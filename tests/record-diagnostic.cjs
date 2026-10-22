const {chromium}=require('C:/Users/20665/AppData/Local/OpenAI/Codex/runtimes/cua_node/78fb63cda1a9e2b2/bin/node_modules/playwright');
(async()=>{
 const b=await chromium.launch({channel:'msedge',headless:true});
 try{
 const p=await b.newPage({viewport:{width:1400,height:1000},acceptDownloads:true});
 p.on('pageerror',e=>console.log('ERROR',e.message));p.on('console',e=>console.log('CONSOLE',e.type(),e.text().slice(0,200)));
 p.on('download',async d=>{await d.saveAs('test-results/diagnostic.webm');console.log('DOWNLOADED',d.suggestedFilename());});
 await p.goto('http://127.0.0.1:5173',{waitUntil:'networkidle'});
 console.log('ENCODERS',await p.evaluate(()=>['video/webm;codecs=vp9','video/webm;codecs=vp8','video/webm'].map(x=>[x,MediaRecorder.isTypeSupported(x)])));
 console.log('CANVAS TEST',await p.evaluate(()=>new Promise(resolve=>{
   const c=document.createElement('canvas');c.width=320;c.height=240;const ctx=c.getContext('2d');let i=0;
   const stream=c.captureStream(24);const recorder=new MediaRecorder(stream,{mimeType:'video/webm;codecs=vp8'});const chunks=[];recorder.ondataavailable=e=>chunks.push(e.data.size);recorder.onerror=e=>resolve({error:e.error.message});recorder.onstop=()=>{clearInterval(t);stream.getTracks().forEach(t=>t.stop());resolve(chunks)};
   const t=setInterval(()=>{ctx.fillStyle=i++%2?'red':'green';ctx.fillRect(0,0,320,240);stream.getVideoTracks()[0].requestFrame?.();},40);recorder.start(250);setTimeout(()=>recorder.stop(),2000);
 })));
 await p.locator('[data-motion="walk"]').click();
 await p.locator('#record-video').click();
 await p.waitForTimeout(10000);
 console.log('STATE',await p.evaluate(()=>({button:document.querySelector('#record-video').innerText,toast:document.querySelector('#toast').textContent,hidden:document.hidden,state:window.__YINGSHEN__.getState()})));
 }finally{await b.close();}
})().catch(e=>{console.error(e);process.exit(1)});
