import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {mkdir,mkdtemp,writeFile,readFile,readdir,rm,stat,utimes} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {setTimeout as delay} from 'node:timers/promises';
import {createLocalMotionProvider} from '../server/local-motion.mjs';
import {createStudioServer} from '../scripts/serve.mjs';
import {createTryOnApi} from '../server/tryon-api.mjs';
import {loadProviderConfig} from '../server/runtime-config.mjs';
import {parseDrivingVideoDataUri,validateDrivingVideo,MAX_DRIVING_VIDEO_BYTES} from '../server/driving-video-validation.mjs';

const root=path.resolve('test-results/driving-motion-api-v4');await mkdir(root,{recursive:true});
const python=path.resolve('runtime/motion-v4/.venv/Scripts/python.exe');
const pythonPresent=await stat(python).then(s=>s.isFile()).catch(()=>false);
const png=await readFile('public/demo/studio-model-v2.png'),image='data:image/png;base64,'+png.toString('base64');
function box(type,data){const out=Buffer.alloc(8+data.length);out.writeUInt32BE(out.length);out.write(type,4);data.copy(out,8);return out;}
// Deliberately non-playable protocol metadata. It is never a neural result.
function metadataMp4(seconds=3,width=256,height=256){const mvhd=Buffer.alloc(100),tkhd=Buffer.alloc(84);mvhd.writeUInt32BE(1000,12);mvhd.writeUInt32BE(seconds*1000,16);tkhd.writeUInt32BE(width*65536,76);tkhd.writeUInt32BE(height*65536,80);
  return Buffer.concat([box('ftyp',Buffer.from('isom0000isommp42')),box('moov',Buffer.concat([box('mvhd',mvhd),box('trak',box('tkhd',tkhd))])),box('mdat',Buffer.alloc(16))]);}
