import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdir, mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { createFashnMotionProvider, downloadFashnVideo, isPublicAddress } from '../server/motion-provider.mjs';
import { createLocalMotionProvider } from '../server/local-motion.mjs';
import { validateVideo } from '../server/video-validation.mjs';
import { createStudioServer } from '../scripts/serve.mjs';

const root=path.resolve('test-results/motion-api-v4');await mkdir(root,{recursive:true});
const png=await readFile('public/demo/studio-model-v2.png');
const imagePath=path.join(root,'source.png');await writeFile(imagePath,png);
const image='data:image/png;base64,'+png.toString('base64');
function box(type,data){const b=Buffer.alloc(8+data.length);b.writeUInt32BE(b.length);b.write(type,4);data.copy(b,8);return b;}
// Protocol fixture with valid MP4 container metadata, not a playable generated clip.
const mvhd=Buffer.alloc(100);mvhd.writeUInt32BE(1000,12);mvhd.writeUInt32BE(5000,16);
const tkhd=Buffer.alloc(84);tkhd.writeUInt32BE(640*65536,76);tkhd.writeUInt32BE(480*65536,80);
const mp4=Buffer.concat([box('ftyp',Buffer.from('isom0000isommp42')),box('moov',Buffer.concat([box('mvhd',mvhd),box('trak',box('tkhd',tkhd))])),box('mdat',Buffer.alloc(16))]);
const json=data=>new Response(JSON.stringify(data),{headers:{'Content-Type':'application/json'}});
const enabled={MOTION_PROVIDER:'fashn-api',MOTION_ENABLED:'true',FASHN_API_KEY:'private-protocol-fixture'};

test('motion service stays disabled without explicit paid enablement, even if key exists',async()=>{
  const provider=createFashnMotionProvider({env:{FASHN_API_KEY:'key',MOTION_PROVIDER:'fashn-api'},inputRoot:root,outputRoot:root,fetchImpl:()=>{throw new Error('Unexpected network');}});
  assert.equal(provider.getProviderStatus().configured,false);assert.equal(provider.getProviderStatus().verifiedGeneration,false);
  await assert.rejects(provider.submitMotion({imagePath,motion:'idle'}),{code:'MOTION_NOT_CONFIGURED'});
  assert.ok(!JSON.stringify(provider.getProviderStatus()).includes('private-protocol-fixture'));
});

test('FASHN video submits exactly once at 5 seconds 480p, polls real states and validates MP4',async()=>{
  let posts=0,polls=0;const progress=[];
  const provider=createFashnMotionProvider({env:enabled,inputRoot:root,outputRoot:root,pollIntervalMs:0,
    fetchImpl:async(url,init)=>{
      assert.equal(init.redirect,'error');assert.equal(init.headers.Authorization,'Bearer private-protocol-fixture');
      if(url.pathname==='/v1/run'){
        posts++;const body=JSON.parse(init.body);assert.equal(body.model_name,'image-to-video');assert.equal(body.inputs.duration,5);assert.equal(body.inputs.resolution,'480p');assert.match(body.inputs.prompt,/waving/);assert.match(body.inputs.image,/^data:image\/png;base64,/);return json({id:'job-video-1'});
      }
      return ++polls===1?json({status:'processing'}):json({status:'completed',output:['https://cdn.fashn.ai/job-video-1/output_0.mp4']});
    },downloadImpl:async(url,options)=>{assert.equal(url,'https://cdn.fashn.ai/job-video-1/output_0.mp4');assert.ok(options.signal);return mp4;}});
  const result=await provider.submitMotion({imagePath,motion:'wave',onProgress:e=>progress.push(e.status)});
  assert.equal(posts,1);assert.equal(result.durationSeconds,5);assert.equal(result.mimeType,'video/mp4');assert.equal(provider.getProviderStatus().available,true);
  assert.deepEqual(progress,['uploading','queued','running','running','completed']);await rm(result.filePath);
});

