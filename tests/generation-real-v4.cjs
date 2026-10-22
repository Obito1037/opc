// Opt-in REAL local-model integration QA. Never mock/route responses or fabricate media.
// Run only after the operator starts the intended production service.
// STUDIO_TEST_URL defaults to http://127.0.0.1:5176.
// RUN_REAL_MOTION=true enables research-input custom motion; RUN_REAL_TRYON=false makes it independent.
const {chromium}=require('C:/Users/20665/AppData/Local/OpenAI/Codex/runtimes/cua_node/78fb63cda1a9e2b2/bin/node_modules/playwright');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const base=process.env.STUDIO_TEST_URL||'http://127.0.0.1:5176',runTryOn=process.env.RUN_REAL_TRYON!=='false',runMotion=process.env.RUN_REAL_MOTION==='true';
const testSeed=process.env.STUDIO_REAL_SEED===undefined?undefined:Number(process.env.STUDIO_REAL_SEED);
const motionPreset=process.env.STUDIO_REAL_MOTION_PRESET||'custom';
const output=path.resolve(process.env.STUDIO_REAL_OUTPUT||'test-results/generation-v4/real-production'),started=Date.now(),deadline=started+15*60*1000;
const person=path.resolve('public/demo/studio-model-v2.png'),garment=path.resolve('asset-sources/catvton-v4/official-test-garment.jpeg'),driver=path.resolve('asset-sources/tps-v4/taichi-driver-research.mp4');
const report={passed:false,base,usesMockApi:false,realGenerationVerified:false,realMotionVerified:false,runTryOn,runMotion,motionPreset,startedAt:new Date(started).toISOString(),timeoutMs:900000,checks:[],jobs:{},errors:[],sources:{person,personIsAiSample:true,garment:runTryOn?garment:null,drivingVideo:runMotion&&motionPreset==='custom'?driver:null,drivingVideoIsResearchInput:runMotion&&motionPreset==='custom',productAssetClaim:false}};
fs.mkdirSync(output,{recursive:true});let browser,context,page,timeoutTimer;
const hash=buffer=>crypto.createHash('sha256').update(buffer).digest('hex');
const saveReport=()=>fs.writeFileSync(path.join(output,'real-generation-report.json'),JSON.stringify(report,null,2));
const remaining=()=>Math.max(1,deadline-Date.now());
const safeUrl=value=>{const u=new URL(value,base);assert.equal(u.origin,new URL(base).origin,'Result URL must belong to the tested local service');return u.href;};
async function jsonRequest(relative){const response=await context.request.get(safeUrl(relative),{timeout:Math.min(20000,remaining())});assert.ok(response.ok(),`GET ${relative}: HTTP ${response.status()} ${await response.text()}`);return response.json();}
async function evidenceLabel(text){await page.evaluate(text=>{let node=document.querySelector('#real-test-evidence-label');if(!node){node=document.createElement('div');node.id='real-test-evidence-label';node.style.cssText='position:absolute;bottom:5px;left:16px;right:16px;z-index:40;width:fit-content;max-width:calc(100% - 32px);padding:5px 8px;border:1px solid #c7cbd2;border-radius:6px;background:#fff;color:#3a3a42;font:10px/1.5 sans-serif;pointer-events:none';document.querySelector('.generation-studio').append(node);}node.textContent=text;},text);}
async function openStudio(){await page.waitForSelector('#ai-tryon',{timeout:Math.min(30000,remaining())});await page.click('#ai-tryon');await page.waitForFunction(()=>document.querySelector('.generation-studio')?.open,{},{timeout:Math.min(30000,remaining())});}
async function reloadAndRecover(kind,id){
 await page.reload({waitUntil:'domcontentloaded',timeout:Math.min(45000,remaining())});await openStudio();
 if(kind==='motion')await page.click('[data-action=toggle-workflow]');
 const selector=kind==='motion'?`[data-motion-job="${id}"]`:`[data-job="${id}"]`;
 await page.waitForSelector(selector,{timeout:Math.min(30000,remaining())});await page.click(selector);
 const key=kind==='motion'?'yingshen-motion-jobs':'yingshen-generation-jobs',ids=await page.evaluate(key=>JSON.parse(localStorage.getItem(key)||'[]'),key);
 assert.ok(ids.includes(id));assert.ok(ids.every(value=>typeof value==='string'&&!value.includes('base64')));
 report.checks.push(`${kind}: reload restored the real task by its local identifier`);
}
async function submit(kind){
 const endpoint=`/api/${kind==='motion'?'motion':'tryon'}/jobs`,action=kind==='motion'?'generate-motion':'generate';
 await page.waitForFunction(action=>!document.querySelector(`[data-action="${action}"]`).disabled,action,{timeout:Math.min(30000,remaining())});
 const pending=page.waitForResponse(response=>new URL(response.url()).pathname===endpoint&&response.request().method()==='POST',{timeout:Math.min(60000,remaining())});
 await page.click(`[data-action="${action}"]`);const response=await pending,payload=await response.json();
 assert.equal(response.status(),202,JSON.stringify(payload));assert.ok(payload.job?.id);report.jobs[kind]={id:payload.job.id,submittedStatus:payload.job.status};saveReport();return payload.job.id;
}
async function waitForRealResult(kind,id){
 const endpoint=`/api/${kind==='motion'?'motion':'tryon'}/jobs/${encodeURIComponent(id)}`;let previous='';
 while(Date.now()<deadline){
  const {job}=await jsonRequest(endpoint);assert.equal(job.id,id);const snapshot={time:new Date().toISOString(),kind,id,status:job.status,stage:job.stage,message:job.message,elapsedMs:job.elapsedMs,progress:job.progress};
  fs.appendFileSync(path.join(output,'progress.jsonl'),JSON.stringify(snapshot)+'\n');report.jobs[kind].latest=snapshot;
  const signature=JSON.stringify([job.status,job.stage,job.message,job.progress]);if(signature!==previous){console.log(JSON.stringify(snapshot));previous=signature;}
  if(job.status==='succeeded'){assert.equal(job.result?.generated,true);assert.ok(job.result.url);report.jobs[kind].result=job.result;saveReport();return job;}
  if(['failed','cancelled'].includes(job.status))throw new Error(`${kind} ${job.status}: ${job.error?.message||job.error||job.message||id}`);
  await new Promise(resolve=>setTimeout(resolve,Math.min(3000,remaining())));
 }
 throw new Error(`15 minute deadline reached; real ${kind} job ${id} has not completed. No automatic resubmit or cancellation was performed.`);
}
async function screenshotResult(kind){
 await page.setViewportSize({width:1440,height:1000});await page.locator('.gen-content').evaluate(el=>el.scrollTop=0);
 await evidenceLabel(kind==='motion'?(motionPreset==='custom'?'真实本机服务验收 · 研究驱动视频输入，非产品素材 · 仅验证小幅体态实验':'真实本机服务验收 · 自有骨骼动作驱动 + AI 人物样片 · 轻微姿态实验'):'真实本机服务验收 · AI 人物样片 + 研究商品图 · 不代表所有输入效果');
 if(kind==='motion'){await page.click('[data-action=motion-focus]');await page.waitForTimeout(150);}
 await page.screenshot({path:path.join(output,`real-${kind}-desktop.png`)});
 await page.setViewportSize({width:390,height:844});if(kind==='tryon')await page.locator('[data-result]').scrollIntoViewIfNeeded();
 else await page.locator('[data-motion-video]').scrollIntoViewIfNeeded();
 assert.ok(await page.locator('.generation-studio').evaluate(el=>el.scrollWidth<=innerWidth));
 assert.ok(await page.locator('.gen-content').evaluate(el=>el.scrollWidth<=el.clientWidth));
 await page.screenshot({path:path.join(output,`real-${kind}-mobile.png`)});
 if(kind==='motion')await page.click('[data-action=motion-focus]');await page.setViewportSize({width:1440,height:1000});
}
async function verifyTryOn(job){
 const response=await context.request.get(safeUrl(job.result.url),{timeout:Math.min(30000,remaining())});assert.equal(response.status(),200);const bytes=await response.body();
 assert.equal(bytes.subarray(0,8).toString('hex'),'89504e470d0a1a0a','Local try-on must return a real PNG');const width=bytes.readUInt32BE(16),height=bytes.readUInt32BE(20);assert.ok(width>=128&&height>=128);
 fs.writeFileSync(path.join(output,'tryon-api-result.png'),bytes);
 await page.click('[data-action=refresh-history]');await page.waitForSelector(`[data-job="${job.id}"]`);await page.click(`[data-job="${job.id}"]`);
 await page.waitForFunction(()=>{const img=document.querySelector('[data-result-image]');return !document.querySelector('[data-result]').hidden&&img.complete&&img.naturalWidth>0;},{},{timeout:Math.min(30000,remaining())});
 const dimensions=await page.locator('[data-result-image]').evaluate(e=>({width:e.naturalWidth,height:e.naturalHeight}));assert.deepEqual(dimensions,{width,height});
 assert.equal(await page.locator('[data-compare]').isDisabled(),true,'Reload must not invent an original image for comparison');
 const pending=page.waitForEvent('download',{timeout:Math.min(30000,remaining())});await page.click('[data-download]');const download=await pending,file=path.join(output,'tryon-ui-download.png');await download.saveAs(file);assert.equal(hash(fs.readFileSync(file)),hash(bytes));
 report.jobs.tryon.verification={width,height,bytes:bytes.length,sha256:hash(bytes),downloadMatchesApi:true};report.realGenerationVerified=true;report.checks.push('tryon: actual API PNG dimensions match the rendered result; UI download bytes match the real API file');await screenshotResult('tryon');
}
async function verifyMotion(job){
 await page.click('[data-action=refresh-motion]');await page.waitForSelector(`[data-motion-job="${job.id}"]`);await page.click(`[data-motion-job="${job.id}"]`);
 await page.waitForFunction(()=>{const v=document.querySelector('[data-motion-video]');return !document.querySelector('[data-motion-video-wrap]').hidden&&v.readyState>=2;},{},{timeout:Math.min(30000,remaining())});
 const video=page.locator('[data-motion-video]');assert.equal(await video.evaluate(v=>v.autoplay),false);assert.equal(await video.evaluate(v=>v.paused),true);
 const playback=await video.evaluate(async v=>{
  const canvas=document.createElement('canvas');canvas.width=128;canvas.height=128;const ctx=canvas.getContext('2d'),samples=[];
  const capture=()=>{ctx.drawImage(v,0,0,128,128);const pixels=ctx.getImageData(0,0,128,128).data;let hash=2166136261;for(let i=0;i<pixels.length;i+=16)hash=Math.imul(hash^pixels[i],16777619);samples.push({time:v.currentTime,hash:hash>>>0});};
  capture();v.currentTime=0;let finished=false,frameCallback;
  const next=()=>{if(finished)return;capture();if(v.requestVideoFrameCallback)frameCallback=v.requestVideoFrameCallback(next);};
  const ended=new Promise((resolve,reject)=>{const timer=setTimeout(()=>{finished=true;v.pause();reject(new Error('Actual video did not reach ended within 20 seconds'));},20000);v.addEventListener('ended',()=>{clearTimeout(timer);finished=true;if(frameCallback)v.cancelVideoFrameCallback(frameCallback);capture();resolve();},{once:true});});
  await v.play();if(v.requestVideoFrameCallback)frameCallback=v.requestVideoFrameCallback(next);await ended;
  return {width:v.videoWidth,height:v.videoHeight,duration:v.duration,ended:v.ended,decodedFrames:v.getVideoPlaybackQuality?.().totalVideoFrames||null,samples,dynamic:new Set(samples.map(item=>item.hash)).size>1};
 });
 assert.equal(playback.ended,true);assert.ok(playback.width>0&&playback.height>0);assert.ok(playback.duration>0);assert.equal(playback.dynamic,true,'Decoded real video frames must differ, without claiming good motion quality');
 const url=safeUrl(job.result.url),apiResponse=await context.request.get(url,{timeout:Math.min(30000,remaining())});assert.equal(apiResponse.status(),200);const bytes=await apiResponse.body();assert.ok(bytes.length>1000);fs.writeFileSync(path.join(output,'motion-api-result.mp4'),bytes);
 const range=await context.request.get(url,{headers:{Range:'bytes=0-1023'},timeout:Math.min(20000,remaining())});assert.equal(range.status(),206);assert.match(range.headers()['content-range'],/^bytes 0-1023\/\d+$/);assert.deepEqual(await range.body(),bytes.subarray(0,1024));
 const pending=page.waitForEvent('download',{timeout:Math.min(30000,remaining())});await page.click('[data-action=download-motion]');const download=await pending,file=path.join(output,'motion-ui-download.mp4');await download.saveAs(file);assert.equal(hash(fs.readFileSync(file)),hash(bytes));
 report.jobs.motion.verification={...playback,bytes:bytes.length,sha256:hash(bytes),rangeVerified:true,downloadMatchesApi:true,researchInputOnly:motionPreset==='custom',qualityClaim:false};report.realMotionVerified=true;report.checks.push('motion: real video decoded differing frames and reached ended; HTTP Range and UI download bytes match the API');await screenshotResult('motion');
}
async function run(){
 assert.ok(runTryOn||runMotion,'Choose at least one real generation task');for(const file of [person,...(runTryOn?[garment]:[]),...(runMotion&&motionPreset==='custom'?[driver]:[])])assert.ok(fs.existsSync(file),`Missing required real test input: ${file}`);
 browser=await chromium.launch({channel:'msedge',headless:true});context=await browser.newContext({viewport:{width:1440,height:1000},acceptDownloads:true,reducedMotion:'reduce'});
 await context.addInitScript(()=>localStorage.setItem('yingshen-preferences',JSON.stringify({theme:'light',motion:'reduced',quality:'balanced',backdrop:'pearl'})));
 report.capabilities=await jsonRequest('/api/capabilities');
 if(runTryOn){assert.equal(report.capabilities.tryOn?.configured,true,'Local try-on must be configured before this opt-in test');assert.equal(report.capabilities.tryOn?.remote,false,'This test is authorized only for the local model');assert.equal(report.capabilities.tryOn?.kind,'local-catvton');}
 if(runMotion){assert.equal(report.capabilities.motion?.configured,true);assert.equal(report.capabilities.motion?.remote,false,'This test is local only');if(motionPreset==='custom')assert.equal(report.capabilities.motion?.acceptsDrivingVideo,true);assert.ok(report.capabilities.motion.presets.includes(motionPreset));}
 page=await context.newPage();page.on('pageerror',error=>report.errors.push(error.message));await page.goto(base,{waitUntil:'domcontentloaded',timeout:Math.min(45000,remaining())});
 await page.setInputFiles('#photo-input',person);await page.waitForFunction(()=>!document.querySelector('#photo-thumbnail').hidden&&!document.querySelector('#generate').disabled);await openStudio();
 await page.waitForFunction(()=>!document.querySelector('[data-preview=person]').hidden);assert.equal(await page.locator('[data-filename=person]').textContent(),path.basename(person));report.checks.push('main workspace person File inherited by the real generation dialog');
 if(runTryOn){await page.setInputFiles('[data-file=garment]',garment);await page.selectOption('[data-field=category]','tops');await page.selectOption('[data-field=photoType]','flat-lay');if(testSeed!==undefined){assert.ok(Number.isInteger(testSeed)&&testSeed>=0&&testSeed<=2147483647);assert.equal(report.capabilities.tryOn.supportsSeed,true);await page.locator('[data-generation-settings]').evaluate(el=>el.open=true);await page.fill('[data-field=seed]',String(testSeed));}const id=await submit('tryon');await reloadAndRecover('tryon',id);const job=await waitForRealResult('tryon',id);if(testSeed!==undefined){assert.equal(job.seed,testSeed);report.jobs.tryon.seed=job.seed;}await verifyTryOn(job);}
 if(runMotion){
  if(!await page.locator('.generation-studio').evaluate(el=>el.classList.contains('gen-motion-entry')))await page.click('[data-action=toggle-workflow]');
  if(runTryOn)await page.selectOption('[data-motion-source]','tryon');else{await page.setInputFiles('[data-file=person]',person);await page.selectOption('[data-motion-source]','person');}
  await page.selectOption('[data-motion-preset]',motionPreset);if(motionPreset==='custom')await page.setInputFiles('[data-driving-file]',driver);await page.waitForFunction(()=>!document.querySelector('[data-action=generate-motion]').disabled,{},{timeout:Math.min(30000,remaining())});
  const id=await submit('motion');report.jobs.motion.motionPreset=motionPreset;if(motionPreset==='custom')report.jobs.motion.researchInput=driver;await reloadAndRecover('motion',id);await verifyMotion(await waitForRealResult('motion',id));
 }
 if(runTryOn&&process.env.STUDIO_TEST_CONTINUE==='true'){
  if(await page.locator('.generation-studio').evaluate(el=>el.classList.contains('gen-motion-entry')))await page.click('[data-action=toggle-workflow]');
  await page.click('[data-action=use-result]');
  await page.waitForFunction(()=>document.querySelector('.product-studio')?.open,{},{timeout:60000});
  const state=await page.evaluate(()=>window.__YINGSHEN__.getState());assert.equal(state.photoReady,true);assert.equal(state.mode,'photo');assert.equal(state.look.showGarment,false);assert.ok(state.hasFace||state.hasPose);
  assert.ok(await page.locator('[data-ps-preview]').evaluate(c=>c.width>0&&c.height>0));
  report.checks.push('actual generated result transferred into the main photo workspace, real landmarks detected, original garment recolouring disabled, and product fitting dialog opened without re-upload');
  await page.screenshot({path:path.join(output,'continue-product-desktop.png')});await page.click('[data-ps=close]');
 }
 assert.deepEqual(report.errors,[]);report.passed=true;report.finishedAt=new Date().toISOString();report.elapsedMs=Date.now()-started;saveReport();console.log(JSON.stringify({passed:true,jobs:report.jobs,checks:report.checks,errors:report.errors,output},null,2));
}
Promise.race([run(),new Promise((_,reject)=>{timeoutTimer=setTimeout(()=>reject(new Error('15 minute overall real-service QA deadline reached; consult saved task identifiers. No automatic resubmit/cancellation.')),remaining());})])
 .catch(error=>{report.failure=error.stack||String(error);report.finishedAt=new Date().toISOString();report.elapsedMs=Date.now()-started;saveReport();console.error(error);process.exitCode=1;})
 .finally(async()=>{clearTimeout(timeoutTimer);await browser?.close();});