const mp4=metadataMp4(),uri=bytes=>'data:video/mp4;base64,'+bytes.toString('base64');
async function fixture(t,mode='copy'){
  const folder=await mkdtemp(path.join(root,'case-')),inputRoot=path.join(folder,'inputs'),outputRoot=path.join(folder,'outputs'),upstream=path.join(folder,'upstream');
  await mkdir(inputRoot);await mkdir(outputRoot);await mkdir(path.join(upstream,'config'),{recursive:true});await writeFile(path.join(upstream,'config/taichi-256.yaml'),'PROTOCOL FIXTURE ONLY');
  const checkpoint=path.join(folder,'fixture-checkpoint.bin'),script=path.join(folder,'fixture.py');await writeFile(checkpoint,'PROTOCOL FIXTURE ONLY');await writeFile(path.join(folder,'mode.txt'),mode);
  await writeFile(path.join(inputRoot,'person.png'),png);await writeFile(path.join(inputRoot,'driving.mp4'),mp4);await writeFile(path.join(folder,'result-fixture.mp4'),mp4);
  await writeFile(script,`import argparse,json,os,shutil,sys,time
from pathlib import Path
p=argparse.ArgumentParser()
for key in ['source-image','driving-video','output','max-frames','fps','threads','checkpoint','upstream','start-seconds','mode','source-fit','motion-strength']:p.add_argument('--'+key)
p.add_argument('--normalize-driving',action='store_true')
a=p.parse_args();base=Path(__file__).parent
(base/'args.json').write_text(json.dumps(vars(a)))
(base/'pid.txt').write_text(str(os.getpid()))
mode=(base/'mode.txt').read_text();out=Path(a.output)
for suffix in ['.partial.mp4','.driver.mp4','.driver.partial.mp4']:out.with_name(out.stem+suffix).write_bytes(b'ISOLATED FIXTURE ONLY')
print(json.dumps({'status':'running','stage':'validating_driver'}),flush=True)
if mode=='hold':
 while True:time.sleep(.1)
if mode=='failed':
 print(json.dumps({'status':'failed','errorCode':'INVALID_DRIVING_VIDEO','message':str(base/'private-secret')}),flush=True)
 sys.exit(1)
shutil.copyfile(base/'result-fixture.mp4',out)
print(json.dumps({'status':'running','stage':'normalizing_driver'}),flush=True)
print(json.dumps({'status':'running','frame':24,'totalFrames':24}),flush=True)
`);
  const env={MOTION_PROVIDER:'local-tps',MOTION_ENABLED:'true',MOTION_ACCEPTS_DRIVING_VIDEO:'true',MOTION_LOCAL_PYTHON:python,MOTION_LOCAL_SCRIPT:script,MOTION_LOCAL_CHECKPOINT:checkpoint,MOTION_LOCAL_UPSTREAM:upstream,MOTION_DRIVING_MANIFEST:path.join(folder,'unverified.json')};
  const provider=await createLocalMotionProvider({env,inputRoot,outputRoot});
  t.after(async()=>{assert.ok(path.resolve(folder).startsWith(root+path.sep));await rm(folder,{recursive:true,force:true});});
  return{folder,inputRoot,outputRoot,env,provider,args:{imagePath:path.join(inputRoot,'person.png'),drivingVideoPath:path.join(inputRoot,'driving.mp4'),motion:'custom'}};
}
function publicOnly(value){assert.doesNotMatch(JSON.stringify(value),/[A-Za-z]:[\\/]|private-secret|fixture-checkpoint|\/home\/|\/tmp\//);}
async function presetProvider(f,manifest,extraEnv={}){
  const filename=path.join(f.folder,'preset-manifest.json');await writeFile(filename,typeof manifest==='string'?manifest:JSON.stringify(manifest));
  return createLocalMotionProvider({env:{...f.env,MOTION_ACCEPTS_DRIVING_VIDEO:'false',MOTION_DRIVING_MANIFEST:filename,...extraEnv},inputRoot:f.inputRoot,outputRoot:f.outputRoot});
}
const presetItem=(overrides={})=>({verified:true,file:'inputs/driving.mp4',checkpoint:'fixture-checkpoint.bin',upstream:'upstream',maxFrames:24,fps:8,...overrides});

test('driving uploads enforce strict base64, type, container, size, duration and dimensions',()=>{
  assert.equal(parseDrivingVideoDataUri(uri(mp4)).extension,'mp4');
  for(const value of ['C:\\private\\clip.mp4','https://example.com/clip.mp4',uri(Buffer.from('<svg/>')),'data:video/webm;base64,'+mp4.toString('base64'),uri(mp4)+' '])assert.throws(()=>parseDrivingVideoDataUri(value),{code:'INVALID_DRIVING_VIDEO'});
  for(const bytes of [metadataMp4(2),metadataMp4(16),metadataMp4(3,1440,1440),metadataMp4(3,64,64),Buffer.alloc(MAX_DRIVING_VIDEO_BYTES+1)])assert.throws(()=>validateDrivingVideo(bytes,'video/mp4'),{code:'INVALID_DRIVING_VIDEO'});
});
test('custom motion requires explicit enabled/upload configuration and assets, without treating presets as verified',{skip:!pythonPresent},async t=>{
  const f=await fixture(t);assert.equal(f.provider.getProviderStatus().configured,true);assert.equal(f.provider.getProviderStatus().verifiedGeneration,false);
  assert.deepEqual(f.provider.getProviderStatus().presets,['custom']);assert.equal(f.provider.getProviderStatus().acceptsDrivingVideo,true);assert.equal(f.provider.getProviderStatus().experimental,true);
  for(const override of [{MOTION_ENABLED:'false'},{MOTION_ACCEPTS_DRIVING_VIDEO:'false'},{MOTION_LOCAL_CHECKPOINT:path.join(f.folder,'missing.bin')}]){
    const disabled=await createLocalMotionProvider({env:{...f.env,...override},inputRoot:f.inputRoot,outputRoot:f.outputRoot});assert.equal(disabled.getProviderStatus().configured,false);assert.equal(disabled.getProviderStatus().acceptsDrivingVideo,false);
  }
});
test('custom subprocess receives fixed normalized parameters and deletes all UUID temporary videos',{skip:!pythonPresent},async t=>{
  const f=await fixture(t),events=[];const result=await f.provider.submitMotion({...f.args,onProgress:event=>events.push(event)});
  const args=JSON.parse(await readFile(path.join(f.folder,'args.json'),'utf8'));
  assert.equal(args.normalize_driving,true);assert.equal(args.max_frames,'24');assert.equal(args.fps,'8');assert.equal(args.motion_strength,'0.25');assert.equal(args.start_seconds,'0');assert.equal(args.source_fit,'contain');
  assert.equal(result.width,256);assert.equal(result.height,256);assert.equal(result.durationSeconds,3);assert.equal(f.provider.getProviderStatus().verifiedGeneration,true);
  assert.deepEqual(await readdir(f.outputRoot),[path.basename(result.filePath)]);assert.ok(events.some(e=>e.stage==='validating_driver'));assert.ok(events.some(e=>e.frame===24));publicOnly(events);
});
test('verified preset specs expose bounded amplitude and preserve custom parameters',{skip:!pythonPresent},async t=>{
  const f=await fixture(t),provider=await presetProvider(f,{version:1,verified:true,presets:{
    minimum:presetItem({motionStrength:0.05}),maximum:presetItem({motionStrength:1}),default:presetItem(),
    fractional:presetItem({motionStrength:0.5,maxFrames:14}),custom:presetItem({motionStrength:1}),
  }},{MOTION_ACCEPTS_DRIVING_VIDEO:'true'});
  const status=provider.getProviderStatus();assert.deepEqual(status.presets,['minimum','maximum','default','fractional','custom']);
  assert.deepEqual(status.presetSpecs.minimum,{duration:3,fps:8,resolution:'256p',motionStrength:0.05});
  assert.equal(status.presetSpecs.maximum.motionStrength,1);assert.equal(status.presetSpecs.default.motionStrength,1);assert.equal(status.presetSpecs.fractional.duration,1.75);
  assert.deepEqual(status.presetSpecs.custom,{duration:3,fps:8,resolution:'256p',motionStrength:0.25});assert.equal(status.verifiedGeneration,false);publicOnly(status);
  assert.equal(await stat(path.join(f.folder,'pid.txt')).then(()=>true).catch(()=>false),false);
});
test('explicit invalid amplitude or malformed verification cannot publish research presets',{skip:!pythonPresent},async t=>{
  const f=await fixture(t),badStrengths=[null,'0.25',false,{},[],0,0.049,1.001,-1];
  const invalid={};badStrengths.forEach((motionStrength,index)=>{invalid['bad-'+index]=presetItem({motionStrength});});
  [null,'true',1,{},[]].forEach((normalizeDriving,index)=>{invalid['bad-normalize-'+index]=presetItem({normalizeDriving});});
  invalid['research-unverified']=presetItem({verified:false,motionStrength:0.25});invalid['research-string-verified']=presetItem({verified:'true',motionStrength:0.25});
  const documents=[{version:1,verified:true,presets:invalid},{version:1,verified:false,presets:{research:presetItem()}},
    {version:1,verified:'true',presets:{research:presetItem()}},{version:1,verified:true,presets:[]},null,[],
    JSON.stringify({version:1,verified:true,presets:{research:presetItem({motionStrength:0.25})}}).replace('"motionStrength":0.25','"motionStrength":1e309'),'{malformed'];
  for(const document of documents){
    const provider=await presetProvider(f,document),status=provider.getProviderStatus();assert.equal(status.configured,false);assert.deepEqual(status.presets,[]);assert.deepEqual(status.presetSpecs,{});
    await assert.rejects(provider.submitMotion({imagePath:f.args.imagePath,motion:'research'}),{code:'MOTION_NOT_CONFIGURED'});publicOnly(status);
  }
  assert.equal(await stat(path.join(f.folder,'pid.txt')).then(()=>true).catch(()=>false),false);
});
test('verified preset subprocess receives reviewed amplitude and normalization without user override',{skip:!pythonPresent},async t=>{
  const f=await fixture(t),provider=await presetProvider(f,{version:1,verified:true,presets:{subtle:presetItem({motionStrength:0.05}),original:presetItem(),normalized:presetItem({motionStrength:0.5,normalizeDriving:true})}});
  for(const [motion,strength,normalize] of [['subtle','0.05',false],['original','1',false],['normalized','0.5',true]]){
    await provider.submitMotion({imagePath:f.args.imagePath,motion,motionStrength:0.9,normalizeDriving:!normalize});
    const args=JSON.parse(await readFile(path.join(f.folder,'args.json'),'utf8'));assert.equal(args.motion_strength,strength);assert.equal(args.normalize_driving,normalize);
    assert.equal(args.max_frames,'24');assert.equal(args.fps,'8');assert.equal(args.driving_video,path.join(f.inputRoot,'driving.mp4'));
  }
  await writeFile(path.join(f.folder,'result-fixture.mp4'),metadataMp4(4));
  await assert.rejects(provider.submitMotion({imagePath:f.args.imagePath,motion:'normalized'}),{code:'INVALID_VIDEO'});
});
test('custom driver rejects outside paths and cancellation kills only its child and removes partial files',{skip:!pythonPresent},async t=>{
  const f=await fixture(t,'hold'),outside=path.join(f.folder,'outside.mp4');await writeFile(outside,mp4);
  await assert.rejects(f.provider.submitMotion({...f.args,drivingVideoPath:outside}),{code:'INVALID_PATH'});
  assert.equal(await stat(path.join(f.folder,'pid.txt')).then(()=>true).catch(()=>false),false);
  const controller=new AbortController(),task=f.provider.submitMotion({...f.args,signal:controller.signal}),rejected=assert.rejects(task,{code:'ABORTED'});
  for(let i=0;i<100&&!await stat(path.join(f.folder,'pid.txt')).catch(()=>null);i++)await delay(10);
  const pid=Number(await readFile(path.join(f.folder,'pid.txt'),'utf8'));controller.abort(new Error(f.folder));await rejected;
  assert.throws(()=>process.kill(pid,0));assert.deepEqual(await readdir(f.outputRoot),[]);assert.equal(f.provider.getProviderStatus().verifiedGeneration,false);publicOnly(f.provider.getProviderStatus());
});
test('driver decode rejection remains failure and cannot expose runner diagnostics',{skip:!pythonPresent},async t=>{
  const f=await fixture(t,'failed');await assert.rejects(f.provider.submitMotion(f.args),cause=>{assert.equal(cause.code,'INVALID_DRIVING_VIDEO');publicOnly({code:cause.code,message:cause.message});return true;});
  assert.deepEqual(await readdir(f.outputRoot),[]);assert.equal(f.provider.getProviderStatus().verifiedGeneration,false);publicOnly(f.provider.getProviderStatus());
});
async function serverFixture(t,mode='copy'){
  const f=await fixture(t,mode),runtimeRoot=path.join(f.folder,'api');
  const {server,api}=await createStudioServer({runtimeRoot,env:{},motionProviderFactory:options=>createLocalMotionProvider({...options,env:f.env})});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`;
  t.after(async()=>{await api.close();await new Promise(r=>server.close(r));});
  const req=(route,options)=>fetch(base+route,options),post=body=>req('/api/motion/jobs',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  return{...f,req,post,api,runtimeRoot};
}
test('custom HTTP jobs save controlled driver files, expose stages, clean sources, and reject URL/path injection',{skip:!pythonPresent},async t=>{
  const f=await serverFixture(t),cap=await(await f.req('/api/capabilities')).json();assert.equal(cap.motion.acceptsDrivingVideo,true);assert.equal(cap.motion.fps,8);assert.equal(cap.motion.duration,3);publicOnly(cap);
  for(const drivingVideo of [undefined,'C:\\private\\clip.mp4','https://example.com/clip.mp4'])assert.equal((await f.post({personImage:image,motion:'custom',drivingVideo})).status,400);
  assert.equal((await f.post({personImage:image,motion:'custom',drivingVideo:uri(mp4),driverPath:'C:\\private'})).status,400);
  const response=await f.post({personImage:image,motion:'custom',drivingVideo:uri(mp4)});assert.equal(response.status,202);const {job}=await response.json();assert.equal(job.hasDrivingVideo,true);publicOnly(job);
  let state;for(let i=0;i<100;i++){state=await(await f.req('/api/motion/jobs/'+job.id)).json();if(['succeeded','failed'].includes(state.job.status))break;await delay(10);}
  assert.equal(state.job.status,'succeeded');publicOnly(state);assert.deepEqual(await readdir(path.join(f.runtimeRoot,'tryon-jobs',job.id)),['job.json']);
  assert.equal((await f.req(state.job.result.url)).status,200);
});
test('HTTP cancellation removes uploaded driving video and model partial outputs',{skip:!pythonPresent},async t=>{
  const f=await serverFixture(t,'hold'),response=await f.post({personImage:image,motion:'custom',drivingVideo:uri(mp4)}),{job}=await response.json();
  for(let i=0;i<100&&!await stat(path.join(f.folder,'pid.txt')).catch(()=>null);i++)await delay(10);
  const deleted=await(await f.req('/api/motion/jobs/'+job.id,{method:'DELETE'})).json();assert.equal(deleted.deleted,true);assert.equal(deleted.remoteMayContinue,false);
  for(let i=0;i<100&&f.api.capabilities().motion.busy;i++)await delay(10);
  assert.equal(await stat(path.join(f.runtimeRoot,'tryon-jobs',job.id)).then(()=>true).catch(()=>false),false);assert.deepEqual(await readdir(path.join(f.runtimeRoot,'tryon-results')),[]);
});
test('custom configuration remains server-only and explicit environment disables upload support',async t=>{
  const folder=await mkdtemp(path.join(root,'config-'));t.after(async()=>{assert.ok(path.resolve(folder).startsWith(root+path.sep));await rm(folder,{recursive:true,force:true});});
  await writeFile(path.join(folder,'config.json'),JSON.stringify({motion:{provider:'local-tps',enabled:true,acceptsDrivingVideo:true,localCheckpoint:'private-checkpoint',localUpstream:'private-upstream'}}));
  const config=await loadProviderConfig(folder,{MOTION_ACCEPTS_DRIVING_VIDEO:'false'});assert.equal(config.env.MOTION_ACCEPTS_DRIVING_VIDEO,'false');assert.equal(config.env.MOTION_LOCAL_CHECKPOINT,'private-checkpoint');assert.equal(config.error,'');
});
test('restart removes interrupted driver uploads and only expired UUID driver intermediates',async t=>{
  const folder=await mkdtemp(path.join(root,'recovery-')),id=randomUUID(),jobDir=path.join(folder,'tryon-jobs',id),resultDir=path.join(folder,'tryon-results');
  await mkdir(jobDir,{recursive:true});await mkdir(resultDir);
  await writeFile(path.join(jobDir,'job.json'),JSON.stringify({id,kind:'motion',motion:'custom',hasDrivingVideo:true,status:'running',createdAt:Date.now()-60000,expiresAt:Date.now()+3600000}));
  await writeFile(path.join(jobDir,'person.png'),png);await writeFile(path.join(jobDir,'driving.webm'),'INTERRUPTED UPLOAD FIXTURE');
  for(const suffix of ['.partial.mp4','.driver.mp4','.driver.partial.mp4']){const filename=path.join(resultDir,randomUUID()+suffix);await writeFile(filename,'INTERRUPTED OUTPUT FIXTURE');await utimes(filename,new Date(0),new Date(0));}
  await writeFile(path.join(resultDir,'unrelated.driver.mp4'),'DO NOT CLAIM THIS FILE');
  const api=await createTryOnApi({runtimeRoot:folder,env:{}});
  t.after(async()=>{await api.close();assert.ok(path.resolve(folder).startsWith(root+path.sep));await rm(folder,{recursive:true,force:true});});
  assert.deepEqual(await readdir(jobDir),['job.json']);assert.equal(JSON.parse(await readFile(path.join(jobDir,'job.json'),'utf8')).status,'failed');
  assert.deepEqual(await readdir(resultDir),['unrelated.driver.mp4']);
});
test('real local MP4 and WebM probe fully decodes without importing torch',{skip:!pythonPresent},async t=>{
  const exec=promisify(execFile);
  const fixtures=['mp4','webm'].map(extension=>path.resolve(`test-results/motion-v4/user-driver-contract/portrait.${extension}`));
  if(!(await Promise.all(fixtures.map(file=>stat(file).then(s=>s.isFile()).catch(()=>false)))).every(Boolean)){t.skip('Optional real-media validation fixtures have not been generated.');return;}
  for(const extension of ['mp4','webm']){
    const video=path.resolve(`test-results/motion-v4/user-driver-contract/portrait.${extension}`);
    assert.equal(validateDrivingVideo(await readFile(video),'video/'+extension).extension,extension);
    const {stdout}=await exec(python,['-u','scripts/motion-v4/infer.py','--validate-only','--driving-video',video,'--max-frames','24','--fps','8'],{cwd:process.cwd(),windowsHide:true,timeout:20000});
    const events=stdout.trim().split(/\r?\n/).map(line=>JSON.parse(line)),last=events.at(-1);assert.equal(last.status,'completed');assert.equal(last.stage,'validated_driver');assert.equal(last.torchImported,false);assert.equal(last.driver.selectedFrames,24);
  }
});
