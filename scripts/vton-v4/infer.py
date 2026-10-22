"""Low-memory CPU CatVTON runner. JSONL progress is consumed by the local API.

Reuses CatVTON attention modules and denoising algorithm (CC BY-NC-SA 4.0).
Derivative work licensed CC BY-NC-SA 4.0; see upstream/LICENSE.
Weights stay local. Models are loaded in stages; no network fallback is allowed.
The original Stable Diffusion safety checker is retained and run before saving.
"""
import argparse, gc, json, os, sys, time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
os.environ['HF_HUB_OFFLINE'] = '1'
os.environ['TRANSFORMERS_OFFLINE'] = '1'
os.environ['HF_HUB_DISABLE_TELEMETRY'] = '1'
os.environ['TOKENIZERS_PARALLELISM'] = 'false'
os.environ['HF_HOME'] = str(ROOT/'runtime/vton-v4/cache')
os.environ['TRANSFORMERS_CACHE'] = str(ROOT/'runtime/vton-v4/cache/transformers')
sys.path.insert(0, str(ROOT/'asset-sources/catvton-v4/upstream'))

def emit(stage, message, **extra):
    print(json.dumps({'status':stage,'message':message,**extra},ensure_ascii=False),flush=True)

def auto_mask(person, category, output_dir):
    import numpy as np
    from PIL import Image, ImageFilter
    import openvino as ov
    from scipy import ndimage
    emit('running','正在本机识别服装区域')
    core=ov.Core(); model=core.compile_model(ROOT/'public/models/selfie_multiclass_256x256.tflite','CPU',{'INFERENCE_NUM_THREADS':2})
    pixels=np.array(person.resize((256,256)),dtype=np.float32)[None]/255
    scores=model([pixels])[model.output(0)][0]; labels=scores.argmax(axis=-1)
    foreground=labels!=0; components,n=ndimage.label(foreground)
    areas=np.bincount(components.ravel()); areas[0]=0
    if n==0 or areas.max()<1200: raise ValueError('没有可靠的人物轮廓，请选择清晰单人正面照。')
    body=components==areas.argmax(); yy,xx=np.where(body)
    top,bottom=int(yy.min()),int(yy.max()); height=bottom-top
    clothing=(labels==4)&body&(scores[:,:,4]>.55)
    rows=np.arange(256)[:,None]
    # Conservative full-body proportions, not a size measurement. Ambiguous
    # categories fail instead of repainting the whole image.
    cut=top+height*.51
    if category=='tops': region=clothing&(rows<cut)
    elif category=='bottoms': region=clothing&(rows>=cut)
    else: region=clothing
    if region.sum()<180: raise ValueError('目标服装区域不够清晰，无法可靠换衣。请换一张正面全身照片。')
    region=ndimage.binary_fill_holes(region)
    # Give diffusion room around the existing garment while preserving face/hair.
    region=ndimage.binary_dilation(region,iterations=5)
    face=ndimage.binary_dilation((labels==3)|(labels==1),iterations=3)
    region&=~face
    if category=='tops': region&=(rows<cut+3)
    if category=='bottoms': region&=(rows>=cut-3)
    mask=Image.fromarray(region.astype(np.uint8)*255).resize(person.size,Image.Resampling.NEAREST)
    if output_dir: mask.save(output_dir/'mask.png')
    del model,core,scores;gc.collect()
    return mask

