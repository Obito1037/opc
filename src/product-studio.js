import './product-studio.css';

const defaults = {scale:1,rotation:0,offsetX:0,offsetY:0,opacity:1,mirror:false};
const makeCanvas=(w,h)=>Object.assign(document.createElement('canvas'),{width:w,height:h});

/** Remove only neutral white background connected to the border. Transparent
 * product PNGs retain their alpha. This is a local cutout, not AI generation. */
export function prepareProductImage(source,removeWhite=false){
  const scale=Math.min(1,1024/Math.max(source.width,source.height));
  const canvas=makeCanvas(Math.max(1,Math.round(source.width*scale)),Math.max(1,Math.round(source.height*scale)));
  const ctx=canvas.getContext('2d',{willReadFrequently:true});ctx.drawImage(source,0,0,canvas.width,canvas.height);
  const image=ctx.getImageData(0,0,canvas.width,canvas.height),{data}=image,w=canvas.width,h=canvas.height;
  if(removeWhite){
    const visited=new Uint8Array(w*h),queue=new Int32Array(w*h);let read=0,end=0;
    const add=i=>{if(visited[i])return;visited[i]=1;const at=i*4,lo=Math.min(data[at],data[at+1],data[at+2]),hi=Math.max(data[at],data[at+1],data[at+2]);if(data[at+3]<8||(lo>226&&hi-lo<25))queue[end++]=i;};
    for(let x=0;x<w;x++){add(x);add((h-1)*w+x);}for(let y=0;y<h;y++){add(y*w);add(y*w+w-1);}
    while(read<end){const i=queue[read++],x=i%w;data[i*4+3]=0;if(x)add(i-1);if(x<w-1)add(i+1);if(i>=w)add(i-w);if(i<w*(h-1))add(i+w);}
    ctx.putImageData(image,0,0);
  }
  let x0=w,y0=h,x1=-1,y1=-1;
  for(let y=0;y<h;y++)for(let x=0;x<w;x++)if(data[(y*w+x)*4+3]>16){x0=Math.min(x0,x);y0=Math.min(y0,y);x1=Math.max(x1,x);y1=Math.max(y1,y);}
  if(x1<0)throw new Error('没有找到商品，请关闭去白，或上传透明背景的商品图片。');
  const crop=makeCanvas(x1-x0+1,y1-y0+1);crop.getContext('2d').drawImage(canvas,x0,y0,crop.width,crop.height,0,0,crop.width,crop.height);return crop;
}

