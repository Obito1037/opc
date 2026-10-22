const { chromium } = require('C:/Users/20665/AppData/Local/OpenAI/Codex/runtimes/cua_node/78fb63cda1a9e2b2/bin/node_modules/playwright');
const fs = require('node:fs/promises');
const path = require('node:path');
(async()=>{
  if(process.argv.includes('--baseline'))throw new Error('The v0.2 baseline is archived; current source can only produce the after sample.');
  const output=path.resolve('test-results/vision-v3');await fs.mkdir(output,{recursive:true});
  const browser=await chromium.launch({channel:'msedge',headless:true});
  const page=await browser.newPage({viewport:{width:1000,height:900}});
  await page.route('**/@vite/client', route=>route.fulfill({contentType:'text/javascript',body:'export const injectQuery = url => url;'}));
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  page.on('console',m=>{if(m.type()==='error'&&!m.text().startsWith('INFO:'))errors.push(m.text());});
  await page.goto('http://127.0.0.1:5175/tests/vision-fixture-v3.html');
  const report=await page.evaluate(async()=>{
    const {PhotoEngine}=await import('/src/photo-engine.js');
    const image=new Image();image.src='/demo/studio-model-v2.png';await image.decode();
    const engine=window.photo=new PhotoEngine(document.querySelector('#photo'));engine.setPaused(true);
    const detected=await engine.load(image);engine.setPresentationMotion?.(false);
    let rebuilds=0;const rebuild=engine.rebuild.bind(engine);engine.rebuild=(...a)=>{rebuilds++;return rebuild(...a)};
    const t=performance.now();for(let i=0;i<60;i++)engine.setLook({makeupIntensity:i/60});
    const burstMs=performance.now()-t;await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
    const batchRebuilds=rebuilds;const fullT=performance.now();
    for(let i=0;i<20;i++){engine.setLook({makeupIntensity:i/20});engine.capture();}
    const captureUpdatesMs=performance.now()-fullT;
    const fabricBefore=engine.stats?.fabricRebuilds;
    engine.setLook({makeupIntensity:.63});engine.capture();
    const fabricCached=engine.stats?.fabricRebuilds===fabricBefore;
    engine.setLook({accessory:'none',makeupIntensity:0,color:'#6789ab'});
    const effect=engine.capture();
    const prepared=engine.recolor, pixels=engine.composite.getContext('2d').getImageData(0,0,engine.width,engine.height).data;
    let maxColorError=0,changedOutsideFabric=0;
    const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
    for(let i=0;i<prepared.mask.length;i++){
      const o=i*4,a=prepared.mask[i],src=prepared.source.data;
      if(a<=.001){for(let c=0;c<3;c++)if(src[o+c]!==pixels[o+c])changedOutsideFabric++;continue;}
      const lum=.2126*src[o]+.7152*src[o+1]+.0722*src[o+2];
      const shade=Math.pow(clamp(lum/prepared.referenceLuminance,.04,2.8),1.12),h=Math.max(0,lum/prepared.referenceLuminance-1.12)*24;
      for(let c=0;c<3;c++){
        const ref=new Uint8ClampedArray([src[o+c]*(1-a)+clamp([103,137,171][c]*shade+h,0,255)*a])[0];
        maxColorError=Math.max(maxColorError,Math.abs(ref-pixels[o+c]));
      }
    }
    engine.setComparison(true);const original=engine.capture();engine.setComparison(false);
    engine.setSplitComparison?.(0);const splitEffect=engine.capture();
    engine.setSplitComparison?.(1);const splitOriginal=engine.capture();
    engine.setSplitComparison?.(.5);const split=engine.capture();
    engine.setPaused(false);const frames=engine.stats?.renderedFrames;await new Promise(r=>setTimeout(r,160));
    const stillFrames=engine.stats?.renderedFrames===frames;engine.setPaused(true);
    const checks={fabricCached,maxColorErrorUnderOne:maxColorError<=1,unchangedOutsideFabric:changedOutsideFabric===0,
      effectChangesPixels:effect!==original,splitOriginalMatches:splitOriginal===original,splitEffectMatches:splitEffect===effect,
      splitDistinct:split!==original&&split!==effect,reducedMotionDoesNotRenderContinuously:stillFrames};
    return {detected,burstMs,batchRebuilds,captureUpdatesMs,rebuilds,maxColorError,changedOutsideFabric,checks};
  });
  report.errors=errors;
  const suffix='after';
  await fs.writeFile(path.join(output,`photo-${suffix}.json`),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
  await page.screenshot({path:path.join(output,`photo-${suffix}.png`)});await browser.close();
  if(errors.length||!Object.values(report.checks).every(Boolean))process.exitCode=1;
})().catch(e=>{console.error(e);process.exitCode=1;});
