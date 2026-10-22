const {chromium}=require('C:/Users/20665/AppData/Local/OpenAI/Codex/runtimes/cua_node/78fb63cda1a9e2b2/bin/node_modules/playwright');
const fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict');
(async()=>{
  const out=path.resolve('test-results/vision-v3');await fs.mkdir(out,{recursive:true});
  const built=process.argv.includes('--built'), fallback=process.argv.includes('--fallback');
  const assets=built?await fs.readdir(path.join(out,'build/assets')):[];
  const entry=built?'/assets/'+assets.find(f=>f.startsWith('live-mirror-')):'/src/live-mirror.js';
  const browser=await chromium.launch({channel:'msedge',headless:true});
  try {
    const page=await browser.newPage({viewport:{width:1000,height:900}});const errors=[],warnings=[];
    if(fallback)await page.addInitScript(()=>{window.Worker=undefined;});
    page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error'&&!m.text().startsWith('INFO:'))errors.push(m.text());if(m.type()==='warning')warnings.push(m.text());});
    await page.route('**/@vite/client',r=>r.fulfill({contentType:'text/javascript',body:'export const injectQuery = url => url;'}));
    if(built){
      await page.route('**/tests/vision-fixture-v3.html',r=>r.fulfill({contentType:'text/html',path:path.resolve('tests/vision-fixture-v3.html')}));
      await page.route('**/test-results/v2/synthetic-tracking-fixture.webm',r=>r.fulfill({contentType:'video/webm',path:path.resolve('test-results/v2/synthetic-tracking-fixture.webm')}));
    }
    await page.goto('http://127.0.0.1:5175/tests/vision-fixture-v3.html');
    await page.evaluate(async entry=>{
      document.querySelector('#photo').remove();
      const {LiveMirror}=await import(entry);
      window.mirror=new LiveMirror(document.querySelector('#mirror'),{onStatus:s=>{window.status=s},onEnded:s=>{window.ended=s}});
      const blob=await(await fetch('/test-results/v2/synthetic-tracking-fixture.webm')).blob();
      await mirror.loadVideo(new File([blob],'fixture.webm',{type:'video/webm'}));
    },entry);
    await page.waitForFunction(()=>mirror.hasFace,{},{timeout:30000});
    const report=await page.evaluate(async fallback=>{
      const wait=ms=>new Promise(r=>setTimeout(r,ms));const intervals=[];let previous=performance.now();
      let timer=setInterval(()=>{const now=performance.now();intervals.push(now-previous);previous=now},16);
      await wait(3000);clearInterval(timer);
      const stats={...mirror.stats};const backend=mirror.backend;
      mirror.setPaused(true);await wait(300);
      mirror.setLook({accessory:'glasses',makeupIntensity:1});const effect=mirror.capture();
      mirror.setComparison(true);const original=mirror.capture();mirror.setComparison(false);
      mirror.setSplitComparison(0);const allEffect=mirror.capture();
      mirror.setSplitComparison(1);const allOriginal=mirror.capture();
      mirror.setSplitComparison(.5);const split=mirror.capture();
      const stable=split===mirror.capture();
      mirror.setQuality('quality');const qualitySize=[mirror.input.width,mirror.input.height];
      mirror.setQuality('balanced');const balancedSize=[mirror.input.width,mirror.input.height];
      mirror.setQuality('auto');const autoSize=[mirror.input.width,mirror.input.height];
      mirror.setSplitComparison(null);mirror.setPaused(false);await wait(600);const moved=mirror.capture()!==effect;
      const worker=mirror.worker;mirror.dispose();const closed=!mirror.worker&&!mirror.model&&!mirror.active&&!mirror.inFlight&&!mirror.video.srcObject;
      return {backend,stats,status,intervals,qualitySize,balancedSize,autoSize,checks:{expectedBackend:backend===(fallback?'main-thread-fallback':'worker'),effectChangesPixels:effect!==original,splitLeftOriginal:allOriginal===original,splitRightEffect:allEffect===effect,splitDistinct:split!==original&&split!==effect,pauseStable:stable,videoMoves:moved,closed},ended:window.ended||null};
    },fallback);
    report.errors=errors;report.warnings=warnings;
    await fs.writeFile(path.join(out,`live-${fallback?'fallback':'worker'}${built?'-built':''}.json`),JSON.stringify(report,null,2));console.log(JSON.stringify({...report,intervals:{count:report.intervals.length,max:Math.max(...report.intervals)}},null,2));
    assert.equal(errors.length,0);assert.ok(Object.values(report.checks).every(Boolean));
  } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
