import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdir, mkdtemp, writeFile, readFile, readdir, rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { deflateSync } from 'node:zlib';
import { request as httpRequest } from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';
import { createStudioServer } from '../scripts/serve.mjs';
import { createTryOnApi } from '../server/tryon-api.mjs';
import { validateImage, parseImageDataUri, MAX_IMAGE_BYTES } from '../server/image-validation.mjs';
import { loadProviderConfig } from '../server/runtime-config.mjs';

const outputRoot = path.resolve('test-results/tryon-api-v4');
await mkdir(outputRoot, { recursive: true });
function crc32(data) { let crc = 0xffffffff; for (const b of data) { crc ^= b; for (let i=0;i<8;i++) crc = crc & 1 ? 0xedb88320 ^ crc >>> 1 : crc >>> 1; } return (crc ^ 0xffffffff) >>> 0; }
function chunk(type, data) {
  const label = Buffer.from(type), result = Buffer.alloc(12 + data.length); result.writeUInt32BE(data.length);
  label.copy(result, 4); data.copy(result, 8); result.writeUInt32BE(crc32(Buffer.concat([label, data])), result.length - 4); return result;
}
function makePng(width = 32, height = 32) {
  const header = Buffer.alloc(13); header.writeUInt32BE(width); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 2;
  const pixels = Buffer.alloc((32 * 3 + 1) * 32, 120); for (let i=0;i<32;i++) pixels[i*97] = 0;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk('IHDR',header),chunk('IDAT',deflateSync(pixels)),chunk('IEND',Buffer.alloc(0))]);
}
const png = makePng(), image = 'data:image/png;base64,' + png.toString('base64');
const body = { personImage: image, garmentImage: image, category: 'tops', garmentPhotoType: 'flat-lay' };
function protocolFixture({ wait = 45, reject = false, badOutput = false, onSeed=()=>{}, kind='test-only' } = {}) {
  return ({ outputRoot }) => {
    let verifiedGeneration = false, busy = false;
    return {
      getProviderStatus: () => ({ configured: true, available: verifiedGeneration, verifiedGeneration, busy, name: 'Isolated protocol test fixture', kind, remote: true, message: 'Protocol fixture, not AI generation' }),
      async submitTryOn({ personPath, garmentPath, allowRemoteUpload, seed, signal, onProgress }) {
        busy = true;
        try {
          assert.equal(allowRemoteUpload, true); assert.deepEqual(await readFile(personPath), png); assert.deepEqual(await readFile(garmentPath), png);
          onSeed(seed);
          onProgress({status:'uploading'}); onProgress({status:'queued',queuePosition:2});
          await delay(wait, undefined, {signal}); onProgress({status:'running'});
          if(reject)throw Object.assign(new Error('匿名 GPU 额度已耗尽'),{code:'QUOTA_EXCEEDED'});
          const filePath = path.join(outputRoot,randomUUID()+'.png');await writeFile(filePath,badOutput?Buffer.from('invalid output'):png);
          verifiedGeneration=true;return {filePath,mimeType:'image/png',provider:'Isolated protocol fixture',generated:true};
        }finally{busy=false;}
      },
    };
  };
}
async function serverContext(t, options = {}) {
  const root = await mkdtemp(path.join(outputRoot,'case-'));const dist = path.join(root,'dist');await mkdir(dist);
  await writeFile(path.join(dist,'index.html'),'<h1>Static regression fixture</h1>');await writeFile(path.join(dist,'clip.webm'),Buffer.from('0123456789'));
  const {server,api}=await createStudioServer({root:dist,runtimeRoot:path.join(root,'runtime'),env:{},...options});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve)); const base=`http://127.0.0.1:${server.address().port}`;
  t.after(async()=>{await api.close();await new Promise(resolve=>server.close(resolve));
    const resolved=path.resolve(root);assert.ok(resolved.startsWith(outputRoot+path.sep));await rm(resolved,{recursive:true,force:true});});
  const request=(route,init={})=>fetch(base+route,init);
  const post=(data=body,extra={})=>request('/api/tryon/jobs',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data),...extra});
  return {root,base,request,post,api};
}
async function finished(request,id) {
  for(let i=0;i<100;i++) { const result=await(await request(`/api/tryon/jobs/${id}`)).json();if(['succeeded','failed','cancelled'].includes(result.job?.status))return result.job;await delay(10); }
  throw new Error('Task did not finish');
}

