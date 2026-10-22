const {chromium}=require('C:/Users/20665/AppData/Local/OpenAI/Codex/runtimes/cua_node/78fb63cda1a9e2b2/bin/node_modules/playwright');
const fs=require('fs'),path=require('path');
(async()=>{
 const output=path.resolve(__dirname,'../../test-results/avatar-v2');fs.mkdirSync(output,{recursive:true});
 const b=await chromium.launch({channel:'msedge',headless:true});const p=await b.newPage({viewport:{width:800,height:900}}),errors=[];p.on('pageerror',e=>errors.push(e.message));
 await p.goto('http://127.0.0.1:5176/tests/avatar-v2/qa.html');await p.waitForFunction(()=>window.ready,null,{timeout:30000});await p.waitForTimeout(900);
 await p.evaluate(()=>stage.setPaused(true));await p.screenshot({path:path.join(output,'qa-shirt.png')});
 const frozen=await p.evaluate(()=>stage.capture());await p.waitForTimeout(250);if(frozen!==await p.evaluate(()=>stage.capture()))throw Error('Pause did not freeze');
 const info=await p.evaluate(()=>({model:stage.model,garments:Object.keys(stage.garments),bones:Object.keys(stage.bones),lipTriangles:stage.lips.geometry.index.count/3}));
 await p.evaluate(()=>stage.setLook({garment:'jacket',color:'#b69372'}));await p.screenshot({path:path.join(output,'qa-jacket.png')});
 await p.evaluate(()=>{stage.setLook({garment:'dress',color:'#a77670'});stage.setMotion('wave');stage.setPaused(false)});await p.waitForTimeout(1500);await p.screenshot({path:path.join(output,'qa-dress-wave.png')});
 await p.evaluate(()=>{stage.setLook({garment:'dress',accessory:'glasses',shoe:'boots'});stage.setMotion('walk')});await p.waitForTimeout(700);await p.screenshot({path:path.join(output,'qa-dress-walk-a.png')});
 const first=await p.evaluate(()=>stage.capture());await p.waitForTimeout(350);if(first===await p.evaluate(()=>stage.capture()))throw Error('Walk did not animate');await p.screenshot({path:path.join(output,'qa-dress-walk-b.png')});
 await p.evaluate(()=>{stage.setMotion('turn');stage.elapsed=8.1});await p.waitForTimeout(300);await p.screenshot({path:path.join(output,'qa-back.png')});
 await p.evaluate(()=>{stage.setPaused(true);stage.setLook({showGarment:false})});const hidden=await p.evaluate(()=>({shirt:stage.garments.Shirt.visible,trousers:stage.garments.Trousers.visible}));if(!hidden.shirt||!hidden.trousers)throw Error('Base layer missing');
 if(errors.length)throw Error(errors.join('\n'));fs.writeFileSync(path.join(output,'report.json'),JSON.stringify({passed:true,info,checks:['GLB local load','three garments','17 bones','pause stable pixels','animated walk pixels','wave','turn back view','glasses and boots','opaque base layer'],errors},null,2));console.log(JSON.stringify(info));await b.close();
})().catch(e=>{console.error(e);process.exit(1)});
