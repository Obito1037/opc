"""Download only required public weights, pin revisions and verify LFS SHA256.

No inference service is called, no credentials are read, no media is uploaded.
Interrupted downloads resume into a .partial file; never count one as a model.
"""
import concurrent.futures, hashlib, json, os, time, urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'runtime/vton-v4/models'
FILES = {
    'stable-diffusion-v1-5/stable-diffusion-inpainting': ('base', [
        'unet/config.json', 'unet/diffusion_pytorch_model.fp16.safetensors',
        'scheduler/scheduler_config.json', 'feature_extractor/preprocessor_config.json',
        'safety_checker/config.json', 'safety_checker/model.fp16.safetensors', 'README.md']),
    'stabilityai/sd-vae-ft-mse': ('vae', ['config.json', 'diffusion_pytorch_model.safetensors', 'README.md']),
    'zhengchong/CatVTON': ('catvton', ['mix-48k-1024/attention/model.safetensors', 'README.md']),
}

def read_json(url):
    with urllib.request.urlopen(url, timeout=120) as response:
        return json.load(response)

def sha256(file):
    h = hashlib.sha256()
    with file.open('rb') as stream:
        for chunk in iter(lambda: stream.read(4*1024*1024), b''): h.update(chunk)
    return h.hexdigest()

def download(item):
    target = OUT / item['local']; target.parent.mkdir(parents=True, exist_ok=True)
    expected, digest = item['size'], item.get('sha256')
    if target.exists() and target.stat().st_size == expected and (not digest or sha256(target) == digest):
        print(json.dumps({'file':item['local'], 'status':'verified-existing'}), flush=True); return
    partial = target.with_suffix(target.suffix + '.partial')
    for attempt in range(6):
        offset = partial.stat().st_size if partial.exists() else 0
        if offset == expected: break
        if offset > expected: partial.unlink(); offset = 0
        headers = {'User-Agent':'Yingshen-local-model-setup/0.4'}
        if offset: headers['Range'] = f'bytes={offset}-'
        request = urllib.request.Request(item['url'], headers=headers)
        try:
            with urllib.request.urlopen(request, timeout=120) as response:
                append = offset > 0 and response.status == 206
                if not append: offset = 0
                with partial.open('ab' if append else 'wb') as stream:
                    last = time.monotonic()
                    while True:
                        chunk = response.read(1024*1024)
                        if not chunk: break
                        stream.write(chunk); offset += len(chunk)
                        if offset > expected: raise ValueError('Model exceeds advertised size')
                        if time.monotonic() - last > 15:
                            print(json.dumps({'file':item['local'],'bytes':offset,'total':expected}), flush=True); last = time.monotonic()
            if partial.stat().st_size == expected: break
        except Exception as error:
            print(json.dumps({'file':item['local'],'attempt':attempt+1,'error':str(error)}),flush=True)
            if attempt == 5: raise
            time.sleep(min(2**attempt,15))
    if not partial.exists() or partial.stat().st_size != expected: raise ValueError(f'Incomplete model: {target.name}')
    if digest and sha256(partial) != digest: raise ValueError(f'Model hash mismatch: {target.name}')
    os.replace(partial, target)
    print(json.dumps({'file':item['local'],'status':'verified','bytes':expected}), flush=True)

def main():
    OUT.mkdir(parents=True, exist_ok=True)
    lock=Path(__file__).with_name('models.lock.json')
    if lock.exists():
        manifest=json.loads(lock.read_text(encoding='utf-8'))
        items=manifest['files']
        print(json.dumps({'totalBytes':sum(x['size'] for x in items),'fileCount':len(items),'pinned':True}),flush=True)
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool: list(pool.map(download,items))
        manifest['verified']=True
        (OUT/'manifest.json').write_text(json.dumps(manifest,indent=2),encoding='utf-8')
        return
    items=[]; sources=[]
    for repo,(folder,files) in FILES.items():
        info=read_json('https://huggingface.co/api/models/'+repo)
        revision=info['sha']
        tree=read_json('https://huggingface.co/api/models/'+repo+'/tree/'+revision+'?recursive=true')
        indexed={x['path']:x for x in tree if x['type']=='file'}
        sources.append({'repo':repo,'revision':revision,'license':info.get('cardData',{}).get('license')})
        for filename in files:
            meta=indexed[filename]
            items.append({'local':folder+'/'+filename,'url':f'https://huggingface.co/{repo}/resolve/{revision}/{filename}',
                          'size':meta['size'],'sha256':meta.get('lfs',{}).get('oid')})
    manifest={'sources':sources,'files':items,'createdAt':time.time(),'purpose':'Local CatVTON research inference. Retain upstream license restrictions.'}
    (OUT/'download-manifest.json').write_text(json.dumps(manifest,indent=2),encoding='utf-8')
    print(json.dumps({'totalBytes':sum(x['size'] for x in items),'fileCount':len(items)}),flush=True)
    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool: list(pool.map(download,items))
    manifest['verified']=True
    (OUT/'manifest.json').write_text(json.dumps(manifest,indent=2),encoding='utf-8')

if __name__ == '__main__': main()
