const {chromium}=require('C:/Users/20665/AppData/Local/OpenAI/Codex/runtimes/cua_node/78fb63cda1a9e2b2/bin/node_modules/playwright');
const fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict');
(async()=>{
  const out=path.resolve('test-results/product-v4');await fs.mkdir(out,{recursive:true});
  const browser=await chromium.launch({channel:'msedge',headless:true});
  try{
    const page=await browser.newPage({viewport:{width:900,height:780}}),errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    await page.goto((process.env.PRODUCT_TEST_BASE||'http://127.0.0.1:5175')+'/tests/vision-fixture-v3.html');
    const report=await page.evaluate(async()=>{
      const {PhotoEngine}=await import('/src/photo-engine.js');
      const canvas=(w,h)=>Object.assign(document.createElement('canvas'),{width:w,height:h});
      const engine=new PhotoEngine(document.querySelector('#photo'));
      // Explicit synthetic geometry fixture. No landmark model or neural
      // generation is invoked; separate real-photo QA covers detection.
      engine.initModels=async()=>{};engine.setPaused(true);engine.setPresentationMotion(false);
      engine.setLook({showGarment:false,accessory:'none',makeupIntensity:0});
      const source=canvas(400,600),sourceCtx=source.getContext('2d');sourceCtx.fillStyle='#eef3f8';sourceCtx.fillRect(0,0,400,600);
      await engine.load(source);
      const pose=Array.from({length:33},()=>({x:200,y:200,visibility:.99,presence:.99}));
      Object.assign(pose,{7:{x:150,y:100},8:{x:250,y:100},11:{x:100,y:200},12:{x:300,y:200},27:{x:150,y:500},28:{x:250,y:500},29:{x:160,y:520},30:{x:240,y:520},31:{x:120,y:530},32:{x:280,y:530}});
      const face=Array.from({length:478},()=>({x:200,y:100}));
      Object.assign(face,{33:{x:160,y:100},133:{x:180,y:100},263:{x:240,y:100},362:{x:220,y:100}});
      for(const point of face){point.visibility=0;point.presence=0;}
      engine.face=face;engine.productPose=pose;engine.pose=pose;
      const product=canvas(100,50),productCtx=product.getContext('2d');productCtx.fillStyle='#fa1641';productCtx.fillRect(0,0,50,50);
      const original=engine.original.toDataURL(),sourcePixels=sourceCtx.getImageData(0,0,400,600).data;
      const frame=()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
      const checks={},changed={};
      for(const type of ['glasses','earrings','necklace','shoe']){
        const status=engine.setProductOverlay({image:product,type});checks[type+'HasMeasuredAnchors']=status.available;
        const result=engine.getProductPreviewCanvas(),pixels=result.getContext('2d').getImageData(0,0,400,600).data;
        let modified=0;for(let i=0;i<pixels.length;i+=4)if(pixels[i]!==sourcePixels[i]||pixels[i+1]!==sourcePixels[i+1]||pixels[i+2]!==sourcePixels[i+2])modified++;
        changed[type]=modified;checks[type+'Composited']=modified>5;
        checks[type+'OriginalUntouched']=engine.original.toDataURL()===original;
        checks[type+'ExportDecodes']=await new Promise(resolve=>{const image=new Image();image.onload=()=>resolve(image.width===400&&image.height===600);image.src=result.toDataURL();});
      }
      engine.setProductOverlay({image:product,type:'glasses'});engine.getProductPreviewCanvas();
      const composite=engine.composite.toDataURL(),transparent=engine.composite.getContext('2d').getImageData(230,100,1,1).data;
      checks.transparentProductAreaPreservesPhoto=[238,243,248,255].every((value,i)=>transparent[i]===value);
      const effect=engine.capture();engine.setComparison(true);const viewedOriginal=engine.capture();
      checks.comparisonExcludesOverlay=effect!==viewedOriginal;
      checks.exportContainsOverlayDuringOriginalComparison=engine.getProductPreviewCanvas().toDataURL()===composite;
      engine.setComparison(false);engine.setSplitComparison(0);checks.splitEffectIncludesOverlay=engine.capture()===effect;
      engine.setSplitComparison(1);checks.splitOriginalExcludesOverlay=engine.capture()===viewedOriginal;engine.setSplitComparison(null);
      const stats=engine.getPerformanceStats();for(let i=0;i<80;i++)engine.setProductOverlay({image:product,type:'glasses',offsetX:i/100});
      await frame();checks.sliderUpdatesCoalesced=engine.stats.compositeRebuilds===stats.compositeRebuilds+1;
      checks.sliderKeepsFabricCache=engine.stats.fabricRebuilds===stats.fabricRebuilds;
      const saved=pose[31];pose[31]={...saved,visibility:.1};engine.setProductOverlay({image:product,type:'shoe'});
      checks.missingFootReportsUnavailable=!engine.getProductAnchorStatus('shoe').available;
      checks.missingFootDoesNotDraw=engine.getProductPreviewCanvas().toDataURL()===original;pose[31]=saved;
      // Count old renderers directly: product layers suppress only the matching
      // built-in accessory/shoe renderer, then clear restores that renderer.
      let oldAccessory=0,oldShoes=0;engine.drawAccessory=()=>oldAccessory++;engine.drawShoes=()=>oldShoes++;
      engine.hasPose=true;engine.feetDetected=true;engine.setLook({photoMode:'overlay'});
      engine.setProductOverlay({image:product,type:'glasses'});engine.getProductPreviewCanvas();checks.builtInAccessorySuppressed=oldAccessory===0;
      engine.setProductOverlay({image:product,type:'shoe'});engine.getProductPreviewCanvas();const beforeShoes=oldShoes;
      engine.setProductOverlay({image:product,type:'shoe',scale:1.1});engine.getProductPreviewCanvas();checks.builtInShoesSuppressed=oldShoes===beforeShoes;
      engine.clearProductOverlay();engine.getProductPreviewCanvas();checks.clearRestoresBuiltInShoes=oldShoes===beforeShoes+1;
      engine.setProductOverlay({image:product,type:'glasses'});await engine.load(source);
      checks.newPhotoClearsProduct=engine.productOverlay===null&&engine.productPose===null;
      engine.dispose();checks.disposeReleasesProduct=engine.getProductPreviewCanvas()===null&&!engine.getProductAnchorStatus('glasses').available;
      return {evidence:'Synthetic pixels/keypoints; no model inference. Actual Canvas composition/export and lifecycle contract.',checks,changed};
    });
    report.errors=errors;report.passed=!errors.length&&Object.values(report.checks).every(Boolean);
    await fs.writeFile(path.join(out,'engine-contract.json'),JSON.stringify(report,null,2));
    console.log(JSON.stringify(report,null,2));assert.equal(report.passed,true);
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
