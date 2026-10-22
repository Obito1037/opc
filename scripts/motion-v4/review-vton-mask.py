"""Read-only morphology review on synthetic label maps; never loads a model."""
from pathlib import Path
import ast
import hashlib
import json
import numpy as np
from scipy import ndimage
from PIL import Image,ImageFilter

ROOT=Path(__file__).resolve().parents[2]
source=ROOT/'scripts/vton-v4/garment_mask.py'
code=source.read_text(encoding='utf-8')
function=next(n for n in ast.parse(code).body if isinstance(n,ast.FunctionDef))
begin=next(i for i,n in enumerate(function.body) if isinstance(n,ast.Assign) and any(isinstance(t,ast.Name) and t.id=='body' for t in n.targets))
end=next(i for i,n in enumerate(function.body) if isinstance(n,ast.If) and isinstance(n.test,ast.Name) and n.test.id=='diagnostics')
algorithm=compile(ast.fix_missing_locations(ast.Module(body=function.body[begin:end],type_ignores=[])),str(source),'exec')
def mask(labels,category):
    scope={'labels':labels,'category':category,'np':np,'ndimage':ndimage,'Image':Image,'person':Image.new('RGB',(384,576))}
    exec(algorithm,scope)
    return np.asarray(scope['mask']),scope['n']

cases=[]
labels=np.zeros((576,384),dtype=np.uint8)
labels[45:85,170:210]=1
labels[85:470,140:244]=4
labels[470:510,150:230]=15
m,n=mask(labels,'tops')
cases.append({'case':'tops_on_dress','lowerDressPixelsEdited':int(np.count_nonzero(m[300:450,150:234])),
              'lowerDressPixels':150*84,'connectedComponents':int(n)})

labels=np.zeros((576,384),dtype=np.uint8)
for x in [60,230]:
    labels[55:100,x+15:x+55]=1
    labels[100:250,x:x+70]=3
    labels[250:450,x+5:x+65]=6
labels[200:211,125:235]=3 # Two foreground bodies touch at an arm/garment bridge.
m,n=mask(labels,'tops')
cases.append({'case':'two_touching_people','connectedComponents':int(n),
              'firstPersonTopEdited':int(np.count_nonzero(m[100:250,60:130])),
              'secondPersonTopEdited':int(np.count_nonzero(m[100:250,230:300]))})

labels=np.zeros((576,384),dtype=np.uint8)
labels[45:90,170:210]=1
labels[90:210,140:244]=3
labels[210:240,145:239]=16
labels[240:320,140:244]=6
labels[320:500,150:235]=14
labels[500:530,145:240]=15
m,n=mask(labels,'one-pieces')
cases.append({'case':'onepiece_from_cropped_top_and_shorts','bareWaistMiddleEdited':int(np.count_nonzero(m[221:229,160:224])),
              'bareLegMiddleEdited':int(np.count_nonzero(m[400:450,160:224]))})

labels=np.zeros((576,384),dtype=np.uint8)
labels[45:85,170:210]=1
labels[85:300,130:254]=3
labels[300:500,140:244]=6
labels[140:200,170:200]=13 # Hand lying over the garment.
labels[210:240,160:220]=12 # Exposed forearm lying over the garment.
m,n=mask(labels,'tops')
soft=np.asarray(Image.fromarray(m).filter(ImageFilter.GaussianBlur(576/450)))
cases.append({'case':'protect_hand_then_final_alpha_blur','handHardMaskPixels':int(np.count_nonzero(m[labels==13])),
              'handSoftAlphaPixels':int(np.count_nonzero(soft[labels==13])),
              'handSoftAlphaMax':int(soft[labels==13].max()),
              'bareArmEditedFraction':float(np.count_nonzero(m[labels==12])/np.count_nonzero(labels==12))})

report={'source':str(source.relative_to(ROOT)),'sourceSha256':hashlib.sha256(code.encode()).hexdigest(),
        'method':'Execute only AST-selected morphology statements from existing file on synthetic labels; no parser/diffusion model.',
        'modelInference':False,'cases':cases}
out=ROOT/'test-results/motion-v4/vton-mask-review.json'
out.write_text(json.dumps(report,indent=2),encoding='utf-8')
print(json.dumps(report))
