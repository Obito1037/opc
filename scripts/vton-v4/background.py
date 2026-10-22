"""Keep original background wherever both semantic models agree it is empty.

This is result compositing, not an alternative image generation path. It never
removes newly generated clothes that extend beyond the source silhouette.
"""
from pathlib import Path

def generated_background(image):
    import numpy as np
    import openvino as ov
    from PIL import Image
    root=Path(__file__).resolve().parents[2]
    core=ov.Core()
    model=core.compile_model(root/'public/models/selfie_multiclass_256x256.tflite','CPU',{'INFERENCE_NUM_THREADS':2})
    pixels=np.asarray(image.resize((256,256)),dtype=np.float32)[None]/255
    scores=model([pixels])[model.output(0)][0]
    # Only high-confidence background can suppress the generated layer.
    mask=Image.fromarray((scores[:,:,0]>.8).astype(np.uint8)*255)
    return mask.resize(image.size,Image.Resampling.NEAREST)

def suppress_shared_background(alpha, original_background, generated_mask):
    import numpy as np
    from PIL import Image
    values=np.asarray(alpha).copy()
    shared=(np.asarray(original_background)>127)&(np.asarray(generated_mask)>127)
    values[shared]=0
    return Image.fromarray(values,'L')
