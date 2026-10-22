const {chromium}=require('C:/Users/20665/AppData/Local/OpenAI/Codex/runtimes/cua_node/78fb63cda1a9e2b2/bin/node_modules/playwright');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const output=path.resolve(process.env.STUDIO_TEST_OUT||'test-results/v2'),base=process.env.STUDIO_TEST_URL||'http://127.0.0.1:5177';
fs.mkdirSync(output,{recursive:true});
async function fixture(page,blank=false){
  // A synthetic moving crop is a deterministic tracking test, not a real video result.
  const data=await page.evaluate(async blank=>{
    const img=new Image();img.src='/demo/studio-model-v2.png';await img.decode();
    const c=document.createElement('canvas');c.width=480;c.height=640;
    Object.assign(c.style,{position:'fixed',bottom:'0',right:'0',width:'120px',height:'160px',zIndex:'9999'});document.body.append(c);
    const ctx=c.getContext('2d'),start=performance.now();
    const draw=()=>{ctx.fillStyle='#d7d9d5';ctx.fillRect(0,0,480,640);if(!blank){const offset=Math.sin((performance.now()-start)/400)*img.width*.025;ctx.drawImage(img,img.width*.25+offset,img.height*.035,img.width*.5,img.height*.53,0,0,480,640);}ctx.fillStyle='#36423a';ctx.font='15px sans-serif';ctx.fillText('SYNTHETIC TEST FIXTURE',16,620);};
    draw();const stream=c.captureStream(24),r=new MediaRecorder(stream,{mimeType:'video/webm'}),chunks=[];
    const done=new Promise(resolve=>r.onstop=()=>resolve(new Blob(chunks,{type:'video/webm'})));
    r.ondataavailable=e=>{if(e.data.size)chunks.push(e.data);};r.start(100);const timer=setInterval(draw,1000/24);
    await new Promise(resolve=>setTimeout(resolve,2400));r.stop();const blob=await done;clearInterval(timer);stream.getTracks().forEach(t=>t.stop());c.remove();
    return await new Promise(resolve=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result.split(',')[1]);reader.readAsDataURL(blob);});
  },blank);
  const name=path.join(output,blank?'no-face-fixture.webm':'synthetic-tracking-fixture.webm');fs.writeFileSync(name,Buffer.from(data,'base64'));return name;
}
(async()=>{
  const browser=await chromium.launch({channel:'msedge',headless:true});
  const context=await browser.newContext({viewport:{width:1512,height:1100},acceptDownloads:true});
  const page=await context.newPage(),errors=[],checks=[];page.on('pageerror',e=>errors.push(e.message));
  const state=()=>page.evaluate(()=>window.__YINGSHEN__.getState());
  const pixels=selector=>page.locator(selector).evaluate(c=>c.toDataURL());
  try{
    await page.goto(base,{waitUntil:'networkidle',timeout:60000});
    await page.waitForFunction(()=>window.__YINGSHEN__?.ready(),{},{timeout:60000});
    await page.waitForTimeout(900);
    await page.screenshot({path:path.join(output,'studio-desktop.png'),fullPage:true});
    await page.locator('[data-motion="walk"]').click();await page.waitForTimeout(500);
    const moving=await pixels('#avatar-stage canvas');await page.waitForTimeout(400);assert.notEqual(await pixels('#avatar-stage canvas'),moving);
    await page.locator('#pause-motion').click();await page.waitForTimeout(400);const frozen=await pixels('#avatar-stage canvas');await page.waitForTimeout(300);assert.equal(await pixels('#avatar-stage canvas'),frozen);
    await page.locator('#pause-motion').click();checks.push('continuous skinned avatar loads, animates and pauses');
    await page.locator('#demo-photo').click();await page.waitForFunction(()=>!document.querySelector('#generate').disabled);await page.locator('#generate').click();
    await page.waitForFunction(()=>window.__YINGSHEN__.getState().photoReady,{},{timeout:90000});
    let s=await state();assert.equal(s.photoReport.recolorAvailable,true);assert.equal(s.look.photoMode,'recolor');
    await page.locator('#pause-motion').click();await page.waitForTimeout(150);
    await page.screenshot({path:path.join(output,'photo-recolor-desktop.png'),fullPage:true});
    const recolor=await pixels('#photo-canvas');await page.locator('#compare').click();assert.notEqual(await pixels('#photo-canvas'),recolor);await page.locator('#compare').click();
    await page.locator('[data-color="#78939f"]').click();assert.notEqual(await pixels('#photo-canvas'),recolor);
    assert.equal(await page.locator('[data-category="shoes"]').isDisabled(),true);
    await page.locator('#photo-render-mode').selectOption('overlay');assert.equal(await page.locator('[data-category="shoes"]').isDisabled(),false);
    await page.locator('#photo-render-mode').selectOption('recolor');checks.push('photo analysis, recolor, original comparison, and explicit outline mode');
    await page.locator('#save-look').click();await page.locator('[data-nav="saved"]').click();assert.equal(await page.locator('.saved-card').count(),1);await page.locator('[data-load-look]').click();checks.push('saved look applies');
    const pngWait=page.waitForEvent('download');await page.locator('#export-photo').click();await (await pngWait).saveAs(path.join(output,'photo-export.png'));checks.push('PNG export');
    const input=await fixture(page),blank=await fixture(page,true);
    await page.locator('[data-mode="mirror"]').click();await page.locator('#video-input').setInputFiles(input);
    await page.waitForFunction(()=>window.__YINGSHEN__.getState().liveReady&&window.__YINGSHEN__.getState().liveFace,{},{timeout:60000});
    if(process.env.STUDIO_EXPECT_WORKER==='1'){const perf=(await state()).visionPerformance;assert.equal(perf.backend,'worker');assert.equal(perf.mainThreadInferenceMs,0);checks.push('production video face inference runs in Worker');}
    await page.locator('[data-category="accessories"]').click();await page.locator('[data-product="frame-glasses"]').click();
    await page.locator('#makeup-intensity').fill('75');
    await page.screenshot({path:path.join(output,'live-mirror.png'),fullPage:true});
    const videoFrame=await pixels('#mirror-canvas');await page.waitForTimeout(600);assert.notEqual(await pixels('#mirror-canvas'),videoFrame);
    await page.locator('#pause-motion').click();await page.waitForTimeout(250);const paused=await pixels('#mirror-canvas');await page.waitForTimeout(400);assert.equal(await pixels('#mirror-canvas'),paused);
    await page.locator('#compare').click();assert.notEqual(await pixels('#mirror-canvas'),paused);await page.locator('#compare').click();
    checks.push('local WebM file tracks face, changes frames, renders glasses, pauses and compares');
    if(process.env.STUDIO_EXPECT_WORKER==='1'){await page.locator('#split-toggle').click();await page.locator('#comparison-position').fill('0');await page.waitForTimeout(100);const effect=await pixels('#mirror-canvas');await page.locator('#comparison-position').fill('100');await page.waitForTimeout(100);assert.notEqual(await pixels('#mirror-canvas'),effect);await page.locator('#comparison-position').fill('50');await page.screenshot({path:path.join(output,'live-split.png'),fullPage:true});await page.locator('#split-toggle').click();checks.push('production video split comparison changes real pixels');}
    const videoWait=page.waitForEvent('download',{timeout:30000});await page.locator('#record-video').click();const download=await videoWait;await download.saveAs(path.join(output,'live-mirror-export.webm'));assert.ok(fs.statSync(path.join(output,'live-mirror-export.webm')).size>10000);
    assert.equal((await state()).paused,true);checks.push('6-second live mirror WebM export restores pause');
    await page.locator('[data-mode="avatar"]').click();s=await state();assert.equal(s.liveReady,false);assert.equal(s.liveSource,null);checks.push('leaving mirror releases source');
    await page.locator('[data-mode="mirror"]').click();await page.locator('#video-input').setInputFiles(blank);
    await page.waitForFunction(()=>window.__YINGSHEN__.getState().liveReady&&document.querySelector('#analysis-status').textContent.includes('没有检测到人脸'),{},{timeout:60000});assert.equal((await state()).liveFace,false);checks.push('no-face video reports no detection');
    await page.locator('#stop-mirror').click();assert.equal((await state()).liveReady,false);
    await page.locator('#video-input').setInputFiles({name:'corrupt.mp4',mimeType:'video/mp4',buffer:Buffer.from('invalid video')});
    await page.waitForFunction(()=>document.querySelector('#stage-loader').hidden,{},{timeout:20000});assert.equal((await state()).liveReady,false);checks.push('corrupt video fails without fake success');
    await page.locator('[data-mode="photo"]').click();await page.setViewportSize({width:390,height:844});await page.screenshot({path:path.join(output,'studio-mobile.png'),fullPage:true});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);checks.push('390px mobile layout has no overflow');
    await page.setViewportSize({width:1512,height:1100});await page.locator('[data-nav="guide"]').click();assert.ok((await page.locator('#dialog-body').textContent()).includes('当前面向衣服'));assert.ok((await page.locator('#dialog-body').textContent()).includes('本机或远程处理方式'));await page.locator('#close-dialog').click();
    await page.locator('#clear-photo').click();assert.equal((await state()).photoReady,false);checks.push('photo clearing and updated capability guide');
    assert.deepEqual(errors,[]);const report={passed:true,base,time:new Date().toISOString(),checks,errors,physicalCameraTested:false,videoFixture:'Synthetic moving crop of explicitly labelled AI sample; verifies pipeline, not real head-turn quality'};fs.writeFileSync(path.join(output,'app-smoke.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
  }catch(error){await page.screenshot({path:path.join(output,'failure.png'),fullPage:true}).catch(()=>{});console.error('STATE',await state().catch(()=>null));console.error('PAGE ERRORS',errors);throw error;}
  finally{await browser.close();}
})().catch(error=>{console.error(error);process.exit(1);});
