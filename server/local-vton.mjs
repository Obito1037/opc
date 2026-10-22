/** Actual isolated CPU inference. Never returns a fixture or fallback image. */
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {readFile,realpath,stat,mkdir,rm} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {validateImage,MAX_IMAGE_BYTES} from './image-validation.mjs';
import {resolveTryOnSeed} from './tryon-seed.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
// Neither an OS error nor a runner-supplied code/message is a public string.
// Rebuild errors from this allowlist; even a known code cannot carry raw text.
const safeMessages=Object.freeze({
  NOT_CONFIGURED:'本地 CatVTON 模型或运行环境未准备好，请完成安装后重启服务。',
  BUSY:'本机已有生成任务，请等待完成。',
  INVALID_CATEGORY:'服装类型无效。',
  INVALID_SEED:'种子须为 0–2147483647 的整数。',
  UNSUPPORTED_PHOTO_TYPE:'本机试衣目前支持平铺或白底商品图，请选择这类图片。',
  INVALID_PATH:'输入图片必须位于本机任务目录。',
  INVALID_IMAGE:'输入图片无效或超过限制，请重新选择图片。',
  PERSON_NOT_FOUND:'没有识别到可靠的人物轮廓，请选择清晰的单人正面照片。',
  MULTIPLE_PEOPLE:'照片中有多个人物，请裁切为清晰的单人照片后重试。',
  UNSUPPORTED_SOURCE_GARMENT:'原图是连衣裙，暂不能只替换上装。请选择连体衣模式或换用上衣照片。',
  REGION_NOT_FOUND:'没有可靠识别到所选服装区域，请检查服装品类并换一张清晰照片。',
  INVALID_OUTPUT:'本机生成文件无效或超过图片大小限制。',
  INVALID_PROGRESS:'本地模型日志异常，生成已停止。',
  LOCAL_START_FAILED:'无法启动本机推理环境，请检查安装。',
  LOCAL_IO_ERROR:'无法读取或保存本机生成文件，请检查文件是否存在及目录是否可写。',
  LOCAL_MEMORY_EXHAUSTED:'本机可用内存不足，生成已停止。',
  LOCAL_INFERENCE_FAILED:'本机模型执行失败，没有返回替代图片。',
  LOCAL_TIMEOUT:'本机生成超时，已停止。',
  ABORTED:'本机生成已取消。',
});
const error=code=>{const safeCode=typeof code==='string'&&Object.hasOwn(safeMessages,code)?code:'LOCAL_INFERENCE_FAILED';return Object.assign(new Error(safeMessages[safeCode]),{code:safeCode});};
function publicError(cause){
  if(cause?.name==='TimeoutError')return error('LOCAL_TIMEOUT');
  if(cause?.name==='AbortError'||cause?.code==='ABORT_ERR')return error('ABORTED');
  if(['ENOENT','EACCES','EPERM','ENOTDIR','EISDIR','ENOSPC','EROFS','EMFILE'].includes(cause?.code))return error('LOCAL_IO_ERROR');
  return error(cause?.code);
}
const progressMessages=new Set(['正在本机识别服装区域','正在编码人物与商品图片','正在加载本机换衣模型，首次加载需要一些时间','模型已加载，开始逐步生成服装','正在还原面料细节','正在检查生成结果','本机试穿已生成']);
function publicProgress(event){
  const validStep=Number.isInteger(event.step)&&Number.isInteger(event.totalSteps)&&event.totalSteps>0&&event.totalSteps<=10000&&event.step>=0&&event.step<=event.totalSteps;
  return {status:event.status,message:validStep?`正在生成服装细节 · ${event.step}/${event.totalSteps}`:progressMessages.has(event.message)?event.message:'正在本机生成',
    ...(validStep?{step:event.step,totalSteps:event.totalSteps}:{})};
}
const required=['base/unet/config.json','base/unet/diffusion_pytorch_model.fp16.safetensors','base/scheduler/scheduler_config.json','base/safety_checker/config.json','base/safety_checker/model.fp16.safetensors','base/feature_extractor/preprocessor_config.json','vae/config.json','vae/diffusion_pytorch_model.safetensors','catvton/mix-48k-1024/attention/model.safetensors','catvton/vitonhd-16k-512/attention/model.safetensors','parser/model.safetensors','parser/config.json'];

