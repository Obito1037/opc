import test from 'node:test';
import assert from 'node:assert/strict';
import { getProductAnchors, normalizeProductOverlay, drawProductOverlay } from '../src/product-overlay.js';

// Synthetic keypoints and canvas command recorder test geometry/contracts.
// These are not evidence that MediaPipe detects every real photograph.
function geometry() {
  const pose = Array.from({length:33},()=>({x:200,y:200,visibility:.99,presence:.99}));
  Object.assign(pose,{7:{x:150,y:100},8:{x:250,y:110},11:{x:100,y:200},12:{x:300,y:220},
    27:{x:150,y:500},28:{x:250,y:500},29:{x:160,y:520},30:{x:240,y:520},31:{x:120,y:530},32:{x:280,y:530}});
  const face = Array.from({length:478},()=>({x:200,y:100}));
  Object.assign(face,{33:{x:160,y:100},133:{x:180,y:100},263:{x:240,y:110},362:{x:220,y:110}});
  return {width:400,height:600,face,pose};
}
function recordingContext() {
  const calls=[];
  const ctx={calls,globalAlpha:1};
  for(const key of ['save','restore','translate','rotate','scale','drawImage'])ctx[key]=(...args)=>calls.push({key,args});
  return ctx;
}
const image={width:100,height:50};

test('product anchors use actual eye/ear/shoulder/foot points and consistent left-foot orientation',()=>{
  const g=geometry();
  for(const [type,count] of [['glasses',1],['earrings',2],['necklace',1],['shoe',2]]){
    const result=getProductAnchors(g,type);assert.equal(result.available,true);assert.equal(result.anchors.length,count);
    assert.ok(result.anchors.every(a=>Number.isFinite(a.width)&&a.width>0&&Number.isFinite(a.angle)));
  }
  const shoes=getProductAnchors(g,'shoe').anchors;assert.equal(shoes[0].mirror,true);assert.equal(shoes[1].mirror,false);
  assert.ok(shoes.every(a=>Math.abs(a.angle)<Math.PI/2));
  const earrings=getProductAnchors(g,'earrings').anchors;assert.equal(earrings[0].mirror,false);assert.equal(earrings[1].mirror,true);
  assert.equal(earrings[0].x,g.pose[7].x);assert.equal(earrings[1].y,g.pose[8].y);
  assert.equal(getProductAnchors(g,'necklace').anchors[0].x,200);
  for(const point of g.face){point.visibility=0;point.presence=0;}
  assert.equal(getProductAnchors(g,'glasses').available,true);
});

test('missing, cropped, low-confidence or degenerate anchors never draw guessed products',()=>{
  for(const [type,index] of [['shoe',31],['earrings',7],['necklace',11]]){
    for(const replacement of [undefined,{x:-1,y:100},{x:100,y:700},{x:100,y:100,visibility:.3},{x:100,y:100,presence:.3},{x:NaN,y:100},{x:100,y:100,visibility:NaN}]){
      const g=geometry();g.pose[index]=replacement;
      assert.equal(getProductAnchors(g,type).available,false);
      const ctx=recordingContext();assert.equal(drawProductOverlay(ctx,normalizeProductOverlay({image,type}),g),false);assert.deepEqual(ctx.calls,[]);
    }
  }
  const g=geometry();g.face[33]=undefined;assert.equal(getProductAnchors(g,'glasses').available,false);
  g.face=geometry().face;g.face[33]={...g.face[133]};assert.equal(getProductAnchors(g,'glasses').available,false);
  assert.equal(getProductAnchors({width:400,height:600,face:geometry().face},'earrings').available,false);
  assert.equal(getProductAnchors({},'shoe').available,false);
});

test('product controls stay finite and bounded; bad image/type is rejected',()=>{
  const overlay=normalizeProductOverlay({image,type:'glasses',scale:Infinity,rotation:999,offsetX:-99,offsetY:99,opacity:2,mirror:1});
  assert.equal(overlay.scale,1);assert.equal(overlay.rotation,180);assert.equal(overlay.offsetX,-1);assert.equal(overlay.offsetY,1);assert.equal(overlay.opacity,1);assert.equal(overlay.mirror,false);
  assert.throws(()=>normalizeProductOverlay({image,type:'hat'}));
  assert.throws(()=>normalizeProductOverlay({image:{width:0,height:100},type:'shoe'}));
  assert.throws(()=>normalizeProductOverlay({image:{width:10000,height:10000},type:'shoe'}));
  const ctx=recordingContext();assert.equal(drawProductOverlay(ctx,normalizeProductOverlay({image,type:'shoe',opacity:0}),geometry()),false);assert.equal(ctx.calls.length,0);
});

test('scale preserves image aspect, offsets use measured anchor width, and mirror composes with feet',()=>{
  const g=geometry(),ctx=recordingContext();
  const overlay=normalizeProductOverlay({image,type:'shoe',scale:2,offsetX:.3,offsetY:-.2,rotation:30,mirror:true});
  const anchors=getProductAnchors(g,'shoe').anchors;
  assert.equal(drawProductOverlay(ctx,overlay,g),true);
  const images=ctx.calls.filter(c=>c.key==='drawImage');assert.equal(images.length,2);
  assert.equal(images[0].args[3]/images[0].args[4],2);
  assert.deepEqual(ctx.calls.filter(c=>c.key==='translate')[0].args,[anchors[0].x+.3*anchors[0].width,anchors[0].y-.2*anchors[0].width]);
  assert.deepEqual(ctx.calls.filter(c=>c.key==='scale').map(c=>c.args[0]),[1,-1]);
  assert.equal(ctx.calls.filter(c=>c.key==='rotate')[0].args[0],anchors[0].angle+Math.PI/6);
});
