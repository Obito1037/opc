import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
// MakeHuman CC0 topology and official skin weights, adapted in Blender.
// A garment display mannequin, never a reconstruction of an uploaded person.
const clamp=THREE.MathUtils.clamp;
const SIDES=[['L',1],['R',-1]],SOLE_POINTS=[-.08,.11,.28];
const QUALITY={auto:{dpr:1.5,shadow:1024},balanced:{dpr:1.25,shadow:1024},quality:{dpr:2,shadow:2048}};
const BACKDROPS={pearl:{platform:'#e8e7e3',ring:'#b4b1aa',shadow:'#7a7873'},ink:{platform:'#36373c',ring:'#8b909b',shadow:'#252630'},rose:{platform:'#e8d7d6',ring:'#be9994',shadow:'#997b7c'}};
const mat=(color,opts={})=>new THREE.MeshStandardMaterial({color,roughness:.6,...opts});
function mesh(parent,g,m,p=[0,0,0],scale){const o=new THREE.Mesh(g,m);o.position.set(...p);if(scale)o.scale.set(...scale);o.castShadow=o.receiveShadow=true;parent.add(o);return o;}
function group(parent,p=[0,0,0]){const o=new THREE.Group();o.position.set(...p);parent.add(o);return o;}
function oval(parent,m,p,scale){return mesh(parent,new THREE.SphereGeometry(1,36,24),m,p,scale);}
function line(parent,points,m,r=.005,closed=false){return mesh(parent,new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points.map(p=>new THREE.Vector3(...p)),closed),64,r,8,closed),m);}
function patch(parent,points,m){const g=new THREE.BufferGeometry(),ids=[];for(let i=1;i<points.length-1;i++)ids.push(0,i,i+1);g.setAttribute('position',new THREE.Float32BufferAttribute(points.flat(),3));g.setIndex(ids);g.computeVertexNormals();return mesh(parent,g,m);}
function shadowTexture(){const canvas=document.createElement('canvas');canvas.width=canvas.height=256;const c=canvas.getContext('2d'),g=c.createRadialGradient(128,128,10,128,128,128);g.addColorStop(0,'rgba(45,38,30,.32)');g.addColorStop(.38,'rgba(45,38,30,.16)');g.addColorStop(1,'rgba(45,38,30,0)');c.fillStyle=g;c.fillRect(0,0,256,256);return new THREE.CanvasTexture(canvas);}
function weaveTexture(){const c=document.createElement('canvas');c.width=c.height=128;const ctx=c.getContext('2d');for(let y=0;y<128;y++)for(let x=0;x<128;x++){const v=128+Math.sin(x*Math.PI/2)*15+Math.cos(y*Math.PI/2)*12;ctx.fillStyle=`rgb(${v},${v},${v})`;ctx.fillRect(x,y,1,1);}const t=new THREE.CanvasTexture(c);t.wrapS=t.wrapT=THREE.RepeatWrapping;t.repeat.set(4,4);return t;}
export class AvatarStage{
 constructor(container){
  this.container=container;this.motion='idle';this.paused=false;this.elapsed=0;this.disposed=false;
  this.frame=null;this.dirty=true;this.inViewport=true;this.visible=false;this.quality='auto';this.backdrop='pearl';this.lastTime=null;
  this.tick=this.tick.bind(this);this.onControlsChange=()=>this.requestRender();
  this.poseQuaternion=new THREE.Quaternion();this.poseEuler=new THREE.Euler();this.solePoint=new THREE.Vector3();
  this.performanceStats={renderedFrames:0,frameIntervals:0,averageFrameMs:0,averageSubmitMs:0,slowFrames:0};
  this.model={ready:false,source:'MakeHuman CC0',type:'garment-display-mannequin'};
  this.look={garment:'shirt',color:'#899a7b',shoe:'sneakers',accessory:'earrings',makeup:'#a34f59',makeupIntensity:.45,body:1,showGarment:true};
  this.scene=new THREE.Scene();this.camera=new THREE.PerspectiveCamera(32,1,.1,40);
  try{this.renderer=new THREE.WebGLRenderer({antialias:true,alpha:true,preserveDrawingBuffer:true,powerPreference:'high-performance'});}catch(error){this.ready=Promise.resolve(false);container.textContent='当前浏览器无法启动 3D 展示，请开启硬件加速后重试。';console.warn(error);return;}
  this.targetPixelRatio=Math.min(window.devicePixelRatio||1,QUALITY.auto.dpr);this.renderer.setClearColor(0,0);this.renderer.outputColorSpace=THREE.SRGBColorSpace;
  this.renderer.toneMapping=THREE.ACESFilmicToneMapping;this.renderer.toneMappingExposure=.86;this.renderer.shadowMap.enabled=true;this.renderer.shadowMap.type=THREE.PCFShadowMap;this.renderer.shadowMap.autoUpdate=false;
  const canvas=this.renderer.domElement;canvas.style.cssText='width:100%;height:100%;display:block;touch-action:none;outline:none';canvas.setAttribute('aria-label','立体服装陈列人台，可拖动旋转、滚轮缩放；此人台不是上传者本人重建。');canvas.tabIndex=0;container.appendChild(canvas);
  this.controls=new OrbitControls(this.camera,canvas);this.controls.enableDamping=true;this.controls.dampingFactor=.08;this.controls.enablePan=false;this.controls.minDistance=3.7;this.controls.maxDistance=10;this.controls.minPolarAngle=.8;this.controls.maxPolarAngle=1.68;this.controls.rotateSpeed=.6;this.resetCamera();
  this.controls.addEventListener('change',this.onControlsChange);
  this.buildLighting();this.buildStage();this.setBackdrop('pearl');this.ready=this.loadModel();this.resizeObserver=new ResizeObserver(()=>this.resize());this.resizeObserver.observe(container);this.resize();
  this.onVisibilityChange=()=>{this.lastTime=null;if(document.hidden)this.cancelFrame();else this.requestRender();};document.addEventListener('visibilitychange',this.onVisibilityChange);
  this.intersectionObserver=new IntersectionObserver(entries=>{this.inViewport=entries[0].isIntersecting;if(this.inViewport)this.requestRender();else this.cancelFrame();});this.intersectionObserver.observe(container);
  this.contextLost=e=>{e.preventDefault();this.paused=true;this.contextUnavailable=true;this.cancelFrame();container.dispatchEvent(new CustomEvent('stageerror',{detail:'3D 渲染连接中断，请刷新重试。'}));};canvas.addEventListener('webglcontextlost',this.contextLost);
 }
 buildLighting(){
  const pmrem=new THREE.PMREMGenerator(this.renderer),room=new RoomEnvironment();this.environment=pmrem.fromScene(room,.05);this.scene.environment=this.environment.texture;this.scene.environmentIntensity=.65;room.dispose();pmrem.dispose();
  this.scene.add(new THREE.HemisphereLight('#fff9ef','#b8b1a6',.8));
  const key=new THREE.DirectionalLight('#fff8ee',3.1);this.keyLight=key;key.position.set(-3.5,6,5);key.castShadow=true;key.shadow.mapSize.set(QUALITY.auto.shadow,QUALITY.auto.shadow);Object.assign(key.shadow.camera,{left:-3,right:3,top:5,bottom:-2,near:.1,far:16});key.shadow.normalBias=.008;key.shadow.bias=-.00015;key.shadow.radius=4;this.scene.add(key);
  const fill=new THREE.DirectionalLight('#edf2ff',1);fill.position.set(4,3,3);this.scene.add(fill);const rim=new THREE.DirectionalLight('#fff',2.2);rim.position.set(-2,4,-3);this.scene.add(rim);
 }
 buildStage(){
  const p=mesh(this.scene,new THREE.CylinderGeometry(1.02,1.045,.065,128),mat('#e6e0d6',{roughness:.48}),[0,-.037,0]);p.castShadow=false;
  const ring=mesh(this.scene,new THREE.TorusGeometry(1.02,.004,8,128),mat('#aa8c60',{metalness:.75,roughness:.35}),[0,-.001,0]);ring.rotation.x=Math.PI/2;
  const shadow=mesh(this.scene,new THREE.PlaneGeometry(2.2,2),new THREE.MeshBasicMaterial({map:shadowTexture(),transparent:true,depthWrite:false}),[0,.001,0]);shadow.rotation.x=-Math.PI/2;shadow.castShadow=shadow.receiveShadow=false;
  const floor=mesh(this.scene,new THREE.PlaneGeometry(40,40),new THREE.ShadowMaterial({color:'#776c5f',opacity:.15}),[0,-.074,0]);floor.rotation.x=-Math.PI/2;floor.castShadow=false;
  this.platform=p;this.platformRing=ring;this.floor=floor;
 }
 async loadModel(){try{
  const gltf=await new GLTFLoader().loadAsync('/models/avatar-v2/atelier-body.glb');if(this.disposed)return false;
  this.avatar=group(this.scene);this.avatar.add(gltf.scene);this.rig=gltf.scene;this.bones={};this.garments={};this.materials={};this.rest={};const weave=weaveTexture();
  gltf.scene.traverse(o=>{if(o.isBone){this.bones[o.name]=o;this.bones[o.name.replace(/(Arm|Hand|Thigh|Shin|Foot)([LR])$/,'$1.$2')]=o;this.rest[o.name]={position:o.position.clone(),quaternion:o.quaternion.clone()};}
   if(o.isMesh){o.castShadow=o.receiveShadow=true;o.frustumCulled=false;o.material=o.material.clone();o.material.envMapIntensity=.6;
    if(o.name==='CeramicBody'){this.bodyMesh=o;o.material=mat('#aaa095',{roughness:.38,metalness:.045});this.materials.skin=o.material;}
    else{this.garments[o.name]=o;o.material.roughness=.86;o.material.side=THREE.DoubleSide;o.material.bumpMap=weave;o.material.bumpScale=.0018;}
   }});
  this.addDetails();this.model.ready=true;this.model.vertices=this.bodyMesh?.geometry.attributes.position.count||0;this.setLook(this.look);this.animatePose(0,1);this.requestRender(true);this.container.dataset.modelReady='true';this.container.dispatchEvent(new CustomEvent('stageready',{detail:this.model}));return true;
 }catch(error){this.model.error=error.message;console.error('Atelier mannequin load failed',error);this.container.dispatchEvent(new CustomEvent('stageerror',{detail:'人台模型加载失败，请刷新重试。'}));return false;}}
 bone(name){return this.bones?.[name]||this.bones?.[name.replace('.','')];}
 addDetails(){
  const m=this.materials;m.gold=mat('#c2a16b',{metalness:.85,roughness:.27});m.sole=mat('#cbc6bc',{roughness:.75});m.shoe=mat('#eee8dc',{roughness:.5});m.boot=mat('#433b35',{roughness:.4});m.lining=mat('#eee9df',{roughness:.92,side:THREE.DoubleSide});m.lapel=mat(this.look.color,{roughness:.85,side:THREE.DoubleSide});
  this.shoes=[];for(const s of ['L','R']){const foot=this.bone('Foot.'+s);if(!foot)continue;const sneakers=group(foot),boots=group(foot);
   oval(sneakers,m.sole,[0,-.089,.15],[.107,.035,.265]);oval(sneakers,m.shoe,[0,-.054,.151],[.104,.073,.254]);oval(sneakers,m.shoe,[0,-.005,.023],[.084,.082,.103]);for(let i=0;i<4;i++)line(sneakers,[[-.045,.023-i*.007,.066+i*.023],[.045,.023-i*.007,.066+i*.023]],m.lining,.004);
   oval(boots,m.sole,[0,-.087,.103],[.108,.035,.23]);oval(boots,m.boot,[0,-.043,.112],[.106,.083,.222]);mesh(boots,new THREE.CylinderGeometry(.135,.104,.31,40),m.boot,[0,.111,-.023]);const trim=mesh(boots,new THREE.TorusGeometry(.135,.004,8,48),m.gold,[0,.269,-.023]);trim.rotation.x=Math.PI/2;this.shoes.push({sneakers,boots,foot});
  }
  const head=this.bone('Head'),chest=this.bone('Chest');this.accessories={earrings:group(head),glasses:group(head),necklace:group(chest)};
  for(const side of [-1,1]){oval(this.accessories.earrings,m.gold,[side*.163,-.034,.107],[.012,.015,.012]);const hoop=mesh(this.accessories.earrings,new THREE.TorusGeometry(.039,.005,12,48),m.gold,[side*.172,-.083,.112]);hoop.scale.x=.74;
   const rim=mesh(this.accessories.glasses,new THREE.TorusGeometry(.043,.0038,10,48),m.gold,[side*.068,.061,.255]);rim.scale.set(1.22,.85,1);const lens=oval(this.accessories.glasses,new THREE.MeshPhysicalMaterial({color:'#a9b0aa',roughness:.07,transparent:true,opacity:.14,depthWrite:false}),[side*.068,.061,.255],[.05,.034,.004]);lens.castShadow=false;line(this.accessories.glasses,[[side*.121,.073,.25],[side*.162,.068,.14],[side*.165,.034,.08]],m.gold,.0038);
  }
  line(this.accessories.glasses,[[-.016,.064,.257],[0,.076,.265],[.016,.064,.257]],m.gold,.0035);
  const necklace=[];for(let i=0;i<64;i++){const a=i/64*Math.PI*2;necklace.push([Math.sin(a)*.123,.267-Math.max(0,Math.cos(a))*.208,.105+Math.cos(a)*.135]);}line(this.accessories.necklace,necklace,m.gold,.0035,true);oval(this.accessories.necklace,m.gold,[0,.052,.244],[.016,.024,.005]);
  this.jacketDetails=group(chest);
  const jacketPoints=[],jp=this.garments.Jacket.geometry.attributes.position;
  for(let y=2.77;y>1.76;y-=.045){let z=-Infinity;for(let i=0;i<jp.count;i++)if(Math.abs(jp.getY(i)-y)<.045&&Math.abs(jp.getX(i))<.055)z=Math.max(z,jp.getZ(i));if(Number.isFinite(z))jacketPoints.push([0,y-2.5204,z+.023]);}
  line(this.jacketDetails,jacketPoints,m.gold,.0028);
  for(const side of [-1,1])line(this.jacketDetails,[[side*.15,-.47,.346],[side*.26,-.59,.31]],m.lapel,.009);
  oval(this.jacketDetails,m.gold,[0,.045,.34],[.009,.021,.006]);
  if(this.bodyMesh){const source=this.bodyMesh.geometry,p=source.attributes.position,idx=source.index,indices=[];for(let i=0;i<idx.count;i+=3){const ids=[idx.getX(i),idx.getX(i+1),idx.getX(i+2)];if(ids.every(j=>Math.abs(p.getX(j))<.052&&p.getY(j)>2.997&&p.getY(j)<3.027&&p.getZ(j)>.311))indices.push(...ids);}const g=source.clone();g.setIndex(indices);m.lips=mat('#a67f70',{roughness:.47,polygonOffset:true,polygonOffsetFactor:-1});this.lips=new THREE.SkinnedMesh(g,m.lips);this.lips.bind(this.bodyMesh.skeleton,this.bodyMesh.bindMatrix);this.lips.frustumCulled=false;this.bodyMesh.parent.add(this.lips);}
 }
 setLook(update={}){this.look={...this.look,...update};if(!this.model.ready)return;const{garment,color,shoe,accessory,makeup,makeupIntensity,showGarment,body}=this.look;const dressed=showGarment!==false;const selected=dressed?({shirt:'Shirt',jacket:'Jacket',dress:'Dress'}[garment]||'Shirt'):'Shirt';
  for(const[name,o]of Object.entries(this.garments)){o.visible=name===selected||(name==='Trousers'&&selected!=='Dress');if(name!=='Trousers'&&/^#[\da-f]{6}$/i.test(color))o.material.color.set(dressed?color:'#e8e1d2');}
  this.materials.lapel.color.set(color||'#899a7b').multiplyScalar(.89);this.jacketDetails.visible=selected==='Jacket';for(const o of this.shoes){o.sneakers.visible=shoe!=='boots';o.boots.visible=shoe==='boots';}for(const[name,o]of Object.entries(this.accessories))o.visible=name===accessory;
  if(this.materials.lips&&/^#[\da-f]{6}$/i.test(makeup))this.materials.lips.color.set('#c3aa98').lerp(new THREE.Color(makeup),clamp(Number(makeupIntensity)||0,0,1)*.7);
  let width=typeof body==='number'?body:body?.width??1;let height=typeof body==='object'?body?.height??1:1;if(typeof body==='string')width=({slim:.93,regular:1,standard:1,curvy:1.1})[body]||1;this.avatar.scale.set(clamp(Number(width)||1,.85,1.2),clamp(Number(height)||1,.9,1.1),1);this.animatePose(this.elapsed,0);this.requestRender(true);
 }
 setPhoto(){return false;}
 setMotion(motion){this.motion=['idle','walk','wave','turn'].includes(motion)?motion:'idle';this.elapsed=0;this.lastTime=null;if(this.paused)this.animatePose(0,1);this.requestRender(true);}
 setPaused(paused){const next=Boolean(paused);if(next===this.paused)return;this.paused=next;this.lastTime=null;this.requestRender();}
 resetCamera(){this.camera?.position.set(2.1,2.05,7.7);this.controls?.target.set(0,1.76,.04);this.controls?.update();this.requestRender();}
 setQuality(value='auto'){
  this.quality=Object.hasOwn(QUALITY,value)?value:'auto';const preset=QUALITY[this.quality];if(!this.renderer)return this.quality;
  this.targetPixelRatio=Math.min(window.devicePixelRatio||1,preset.dpr);
  if(this.keyLight&&this.keyLight.shadow.mapSize.x!==preset.shadow){this.keyLight.shadow.mapSize.set(preset.shadow,preset.shadow);this.keyLight.shadow.map?.dispose();this.keyLight.shadow.map=null;}
  this.performanceStats.slowFrames=0;this.performanceStats.averageFrameMs=0;this.performanceStats.frameIntervals=0;this.resize();this.requestRender(true);return this.quality;
 }
 setBackdrop(value='pearl'){
  this.backdrop=Object.hasOwn(BACKDROPS,value)?value:'pearl';const colors=BACKDROPS[this.backdrop];this.platform?.material.color.set(colors.platform);this.platformRing?.material.color.set(colors.ring);this.floor?.material.color.set(colors.shadow);this.requestRender();return this.backdrop;
 }
 getPerformanceStats(){const s=this.performanceStats;return{quality:this.quality,backdrop:this.backdrop,pixelRatio:this.renderer?.getPixelRatio()||0,shadowMapSize:this.keyLight?.shadow.mapSize.x||0,renderedFrames:s.renderedFrames,averageFrameMs:Number(s.averageFrameMs.toFixed(2)),averageSubmitMs:Number(s.averageSubmitMs.toFixed(2)),scheduled:this.frame!==null,paused:this.paused,visible:this.canRender(),drawCalls:this.renderer?.info.render.calls||0,triangles:this.renderer?.info.render.triangles||0};}
 canRender(){return !!(this.renderer&&!this.disposed&&!this.contextUnavailable&&this.visible&&this.inViewport&&!document.hidden);}
 cancelFrame(){if(this.frame!==null)cancelAnimationFrame(this.frame);this.frame=null;this.lastTime=null;}
 requestRender(shadows=false){this.dirty=true;if(shadows&&this.renderer)this.renderer.shadowMap.needsUpdate=true;if(this.canRender()&&this.frame===null&&!this.rendering)this.frame=requestAnimationFrame(this.tick);}
 resize(){if(!this.renderer||this.disposed)return;const{width,height}=this.container.getBoundingClientRect();this.visible=width>0&&height>0;if(!this.visible){this.cancelFrame();return;}this.viewportWidth=width;this.viewportHeight=height;this.requestRender();}
 syncRenderSize(){
  const width=this.viewportWidth,height=this.viewportHeight,dpr=this.targetPixelRatio||1;if(!width||!height)return;
  if(this.renderWidth===width&&this.renderHeight===height&&this.renderer.getPixelRatio()===dpr)return;
  // Changing canvas dimensions clears WebGL pixels. Resize and draw in the same
  // callback so a paused stage never presents a cleared frame during UI reflow.
  this.renderer.setDrawingBufferSize(width,height,dpr);this.renderWidth=width;this.renderHeight=height;
  this.camera.aspect=width/height;this.camera.fov=width/height<.65?37:32;this.camera.updateProjectionMatrix();
 }
 rotateBone(name,x=0,y=0,z=0,amount=1){const b=this.bones[name];if(!b)return;this.poseQuaternion.setFromEuler(this.poseEuler.set(x,y,z)).premultiply(this.rest[b.name].quaternion);b.quaternion.slerp(this.poseQuaternion,amount);}
 animatePose(t,delta){if(!this.model.ready)return;const walk=this.motion==='walk',wave=this.motion==='wave',turn=this.motion==='turn';const a=delta===0?0:1-Math.exp(-Math.min(delta,.1)*9),pace=t*3.2;
  this.rotateBone('Spine',0,walk?Math.sin(pace)*.038:Math.sin(t*.65)*.016,walk?-Math.sin(pace)*.018:-.008,a);this.rotateBone('Chest',0,walk?-Math.sin(pace)*.045:0,0,a);this.rotateBone('Neck',0,0,-.015,a);this.rotateBone('Head',0,wave?-.055:Math.sin(t*.43)*.032,wave?-.035:0,a);
  for(const[s,sign]of SIDES){const swing=Math.sin(pace+(sign===1?Math.PI:0)),waving=wave&&s==='R';this.rotateBone('UpperArm.'+s,walk?-swing*.22:waving?-.13:-.015,0,waving?-1.12:sign*.045,a);this.rotateBone('ForeArm.'+s,waving?-.17:walk?-.09-Math.max(0,-swing)*.11:-.06,0,waving?-.9-Math.sin(t*4.8)*.14:0,a);this.rotateBone('Hand.'+s,0,0,waving?Math.sin(t*4.8)*.18:sign*.025,a);const stride=this.look.garment==='dress'?.12:.24;this.rotateBone('Thigh.'+s,walk?swing*stride:sign*.009,0,sign*.008,a);this.rotateBone('Shin.'+s,walk?Math.max(0,-swing)*stride*1.55:.015,0,0,a);this.rotateBone('Foot.'+s,walk?-Math.max(0,-swing)*.105:0,0,0,a);}
  this.avatar.rotation.y=turn?t*.38:-.05;this.avatar.position.y=0;this.avatar.updateMatrixWorld(true);let lowest=Infinity;for(const o of this.shoes)for(const z of SOLE_POINTS){this.solePoint.set(0,-.122,z).applyMatrix4(o.foot.matrixWorld);lowest=Math.min(lowest,this.solePoint.y);}if(Number.isFinite(lowest))this.avatar.position.y=.004-lowest;
 }
 tick(now){
  this.frame=null;if(!this.canRender()){this.lastTime=null;return;}this.rendering=true;this.syncRenderSize();
  const interval=this.lastTime===null?0:now-this.lastTime,d=clamp(interval/1000,0,.05),animated=this.model.ready&&!this.paused;this.lastTime=now;
  const dirty=this.dirty;this.dirty=false;
  if(animated){this.elapsed+=d;this.animatePose(this.elapsed,d);this.renderer.shadowMap.needsUpdate=true;}
  const cameraChanged=this.controls.update();
  if(animated||dirty||cameraChanged){const start=performance.now();this.renderer.render(this.scene,this.camera);const s=this.performanceStats;s.renderedFrames++;s.averageSubmitMs=s.averageSubmitMs*.9+(performance.now()-start)*.1;
   if(animated&&interval>0&&interval<250){s.frameIntervals++;s.averageFrameMs=s.averageFrameMs?s.averageFrameMs*.95+interval*.05:interval;
    if(this.quality==='auto'&&s.frameIntervals>90&&s.averageFrameMs>28)s.slowFrames++;else s.slowFrames=0;
    // A sustained slow interval reduces pixel work once; never oscillate quality upward mid-session.
    if(s.slowFrames>=90&&this.renderer.getPixelRatio()>.8){this.targetPixelRatio=Math.max(.8,this.renderer.getPixelRatio()-.2);s.slowFrames=0;this.resize();}
   }
  }
  this.rendering=false;if(animated||cameraChanged||this.dirty)this.requestRender();else this.lastTime=null;
 }
 capture(){if(!this.renderer||!this.model.ready||this.contextUnavailable)return null;this.syncRenderSize();this.renderer.render(this.scene,this.camera);return this.renderer.domElement.toDataURL('image/png');}
 dispose(){this.disposed=true;this.cancelFrame();document.removeEventListener('visibilitychange',this.onVisibilityChange);this.intersectionObserver?.disconnect();this.resizeObserver?.disconnect();this.controls?.removeEventListener('change',this.onControlsChange);this.controls?.dispose();const geometries=new Set(),materials=new Set(),textures=new Set();this.scene?.traverse(o=>{if(o.geometry)geometries.add(o.geometry);if(o.material)for(const m of Array.isArray(o.material)?o.material:[o.material]){materials.add(m);for(const v of Object.values(m))if(v?.isTexture)textures.add(v);}});for(const g of geometries)g.dispose();for(const m of materials)m.dispose();for(const t of textures)t.dispose();this.keyLight?.shadow.map?.dispose();this.environment?.dispose();this.renderer?.domElement.removeEventListener('webglcontextlost',this.contextLost);this.renderer?.dispose();this.renderer?.domElement.remove();}
}
