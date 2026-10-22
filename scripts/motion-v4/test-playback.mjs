import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';
const require=createRequire(import.meta.url);
const { chromium }=require('C:/Users/20665/AppData/Local/OpenAI/Codex/runtimes/cua_node/78fb63cda1a9e2b2/bin/node_modules/playwright');
const root=fileURLToPath(new URL('../../',import.meta.url));
const filename=process.argv[2]?path.resolve(process.argv[2]):path.join(root,'test-results/motion-v4/tps-user-pipeline-quarter-24.mp4');
const prefix=filename.replace(/\.mp4$/i,'');
const bytes=await readFile(filename);
const server=createServer((req,res)=>{
  if(req.url==='/clip.mp4'){
    res.writeHead(200,{'Content-Type':'video/mp4','Content-Length':bytes.length,'Cache-Control':'no-store'});res.end(bytes);
  }else if(req.url==='/'){
    res.writeHead(200,{'Content-Type':'text/html;charset=utf-8'});
    res.end('<!doctype html><meta charset="utf-8"><title>Local motion playback QA</title><body style="background:#15191d;color:white;font:16px sans-serif"><p>Research · 256 × 256 · 8 fps · subtle motion</p><video id="clip" src="/clip.mp4" muted playsinline controls width="512" height="512"></video>');
  }else{res.writeHead(404);res.end();}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
let browser;
try{
  browser=await chromium.launch({channel:'msedge',headless:true});
  const page=await browser.newPage({viewport:{width:720,height:640}});
  await page.goto(`http://127.0.0.1:${server.address().port}/`,{waitUntil:'load'});
  const result=await page.evaluate(async()=>{
    const video=document.querySelector('video');
    if(video.readyState<2)await new Promise((resolve,reject)=>{video.onloadeddata=resolve;video.onerror=reject;});
    const frames=[];
    const tick=(now,meta)=>{frames.push({mediaTime:meta.mediaTime,presentedFrames:meta.presentedFrames,now});if(!video.ended)video.requestVideoFrameCallback(tick);};
    video.requestVideoFrameCallback(tick);
    const start=performance.now();
    const ended=new Promise((resolve,reject)=>{video.onended=resolve;video.onerror=()=>reject(new Error('video decode error'));});
    await video.play();await ended;
    return{duration:video.duration,width:video.videoWidth,height:video.videoHeight,currentTime:video.currentTime,
      ended:video.ended,error:video.error?.message||null,elapsedMilliseconds:performance.now()-start,
      frames,quality:video.getVideoPlaybackQuality().toJSON?.()||{totalVideoFrames:video.getVideoPlaybackQuality().totalVideoFrames,droppedVideoFrames:video.getVideoPlaybackQuality().droppedVideoFrames}};
  });
  assert.equal(result.ended,true);assert.equal(result.error,null);assert.equal(result.width,256);assert.equal(result.height,256);
  assert.ok(Math.abs(result.duration-3)<.03);assert.ok(result.frames.length>=20,`Only ${result.frames.length} presented callbacks`);
  assert.ok(result.frames.every((f,i)=>i===0||f.mediaTime>result.frames[i-1].mediaTime));
  await page.screenshot({path:prefix+'.playback.png'});
  await writeFile(prefix+'.playback.json',JSON.stringify({passed:true,...result},null,2));
  console.log(JSON.stringify({passed:true,presentedCallbacks:result.frames.length,duration:result.duration,elapsedMilliseconds:result.elapsedMilliseconds,quality:result.quality}));
}finally{
  await browser?.close();await new Promise(resolve=>server.close(resolve));
}
