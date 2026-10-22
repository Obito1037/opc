const {chromium}=require('C:/Users/20665/AppData/Local/OpenAI/Codex/runtimes/cua_node/78fb63cda1a9e2b2/bin/node_modules/playwright');
const fs=require('node:fs'),path=require('node:path');
const base=process.env.STUDIO_TEST_URL||'http://127.0.0.1:5173',label=process.env.AVATAR_PERF_LABEL||'baseline';
const output=path.resolve('test-results/performance-v3');fs.mkdirSync(output,{recursive:true});
(async()=>{
 const browser=await chromium.launch({channel:'msedge',headless:true});
 const page=await browser.newPage({viewport:{width:1512,height:1100},deviceScaleFactor:1});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 // Other agents edit the same workspace: suppress Vite HMR during fixed-size sampling.
 await page.routeWebSocket('**',socket=>{const server=socket.connectToServer();server.onMessage(data=>{let message;try{message=JSON.parse(String(data));}catch{}if(!['update','full-reload'].includes(message?.type))socket.send(data);});socket.onMessage(data=>server.send(data));});
 await page.addInitScript(()=>{
  let stamp=0;const native=window.requestAnimationFrame;window.requestAnimationFrame=fn=>native.call(window,t=>{stamp=t;fn(t);});
  window.__perfDraw={draws:0,frames:[],last:-1};
  for(const cls of[WebGLRenderingContext,WebGL2RenderingContext])for(const name of['drawArrays','drawElements','drawArraysInstanced','drawElementsInstanced']){const original=cls.prototype[name];if(!original)continue;cls.prototype[name]=function(...args){if(this.canvas?.closest?.('#avatar-stage')){const p=window.__perfDraw;p.draws++;if(stamp!==p.last){p.frames.push(stamp);p.last=stamp;}}return original.apply(this,args);};}
 });
 const cdp=await page.context().newCDPSession(page);await cdp.send('Performance.enable');
 const metric=async()=>Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(v=>[v.name,v.value]));
 async function sample(name,ms=4000){await page.evaluate(()=>{window.__perfDraw.draws=0;window.__perfDraw.frames=[];window.__perfDraw.last=-1;});const before=await metric();const start=Date.now();await page.waitForTimeout(ms);const durationMs=Date.now()-start,after=await metric();const data=await page.evaluate(()=>({draws:window.__perfDraw.draws,frames:window.__perfDraw.frames}));const intervals=data.frames.slice(1).map((v,i)=>v-data.frames[i]).sort((a,b)=>a-b);return{name,durationMs,renderedFrames:data.frames.length,renderedFps:Number((data.frames.length*1000/durationMs).toFixed(2)),drawCalls:data.draws,medianFrameMs:intervals[Math.floor(intervals.length*.5)]||null,p95FrameMs:intervals[Math.floor(intervals.length*.95)]||null,mainThreadTaskMs:Number(((after.TaskDuration-before.TaskDuration)*1000).toFixed(1))};}
 try{
  await page.goto(base,{waitUntil:'domcontentloaded',timeout:60000});await page.waitForFunction(()=>window.__YINGSHEN__?.ready(),{},{timeout:60000});
  // Fix canvas CSS dimensions independently of ongoing visual redesign.
  await page.addStyleTag({content:'#avatar-stage{position:fixed!important;left:380px!important;top:200px!important;width:596px!important;height:650px!important;z-index:100!important;background:#eeeae3}'});
  await page.locator('[data-motion="walk"]').evaluate(e=>e.click());await page.waitForTimeout(2000);
  const active=await sample('walk-active');await page.locator('#pause-motion').evaluate(e=>e.click());await page.waitForTimeout(1000);
  const paused=await sample('paused');await page.locator('#avatar-stage').screenshot({path:path.join(output,label+'-avatar.png')});
  await page.locator('[data-mode="mirror"]').evaluate(e=>e.click());await page.waitForTimeout(500);const hidden=await sample('inactive-mode');
  const info=await page.evaluate(()=>{const c=document.querySelector('#avatar-stage canvas'),gl=c.getContext('webgl2'),ext=gl.getExtension('WEBGL_debug_renderer_info');return{drawingBuffer:[c.width,c.height],renderer:ext?gl.getParameter(ext.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER),dpr:devicePixelRatio,hardwareConcurrency:navigator.hardwareConcurrency};});
  if(info.drawingBuffer[0]!==596||info.drawingBuffer[1]!==650)throw new Error('Fixed-stage drawing buffer changed during sampling: '+info.drawingBuffer);
  const report={label,base,at:new Date().toISOString(),viewport:[1512,1100],fixedStageCss:[596,650],info,samples:[active,paused,hidden],errors,limitations:'4 s samples on a shared development workstation, headless Edge with instrumentation. Does not establish end-to-end real device FPS or GPU power usage.'};
  fs.writeFileSync(path.join(output,label+'.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
 }catch(error){console.error('PAGE ERRORS',errors);console.error('APP STATE',await page.evaluate(()=>window.__YINGSHEN__?.getState()).catch(()=>null));throw error;}finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1);});