test('FASHN failed and aborted jobs are never retried or marked verified',async()=>{
  let posts=0;
  const provider=createFashnMotionProvider({env:enabled,inputRoot:root,outputRoot:root,fetchImpl:async url=>{
    if(url.pathname.endsWith('/run')){posts++;return json({id:'job-failed'});}return json({status:'failed',error:'provider failure'});
  }});
  await assert.rejects(provider.submitMotion({imagePath,motion:'walk'}),{code:'GENERATION_FAILED'});assert.equal(posts,1);assert.equal(provider.getProviderStatus().available,false);
  const controller=new AbortController();const abortProvider=createFashnMotionProvider({env:enabled,inputRoot:root,outputRoot:root,fetchImpl:async url=>url.pathname.endsWith('/run')?json({id:'job-abort'}):json({status:'processing'}),pollIntervalMs:10000});
  const task=abortProvider.submitMotion({imagePath,motion:'idle',signal:controller.signal});setTimeout(()=>controller.abort(),30);
  await assert.rejects(task,{code:'ABORTED'});assert.equal(abortProvider.getProviderStatus().verifiedGeneration,false);
});

test('CDN gate refuses arbitrary URL, credentials, redirects and all private DNS answers',async()=>{
  for(const url of ['http://cdn.fashn.ai/id/output_0.mp4','https://cdn.fashn.ai.evil.example/id/output_0.mp4','https://user:pass@cdn.fashn.ai/id/output_0.mp4','https://127.0.0.1/id/output_0.mp4','https://cdn.fashn.ai/config.json'])
    await assert.rejects(downloadFashnVideo(url,{lookupImpl:()=>{throw new Error('DNS should not run')}}),{code:'INVALID_OUTPUT_URL'});
  await assert.rejects(downloadFashnVideo('https://cdn.fashn.ai/id/output_0.mp4',{lookupImpl:async()=>[{address:'127.0.0.1',family:4}],requestImpl:()=>{throw new Error('HTTP should not run')}}),{code:'UNSAFE_OUTPUT_ADDRESS'});
  for(const address of ['127.0.0.1','10.1.1.1','172.16.0.2','192.168.1.2','169.254.1.1','100.64.0.1','::1','::ffff:127.0.0.1','fc00::1','fe80::1','2001:db8::1'])assert.equal(isPublicAddress(address),false,address);
  assert.equal(isPublicAddress('8.8.8.8'),true);
});

test('CDN download pins verified address, never sends API key and does not follow redirect',async()=>{
  const request=(status)=>((url,options,callback)=>{
    assert.equal(options.headers.Authorization,undefined);assert.equal(url.hostname,'cdn.fashn.ai');
    options.lookup(url.hostname,{},(err,address,family)=>{assert.equal(err,null);assert.equal(address,'8.8.8.8');assert.equal(family,4);});
    const request=new EventEmitter();request.end=()=>{const response=Readable.from([mp4]);response.statusCode=status;response.headers={'content-length':mp4.length};callback(response);};request.destroy=()=>{};return request;
  });
  const options={lookupImpl:async()=>[{address:'8.8.8.8',family:4}],requestImpl:request(200)};
  assert.deepEqual(await downloadFashnVideo('https://cdn.fashn.ai/job/output_0.mp4',options),mp4);
  await assert.rejects(downloadFashnVideo('https://cdn.fashn.ai/job/output_0.mp4',{...options,requestImpl:request(302)}),{code:'VIDEO_DOWNLOAD_FAILED'});
  assert.throws(()=>validateVideo(Buffer.from('<html>not video</html>')),{code:'INVALID_VIDEO'});
  assert.throws(()=>validateVideo(mp4.subarray(0,mp4.length-1)),{code:'INVALID_VIDEO'});
});

test('local TPS without verified driver manifest stays unavailable and cannot spawn',async()=>{
  const provider=await createLocalMotionProvider({env:{MOTION_ENABLED:'true',MOTION_PROVIDER:'local-tps',MOTION_DRIVING_MANIFEST:path.join(root,'missing.json')},inputRoot:root,outputRoot:root,spawnImpl:()=>{throw new Error('Unexpected spawn')}});
  assert.equal(provider.getProviderStatus().configured,false);assert.deepEqual(provider.getProviderStatus().presets,[]);
  await assert.rejects(provider.submitMotion({imagePath,motion:'turn'}),{code:'MOTION_NOT_CONFIGURED'});
});

