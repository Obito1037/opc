import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdir, mkdtemp, writeFile, readFile, readdir, rm, stat } from 'node:fs/promises';
import http from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';
import { createLocalVtonProvider } from '../server/local-vton.mjs';
import { createTryOnApi } from '../server/tryon-api.mjs';

// These explicit standard-library subprocess fixtures test Node boundaries.
// They never import torch/diffusers or load actual model weights, and copying
// the source fixture is not a real try-on result or a production fallback.
const root=path.resolve('test-results/local-vton-protocol-v4');await mkdir(root,{recursive:true});
const python=path.resolve('runtime/vton-v4/.venv/Scripts/python.exe');
const pythonPresent=await stat(python).then(s=>s.isFile()).catch(()=>false);
const png=await readFile('public/demo/studio-model-v2.png');
const required=['base/unet/config.json','base/unet/diffusion_pytorch_model.fp16.safetensors','base/scheduler/scheduler_config.json','base/safety_checker/config.json','base/safety_checker/model.fp16.safetensors','base/feature_extractor/preprocessor_config.json','vae/config.json','vae/diffusion_pytorch_model.safetensors','catvton/mix-48k-1024/attention/model.safetensors','catvton/vitonhd-16k-512/attention/model.safetensors','parser/model.safetensors','parser/config.json'];
async function fixture(t,mode='copy'){
  const folder=await mkdtemp(path.join(root,'case-')),input=path.join(folder,'inputs'),output=path.join(folder,'outputs'),models=path.join(folder,'models');
  await mkdir(input);await mkdir(output);await mkdir(models);await writeFile(path.join(input,'person.png'),png);await writeFile(path.join(input,'garment.png'),png);
  for(const file of required){const full=path.join(models,file);await mkdir(path.dirname(full),{recursive:true});await writeFile(full,'x');}
  await writeFile(path.join(models,'manifest.json'),JSON.stringify({verified:true,files:required.map(local=>({local,size:1}))}));
  await writeFile(path.join(models,'fixture-mode.txt'),mode);
  const script=path.join(folder,'process-fixture.py');
  await writeFile(script,`import argparse, json, os, shutil, sys, time
from pathlib import Path
p=argparse.ArgumentParser()
for key in ['person','garment','output','model-dir','category','seed']: p.add_argument('--'+key)
a=p.parse_args()
m=Path(a.model_dir)
(m/'fixture-seed.json').write_text(json.dumps({'seed':int(a.seed)}))
mode=(m/'fixture-mode.txt').read_text()
(m/'fixture-started.pid').write_text(str(os.getpid()))
if mode=='hold':
 Path(a.output).write_bytes(b'partial-protocol-fixture')
 while True: time.sleep(0.1)
if mode in ['copy','progress']:
 if mode=='progress':
  print('null',flush=True)
  print(json.dumps({'status':'running','message':str(m/'private.log'),'step':1,'totalSteps':3}),flush=True)
  print(json.dumps({'status':'running','message':str(m/'private.log')}),flush=True)
 shutil.copyfile(a.person,a.output)
 print(json.dumps({'status':'completed','message':'ISOLATED PROTOCOL FIXTURE ONLY'}),flush=True)
if mode=='oversize':
 with open(a.output,'wb') as output: output.truncate(12*1024*1024+1)
if mode in ['failed','failed-known']:
 code='LOCAL_INFERENCE_FAILED' if mode=='failed-known' else str(m/'private-code')
 print(json.dumps({'status':'failed','code':code,'message':'Private diagnostic: '+str(m/'private.log')}),flush=True)
 sys.exit(1)
if mode.startswith('mask-'):
 print(json.dumps({'status':'failed','code':mode[5:],'message':'Private parser diagnostic: '+str(m/'private.log')}),flush=True)
 sys.exit(1)
`);
  t.after(async()=>{assert.ok(path.resolve(folder).startsWith(root+path.sep));await rm(folder,{recursive:true,force:true});});
  const env={TRYON_LOCAL_PYTHON:python,TRYON_LOCAL_SCRIPT:script,TRYON_LOCAL_MODEL_DIR:models};
  const provider=await createLocalVtonProvider({env,inputRoot:input,outputRoot:output});
  return{folder,input,output,models,env,provider,args:{personPath:path.join(input,'person.png'),garmentPath:path.join(input,'garment.png')}};
}
function assertPublic(value){
  const text=JSON.stringify(value);assert.doesNotMatch(text,/[A-Za-z]:[\\/]|\/Users\/|\/home\/|\/tmp\/|private\.log|private-code|Traceback|ENOENT|EACCES/);
  assert.ok(!text.includes(root));
}
test('local provider reports configured separately from generation and validates a real child process result',{skip:!pythonPresent},async t=>{
  const f=await fixture(t);assert.equal(f.provider.getProviderStatus().configured,true);assert.equal(f.provider.getProviderStatus().available,false);
  const result=await f.provider.submitTryOn(f.args);assert.equal(result.generated,true);assert.equal(result.mimeType,'image/png');assert.deepEqual(await readFile(result.filePath),png);
  assert.equal(f.provider.getProviderStatus().verifiedGeneration,true);
});
test('local provider rejects outside paths before spawning and rejects missing results',{skip:!pythonPresent},async t=>{
  const f=await fixture(t,'no-output'),outside=path.join(f.folder,'outside.png');await writeFile(outside,png);
  await assert.rejects(f.provider.submitTryOn({...f.args,personPath:outside}),{code:'INVALID_PATH'});
  assert.equal(await stat(path.join(f.models,'fixture-started.pid')).then(()=>true).catch(()=>false),false);
  await assert.rejects(f.provider.submitTryOn(f.args),cause=>{assert.equal(cause.code,'LOCAL_IO_ERROR');assertPublic({code:cause.code,message:cause.message});return true;});assert.equal(f.provider.getProviderStatus().available,false);
  assertPublic(f.provider.getProviderStatus());
  assert.deepEqual(await readdir(f.output),[]);
});
test('local provider cancellation kills its Python child and removes partial output',{skip:!pythonPresent},async t=>{
  const f=await fixture(t,'hold'),controller=new AbortController();
  const task=f.provider.submitTryOn({...f.args,signal:controller.signal});const rejected=assert.rejects(task,{code:'ABORTED'});
  const pidFile=path.join(f.models,'fixture-started.pid');
  for(let i=0;i<100&&!await stat(pidFile).catch(()=>null);i++)await delay(10);
  const pid=Number(await readFile(pidFile,'utf8'));assert.equal(f.provider.getProviderStatus().busy,true);
  await assert.rejects(f.provider.submitTryOn(f.args),{code:'BUSY'});controller.abort();await rejected;
  assert.equal(f.provider.getProviderStatus().busy,false);assert.equal(f.provider.getProviderStatus().verifiedGeneration,false);
  assert.deepEqual(await readdir(f.output),[]);assert.throws(()=>process.kill(pid,0));
});
test('local provider rejects oversized child output and deletes it without verifying generation',{skip:!pythonPresent},async t=>{
  const f=await fixture(t,'oversize');
  await assert.rejects(f.provider.submitTryOn(f.args),{code:'INVALID_OUTPUT'});
  assert.equal(f.provider.getProviderStatus().verifiedGeneration,false);assert.deepEqual(await readdir(f.output),[]);
});
test('pre-aborted request and explicit child failure cannot create successful results',{skip:!pythonPresent},async t=>{
  const f=await fixture(t,'failed'),controller=new AbortController();controller.abort(new Error(f.models));
  await assert.rejects(f.provider.submitTryOn({...f.args,signal:controller.signal}),cause=>{assert.equal(cause.code,'ABORTED');assertPublic({code:cause.code,message:cause.message});return true;});
  assert.equal(await stat(path.join(f.models,'fixture-started.pid')).then(()=>true).catch(()=>false),false);
  await assert.rejects(f.provider.submitTryOn(f.args),cause=>{assert.equal(cause.code,'LOCAL_INFERENCE_FAILED');assertPublic({code:cause.code,message:cause.message});return true;});assert.equal(f.provider.getProviderStatus().verifiedGeneration,false);
  assertPublic(f.provider.getProviderStatus());
});
test('local provider exposes only flat-lay and rejects model product photos before spawning',{skip:!pythonPresent},async t=>{
  const f=await fixture(t);assert.deepEqual(f.provider.getProviderStatus().garmentPhotoTypes,['flat-lay']);
  await assert.rejects(f.provider.submitTryOn({...f.args,garmentPhotoType:'model'}),{code:'UNSUPPORTED_PHOTO_TYPE'});
  assert.equal(await stat(path.join(f.models,'fixture-started.pid')).then(()=>true).catch(()=>false),false);
});