test('image validation rejects disguised files, damaged CRC, traversal-style data and pixel bombs',async()=>{
  assert.equal(validateImage(png).width,32);assert.equal(parseImageDataUri(image).mimeType,'image/png');
  assert.throws(()=>parseImageDataUri('C:\\private\\photo.png'),{code:'INVALID_IMAGE'});
  assert.throws(()=>parseImageDataUri('data:image/jpeg;base64,'+png.toString('base64')),{code:'INVALID_IMAGE'});
  assert.throws(()=>parseImageDataUri('data:image/svg+xml;base64,'+Buffer.from('<svg/>').toString('base64')),{code:'INVALID_IMAGE'});
  const corrupt=Buffer.from(png);corrupt[29]^=1;assert.throws(()=>validateImage(corrupt),{code:'INVALID_IMAGE'});
  assert.throws(()=>validateImage(makePng(10000,10000)),{code:'INVALID_IMAGE'});
  assert.throws(()=>validateImage(Buffer.alloc(MAX_IMAGE_BYTES+1)),{code:'INVALID_IMAGE'});
  assert.throws(()=>validateImage(Buffer.concat([png,Buffer.from('<script/>')])),{code:'INVALID_IMAGE'});
  const jpeg=await readFile('public/demo/fashion-runway2.jpg');assert.equal(validateImage(jpeg).mimeType,'image/jpeg');
  assert.throws(()=>validateImage(jpeg.subarray(0,jpeg.length-2)),{code:'INVALID_IMAGE'});
  // An actual Edge Canvas-encoded 32×32 solid-colour codec fixture; not a VTON output.
  const webp=Buffer.from('UklGRiYCAABXRUJQVlA4WAoAAAAgAAAAHwAAHwAASUNDUMgBAAAAAAHIAAAAAAQwAABtbnRyUkdCIFhZWiAH4AABAAEAAAAAAABhY3NwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQAA9tYAAQAAAADTLQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAlkZXNjAAAA8AAAACRyWFlaAAABFAAAABRnWFlaAAABKAAAABRiWFlaAAABPAAAABR3dHB0AAABUAAAABRyVFJDAAABZAAAAChnVFJDAAABZAAAAChiVFJDAAABZAAAAChjcHJ0AAABjAAAADxtbHVjAAAAAAAAAAEAAAAMZW5VUwAAAAgAAAAcAHMAUgBHAEJYWVogAAAAAAAAb6IAADj1AAADkFhZWiAAAAAAAABimQAAt4UAABjaWFlaIAAAAAAAACSgAAAPhAAAts9YWVogAAAAAAAA9tYAAQAAAADTLXBhcmEAAAAAAAQAAAACZmYAAPKnAAANWQAAE9AAAApbAAAAAAAAAABtbHVjAAAAAAAAAAEAAAAMZW5VUwAAACAAAAAcAEcAbwBvAGcAbABlACAASQBuAGMALgAgADIAMAAxADZWUDggOAAAABADAJ0BKiAAIAA+bTSWR6QjIiEoCACADYllAHYAAICgoAD+rhf//ggtqPTDUv//wG6+LZfAAAAA','base64');
  assert.equal(validateImage(webp).width,32);webp[24]=255;
  assert.throws(()=>validateImage(webp),{code:'INVALID_IMAGE'});
});

test('unconfigured API is honest, creates no jobs, protects origin, and preserves static range requests',async t=>{
  const {request,post,root,base}=await serverContext(t);
  const c=await(await request('/api/capabilities')).json();assert.equal(c.tryOn.configured,false);assert.equal(c.tryOn.available,false);assert.equal(c.tryOn.verifiedGeneration,false);
  const response=await post();assert.equal(response.status,503);assert.equal((await response.json()).error.code,'NOT_CONFIGURED');
  assert.deepEqual(await readdir(path.join(root,'runtime/tryon-jobs')),[]);
  assert.equal((await request('/api/capabilities',{headers:{Origin:'https://other.example'}})).status,403);
  const badHostStatus=await new Promise((resolve,reject)=>{const req=httpRequest(new URL('/api/capabilities',base),{headers:{Host:'rebinding.example'}},res=>{res.resume();resolve(res.statusCode)});req.on('error',reject);req.end();});
  assert.equal(badHostStatus,403);
  assert.match(await(await request('/')).text(),/Static regression/);
  const range=await request('/clip.webm',{headers:{Range:'bytes=2-5'}});assert.equal(range.status,206);assert.equal(range.headers.get('content-type'),'video/webm');assert.equal(await range.text(),'2345');
  assert.equal((await request('/clip.webm',{headers:{Range:'bytes=50-'}})).status,416);
  assert.equal((await request('/runtime/config.json')).status,404);
});