function fixtureFactory(kind='tryon',local=false){return({outputRoot})=>{
  let verifiedGeneration=false;
  const status=()=>({configured:true,available:verifiedGeneration,verifiedGeneration,busy:false,kind:local?'local-tps':kind==='motion'?'fashn-api':'fixture',name:'Protocol fixture',remote:!local,enabled:true,paid:!local,presets:local?['tai-chi']:['idle','walk','wave','turn']});
  const generate=async({onProgress,signal})=>{onProgress({status:'running'});await delay(30,undefined,{signal});const filePath=path.join(outputRoot,randomUUID()+(kind==='motion'?'.mp4':'.png'));await writeFile(filePath,kind==='motion'?mp4:png);verifiedGeneration=true;return {filePath,generated:true,provider:'Protocol fixture'};};
  return {getProviderStatus:status,submitTryOn:generate,submitMotion:generate};
};}
async function start(t,local=false){
  const folder=await mkdtemp(path.join(root,'api-'));const {server,api}=await createStudioServer({runtimeRoot:folder,env:{},providerFactory:fixtureFactory(),motionProviderFactory:fixtureFactory('motion',local)});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`;
  t.after(async()=>{await api.close();await new Promise(r=>server.close(r));assert.ok(path.resolve(folder).startsWith(root+path.sep));await rm(folder,{recursive:true,force:true});});
  const req=(route,options)=>fetch(base+route,options);const post=(kind,data)=>req(`/api/${kind}/jobs`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});
  const wait=async(kind,id)=>{for(let i=0;i<100;i++){const {job}=await(await req(`/api/${kind}/jobs/${id}`)).json();if(['succeeded','failed','cancelled'].includes(job.status))return job;await delay(10)}throw new Error('Timeout');};
  return {req,post,wait};
}

test('motion API reuses successful tryon image, separates lists, ranges result and deletes it',async t=>{
  const {req,post,wait}=await start(t);const tryon=await(await post('tryon',{personImage:image,garmentImage:image})).json();await wait('tryon',tryon.job.id);
  assert.equal((await post('motion',{personImage:image,motion:'idle'})).status,400);
  assert.equal((await post('motion',{sourceJobId:randomUUID(),motion:'idle'})).status,410);
  const response=await post('motion',{sourceJobId:tryon.job.id,motion:'walk'});assert.equal(response.status,202);const {job}=await response.json();
  assert.equal((await post('tryon',{personImage:image,garmentImage:image})).status,429);
  const done=await wait('motion',job.id);assert.equal(done.status,'succeeded');assert.equal(done.kind,'motion');assert.equal(done.result.mimeType,'video/mp4');assert.equal(done.result.durationSeconds,5);
  assert.equal((await(await req('/api/tryon/jobs')).json()).jobs.length,1);assert.equal((await(await req('/api/motion/jobs')).json()).jobs.length,1);
  assert.equal((await req(`/api/tryon/jobs/${job.id}`)).status,404);
  const range=await req(done.result.url,{headers:{Range:'bytes=0-15'}});assert.equal(range.status,206);assert.deepEqual(Buffer.from(await range.arrayBuffer()),mp4.subarray(0,16));
  assert.equal((await(await req('/api/capabilities')).json()).motion.verifiedGeneration,true);
  await req(`/api/motion/jobs/${job.id}`,{method:'DELETE'});assert.equal((await req(done.result.url)).status,404);
});

test('local motion accepts person image only for manifest presets; cloud defaults remain off',async t=>{
  const {req,post,wait}=await start(t,true);const capabilities=await(await req('/api/capabilities')).json();assert.equal(capabilities.motion.acceptsPersonImage,true);
  assert.equal((await post('motion',{personImage:image,motion:'turn'})).status,400);
  const response=await post('motion',{personImage:image,motion:'tai-chi'});assert.equal(response.status,202);const {job}=await response.json();assert.equal((await wait('motion',job.id)).status,'succeeded');
});
