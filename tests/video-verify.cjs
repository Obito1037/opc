const {chromium}=require('C:/Users/20665/AppData/Local/OpenAI/Codex/runtimes/cua_node/78fb63cda1a9e2b2/bin/node_modules/playwright');
const fs=require('node:fs');
(async()=>{
 const browser=await chromium.launch({channel:'msedge',headless:true});
 try{
  const page=await browser.newPage();
  await page.goto('http://127.0.0.1:5173');
  const result=await page.evaluate(async data=>{
   const video=document.createElement('video');video.src=data;video.muted=true;
   await new Promise((resolve,reject)=>{video.onloadedmetadata=resolve;video.onerror=()=>reject(new Error('Exported video cannot decode'));});
   const c=document.createElement('canvas');c.width=video.videoWidth;c.height=video.videoHeight;const ctx=c.getContext('2d');
   const frame=async t=>{await new Promise(resolve=>{video.onseeked=resolve;video.currentTime=t;});ctx.drawImage(video,0,0);return c.toDataURL();};
   const a=await frame(.4),b=await frame(4.5);
   return {width:c.width,height:c.height,dynamic:a!==b,seekedTo:video.currentTime};
  },'data:video/webm;base64,'+fs.readFileSync('test-results/motion.webm').toString('base64'));
  if(!result.dynamic||result.seekedTo<4.4||result.width<100)throw new Error('Export lacks valid dynamic video '+JSON.stringify(result));
  fs.writeFileSync('test-results/video-verify.json',JSON.stringify({passed:true,...result},null,2));console.log(result);
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1);});