export function mountProductStudio({getEngine,onMakeup,onClose}={}){
  const dialog=document.createElement('dialog');dialog.className='product-studio';dialog.setAttribute('aria-labelledby','product-studio-title');
  dialog.innerHTML=`<header class="ps-header"><div><span>YOUR OWN FINDS</span><h2 id="product-studio-title">把心动单品，放进搭配。</h2></div><button data-ps="close" aria-label="关闭商品试搭">×</button></header>
  <div class="ps-body"><section class="ps-preview"><canvas data-ps-preview aria-label="商品试搭照片"></canvas><span class="ps-preview-label">商品图片试搭 · 不代表尺码或真实贴合</span><button data-ps="compare" aria-pressed="false">查看原图</button></section>
  <section class="ps-controls"><label>想试什么<select data-ps-type><option value="glasses">眼镜 · 正面单件</option><option value="earrings">耳饰 · 单只</option><option value="necklace">项链 · 正面</option><option value="shoe">鞋履 · 单只侧面</option><option value="makeup">妆容 · 从色卡取色</option></select></label>
  <button type="button" class="ps-upload" data-ps="pick-file"><strong>＋ 上传商品或色卡</strong><span>PNG / JPG / WebP · 最大 12 MB</span></button><input data-ps-file type="file" accept="image/png,image/jpeg,image/webp" hidden><div class="ps-product"><canvas data-ps-product aria-label="已选择的商品图片" role="img"></canvas><p data-ps-empty>透明背景商品图效果更好</p></div><p data-ps-name></p>
  <label class="ps-check" data-ps-cutout><input type="checkbox" data-ps-white>去除与边缘相连的白底</label>
  <div data-ps-adjustments>${[['scale','大小',.2,3,.01,1],['rotation','旋转',-180,180,1,0],['offsetX','左右位置',-1,1,.01,0],['offsetY','上下位置',-1,1,.01,0],['opacity','不透明度',.1,1,.01,1]].map(([key,label,min,max,step,value])=>`<label class="ps-range">${label}<output data-ps-value="${key}"></output><input type="range" data-ps-control="${key}" min="${min}" max="${max}" step="${step}" value="${value}" aria-label="${label}"></label>`).join('')}<label class="ps-check"><input type="checkbox" data-ps-control="mirror">翻转商品方向</label></div>
  <div data-ps-makeup hidden><p>点击色卡取色；也可聚焦色卡，用方向键移动取色点，回车应用。</p><label class="ps-color">预览色号<input type="color" value="#a34f59" data-ps-color></label><p class="ps-note">商品图片、屏幕和光线会影响色彩，仅供搭配参考。</p></div>
  <p class="ps-status" data-ps-status role="status"></p><div class="ps-buttons"><button data-ps="reset">重置位置</button><button data-ps="clear">移除商品</button><button data-ps="download" class="ps-primary">导出试搭</button></div><p class="ps-note">全程在浏览器内处理。只在当前页面保留商品图片，刷新后释放。</p></section></div>`;
  document.body.append(dialog);const $=selector=>dialog.querySelector(selector),events=new AbortController(),productBase=makeCanvas(320,200);
  let source=null,prepared=null,state={...defaults},type='glasses',compare=false,disposed=false,loadId=0,raf=0,downloading=false,previousFocus=null,sample={x:160,y:100},showSample=false;
  const listen=(node,event,handler)=>node.addEventListener(event,handler,{signal:events.signal});
  const status=(text,error=false)=>{if(disposed)return;const node=$('[data-ps-status]');node.textContent=text;node.setAttribute('role',error?'alert':'status');node.classList.toggle('is-error',error);};
  const engine=()=>getEngine?.();
  function resetComparison(){compare=false;$('[data-ps="compare"]').textContent='查看原图';$('[data-ps="compare"]').setAttribute('aria-pressed','false');}
  function preview(){
    raf=0;if(disposed||!dialog.open)return;const current=engine();
    const input=compare?current?.original:current?.getProductPreviewCanvas?.();if(!input){const canvas=$('[data-ps-preview]');canvas.getContext('2d').clearRect(0,0,canvas.width,canvas.height);return;}
    const canvas=$('[data-ps-preview]'),scale=Math.min(1,1100/Math.max(input.width,input.height));
    canvas.width=Math.round(input.width*scale);canvas.height=Math.round(input.height*scale);canvas.getContext('2d').drawImage(input,0,0,canvas.width,canvas.height);
  }
  function schedule(){if(!disposed&&dialog.open&&!raf)raf=requestAnimationFrame(preview);}
  function update(){
    if(disposed)return;const current=engine(),makeup=type==='makeup';$('[data-ps-adjustments]').hidden=makeup;$('[data-ps-cutout]').hidden=makeup;$('[data-ps-makeup]').hidden=!makeup;
    for(const key of ['scale','rotation','offsetX','offsetY','opacity']){const value=key==='rotation'?`${state[key]}°`:key==='scale'||key==='opacity'?`${Math.round(state[key]*100)}%`:state[key].toFixed(2);$(`[data-ps-value="${key}"]`).textContent=value;$(`[data-ps-control="${key}"]`).setAttribute('aria-valuetext',value);}
    if(makeup){current?.clearProductOverlay?.();status(source?'点击色卡取色，或直接选择色号。':'上传色卡后点击取色，也可直接选择色号。');}
    else if(prepared){const result=current?.setProductOverlay?.({image:prepared,type,...state}),anchor=current?.getProductAnchorStatus?.(type);status(result?.message||anchor?.message||(anchor?.available?'已自动定位，可微调位置。':'当前照片无法定位这件商品，请换用清晰照片。'));}
    else{current?.clearProductOverlay?.();status('上传商品图片后，自动放到已识别的部位。');}
    $('[data-ps="download"]').disabled=!current?.original||downloading;$('[data-ps="compare"]').disabled=!current?.original;$('[data-ps="clear"]').disabled=!source;$('[data-ps="reset"]').disabled=!prepared||makeup;$('[data-ps="clear"]').textContent=makeup?'移除色卡':'移除商品';
    for(const node of dialog.querySelectorAll('[data-ps-control]'))node.disabled=!prepared;
    $('[data-ps-white]').disabled=!source;schedule();
  }
  function productPreview(){
    const canvas=$('[data-ps-product]');canvas.width=320;canvas.height=200;const ctx=productBase.getContext('2d');ctx.clearRect(0,0,320,200);
    const input=type==='makeup'?source:prepared;if(input){const s=Math.min(320/input.width,200/input.height);ctx.drawImage(input,(320-input.width*s)/2,(200-input.height*s)/2,input.width*s,input.height*s);}
    $('[data-ps-empty]').hidden=!!input;canvas.tabIndex=type==='makeup'&&!!source?0:-1;canvas.setAttribute('role',type==='makeup'?'button':'img');canvas.setAttribute('aria-label',type==='makeup'?'色卡取色。方向键移动取色点，回车应用；也可直接选择下方色号。':'已选择的商品图片');drawProductPreview();
  }
  function drawProductPreview(){const ctx=$('[data-ps-product]').getContext('2d');ctx.clearRect(0,0,320,200);ctx.drawImage(productBase,0,0);if(type==='makeup'&&source&&showSample){ctx.beginPath();ctx.arc(sample.x,sample.y,6,0,Math.PI*2);ctx.strokeStyle='#fff';ctx.lineWidth=3;ctx.stroke();ctx.strokeStyle='#1d1d1f';ctx.lineWidth=1;ctx.stroke();}}
  function candidate(input,nextType=type){return input&&(nextType==='makeup'?input:prepareProductImage(input,$('[data-ps-white]').checked));}
  async function upload(file){
    if(!file||disposed)return;const id=++loadId;$('[data-ps-file]').value='';if(!['image/png','image/jpeg','image/webp'].includes(file.type)||file.size>12*1024*1024)return status('请选择 12 MB 以内的 PNG、JPG 或 WebP 图片。原有商品已保留。',true);
    const url=URL.createObjectURL(file),image=new Image();status('正在读取商品图片…');
    try{image.src=url;await image.decode();if(disposed||id!==loadId)return;if(image.naturalWidth*image.naturalHeight>40000000||Math.min(image.naturalWidth,image.naturalHeight)<8)throw new Error('图片尺寸不合适，请使用 4000 万像素以内的清晰商品图。');
      const s=Math.min(1,1024/Math.max(image.width,image.height)),next=makeCanvas(Math.round(image.width*s),Math.round(image.height*s));next.getContext('2d').drawImage(image,0,0,next.width,next.height);const nextPrepared=candidate(next);if(disposed||id!==loadId)return;
      source=next;prepared=nextPrepared;state={...defaults};showSample=false;sample={x:160,y:100};resetComparison();syncControls();$('[data-ps-name]').textContent=file.name;productPreview();update();
    }catch(error){if(!disposed&&id===loadId)status(`${error.name==='EncodingError'?'商品图片无法解码，请选择有效的 PNG、JPG 或 WebP。':error.message||'商品图片无法读取，请更换文件。'} 原有商品已保留。`,true);}finally{URL.revokeObjectURL(url);}
  }
  function syncControls(){for(const input of dialog.querySelectorAll('[data-ps-control]')){const key=input.dataset.psControl;if(input.type==='checkbox')input.checked=state[key];else input.value=state[key];}}
  function clear(){loadId++;source=prepared=null;state={...defaults};showSample=false;engine()?.clearProductOverlay?.();$('[data-ps-name]').textContent='';$('[data-ps-white]').checked=false;resetComparison();syncControls();productPreview();update();}
  function applyColor(value){if(disposed)return;try{onMakeup?.(value);$('[data-ps-color]').value=value;resetComparison();status(`已应用色号 ${value.toUpperCase()}，可返回工作台调整浓度。`);schedule();}catch(error){status(error.message||'当前照片无法应用此色号。',true);}}
  function applySample(){const pixel=productBase.getContext('2d').getImageData(sample.x,sample.y,1,1).data;showSample=true;drawProductPreview();if(pixel[3]<128)return status('请在色卡的不透明颜色区域取色。');applyColor('#'+[...pixel.slice(0,3)].map(n=>n.toString(16).padStart(2,'0')).join(''));}
  async function download(){
    if(downloading||disposed)return;const input=engine()?.getProductPreviewCanvas?.();if(!input)return;downloading=true;$('[data-ps="download"]').disabled=true;$('[data-ps="download"]').setAttribute('aria-busy','true');
    try{const out=makeCanvas(input.width,input.height+55),ctx=out.getContext('2d');ctx.fillStyle='#f5f5f7';ctx.fillRect(0,0,out.width,out.height);ctx.drawImage(input,0,0);ctx.fillStyle='#555';ctx.font=`${Math.max(12,Math.round(input.width/70))}px sans-serif`;ctx.fillText('映身 · 商品图片试搭 / 仅供搭配参考',20,out.height-20);const blob=await new Promise(resolve=>out.toBlob(resolve,'image/png'));if(disposed)return;if(!blob)throw new Error('图片导出失败，请重试。');const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=`映身-商品试搭-${Date.now()}.png`;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),10000);status('已导出当前试搭图片，包含搭配参考说明。');}
    catch(error){status(error.message||'导出失败，请重试。',true);}finally{downloading=false;if(!disposed){$('[data-ps="download"]').disabled=!engine()?.original;$('[data-ps="download"]').removeAttribute('aria-busy');}}
  }
  listen($('[data-ps-file]'),'change',e=>upload(e.target.files[0]));
  listen($('[data-ps-type]'),'change',e=>{loadId++;try{const nextType=e.target.value,nextPrepared=candidate(source,nextType);type=nextType;prepared=nextPrepared;state={...defaults};showSample=false;resetComparison();syncControls();productPreview();update();}catch(error){e.target.value=type;status(error.message,true);}});
  listen($('[data-ps-white]'),'change',e=>{loadId++;try{const next=candidate(source);prepared=next;resetComparison();productPreview();update();}catch(error){e.target.checked=!e.target.checked;status(`${error.message} 原有商品已保留。`,true);}});
  for(const input of dialog.querySelectorAll('[data-ps-control]'))listen(input,'input',()=>{state[input.dataset.psControl]=input.type==='checkbox'?input.checked:Number(input.value);resetComparison();update();});
  listen($('[data-ps-color]'),'input',e=>applyColor(e.target.value));
  listen($('[data-ps-product]'),'click',e=>{if(type!=='makeup'||!source)return;const canvas=e.currentTarget,rect=canvas.getBoundingClientRect(),scale=Math.min(rect.width/canvas.width,rect.height/canvas.height),x=(e.clientX-rect.left-(rect.width-canvas.width*scale)/2)/scale,y=(e.clientY-rect.top-(rect.height-canvas.height*scale)/2)/scale;if(x<0||y<0||x>=canvas.width||y>=canvas.height)return status('请点击色卡中的颜色区域。');sample={x:Math.floor(x),y:Math.floor(y)};applySample();});
  listen($('[data-ps-product]'),'keydown',e=>{if(type!=='makeup'||!source)return;const moves={ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,-1],ArrowDown:[0,1]};if(moves[e.key]){e.preventDefault();const step=e.shiftKey?1:8;sample={x:Math.max(0,Math.min(319,sample.x+moves[e.key][0]*step)),y:Math.max(0,Math.min(199,sample.y+moves[e.key][1]*step))};showSample=true;drawProductPreview();status('取色点已移动，按回车应用。Shift + 方向键可精调。');}else if(e.key==='Enter'||e.key===' '){e.preventDefault();applySample();}});
  listen(dialog,'click',e=>{const button=e.target.closest('[data-ps]');if(!button||button.disabled)return;const action=button.dataset.ps;if(action==='close')dialog.close();if(action==='pick-file')$('[data-ps-file]').click();if(action==='clear')clear();if(action==='reset'){state={...defaults};resetComparison();syncControls();update();}if(action==='compare'){compare=!compare;button.textContent=compare?'返回试搭':'查看原图';button.setAttribute('aria-pressed',String(compare));schedule();}if(action==='download')download();});
  listen(dialog,'keydown',e=>e.stopPropagation());listen(dialog,'close',()=>{if(raf)cancelAnimationFrame(raf);raf=0;previousFocus?.focus?.({preventScroll:true});onClose?.();});
  listen(dialog,'dragover',e=>e.preventDefault());listen(dialog,'drop',e=>{e.preventDefault();upload(e.dataTransfer?.files[0]);});
  return {element:dialog,open(){if(disposed)return;if(!dialog.open){previousFocus=document.activeElement;dialog.showModal();}resetComparison();update();productPreview();},destroy(){if(disposed)return;disposed=true;loadId++;if(raf)cancelAnimationFrame(raf);events.abort();engine()?.clearProductOverlay?.();source=prepared=null;productBase.width=productBase.height=1;dialog.remove();}};
}
