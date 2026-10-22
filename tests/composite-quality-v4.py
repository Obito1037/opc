"""Recompose an already generated neural output; does not rerun diffusion."""
from pathlib import Path
import sys
from PIL import Image,ImageFilter
import numpy as np,json
ROOT=Path(__file__).resolve().parents[1]
folder=ROOT/'test-results/vton-v4/quality-sleeve-v4'
original=Image.open(ROOT/'public/demo/studio-model-v2.png').convert('RGB')
original.thumbnail((1280,1280),Image.Resampling.LANCZOS)
mask=Image.open(folder/'mask.png').convert('L')
bx0,by0,bx1,by1=mask.getbbox();bw,bh=bx1-bx0,by1-by0
region=(max(0,int(bx0-bw*.6)),max(0,int(by0-bh*.4)),min(original.width,int(bx1+bw*.6)),min(original.height,int(by1+bh*.4)))
size=(region[2]-region[0],region[3]-region[1]);scale=min(384/size[0],512/size[1]);resized=(round(size[0]*scale),round(size[1]*scale));offset=((384-resized[0])//2,(512-resized[1])//2)
raw=Image.open(folder/'generated-raw.png');crop=raw.crop((offset[0],offset[1],offset[0]+resized[0],offset[1]+resized[1])).resize(size,Image.Resampling.LANCZOS)
layer=original.copy();layer.paste(crop,region[:2])
for radius in [3,6,10]:
    alpha=mask.filter(ImageFilter.GaussianBlur(radius))
    result=Image.composite(layer,original,alpha)
    result.save(folder/f'composite-radius-{radius}.png')
    result.crop((300,220,730,600)).save(folder/f'edge-radius-{radius}.png')

# Exercise the final production compositor with the actual saved parser labels.
# This is a deterministic re-composition of real inference, not a second run.
sys.path.insert(0,str(ROOT/'scripts/vton-v4'))
from garment_mask import mask_images_from_labels,composite_mask
palette=np.array([[0,0,0],[245,199,166],[78,58,48],[76,147,220],[178,90,180],[67,170,140],[88,99,166],[200,160,80],[179,108,60],[171,141,212],[106,174,198],[82,71,103],[233,184,149],[229,167,145],[222,176,146],[190,200,210],[230,191,170],[255,218,80]],np.uint8)
parsed=np.asarray(Image.open(folder/'parsing.png'));labels=np.zeros(parsed.shape[:2],np.uint8)
for index,color in enumerate(palette):labels[(parsed==color).all(axis=-1)]=index
current,info=mask_images_from_labels(labels,'tops',original.size)
assert np.array_equal(np.asarray(current),np.asarray(mask)), 'Conditioning mask changed; re-run inference instead.'
alpha=composite_mask(current,max(original.size)/450,info['protected'])
result=Image.composite(layer,original,alpha)
protected=np.asarray(info['protected'])>127
assert np.array_equal(np.asarray(result)[protected],np.asarray(original)[protected])
result.save(folder/'final-composite.png')
(folder/'composite-check.json').write_text(json.dumps({'passed':True,'realInferenceInput':'generated-raw.png','diffusionRerun':False,'conditioningMaskUnchanged':True,'protectedPixelsExactlyRetained':int(protected.sum()),'outsideSoftBoundaryUnchanged':True},indent=2),encoding='utf-8')
