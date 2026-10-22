"""One cold CPU Conv2d call per dtype; no model weights loaded."""
import json
import time
import torch

torch.set_num_threads(4)
torch.set_num_interop_threads(1)
torch.manual_seed(42)
print(json.dumps({'torch': torch.__version__, 'threads': 4, 'mkldnn': torch.backends.mkldnn.enabled}), flush=True)
base = torch.nn.Conv2d(320,320,3,padding=1).eval()
source = torch.randn(1,320,96,32)
results = []
with torch.inference_mode():
    for dtype in [torch.float32, torch.float16]:
        layer = torch.nn.Conv2d(320,320,3,padding=1).eval().to(dtype)
        layer.load_state_dict(base.state_dict())
        x = source.to(dtype)
        print(json.dumps({'stage':'starting','dtype':str(dtype)}), flush=True)
        start = time.perf_counter()
        y = layer(x)
        elapsed = time.perf_counter()-start
        result = {'dtype':str(dtype),'seconds':elapsed,'finite':bool(torch.isfinite(y).all()),'shape':list(y.shape)}
        results.append(result)
        print(json.dumps(result), flush=True)
print(json.dumps({'results': results}), flush=True)