def run(args):
    import numpy as np
    import torch
    from PIL import Image, ImageOps, ImageFilter
    from diffusers import AutoencoderKL, UNet2DConditionModel, DDIMScheduler
    from diffusers.pipelines.stable_diffusion.safety_checker import StableDiffusionSafetyChecker
    from transformers import CLIPImageProcessor
    from safetensors.torch import load_file
    from model.utils import init_adapter, get_trainable_module
    from model.attn_processor import SkipAttnProcessor
    from utils import prepare_image, prepare_mask_image, resize_and_padding
    torch.set_num_threads(args.threads);torch.set_num_interop_threads(1)
    torch.manual_seed(args.seed)
    started=time.monotonic(); model_dir=Path(args.model_dir).resolve(); out=Path(args.output).resolve();out.parent.mkdir(parents=True,exist_ok=True)
    diagnostics=Path(args.diagnostics).resolve() if args.diagnostics else None
    if diagnostics: diagnostics.mkdir(parents=True,exist_ok=True)
    if args.checkpoint=='auto':args.checkpoint='vitonhd-16k-512' if args.category=='tops' else 'mix-48k-1024'
    person=ImageOps.exif_transpose(Image.open(args.person)).convert('RGB');person.thumbnail((1280,1280),Image.Resampling.LANCZOS)
    garment=ImageOps.exif_transpose(Image.open(args.garment)).convert('RGB');garment.thumbnail((1600,1600),Image.Resampling.LANCZOS)
    original=person.copy();mask_info={}
    if args.mask:full_mask=Image.open(args.mask).convert('L').resize(person.size,Image.Resampling.NEAREST)
    elif args.masker=='semantic':
        from garment_mask import garment_mask
        emit('running','正在本机识别服装区域')
        full_mask,mask_info=garment_mask(person,args.category,model_dir,diagnostics,return_info=True)
    else:full_mask=auto_mask(person,args.category,diagnostics)
    bounds=full_mask.getbbox()
    if not bounds: raise ValueError('没有可生成的服装区域。')
    bx0,by0,bx1,by1=bounds;bw,bh=bx1-bx0,by1-by0
    # Retain surrounding context: the tighter portrait experiment introduced
    # visible shoulder/background artifacts in the actual local quality run.
    region=(max(0,int(bx0-bw*.6)),max(0,int(by0-bh*.4)),min(person.width,int(bx1+bw*.6)),min(person.height,int(by1+bh*.4)))
    person=person.crop(region);mask=full_mask.crop(region)
    # Uniform light product backgrounds can contain large empty margins.
    # Trim only that background; model-worn images are rejected by the API.
    gp=np.asarray(garment);border=np.concatenate([gp[0],gp[-1],gp[:,0],gp[:,-1]])
    bg=np.median(border,axis=0)
    if bg.min()>210 and np.std(border,axis=0).max()<18:
        foreground=np.max(np.abs(gp.astype(np.float32)-bg),axis=-1)>35
        gy,gx=np.where(foreground)
        if len(gx)>200:
            pad=max(8,int(max(gx.max()-gx.min(),gy.max()-gy.min())*.07))
            garment=garment.crop((max(0,int(gx.min())-pad),max(0,int(gy.min())-pad),min(garment.width,int(gx.max())+pad),min(garment.height,int(gy.max())+pad)))
    # Padding retains the entire person/background and avoids altering the face.
    canvas_size=(args.width,args.height)
    scale=min(args.width/person.width,args.height/person.height)
    resized=(round(person.width*scale),round(person.height*scale)); offset=((args.width-resized[0])//2,(args.height-resized[1])//2)
    canvas=Image.new('RGB',canvas_size,(245,245,245));canvas.paste(person.resize(resized,Image.Resampling.LANCZOS),offset)
    mask_canvas=Image.new('L',canvas_size,0);mask_canvas.paste(mask.resize(resized,Image.Resampling.NEAREST),offset)
    condition=resize_and_padding(garment,canvas_size)
    if diagnostics:
        canvas.save(diagnostics/'person-input.png');condition.save(diagnostics/'garment-input.png');mask_canvas.save(diagnostics/'mask-input.png')
    dtype=torch.float16 if args.precision=='fp16' else torch.float32
    with torch.inference_mode():
        emit('running','正在编码人物与商品图片')
        vae=AutoencoderKL.from_pretrained(model_dir/'vae',torch_dtype=torch.float32,local_files_only=True,use_safetensors=True,low_cpu_mem_usage=True)
        vae.enable_slicing();vae.enable_tiling();vae.eval()
        image=prepare_image(canvas);condition_tensor=prepare_image(condition);mask_tensor=prepare_mask_image(mask_canvas)
        masked_latent=vae.encode(image*(mask_tensor<.5)).latent_dist.sample()*vae.config.scaling_factor
        condition_latent=vae.encode(condition_tensor).latent_dist.sample()*vae.config.scaling_factor
        vae_scale=vae.config.scaling_factor
        del vae,image,condition_tensor;gc.collect()
        masked_latent=masked_latent.to(dtype);condition_latent=condition_latent.to(dtype)
        mask_latent=torch.nn.functional.interpolate(mask_tensor,size=masked_latent.shape[-2:],mode='nearest').to(dtype)
        masked_concat=torch.cat([masked_latent,condition_latent],dim=-2)
        mask_concat=torch.cat([mask_latent,torch.zeros_like(mask_latent)],dim=-2)
        unconditioned=torch.cat([masked_latent,torch.zeros_like(condition_latent)],dim=-2)
        emit('running','正在加载本机换衣模型，首次加载需要一些时间')
        unet=UNet2DConditionModel.from_pretrained(model_dir/'base',subfolder='unet',variant='fp16',torch_dtype=dtype,use_safetensors=True,local_files_only=True,low_cpu_mem_usage=True)
        init_adapter(unet,cross_attn_cls=SkipAttnProcessor)
        attention=get_trainable_module(unet,'attention')
        attention_weights=load_file(model_dir/'catvton'/args.checkpoint/'attention/model.safetensors')
        # Upstream ModuleList includes parent modules and their shared children.
        # Safetensors saves each shared parameter once; require every canonical
        # parameter, while allowing missing duplicate aliases in state_dict.
        canonical=set(dict(attention.named_parameters()))
        if canonical-set(attention_weights):raise ValueError('CatVTON attention checkpoint does not cover all model parameters')
        attention.load_state_dict(attention_weights,strict=False)
        del attention_weights;gc.collect()
        unet.eval()
        scheduler=DDIMScheduler.from_pretrained(model_dir/'base',subfolder='scheduler',local_files_only=True)
        scheduler.set_timesteps(args.steps)
        generator=torch.Generator(device='cpu').manual_seed(args.seed)
        latents=torch.randn(masked_concat.shape,generator=generator,dtype=dtype)*scheduler.init_noise_sigma
        step_times=[]
        emit('running','模型已加载，开始逐步生成服装',step=0,totalSteps=args.steps,loadSeconds=round(time.monotonic()-started,2))
        for index,timestep in enumerate(scheduler.timesteps):
            tick=time.monotonic();scaled=scheduler.scale_model_input(latents,timestep)
            # Sequential CFG keeps the denoising batch at one for lower peak RAM.
            conditional=unet(torch.cat([scaled,mask_concat,masked_concat],dim=1),timestep,encoder_hidden_states=None,return_dict=False)[0]
            if args.guidance>1:
                baseline=unet(torch.cat([scaled,mask_concat,unconditioned],dim=1),timestep,encoder_hidden_states=None,return_dict=False)[0]
                predicted=baseline+args.guidance*(conditional-baseline)
                del baseline
            else:predicted=conditional
            latents=scheduler.step(predicted,timestep,latents,eta=1.,generator=generator).prev_sample
            del conditional,predicted,scaled
            if not torch.isfinite(latents).all(): raise ValueError('模型数值异常，已停止生成；没有返回替代图片。')
            step_times.append(time.monotonic()-tick)
            emit('running',f'正在生成服装细节 · {index+1}/{args.steps}',step=index+1,totalSteps=args.steps,stepSeconds=round(step_times[-1],3))
        del attention,unet;gc.collect()
        emit('running','正在还原面料细节')
        vae=AutoencoderKL.from_pretrained(model_dir/'vae',torch_dtype=torch.float32,local_files_only=True,use_safetensors=True,low_cpu_mem_usage=True)
        vae.enable_slicing();vae.enable_tiling();vae.eval()
        decoded=vae.decode(latents[:,:,:latents.shape[-2]//2,:].float()/vae_scale).sample
        raw=np.uint8(((decoded[0].permute(1,2,0).clamp(-1,1).numpy()+1)*127.5).round())
        del vae,decoded,latents;gc.collect()
        generated=Image.fromarray(raw)
        emit('running','正在检查生成结果')
        checker=StableDiffusionSafetyChecker.from_pretrained(model_dir/'base',subfolder='safety_checker',variant='fp16',torch_dtype=torch.float32,use_safetensors=True,local_files_only=True,low_cpu_mem_usage=True)
        extractor=CLIPImageProcessor.from_pretrained(model_dir/'base',subfolder='feature_extractor',local_files_only=True)
        _,flagged=checker(images=np.array(generated)[None]/255.,clip_input=extractor(images=generated,return_tensors='pt').pixel_values)
        del checker,extractor;gc.collect()
        if any(flagged):raise ValueError('生成结果未通过内容检查，请更换图片后重试。')
        if diagnostics: generated.save(diagnostics/'generated-raw.png')
        box=(offset[0],offset[1],offset[0]+resized[0],offset[1]+resized[1])
        crop=generated.crop(box).resize(person.size,Image.Resampling.LANCZOS)
        layer=original.copy();layer.paste(crop,region[:2])
        from garment_mask import composite_mask
        blend=composite_mask(full_mask,max(original.width,original.height)/450,mask_info.get('protected'))
        result=Image.composite(layer,original,blend)
        result.save(out,'PNG')
        report={'generated':True,'provider':'CatVTON local CPU','checkpoint':args.checkpoint,'elapsedSeconds':time.monotonic()-started,'steps':args.steps,'guidance':args.guidance,'precision':args.precision,'modelSize':canvas_size,'outputSize':original.size,'stepSeconds':step_times,'category':args.category,'seed':args.seed,'safetyCheckPassed':True,'limitations':'Research model. Mask selected with 18-class semantic segmentation and conservative clothing boundaries; clothing shape, texture, sleeve skin and occlusions can differ from product and person.'}
        if diagnostics: (diagnostics/'report.json').write_text(json.dumps(report,indent=2),encoding='utf-8')
        emit('completed','本机试穿已生成',filePath=str(out),elapsedSeconds=round(report['elapsedSeconds'],2))

if __name__=='__main__':
    parser=argparse.ArgumentParser()
    for name in ['person','garment','output']:parser.add_argument('--'+name,required=True)
    parser.add_argument('--model-dir',default=str(ROOT/'runtime/vton-v4/models'))
    parser.add_argument('--category',choices=['tops','bottoms','one-pieces'],default='tops')
    parser.add_argument('--mask');parser.add_argument('--diagnostics')
    parser.add_argument('--masker',choices=['semantic','basic'],default='semantic')
    parser.add_argument('--width',type=int,default=384);parser.add_argument('--height',type=int,default=512)
    parser.add_argument('--steps',type=int,default=24);parser.add_argument('--seed',type=int,default=42)
    parser.add_argument('--guidance',type=float,default=2.5);parser.add_argument('--threads',type=int,default=4)
    parser.add_argument('--precision',choices=['fp16','fp32'],default='fp32')
    parser.add_argument('--checkpoint',choices=['auto','mix-48k-1024','vitonhd-16k-512','dresscode-16k-512'],default='auto')
    args=parser.parse_args()
    try:run(args)
    except Exception as error:
        emit('failed',str(error),code=getattr(error,'code','LOCAL_INFERENCE_FAILED'))
        import traceback;traceback.print_exc(file=sys.stderr);sys.exit(1)