test('job lifecycle exposes no paths, validates result, deletes sources and serves/delete result',async t=>{
  const {request,post,root}=await serverContext(t,{providerFactory:protocolFixture()});
  assert.equal((await(await request('/api/capabilities')).json()).tryOn.verifiedGeneration,false);
  const response=await post();assert.equal(response.status,202);const {job:initial}=await response.json();assert.equal(initial.status,'queued');
  assert.equal((await post()).status,429);
  const job=await finished(request,initial.id);assert.equal(job.status,'succeeded');assert.equal(job.result.generated,true);assert.equal(job.result.width,32);
  assert.ok(!JSON.stringify(job).includes(root));assert.equal('personPath' in job,false);
  const files=await readdir(path.join(root,'runtime/tryon-jobs',job.id));assert.deepEqual(files,['job.json']);
  const result=await request(job.result.url+'?download=1');assert.equal(result.status,200);assert.match(result.headers.get('content-disposition'),/^attachment;/);assert.deepEqual(Buffer.from(await result.arrayBuffer()),png);
  assert.equal((await(await request('/api/capabilities')).json()).tryOn.available,true);
  assert.equal((await(await request('/api/tryon/jobs')).json()).jobs.length,1);
  assert.equal((await request(`/api/tryon/jobs/${job.id}`,{method:'DELETE'})).status,200);
  assert.equal((await request(job.result.url)).status,404);assert.deepEqual(await readdir(path.join(root,'runtime/tryon-results')),[]);
});

test('cancel aborts local waiting and deletes uploaded images without claiming remote cancellation',async t=>{
  const {request,post,root}=await serverContext(t,{providerFactory:protocolFixture({wait:10000})});
  const {job}=await(await post()).json();const response=await request(`/api/tryon/jobs/${job.id}`,{method:'DELETE'});
  assert.deepEqual(await response.json(),{deleted:true,cancelled:true,remoteMayContinue:true});
  assert.equal((await request(`/api/tryon/jobs/${job.id}`)).status,404);await delay(30);
  assert.deepEqual(await readdir(path.join(root,'runtime/tryon-jobs')),[]);assert.equal((await(await request('/api/capabilities')).json()).tryOn.busy,false);
});

test('upstream failures and invalid output cannot become successful or verified jobs',async t=>{
  for(const options of [{reject:true},{badOutput:true}]){
    const {request,post,root}=await serverContext(t,{providerFactory:protocolFixture(options)});
    const {job}=await(await post()).json();const done=await finished(request,job.id);assert.equal(done.status,'failed');assert.equal(done.result,undefined);
    assert.equal((await(await request('/api/capabilities')).json()).tryOn.available,false);
    assert.equal((await request(`/api/tryon/jobs/${job.id}/result`)).status,409);
    assert.deepEqual(await readdir(path.join(root,'runtime/tryon-jobs',job.id)),['job.json']);
    assert.deepEqual(await readdir(path.join(root,'runtime/tryon-results')),[]);
  }
});

test('configured API rejects system paths, invalid categories, media types and excessive body lengths',async t=>{
  const {post,request,base}=await serverContext(t,{providerFactory:protocolFixture()});
  assert.equal((await post({...body,personPath:'C:/private/photo.png'})).status,400);
  assert.equal((await post({...body,category:'shoes'})).status,400);
  assert.equal((await post({...body,personImage:'data:image/png;base64,AAAA'})).status,400);
  assert.equal((await post(body,{headers:{'Content-Type':'text/plain'}})).status,415);
  assert.equal((await request('/api/tryon/jobs/not-a-job')).status,404);
  const largeStatus=await new Promise((resolve,reject)=>{const req=httpRequest(new URL('/api/tryon/jobs',base),{method:'POST',headers:{'Content-Type':'application/json','Content-Length':40000000}},res=>{res.resume();resolve(res.statusCode)});req.on('error',reject);req.end();});
  assert.equal(largeStatus,413);
});

test('local config loads only allowed server settings and environment takes precedence',async t=>{
  const root=await mkdtemp(path.join(outputRoot,'config-'));t.after(()=>rm(root,{recursive:true,force:true}));
  await writeFile(path.join(root,'config.json'),JSON.stringify({tryOn:{provider:'fashn-api',fashnApiKey:'private-fixture-secret'}}));
  const config=await loadProviderConfig(root,{FASHN_API_KEY:'env-secret'});assert.equal(config.env.FASHN_API_KEY,'env-secret');assert.equal(config.env.TRYON_PROVIDER,'fashn-api');
  const api=await createTryOnApi({runtimeRoot:root,env:{}});assert.equal(api.capabilities().tryOn.configured,true);assert.ok(!JSON.stringify(api.capabilities()).includes('private-fixture-secret'));await api.close();
  await writeFile(path.join(root,'config.json'),'{broken');const broken=await createTryOnApi({runtimeRoot:root,env:{}});assert.equal(broken.capabilities().tryOn.configured,false);assert.match(broken.capabilities().tryOn.message,/config.json/);await broken.close();
});

