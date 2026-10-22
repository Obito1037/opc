"""Development helper: record already downloaded auxiliary models in the lock.

Does not perform inference or download data. Weight hashes must match the
official metadata before the combined installation manifest is published.
"""
import hashlib, json
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
models=ROOT/'runtime/vton-v4/models'
lock=Path(__file__).with_name('models.lock.json')
manifest=json.loads(lock.read_text(encoding='utf-8'))
source=json.loads((models/'parser/source.json').read_text(encoding='utf-8-sig'))
trees=[('parser',source['repository'],source['revision'],json.loads((models/'parser/tree.json').read_text(encoding='utf-8-sig'))),
       ('catvton','zhengchong/CatVTON','2969fcf85fe62f2036605716f0b56f0b81d01d79',json.loads((models/'catvton/vitonhd-16k-512/attention/metadata.json').read_text(encoding='utf-8-sig')))]
existing={item['local']:item for item in manifest['files']}
for folder,repo,revision,tree in trees:
    if isinstance(tree,dict):tree=tree.get('value',[tree])
    for item in tree:
        if item.get('type')!='file':continue
        name=item['path'];file=models/folder/name
        if not file.is_file():continue
        if name not in ['config.json','preprocessor_config.json','model.safetensors','README.md','vitonhd-16k-512/attention/model.safetensors']:continue
        digest=hashlib.file_digest(file.open('rb'),'sha256').hexdigest()
        if item.get('lfs') and digest!=item['lfs']['oid']:raise ValueError('Checkpoint hash mismatch')
        existing[folder+'/'+name]={'local':folder+'/'+name,'url':f'https://huggingface.co/{repo}/resolve/{revision}/{name}','size':file.stat().st_size,'sha256':digest}
manifest['files']=list(existing.values())
if not any(s['repo']==source['repository'] for s in manifest['sources']):
    manifest['sources'].append({'repo':source['repository'],'revision':source['revision'],'license':'nvidia-segformer'})
lock.write_text(json.dumps(manifest,indent=2),encoding='utf-8')
manifest['verified']=True
(models/'manifest.json').write_text(json.dumps(manifest,indent=2),encoding='utf-8')
print(json.dumps({'files':len(manifest['files']),'bytes':sum(x['size'] for x in manifest['files'])}))
