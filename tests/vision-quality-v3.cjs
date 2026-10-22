const {chromium}=require('C:/Users/20665/AppData/Local/OpenAI/Codex/runtimes/cua_node/78fb63cda1a9e2b2/bin/node_modules/playwright');
const fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict');
(async()=>{
  const out=path.resolve('test-results/vision-v3'),assets=await fs.readdir(path.join(out,'build/assets'));
  const entry='/assets/'+assets.find(f=>f.startsWith('photo-engine-'));
  const browser=await chromium.launch({channel:'msedge',headless:true});
  try{
    const page=await browser.newPage({viewport:{width:1000,height:900}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.route('**/tests/vision-fixture-v3.html',r=>r.fulfill({contentType:'text/html',path:path.resolve('tests/vision-fixture-v3.html')}));
    await page.goto('http://127.0.0.1:5175/tests/vision-fixture-v3.html');
    const result=await page.evaluate(async entry=>{
      const {PhotoEngine}=await import(entry);const engine=new PhotoEngine(document.querySelector('#photo'));
      engine.setLook({makeupIntensity:0,accessory:'none'});engine.setPresentationMotion(false);engine.setPaused(true);
      const image=new Image();image.src='/demo/fashion-runway2.jpg';await image.decode();const complex=await engine.load(image);
      engine.setComparison(true);const original=engine.capture();engine.setComparison(false);const effect=engine.capture();
      const canvas=document.createElement('canvas');canvas.width=400;canvas.height=600;const ctx=canvas.getContext('2d');ctx.fillStyle='#ddd';ctx.fillRect(0,0,400,600);
      const blank=await engine.load(canvas);engine.dispose();
      return {complex,blank,checks:{complexClothingRejected:!complex.recolorAvailable,complexPixelsPreserved:original===effect,blankNoInventedBody:!blank.poseDetected,blankNoInventedFace:!blank.faceDetected,blankNoFabric:!blank.recolorAvailable}};
    },entry);
    result.errors=errors;await fs.writeFile(path.join(out,'quality-regression.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
    assert.ok(Object.values(result.checks).every(Boolean));assert.equal(errors.length,0);
  }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
