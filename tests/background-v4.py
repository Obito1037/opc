"""Verify background compositing without another diffusion call.

Uses the actual API result as a diagnostic input; does not modify API jobs.
"""
import sys,json
from pathlib import Path
import numpy as np
from PIL import Image
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'scripts/vton-v4'))
from background import generated_background,suppress_shared_background
folder=ROOT/'test-results/generation-v4/real-production'
source=Image.open(ROOT/'public/demo/studio-model-v2.png').convert('RGB')
source.thumbnail((1280,1280),Image.Resampling.LANCZOS)
result=Image.open(folder/'tryon-api-result.png').convert('RGB')
labels=np.asarray(Image.open(ROOT/'test-results/vton-v4/quality-semantic-24/parsing.png'))
original_bg=Image.fromarray((np.max(labels,axis=-1)==0).astype(np.uint8)*255).resize(source.size,Image.Resampling.NEAREST)
predicted_bg=generated_background(result)
alpha=suppress_shared_background(Image.new('L',source.size,255),original_bg,predicted_bg)
fixed=Image.composite(result,source,alpha)
fixed.save(folder/'background-composite-diagnostic.png')
shared=(np.asarray(original_bg)>0)&(np.asarray(predicted_bg)>0)
assert np.array_equal(np.asarray(fixed)[shared],np.asarray(source)[shared])
outside=~shared
assert np.array_equal(np.asarray(fixed)[outside],np.asarray(result)[outside])
changed=np.any(np.asarray(fixed)!=np.asarray(result),axis=-1)
report={'passed':True,'diffusionCalled':False,'diagnosticOnly':True,'changedPixels':int(changed.sum()),'sharedBackgroundExactlyPreserved':True,'otherGeneratedPixelsUnchanged':True}
(folder/'background-composite-check.json').write_text(json.dumps(report,indent=2),encoding='utf-8')
print(json.dumps(report))