test('expired jobs and interrupted inputs are cleaned on startup without continuing generation',async t=>{
  const root=await mkdtemp(path.join(outputRoot,'expiry-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const id=randomUUID(),folder=path.join(root,'tryon-jobs',id);await mkdir(folder,{recursive:true});await writeFile(path.join(folder,'person.png'),png);
  await writeFile(path.join(folder,'job.json'),JSON.stringify({id,status:'running',createdAt:1,expiresAt:2}));
  const api=await createTryOnApi({runtimeRoot:root,env:{}});assert.deepEqual(await readdir(path.join(root,'tryon-jobs')),[]);await api.close();
});

test('seed is chosen once, passed unchanged, persisted, listed and restored without inference',async t=>{
  const received=[];
  const {request,post,root,api}=await serverContext(t,{providerFactory:protocolFixture({wait:1,kind:'local-catvton',onSeed:seed=>received.push(seed)})});
  const cap=(await(await request('/api/capabilities')).json()).tryOn;
  assert.equal(cap.supportsSeed,true);assert.deepEqual(cap.seedRange,{min:0,max:2147483647});assert.equal(cap.seedDefault,'random-per-job');
  const completed=[];
  for(const seed of [undefined,undefined,undefined,0,2147483647,73,73]){
    const response=await post({...body,...(seed===undefined?{}:{seed})});assert.equal(response.status,202);
    const {job}=await response.json();assert.ok(Number.isInteger(job.seed)&&job.seed>=0&&job.seed<=2147483647);
    if(seed!==undefined)assert.equal(job.seed,seed);
    const done=await finished(request,job.id);assert.equal(done.status,'succeeded');assert.equal(done.seed,job.seed);
    assert.equal(received.at(-1),job.seed);
    const saved=JSON.parse(await readFile(path.join(root,'runtime','tryon-jobs',job.id,'job.json'),'utf8'));assert.equal(saved.seed,job.seed);
    completed.push(done);
  }
  // Three independent 31-bit samples all matching has probability 2^-62;
  // catches a regression back to the old fixed seed without assuming values.
  assert.ok(new Set(completed.slice(0,3).map(job=>job.seed)).size>1);
  const listed=(await(await request('/api/tryon/jobs')).json()).jobs;
  for(const job of completed)assert.equal(listed.find(item=>item.id===job.id).seed,job.seed);
  await api.close();
  // Legacy and malformed metadata must not acquire or expose invented seeds.
  for(const [job,seed] of [[completed[0],undefined],[completed[1],'C:/private/seed']]){
    const file=path.join(root,'runtime','tryon-jobs',job.id,'job.json');const saved=JSON.parse(await readFile(file,'utf8'));
    if(seed===undefined)delete saved.seed;else saved.seed=seed;await writeFile(file,JSON.stringify(saved));
  }
  const restored=await createStudioServer({root:path.join(root,'dist'),runtimeRoot:path.join(root,'runtime'),env:{},providerFactory:protocolFixture({onSeed:()=>assert.fail('Recovery must not invoke generation')})});
  await new Promise(resolve=>restored.server.listen(0,'127.0.0.1',resolve));
  try{
    const restoredBase=`http://127.0.0.1:${restored.server.address().port}`;
    const jobs=(await(await fetch(restoredBase+'/api/tryon/jobs')).json()).jobs;
    for(const job of completed.slice(2))assert.equal(jobs.find(item=>item.id===job.id).seed,job.seed);
    for(const job of completed.slice(0,2))assert.equal('seed' in jobs.find(item=>item.id===job.id),false);
    assert.equal(received.length,completed.length);assert.ok(!JSON.stringify(jobs).includes('private'));
  }finally{await restored.api.close();await new Promise(resolve=>restored.server.close(resolve));}
});

test('API rejects every noninteger or out-of-range seed before accepting images',async t=>{
  const {post,request,root}=await serverContext(t,{providerFactory:protocolFixture({onSeed:()=>assert.fail('Invalid seed invoked provider')})});
  for(const seed of [null,-1,2147483648,1.5,'42',true,{},[]]){
    const response=await post({...body,seed});assert.equal(response.status,400);assert.equal((await response.json()).error.code,'INVALID_SEED');
  }
  assert.deepEqual((await(await request('/api/tryon/jobs')).json()).jobs,[]);
  assert.deepEqual(await readdir(path.join(root,'runtime','tryon-jobs')),[]);
});