test('local provider passes exact bounded seed to Python and chooses one default seed per invocation',{skip:!pythonPresent},async t=>{
  const f=await fixture(t);
  for(const seed of [0,2147483647,73,73,undefined]){
    const result=await f.provider.submitTryOn({...f.args,...(seed===undefined?{}:{seed})});
    const passed=JSON.parse(await readFile(path.join(f.models,'fixture-seed.json'),'utf8')).seed;
    assert.ok(Number.isInteger(passed)&&passed>=0&&passed<=2147483647);
    assert.equal(result.seed,passed);if(seed!==undefined)assert.equal(passed,seed);
  }
});

test('local provider rejects invalid seeds before spawning or writing output',{skip:!pythonPresent},async t=>{
  const f=await fixture(t);
  for(const seed of [null,-1,2147483648,1.5,'42',true,{},[],NaN,Infinity]){
    await assert.rejects(f.provider.submitTryOn({...f.args,seed}),cause=>{assert.equal(cause.code,'INVALID_SEED');assertPublic({code:cause.code,message:cause.message});return true;});
  }
  assert.equal(await stat(path.join(f.models,'fixture-started.pid')).then(()=>true).catch(()=>false),false);
  assert.deepEqual(await readdir(f.output),[]);assert.equal(f.provider.getProviderStatus().busy,false);
});
test('known runner codes, filesystem failures and progress cannot expose private diagnostics',{skip:!pythonPresent},async t=>{
  const f=await fixture(t,'failed-known');
  await assert.rejects(f.provider.submitTryOn(f.args),cause=>{assert.equal(cause.code,'LOCAL_INFERENCE_FAILED');assertPublic({code:cause.code,message:cause.message});return true;});
  assertPublic(f.provider.getProviderStatus());
  await assert.rejects(f.provider.submitTryOn({...f.args,onProgress:()=>{throw Object.assign(new Error(f.models),{code:'EACCES'});}}),cause=>{assert.equal(cause.code,'LOCAL_IO_ERROR');assertPublic({code:cause.code,message:cause.message});return true;});
  assertPublic(f.provider.getProviderStatus());
  await writeFile(path.join(f.models,'fixture-mode.txt'),'progress');const progress=[];
  await f.provider.submitTryOn({...f.args,onProgress:event=>progress.push(event)});assertPublic(progress);
  assert.ok(progress.some(event=>event.step===1&&event.totalSteps===3));
});
test('HTTP failure records and capabilities cannot publish runner filesystem paths',{skip:!pythonPresent},async t=>{
  const f=await fixture(t,'failed-known'),runtimeRoot=path.join(f.folder,'api');
  const api=await createTryOnApi({runtimeRoot,env:{},providerFactory:options=>createLocalVtonProvider({...options,env:f.env})});
  const server=http.createServer((req,res)=>{api.handle(req,res)});await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`;
  t.after(async()=>{await api.close();await new Promise(r=>server.close(r));});
  const image='data:image/png;base64,'+png.toString('base64');
  const submitted=await(await fetch(base+'/api/tryon/jobs',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({personImage:image,garmentImage:image})})).json();
  let state;for(let i=0;i<100;i++){state=await(await fetch(base+'/api/tryon/jobs/'+submitted.job.id)).json();if(state.job.status==='failed')break;await delay(10);}
  assert.equal(state.job.status,'failed');assert.equal(state.job.error.code,'LOCAL_INFERENCE_FAILED');assertPublic(state);
  assertPublic(await(await fetch(base+'/api/capabilities')).json());
});
test('semantic mask failures expose only fixed Chinese business messages and never runner paths',{skip:!pythonPresent},async t=>{
  const messages={
    PERSON_NOT_FOUND:'没有识别到可靠的人物轮廓，请选择清晰的单人正面照片。',
    MULTIPLE_PEOPLE:'照片中有多个人物，请裁切为清晰的单人照片后重试。',
    UNSUPPORTED_SOURCE_GARMENT:'原图是连衣裙，暂不能只替换上装。请选择连体衣模式或换用上衣照片。',
    REGION_NOT_FOUND:'没有可靠识别到所选服装区域，请检查服装品类并换一张清晰照片。',
  };
  const f=await fixture(t);
  for(const [code,message] of Object.entries(messages)){
    await writeFile(path.join(f.models,'fixture-mode.txt'),'mask-'+code);
    await assert.rejects(f.provider.submitTryOn(f.args),cause=>{assert.equal(cause.code,code);assert.equal(cause.message,message);assertPublic({code:cause.code,message:cause.message});return true;});
    const status=f.provider.getProviderStatus();assert.deepEqual(status.lastError,{code,message});assert.equal(status.message,message);assert.equal(status.busy,false);assert.equal(status.verifiedGeneration,false);assertPublic(status);
    assert.deepEqual(await readdir(f.output),[]);
  }
});
test('active local CPU job survives orphan-file TTL, then aborts and clears inputs at provider budget',async t=>{
  const folder=await mkdtemp(path.join(root,'ttl-'));let clock=Date.now(),started=false,aborted=false;
  const factory=()=>({getProviderStatus:()=>({configured:true,available:false,verifiedGeneration:false,busy:false,kind:'local-catvton',remote:false,maxDurationMs:30*60*1000,name:'Explicit TTL fixture'}),
    submitTryOn:({signal,onProgress})=>new Promise((resolve,reject)=>{started=true;onProgress({status:'running'});signal.addEventListener('abort',()=>{aborted=true;reject(Object.assign(new Error('fixture abort'),{code:'ABORTED'}));},{once:true});})});
  const api=await createTryOnApi({runtimeRoot:folder,env:{},providerFactory:factory,now:()=>clock});
  const server=http.createServer((req,res)=>{api.handle(req,res)});await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`;
  t.after(async()=>{await api.close();await new Promise(r=>server.close(r));assert.ok(path.resolve(folder).startsWith(root+path.sep));await rm(folder,{recursive:true,force:true});});
  const image='data:image/png;base64,'+png.toString('base64');
  const response=await fetch(base+'/api/tryon/jobs',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({personImage:image,garmentImage:image})});
  assert.equal(response.status,202);const {job}=await response.json();for(let i=0;i<20&&!started;i++)await delay(5);assert.ok(started);
  clock+=16*60*1000;await api.cleanup();assert.equal(aborted,false);assert.ok((await readdir(path.join(folder,'tryon-jobs',job.id))).includes('person.png'));
  assert.equal(api.capabilities().limits.activeSourceTtlMsByProvider.tryOn,30*60*1000);
  clock+=15*60*1000;await api.cleanup();await delay(30);assert.equal(aborted,true);
  assert.deepEqual(await readdir(path.join(folder,'tryon-jobs',job.id)),['job.json']);
  const done=await(await fetch(base+'/api/tryon/jobs/'+job.id)).json();assert.equal(done.job.status,'cancelled');assert.equal(api.capabilities().tryOn.busy,false);
});
