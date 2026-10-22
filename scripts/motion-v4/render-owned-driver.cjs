/* Render only. This script must never launch TPS or edit the verified presets. */
const fs=require('node:fs/promises'),path=require('node:path'),http=require('node:http');
const crypto=require('node:crypto');
const {spawn}=require('node:child_process');
const {chromium}=require('C:/Users/20665/AppData/Local/OpenAI/Codex/runtimes/cua_node/78fb63cda1a9e2b2/bin/node_modules/playwright');
const root=path.resolve(__dirname,'../..');
const argument=name=>{const i=process.argv.indexOf('--'+name);return i>=0?process.argv[i+1]:undefined;};
const name=argument('name')||'owned-driver-v1';
if(!/^owned-driver-v\d+$/.test(name))throw new Error('Candidate name must be owned-driver-v<number>');
const amplitude=Number(argument('amplitude')||1),appearance=argument('appearance')||'plain';
if(!Number.isFinite(amplitude)||amplitude<.25||amplitude>4||!['plain','hair'].includes(appearance))throw new Error('Invalid render parameters');
const output=path.join(root,'asset-sources/tps-v4',name);
const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const model=path.join(root,'public/models/avatar-v2/atelier-body.glb');

(async()=>{
  await fs.mkdir(path.join(output,'frames'),{recursive:true});
  const server=http.createServer(async(req,res)=>{
    try{
      const request=new URL(req.url,'http://127.0.0.1').pathname;
      let file,type;
      if(request==='/'){file=path.join(__dirname,'render-owned-driver.html');type='text/html;charset=utf-8';}
      else if(request==='/atelier-body.glb'){file=model;type='model/gltf-binary';}
      else if(request.startsWith('/three/')){
        const base=path.join(root,'node_modules/three');
        file=path.resolve(base,request.slice('/three/'.length));
        if(!file.startsWith(base+path.sep))throw new Error('outside allowed path');
        type='text/javascript';
      }else{res.writeHead(404);res.end();return;}
      const bytes=await fs.readFile(file);res.writeHead(200,{'Content-Type':type,'Cache-Control':'no-store'});res.end(bytes);
    }catch(error){res.writeHead(404);res.end();}
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  let browser;
  const started=Date.now();
  try{
    browser=await chromium.launch({channel:'msedge',headless:true,args:['--disable-extensions']});
    const page=await browser.newPage({viewport:{width:256,height:256},deviceScaleFactor:1});
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.goto(`http://127.0.0.1:${server.address().port}/?amplitude=${amplitude}&appearance=${appearance}`,{waitUntil:'load'});
    try{await page.waitForFunction(()=>window.ownedDriverReady===true,null,{timeout:30000});}
    catch(error){throw new Error([error.message,...errors].join('\n'));}
    const info=await page.evaluate(()=>window.ownedDriverInfo),frames=[];
    for(let i=0;i<info.frames;i++){
      const frame=await page.evaluate(index=>window.renderOwnedFrame(index),i);
      const bytes=Buffer.from(frame.png.split(',')[1],'base64');delete frame.png;
      await fs.writeFile(path.join(output,'frames',String(i).padStart(3,'0')+'.png'),bytes);
      frames.push({...frame,sha256:hash(bytes)});
      // Deliberately offline/low-rate capture while another local model runs.
      await new Promise(resolve=>setTimeout(resolve,100));
    }
    if(errors.length)throw new Error(errors.join('\n'));
    const reference=JSON.stringify(frames[0].camera),rig=JSON.stringify(frames[0].rig);
    if(frames.some(frame=>JSON.stringify(frame.camera)!==reference||JSON.stringify(frame.rig)!==rig))throw new Error('Camera or whole-rig transform changed');
    if(new Set(frames.map(frame=>frame.sha256)).size<20)throw new Error('Too few unique skeletal frames');
    const motionStats={};
    for(const name of Object.keys(frames[0].joints)){
      const a=frames[0].joints[name];let maxAngle=0,maxPosition=0;
      for(const frame of frames){const b=frame.joints[name];maxAngle=Math.max(maxAngle,2*Math.acos(Math.min(1,Math.abs(a.quaternion.reduce((s,x,i)=>s+x*b.quaternion[i],0))))*180/Math.PI);maxPosition=Math.max(maxPosition,Math.hypot(...a.position.map((x,i)=>x-b.position[i])));}
      motionStats[name]={maxAngleDegrees:maxAngle,maxWorldDisplacement:maxPosition};
    }
    await fs.copyFile(path.join(__dirname,'render-owned-driver.html'),path.join(output,'render-source.html'));
    const manifest={version:1,kind:'owned-3d-driver-candidate',verified:false,...info,motionStats,
      createdAt:new Date().toISOString(),renderSeconds:(Date.now()-started)/1000,
      model:{file:'public/models/avatar-v2/atelier-body.glb',sha256:hash(await fs.readFile(model)),license:'MakeHuman graphical assets CC0 1.0; project authored garment adaptation'},
      source:{html:'scripts/motion-v4/render-owned-driver.html',snapshot:'render-source.html',sha256:hash(await fs.readFile(path.join(__dirname,'render-owned-driver.html'))),
        upstreamLicense:'https://github.com/makehumancommunity/makehuman/blob/master/LICENSE.md',
        upstreamAssetsLicense:'https://github.com/makehumancommunity/makehuman/blob/master/LICENSE.ASSETS.md'},
      framePoses:frames,limits:'3D render is a driver only. No human image has been animated by this script, and TPS quality has not been verified.'};
    await fs.writeFile(path.join(output,'manifest.json'),JSON.stringify(manifest,null,2));
    console.log(JSON.stringify({status:'rendered',frames:frames.length,renderSeconds:manifest.renderSeconds,output}));
  }finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
  // Encoding runs only after closing the browser; PyAV is isolated and uses 1 thread.
  const python=path.join(root,'runtime/motion-v4/.venv/Scripts/python.exe');
  await new Promise((resolve,reject)=>{
    const child=spawn(python,[path.join(__dirname,'encode-owned-driver.py'),'--directory',output],{cwd:root,stdio:'inherit',windowsHide:true});
    child.on('error',reject);child.on('close',code=>code===0?resolve():reject(new Error('Encoder exited '+code)));
  });
})().catch(error=>{console.error(error);process.exitCode=1;});
