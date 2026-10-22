"""CPU-light decoded frame diagnostics; no learned identity score or torch."""
from pathlib import Path
import json
import hashlib
import argparse
import av
import numpy as np
from PIL import Image, ImageOps, ImageDraw

ROOT=Path(__file__).resolve().parents[2]
p=argparse.ArgumentParser()
p.add_argument('--video',type=Path,default=ROOT/'test-results/motion-v4/tps-user-pipeline-quarter-24.mp4')
p.add_argument('--source',type=Path,default=ROOT/'public/demo/studio-model-v2.png')
p.add_argument('--regions',choices=['studio','taichi'],default='studio')
args=p.parse_args()
filename=args.video
folder=filename.parent
with av.open(str(filename)) as c:
    decoded=list(c.decode(video=0))
    times=[float(f.time) for f in decoded]
    arrays=[f.to_ndarray(format='rgb24').astype(np.float32) for f in decoded]
images=[Image.fromarray(a.astype(np.uint8)) for a in arrays]
first=arrays[0]
source=ImageOps.exif_transpose(Image.open(args.source)).convert('RGB')
source=ImageOps.pad(source,(256,256),method=Image.Resampling.LANCZOS,color=source.getpixel((0,0)))
source_array=np.array(source,dtype=np.float32)
regions={'face':(106,8,151,64),'shirt':(93,64,165,139),'legs':(96,139,164,242),'left_background':(8,10,70,240),'right_background':(190,10,248,240)}
if args.regions=='taichi':
    regions={'face':(113,43,143,79),'shirt':(99,79,155,165),'legs':(107,165,151,245),'left_background':(8,10,80,240),'right_background':(180,10,248,240)}
def crop(a,box):
    x0,y0,x1,y1=box
    return a[y0:y1,x0:x1]
def mae(a,b):
    return float(np.abs(a-b).mean())
adjacent=[mae(a,b) for a,b in zip(arrays,arrays[1:])]
gray=[a.mean(axis=2) for a in arrays]
gradients=[np.stack(np.gradient(a),axis=2) for a in gray]
shifts={}
for name,box in list(regions.items())[:3]:
    ref=crop(gradients[0],box)
    x0,y0,x1,y1=box
    shifts[name]=[]
    for i,g in enumerate(gradients):
        candidates=[]
        for dy in range(-6,7):
            for dx in range(-6,7):
                target=g[y0+dy:y1+dy,x0+dx:x1+dx]
                if target.shape==ref.shape:
                    candidates.append((mae(ref,target),abs(dx)+abs(dy),dx,dy))
        score,_,dx,dy=min(candidates)
        shifts[name].append({'frame':i+1,'dx':dx,'dy':dy,'gradientMAE':round(score,4)})
report={
    'frames':len(arrays),'timestampsSeconds':times,'durationSeconds':times[-1]+1/8,
    'uniqueDecodedFrames':len({hashlib.sha256(a.astype(np.uint8).tobytes()).hexdigest() for a in arrays}),
    'adjacentFrameMAE':adjacent,'maxAdjacentMAE':max(adjacent),'meanAdjacentMAE':float(np.mean(adjacent)),
    'firstToLastMAE':mae(first,arrays[-1]),'firstFrameSourceMAE':mae(first,source_array),
    'regions':{name:{'firstFrameSourceMAE':mae(crop(first,box),crop(source_array,box)),
        'firstToLastMAE':mae(crop(first,box),crop(arrays[-1],box)),
        'maxAdjacentMAE':max(mae(crop(a,box),crop(b,box)) for a,b in zip(arrays,arrays[1:]))} for name,box in regions.items()},
    'estimatedIntegerPixelShifts':shifts,
    'limitations':'Manual ROIs and local gradient matching estimate visible pixel movement, not true pose/identity validation. H264 compression and neural resynthesis contribute to pixel differences. No face recognition model is used.',
}
filename.with_suffix('.visual-metrics.json').write_text(json.dumps(report,indent=2),encoding='utf-8')
sheet=Image.new('RGB',(256*4,280*2),'#202020')
draw=ImageDraw.Draw(sheet)
for i,(label,im) in enumerate([('Source 256px',source),('Neural frame 1',images[0]),('Neural frame 12',images[11]),('Neural frame 24',images[-1])]):
    sheet.paste(im,(256*i,24)); draw.text((256*i+8,6),label,fill='white')
    face=im.crop(regions['face']).resize((180,224),Image.Resampling.NEAREST)
    sheet.paste(face,(256*i+38,304)); draw.text((256*i+8,286),'Face crop (nearest x4)',fill='white')
sheet.save(filename.with_suffix('.identity-review.png'))
print(json.dumps({k:v for k,v in report.items() if k not in ['estimatedIntegerPixelShifts','adjacentFrameMAE','timestampsSeconds']},ensure_ascii=False))