export async function createLocalVtonProvider({env=process.env,inputRoot,outputRoot}={}){
  const python=path.resolve(env.TRYON_LOCAL_PYTHON||path.join(root,'runtime/vton-v4/.venv/Scripts/python.exe'));
  const script=path.resolve(env.TRYON_LOCAL_SCRIPT||path.join(root,'scripts/vton-v4/infer.py'));
  const modelDir=path.resolve(env.TRYON_LOCAL_MODEL_DIR||path.join(root,'runtime/vton-v4/models'));
  let configured=false,configurationMessage='',busy=false,verifiedGeneration=false,lastError=null;
  try{
    await Promise.all([stat(python),stat(script)]);
    const manifest=JSON.parse(await readFile(path.join(modelDir,'manifest.json'),'utf8'));
    if(manifest.verified!==true)throw new Error('模型校验尚未完成');
    for(const name of required){const expected=manifest.files?.find(item=>item.local===name),file=await stat(path.join(modelDir,name));if(!expected||file.size!==expected.size)throw new Error('模型文件不完整');}
    configured=true;
  }catch{configurationMessage='本地 CatVTON 模型或运行环境未准备好，请完成安装后重启服务。';}
  const name='CatVTON · 本机实验试衣';
  const getProviderStatus=()=>({configured,available:configured&&verifiedGeneration&&!lastError,verifiedGeneration,busy,kind:'local-catvton',name,remote:false,maxDurationMs:30*60*1000,garmentPhotoTypes:['flat-lay'],
    message:!configured?configurationMessage:lastError?.message||'本机生成，通常需要数分钟。研究模型可能改变图案与衣物细节，仅供非商业参赛研究。',
    lastError:lastError?{code:lastError.code,message:lastError.message}:null});
  async function checkInput(file){
    const base=await realpath(inputRoot),actual=await realpath(file),relative=path.relative(base,actual);
    if(!relative||relative.startsWith('..')||path.isAbsolute(relative))throw error('INVALID_PATH');
    const info=await stat(actual);if(!info.isFile()||info.size>MAX_IMAGE_BYTES)throw error('INVALID_IMAGE');
    validateImage(await readFile(actual));return actual;
  }
  async function submitTryOn({personPath,garmentPath,category='tops',garmentPhotoType='flat-lay',seed,signal,onProgress=()=>{}}={}){
    if(!configured)throw error('NOT_CONFIGURED');
    if(busy)throw error('BUSY');
    if(!['tops','bottoms','one-pieces'].includes(category)||!['flat-lay','model'].includes(garmentPhotoType))throw error('INVALID_CATEGORY');
    if(garmentPhotoType!=='flat-lay')throw error('UNSUPPORTED_PHOTO_TYPE');
    if(signal?.aborted)throw error('ABORTED');const resolvedSeed=resolveTryOnSeed(seed);busy=true;let output;
    try{
      const [person,garment]=await Promise.all([checkInput(personPath),checkInput(garmentPath)]);
      await mkdir(outputRoot,{recursive:true});output=path.join(path.resolve(outputRoot),randomUUID()+'.png');
      onProgress({status:'running',message:'正在启动本机换衣模型'});
      const timeoutSignal=AbortSignal.timeout(30*60*1000),combined=signal?AbortSignal.any([signal,timeoutSignal]):timeoutSignal;
      await new Promise((resolve,reject)=>{
        const child=spawn(python,['-u',script,'--person',person,'--garment',garment,'--output',output,'--model-dir',modelDir,'--category',category,'--seed',String(resolvedSeed)],
          {cwd:root,windowsHide:true,shell:false,stdio:['ignore','pipe','pipe'],env:{...process.env,HF_HUB_OFFLINE:'1',TRANSFORMERS_OFFLINE:'1',HF_HUB_DISABLE_TELEMETRY:'1',PYTHONIOENCODING:'utf-8'}});
        let pending='',stderr='',failure=null,settled=false;
        const finish=(cause)=>{if(settled)return;settled=true;combined.removeEventListener('abort',abort);cause?reject(cause):resolve();};
        const abort=()=>{child.kill();};combined.addEventListener('abort',abort,{once:true});if(combined.aborted)abort();
        child.stdout.setEncoding('utf8');child.stderr.setEncoding('utf8');
        child.stdout.on('data',chunk=>{
          pending+=chunk;if(pending.length>65536){failure=error('INVALID_PROGRESS');child.kill();return;}
          let newline;while((newline=pending.indexOf('\n'))>=0){
            const line=pending.slice(0,newline);pending=pending.slice(newline+1);let event;
            try{event=JSON.parse(line);}catch{continue;}
            if(!event||typeof event!=='object'||Array.isArray(event))continue;
            if(event.status==='failed')failure=error(event.code);
            else if(['running','completed'].includes(event.status))onProgress(publicProgress(event));
          }
        });
        child.stderr.on('data',chunk=>{stderr=(stderr+chunk.toString()).slice(-4000);});
        child.on('error',()=>finish(error('LOCAL_START_FAILED')));
        child.on('close',code=>{if(combined.aborted)return finish(error(timeoutSignal.aborted?'LOCAL_TIMEOUT':'ABORTED'));if(failure)return finish(failure);if(code!==0)return finish(error(/memory|alloc/i.test(stderr)?'LOCAL_MEMORY_EXHAUSTED':'LOCAL_INFERENCE_FAILED'));finish();});
      });
      combined.throwIfAborted();const info=await stat(output);if(!info.isFile()||info.size>MAX_IMAGE_BYTES||info.size<12)throw error('INVALID_OUTPUT');
      const bytes=await readFile(output);combined.throwIfAborted();const details=validateImage(bytes);verifiedGeneration=true;lastError=null;
      return {filePath:output,mimeType:details.mimeType||'image/png',provider:name,generated:true,seed:resolvedSeed};
    }catch(cause){if(output)await rm(output,{force:true}).catch(()=>{});const safe=publicError(cause);lastError={code:safe.code,message:safe.message};throw safe;}
    finally{busy=false;}
  }
  return {getProviderStatus,submitTryOn};
}
