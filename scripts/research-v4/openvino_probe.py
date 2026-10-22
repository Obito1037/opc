"""Local device + real clothing-segmentation inference probe; not a try-on generator.

Runs an already-installed MediaPipe TFLite model with OpenVINO CPU / Intel GPU.
No photo is uploaded, no diffusion weights are downloaded, no remote inference.
"""
from pathlib import Path
import ctypes, gc, hashlib, json, os, platform, statistics, sys, time
import numpy as np
from PIL import Image
import openvino as ov

ROOT = Path(__file__).resolve().parents[2]
OUT = Path(__file__).resolve().parent / 'results'
OUT.mkdir(exist_ok=True)

class Memory(ctypes.Structure):
    _fields_ = [('length', ctypes.c_ulong), ('load', ctypes.c_ulong)] + [(n, ctypes.c_ulonglong) for n in ['total','free','page_total','page_free','virtual_total','virtual_free','extended']]

def memory():
    m = Memory(); m.length = ctypes.sizeof(m)
    ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(m))
    return {'totalGiB': round(m.total / 2**30, 3), 'freeGiB': round(m.free / 2**30, 3)}

model_path = ROOT / 'public/models/selfie_multiclass_256x256.tflite'
image_path = ROOT / 'public/demo/studio-model-v2.png'
core = ov.Core()
report = {'purpose': 'Device and real clothing segmentation inference; NOT clothing synthesis or motion generation', 'python': sys.version, 'runtime': ov.__version__, 'platform': platform.platform(), 'memoryBefore': memory(), 'devices': {}, 'model': {'path': str(model_path), 'bytes': model_path.stat().st_size, 'sha256': hashlib.sha256(model_path.read_bytes()).hexdigest()}, 'input': {'path': str(image_path), 'source': 'Explicitly AI-generated demo photo from v0.2; no user media'}, 'samples': []}
for device in core.available_devices:
    report['devices'][device] = core.get_property(device, 'FULL_DEVICE_NAME')
model = core.read_model(model_path)
report['model']['inputs'] = [str(x.shape) for x in model.inputs]
report['model']['outputs'] = [str(x.shape) for x in model.outputs]
img = Image.open(image_path).convert('RGB').resize((256,256), Image.Resampling.BILINEAR)
image_input = np.asarray(img, dtype=np.float32)[None] / 255.0
cpu_labels = None
for device in ['CPU', 'GPU']:
    if device not in core.available_devices:
        continue
    try:
        start = time.perf_counter()
        settings = {'PERFORMANCE_HINT': 'LATENCY'}
        if device == 'CPU': settings['INFERENCE_NUM_THREADS'] = 4
        compiled = core.compile_model(model, device, settings)
        compile_s = time.perf_counter()-start
        result = compiled([image_input])[compiled.output(0)]
        times=[]
        for _ in range(30):
            start=time.perf_counter(); result=compiled([image_input])[compiled.output(0)];times.append((time.perf_counter()-start)*1000)
        labels = result[0].argmax(axis=-1).astype(np.uint8)
        palette=np.array([[14,18,25],[70,55,35],[217,165,123],[232,196,163],[95,160,211],[152,110,179]],dtype=np.uint8)
        Image.fromarray(palette[labels]).save(OUT / f'clothing-segmentation-{device.lower()}.png')
        Image.fromarray(np.uint8(labels == 4)*255).save(OUT / f'clothing-mask-{device.lower()}.png')
        row={'device':device,'compileSeconds':round(compile_s,3),'medianMs':round(statistics.median(times),3),'p95Ms':round(sorted(times)[28],3),'runs':len(times),'shape':list(result.shape),'finite':bool(np.isfinite(result).all()),'classPixelCounts':np.bincount(labels.ravel(),minlength=6).tolist(),'memory':memory()}
        if device == 'CPU': cpu_labels=labels.copy()
        elif cpu_labels is not None: row['labelAgreementWithCPU']=round(float(np.mean(cpu_labels==labels)),6)
        report['samples'].append(row); print(json.dumps(row),flush=True)
        del compiled,result;gc.collect()
    except Exception as error:
        report['samples'].append({'device':device,'error':str(error)})
report['memoryAfter']=memory()
report['limitations']='30 short runs on one shared development machine, 256px segmentation only; cannot predict diffusion RAM, generation time, image quality or full-body animation.'
(OUT / 'openvino-probe.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps(report,ensure_ascii=False,indent=2))
