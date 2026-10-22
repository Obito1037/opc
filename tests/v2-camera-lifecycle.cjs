const {chromium}=require('C:/Users/20665/AppData/Local/OpenAI/Codex/runtimes/cua_node/78fb63cda1a9e2b2/bin/node_modules/playwright');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const output=path.resolve(process.env.STUDIO_TEST_OUT||'test-results/v2');
const base=process.env.STUDIO_TEST_URL||'http://127.0.0.1:5173';
fs.mkdirSync(output,{recursive:true});

(async()=>{
  const browser=await chromium.launch({channel:'msedge',headless:true});
  const context=await browser.newContext({viewport:{width:1512,height:1100},acceptDownloads:true});
  // This stub is installed before application code. The real device method is
  // never called and no camera permission is granted to this browser context.
  await context.addInitScript(()=>{
    const records=[];
    window.__CAMERA_LIFECYCLE_TEST__={
      records,
      snapshot(){return records.map(record=>({constraints:record.constraints,tracks:record.stream.getTracks().map(track=>({kind:track.kind,readyState:track.readyState})),fixtureRemoved:!record.canvas.isConnected}));},
      endLatest(){
        const record=records.at(-1);
        if(!record)throw new Error('No synthetic camera stream');
        // MediaStreamTrack.stop() does not dispatch ended. Dispatch it explicitly
        // to model a device/browser source termination after changing its state.
        for(const track of record.stream.getVideoTracks()){track.stop();track.dispatchEvent(new Event('ended'));}
      },
      cleanup(){for(const record of records){clearInterval(record.timer);record.stream.getTracks().forEach(track=>track.stop());record.canvas.remove();}},
    };
    Object.defineProperty(navigator.mediaDevices,'getUserMedia',{configurable:true,value:async constraints=>{
      const image=new Image();image.src='/demo/studio-model-v2.png';await image.decode();
      const canvas=document.createElement('canvas');canvas.width=480;canvas.height=640;
      canvas.setAttribute('aria-label','Synthetic camera test source, not physical camera');
      Object.assign(canvas.style,{position:'fixed',right:'0',bottom:'0',width:'120px',height:'160px',zIndex:'9999'});
      document.body.appendChild(canvas);
      const ctx=canvas.getContext('2d'),started=performance.now();
      const draw=()=>{
        ctx.fillStyle='#d7d9d5';ctx.fillRect(0,0,480,640);
        const offset=Math.sin((performance.now()-started)/450)*image.width*.025;
        ctx.drawImage(image,image.width*.25+offset,image.height*.035,image.width*.5,image.height*.53,0,0,480,640);
        ctx.fillStyle='#36423a';ctx.font='15px sans-serif';ctx.fillText('SYNTHETIC CAMERA TEST',16,620);
      };
      draw();
      const stream=canvas.captureStream(24);
      const record={constraints:JSON.parse(JSON.stringify(constraints)),stream,canvas,timer:null};
      record.timer=setInterval(()=>{
        if(stream.getTracks().every(track=>track.readyState==='ended')){clearInterval(record.timer);canvas.remove();return;}
        draw();
      },1000/24);
      records.push(record);
      return stream;
    }});
  });
  const page=await context.newPage(),errors=[],downloads=[],checks=[];
  page.on('pageerror',error=>errors.push(error.message));
  page.on('download',download=>downloads.push(download.suggestedFilename()));
  const state=()=>page.evaluate(()=>window.__YINGSHEN__.getState());
  const streams=()=>page.evaluate(()=>window.__CAMERA_LIFECYCLE_TEST__.snapshot());
  const openCamera=async()=>{
    await page.locator('#view-switch [data-mode="mirror"]').click();
    await page.locator('#start-camera').click();
    await page.waitForFunction(()=>{const s=window.__YINGSHEN__.getState();return s.liveReady&&s.liveFace&&s.liveSource==='camera';},{},{timeout:60000});
  };
  const report={passed:false,base,time:new Date().toISOString(),physicalCameraTested:false,realDeviceMethodCalled:false,fixture:'canvas.captureStream(24) from a moving crop of the labelled AI sample; real camera application branch and real MediaPipe tracking, no physical camera or microphone',checks,errors};
  try{
    await page.goto(base,{waitUntil:'networkidle',timeout:60000});
    await page.waitForFunction(()=>window.__YINGSHEN__?.ready(),{},{timeout:60000});

    await openCamera();
    let records=await streams();assert.equal(records.length,1);
    assert.equal(records[0].constraints.audio,false);
    assert.equal(records[0].constraints.video.facingMode,'user');
    assert.deepEqual(records[0].tracks.map(track=>track.kind),['video']);
    assert.equal(records[0].tracks[0].readyState,'live');
    const frame=await page.locator('#mirror-canvas').evaluate(canvas=>canvas.toDataURL());
    await page.waitForTimeout(450);
    assert.notEqual(await page.locator('#mirror-canvas').evaluate(canvas=>canvas.toDataURL()),frame);
    checks.push('camera() branch obtains a video-only stream with audio:false and detects a face on continuously changing frames');
    await page.screenshot({path:path.join(output,'camera-lifecycle.png'),fullPage:true});

    await page.locator('#view-switch [data-mode="avatar"]').click();
    let current=await state();assert.equal(current.liveReady,false);assert.equal(current.liveSource,null);
    await page.waitForFunction(()=>window.__CAMERA_LIFECYCLE_TEST__.snapshot()[0].fixtureRemoved);
    records=await streams();assert.ok(records[0].tracks.every(track=>track.readyState==='ended'));
    checks.push('leaving mirror mode stops every camera stream track and clears liveReady/liveSource');

    await openCamera();
    await page.evaluate(()=>window.__CAMERA_LIFECYCLE_TEST__.endLatest());
    await page.waitForFunction(()=>!window.__YINGSHEN__.getState().liveReady);
    current=await state();assert.equal(current.liveSource,null);
    assert.equal(await page.locator('#mirror-empty').isVisible(),true);
    assert.equal(await page.locator('#mirror-canvas').isVisible(),false);
    assert.equal(await page.locator('#pause-motion').isDisabled(),true);
    assert.match(await page.locator('#analysis-status').textContent(),/摄像头连接已结束/);
    checks.push('camera track ended event clears liveReady, removes stale canvas, and displays the source termination message');

    await openCamera();
    await page.locator('#record-video').click();
    await page.waitForFunction(()=>document.querySelector('#record-video').disabled&&document.querySelector('.recording-preview'));
    await page.waitForTimeout(950);
    await page.evaluate(()=>window.__CAMERA_LIFECYCLE_TEST__.endLatest());
    await page.waitForFunction(()=>!window.__YINGSHEN__.getState().liveReady&&!document.querySelector('#record-video').disabled&&!document.querySelector('.recording-preview'),{},{timeout:10000});
    assert.match(await page.locator('#toast').textContent(),/录制中断|摄像头连接已结束/);
    assert.equal(downloads.length,0);
    // Wait beyond the original six-second recording deadline to catch a stale
    // countdown that might later report success or trigger a partial download.
    await page.waitForTimeout(6500);
    assert.equal(downloads.length,0);
    assert.equal(await page.locator('#record-video').isDisabled(),false);
    assert.equal(await page.locator('.recording-preview').count(),0);
    assert.doesNotMatch(await page.locator('#toast').textContent(),/已导出/);
    records=await streams();assert.equal(records.length,3);
    assert.ok(records.every(record=>record.constraints.audio===false&&record.tracks.every(track=>track.kind==='video'&&track.readyState==='ended')));
    checks.push('source ended during active recording aborts export, releases recorder UI, and produces no download after the original deadline');

    assert.deepEqual(errors,[]);
    report.passed=true;report.streams=records;report.downloads=downloads;
  }catch(error){
    report.failure=error.stack||String(error);
    report.state=await state().catch(()=>null);report.streams=await streams().catch(()=>null);report.downloads=downloads;
    await page.screenshot({path:path.join(output,'camera-lifecycle-failure.png'),fullPage:true}).catch(()=>{});
    throw error;
  }finally{
    fs.writeFileSync(path.join(output,'camera-lifecycle.json'),JSON.stringify(report,null,2));
    console.log(JSON.stringify(report,null,2));
    await page.evaluate(()=>window.__CAMERA_LIFECYCLE_TEST__?.cleanup()).catch(()=>{});
    await browser.close();
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
