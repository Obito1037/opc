import './generation-studio.css';
import {icon} from './icons.js';

const HISTORY_KEY='yingshen-generation-jobs';
const MOTION_HISTORY_KEY='yingshen-motion-jobs';
const ACTIVE=new Set(['queued','running']);
const LABELS={queued:'等待处理',running:'正在生成',succeeded:'已生成',failed:'生成失败',cancelled:'已取消'};
const ACCEPTED=new Set(['image/jpeg','image/png','image/webp']);
const escapeHTML=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const formatTime=value=>{const date=new Date(value);return Number.isFinite(date.getTime())?date.toLocaleString('zh-CN',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}):'本次任务';};
function readIds(key=HISTORY_KEY){try{const ids=JSON.parse(localStorage.getItem(key)||'[]');return Array.isArray(ids)?ids.filter(id=>typeof id==='string'&&/^[a-z0-9_-]{1,100}$/i.test(id)).slice(0,24):[];}catch{return [];}}
function dataURL(file){return new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(new Error('无法读取图片，请重新选择。'));reader.readAsDataURL(file);});}
async function imageSize(file){
  if(typeof createImageBitmap==='function'){const bitmap=await createImageBitmap(file);try{return {width:bitmap.width,height:bitmap.height};}finally{bitmap.close();}}
  const url=URL.createObjectURL(file);try{const image=new Image();image.src=url;await image.decode();return {width:image.naturalWidth,height:image.naturalHeight};}finally{URL.revokeObjectURL(url);}
}
async function videoMetadata(file){
  const video=document.createElement('video'),url=URL.createObjectURL(file);video.preload='metadata';video.muted=true;video.playsInline=true;
  try{return await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('视频信息读取超时，请重新保存为 MP4 或 WebM。')),20000),finish=(callback,value)=>{clearTimeout(timer);callback(value);};video.onloadedmetadata=()=>finish(resolve,{duration:video.duration,width:video.videoWidth,height:video.videoHeight});video.onerror=()=>finish(reject,new Error('浏览器无法读取此视频，请使用 MP4 或 WebM。'));video.src=url;});}
  finally{video.pause();video.removeAttribute('src');video.load();URL.revokeObjectURL(url);}
}
async function firstFrameBlob(file,signal){
  const video=document.createElement('video'),url=URL.createObjectURL(file);video.preload='auto';video.muted=true;video.playsInline=true;
  const aborted=()=>new DOMException('首帧提取已取消','AbortError');
  const waitFor=(event,start)=>new Promise((resolve,reject)=>{if(signal.aborted)return reject(aborted());let timer;
    const finish=(error)=>{clearTimeout(timer);video.removeEventListener(event,ready);video.removeEventListener('error',failed);signal.removeEventListener('abort',cancel);error?reject(error):resolve();};
    const ready=()=>finish(),failed=()=>finish(new Error('视频首帧无法读取，请更换视频。')),cancel=()=>finish(aborted());
    video.addEventListener(event,ready,{once:true});video.addEventListener('error',failed,{once:true});signal.addEventListener('abort',cancel,{once:true});timer=setTimeout(()=>finish(new Error('视频首帧读取超时，请重新选择视频。')),15000);start?.();if(event==='seeked'&&!video.seeking&&video.readyState>=2)finish();
  });
  try{await waitFor('loadeddata',()=>{video.src=url;video.load();});await waitFor('seeked',()=>video.currentTime=0);if(signal.aborted)throw aborted();
    const scale=Math.min(1,1280/Math.max(video.videoWidth,video.videoHeight)),canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(video.videoWidth*scale));canvas.height=Math.max(1,Math.round(video.videoHeight*scale));canvas.getContext('2d').drawImage(video,0,0,canvas.width,canvas.height);
    const blob=await new Promise((resolve,reject)=>canvas.toBlob(value=>signal.aborted?reject(aborted()):value?resolve(value):reject(new Error('无法保存视频首帧，请重试。')),'image/png'));if(signal.aborted)throw aborted();return blob;
  }finally{video.pause();video.removeAttribute('src');video.load();URL.revokeObjectURL(url);}
}

/** Local browser shell for the real generation API. No provider credentials enter this module. */
export function mountGenerationStudio({trigger,getPersonFile,onUseResult,apiBase='/api/tryon',motionApiBase='/api/motion',capabilitiesUrl='/api/capabilities'}={}){
  const dialog=document.createElement('dialog');dialog.className='generation-studio';dialog.setAttribute('aria-labelledby','generation-title');
  dialog.innerHTML=`
    <header class="gen-header"><div class="gen-brand">${icon('sparkle')}<span>映身 <b>AI 试穿</b></span></div><div class="gen-header-actions"><button type="button" class="gen-secondary gen-workflow-switch" data-action="toggle-workflow">${icon('video')} 照片动作</button><span class="gen-local">结果保存在本机</span><button type="button" class="gen-icon" data-action="close" aria-label="关闭真实试穿工作台" title="关闭">${icon('close')}</button></div></header>
    <div class="gen-content">
      <section class="gen-intro"><div><span class="gen-eyebrow">YOUR PHOTO. YOUR NEXT LOOK.</span><h1 id="generation-title">喜欢的单品，<br class="gen-mobile-break">用你的照片试穿。</h1><p>准备一张人物照片与商品图，交给已连接的生成服务。</p></div><button type="button" class="gen-service" data-action="refresh" title="刷新生成服务状态"><i></i><span>正在检查服务</span>${icon('rotate')}</button></section>
      <div class="gen-layout">
        <section class="gen-input-panel" aria-label="准备试穿图片">
          <div class="gen-section-heading"><h2>准备素材</h2><span>01 / INPUTS</span></div>
          <div class="gen-inputs">
            ${['person','garment'].map((kind,i)=>`<div class="gen-input-card"><div class="gen-input-label"><span>${i?'商品图片':'人物照片'}</span><b>${i?'02':'01'}</b></div><button type="button" class="gen-drop" data-pick="${kind}" aria-label="${i?'上传商品图片':'上传人物照片'}"><img data-preview="${kind}" alt="${i?'准备提交的商品图片':'准备提交的人物照片'}" hidden><span class="gen-drop-placeholder">${icon(i?'hanger':'user')}<strong>${i?'选一件心动单品':'添加人物照片'}</strong><small>点击或拖入图片</small><span class="gen-upload-icon">${icon('upload')}</span></span><span class="gen-replace" hidden>更换图片</span></button><input type="file" data-file="${kind}" accept="image/jpeg,image/png,image/webp" hidden><div class="gen-file-meta"><span data-filename="${kind}">JPG / PNG / WebP</span><button type="button" data-clear="${kind}" aria-label="移除${i?'商品图片':'人物照片'}" hidden>${icon('close')}</button></div></div>`).join('')}
          </div>
          <p class="gen-input-hint">单人、正面、光线清楚的人物照更适合试穿。商品图应完整显示衣服。</p>
          <label class="gen-field">服装品类<select data-field="category"><option value="tops">上装</option><option value="bottoms">下装</option><option value="one-pieces">连体服饰 / 连衣裙</option></select></label>
          <label class="gen-field">商品图片类型<select data-field="photoType"><option value="flat-lay">平铺 / 商品白底图</option><option value="model">模特穿着图</option></select></label>
          <p class="gen-submit-help" data-photo-type-help hidden></p>
          <details class="gen-generation-settings" data-generation-settings><summary><span>生成设置</span><small data-seed-mode>每次生成新变体</small>${icon('chevron')}</summary><div class="gen-seed-settings"><label class="gen-field">随机种子<input type="number" data-field="seed" inputmode="numeric" min="0" max="2147483647" step="1" placeholder="留空 · 新变体" aria-describedby="gen-seed-help gen-seed-error"></label><button type="button" class="gen-text-button" data-action="new-variant">清空种子，使用新变体</button><p id="gen-seed-help" data-seed-help>留空时每次分配新种子。固定种子便于在相同图片、模型与参数下复现；不代表效果一定更好。</p><p id="gen-seed-error" data-seed-error role="status" hidden>请输入 0–2147483647 的整数，或留空。</p></div></details>
          <p class="gen-privacy" data-privacy>${icon('lock')}<span>提交前会显示生成服务的数据处理方式。</span></p>
          <button type="button" class="gen-generate" data-action="generate" disabled>${icon('sparkle')}<span>生成真实试穿</span>${icon('arrow')}</button>
          <p class="gen-submit-help" data-submit-help>图片仅准备在浏览器中，尚未提交。</p>
          <p class="gen-feedback" data-feedback role="status" hidden></p>
        </section>
        <section class="gen-preview-panel" aria-label="真实生成结果">
          <div class="gen-preview-heading"><div><span class="gen-live-dot"></span><h2 data-preview-title>试穿预览</h2><span class="gen-status-tag" data-job-badge hidden></span></div><button type="button" class="gen-text-button" data-action="delete" hidden>${icon('trash')} 删除本机结果</button></div>
          <div class="gen-preview-body">
            <div class="gen-empty" data-empty><span class="gen-empty-symbol">${icon('hanger')}</span><h3>下一套喜欢的搭配，<br>从这里开始。</h3><p>生成完成后，在这里查看你的试穿结果。<br>支持原图对比与图片下载。</p><div class="gen-empty-steps"><span>人物</span><b aria-hidden="true">＋</b><span>衣服</span>${icon('arrow')}<span>试穿</span></div></div>
            <div class="gen-task-state" data-task-state hidden><div class="gen-task-symbol" data-task-symbol></div><h3 data-task-title></h3><p data-task-message></p><div class="gen-progress" data-progress role="progressbar" aria-label="生成任务处理中"><span></span></div><button type="button" class="gen-secondary" data-action="cancel">取消本机任务</button><p class="gen-task-footnote">可以关闭窗口，稍后从任务记录继续查看。</p></div>
            <div class="gen-result" data-result hidden><div class="gen-image-stage"><img data-result-image alt="生成服务返回的真实试穿结果"><div class="gen-original-layer" data-original-layer hidden><img data-original-image alt="本次任务的原始人物照片"></div><div class="gen-split-line" data-split-line hidden><span>‹ ›</span></div><span class="gen-image-label gen-before-label" data-before-label hidden>原图</span><span class="gen-image-label gen-after-label">生成效果</span></div></div>
          </div>
          <div class="gen-result-toolbar" data-result-toolbar hidden><label class="gen-compare-label"><input type="checkbox" data-compare>原图对比</label><input data-split type="range" min="0" max="100" value="50" aria-label="原图与生成效果分屏位置" disabled><output data-split-value>50%</output><a class="gen-download" data-download download>${icon('download')} 下载图片</a></div>
          <div class="gen-result-settings" data-result-settings hidden><div class="gen-result-seed"><span data-result-seed></span><div><button type="button" class="gen-secondary" data-action="reuse-seed">复用种子</button><button type="button" class="gen-secondary" data-action="regenerate">${icon('rotate')} 再次生成</button><button type="button" class="gen-secondary" data-action="use-result" ${typeof onUseResult==='function'?'':'hidden'}>继续搭配鞋饰</button></div></div><p data-regenerate-help>再次生成使用当前准备的图片与设置。</p></div>
          <div class="gen-preview-footer"><span data-result-note>真实服务 · 可恢复任务 · 本机结果管理</span><span data-task-time></span></div>
        </section>
      </div>
      <section class="gen-history"><div class="gen-section-heading"><div><h2>最近任务</h2><span data-history-count>0 项</span></div><button type="button" class="gen-text-button" data-action="refresh-history">${icon('rotate')} 刷新记录</button></div><div class="gen-history-list" data-history-list><p class="gen-history-empty">还没有提交任务。生成开始后，可以在这里继续查看。</p></div><p class="gen-history-note">图片结果保存在这台设备，过期会自动清理。浏览器仅记住任务编号；恢复历史结果时，不会同时恢复人物原图。</p></section>
      <section class="gen-motion-panel" aria-labelledby="gen-motion-title">
        <div class="gen-motion-heading"><div><span class="gen-eyebrow">SEE YOUR LOOK IN MOTION</span><h2 id="gen-motion-title">让照片里的你，动起来。</h2><p data-motion-description>选择人物照片或已生成的试穿结果，查看当前服务支持的动作。</p></div><div class="gen-motion-heading-actions"><span class="gen-motion-status" data-motion-service>正在检查动作服务</span><button type="button" class="gen-secondary" data-action="motion-focus" aria-pressed="false" disabled>${icon('expand')} 专注视频</button></div></div>
        <div class="gen-motion-layout">
          <div class="gen-motion-controls">
            <label class="gen-field">动作来源<select data-motion-source aria-label="动作来源"><option value="person">当前人物照片</option></select></label>
            <button type="button" class="gen-motion-source-card" data-action="motion-pick" aria-label="选择动作人物照片"><img data-motion-source-image alt="本次动作的来源图片" hidden><span data-motion-source-empty>${icon('user')}<strong>添加人物照片</strong><small>上传正面全身照片</small></span><span class="gen-motion-source-caption" data-motion-source-caption>点击选择人物照片</span></button>
            <label class="gen-field">动作预设<select data-motion-preset aria-label="动作预设" disabled><option value="">暂无可用动作</option></select></label>
            <div class="gen-driving-input" data-driving-input hidden>
              <div class="gen-driving-heading"><strong>你的动作视频</strong><span>实验功能</span></div>
              <p class="gen-driving-advice">建议录制 4–6 秒：固定镜头、正面全身，保持人脸朝前，只做小幅重心或抬臂动作。第一帧姿态应与人物照片接近。</p>
              <video data-driving-preview controls playsinline preload="auto" aria-label="本地驱动视频预览，对照上方人物照片" hidden></video>
              <button type="button" class="gen-secondary gen-driving-pick" data-action="pick-driving">${icon('upload')} 选择动作视频</button>
              <button type="button" class="gen-secondary gen-driving-frame" data-action="use-driving-frame" disabled>${icon('photo')} 用首帧作为人物照片</button>
              <p class="gen-driving-advice">此按钮会替换当前人物照片，让初始姿态与视频一致。只在本地提取首帧，不会自动提交生成。</p>
              <input type="file" data-driving-file accept="video/mp4,video/webm" hidden>
              <div class="gen-file-meta"><span data-driving-name>MP4 / WebM</span><button type="button" data-action="clear-driving" aria-label="移除动作视频" hidden>${icon('close')}</button></div>
              <p class="gen-driving-limits" data-driving-limits></p><p class="gen-driving-advice">预览只在浏览器中进行。点击生成才提交人物来源和动作视频；请先对照视频首帧与上方人物姿态。</p>
              <p class="gen-driving-experiment">小幅正面体态实验 · 3 秒 / 8fps / 256p。可能出现局部形变，不代表走秀或转身效果。</p>
            </div>
            <p class="gen-motion-spec" data-motion-spec>规格由已连接服务提供</p>
            <p class="gen-privacy" data-motion-privacy>${icon('lock')}<span>动作服务尚未连接，可以先准备人物照片。</span></p>
            <button type="button" class="gen-generate" data-action="generate-motion" disabled>${icon('video')}<span>生成动作视频</span>${icon('arrow')}</button>
            <p class="gen-submit-help" data-motion-help>尚未生成动作。</p><p class="gen-feedback" data-motion-feedback role="status" hidden></p>
          </div>
          <div class="gen-motion-view">
            <div class="gen-motion-empty" data-motion-empty><span class="gen-empty-symbol">${icon('video')}</span><h3>让搭配，多一个视角。</h3><p>生成完成后，在这里播放真实返回的视频。<br>动作范围与时长以当前服务能力为准。</p></div>
            <div class="gen-motion-task" data-motion-task hidden><span data-motion-task-icon></span><h3 data-motion-task-title></h3><p data-motion-task-message role="status"></p><div class="gen-progress" data-motion-progress role="progressbar" aria-label="动作生成处理中"><span></span></div><button type="button" class="gen-secondary" data-action="cancel-motion">取消本机任务</button></div>
            <div class="gen-motion-video-wrap" data-motion-video-wrap hidden><video data-motion-video controls playsinline preload="metadata" aria-label="生成服务返回的动作视频"></video><div class="gen-motion-video-toolbar"><span data-motion-result-detail></span><div><button type="button" class="gen-text-button" data-action="delete-motion">${icon('trash')} 删除本机视频</button><button type="button" class="gen-download" data-action="download-motion">${icon('download')} 下载视频</button></div></div></div>
          </div>
        </div>
        <div class="gen-motion-history-heading"><h3>动作任务</h3><button type="button" class="gen-text-button" data-action="refresh-motion">${icon('rotate')} 刷新</button></div><div class="gen-history-list" data-motion-history><p class="gen-history-empty">动作生成开始后，可在这里恢复查看。</p></div>
      </section>
    </div>`;
  document.body.append(dialog);
  const $=selector=>dialog.querySelector(selector),$$=selector=>[...dialog.querySelectorAll(selector)];
  const events=new AbortController(),files={person:null,garment:null},urls={person:null,garment:null},epochs={person:0,garment:0};
  const jobs=new Map(),sources=new Map(),removedIds=new Set();let capabilities=null,current=null,posting=false,refreshing=false,pollTimer=null,destroyed=false,statusError='',lastResultUrl=null,feedbackTimer=null;
  let ids=readIds(),previousFocus=null,requestVersion=0,inheritedPersonFile,hasInheritedPersonFile=false;
  const motionJobs=new Map(),removedMotionIds=new Set();let motionIds=readIds(MOTION_HISTORY_KEY),motionJob=null,motionPosting=false,motionTimer=null,motionFocused=false,motionVideoUrl=null,motionSource='person';
  let drivingFile=null,drivingUrl=null,drivingEpoch=0,drivingReading=false,extractingFrame=false,frameVersion=0,frameController=null;
  const listen=(target,type,handler)=>target.addEventListener(type,handler,{signal:events.signal});
  const remember=()=>{try{localStorage.setItem(HISTORY_KEY,JSON.stringify(ids.slice(0,24)));}catch{/* Current tasks remain recoverable from the local service. */}};
  function feedback(message,error=false){clearTimeout(feedbackTimer);const node=$('[data-feedback]');node.hidden=!message;node.textContent=message;node.classList.toggle('is-error',error);}
  async function api(path,{method='GET',body,timeout=20000}={}){
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeout);
    try{const response=await fetch(path,{method,body:body===undefined?undefined:JSON.stringify(body),headers:body===undefined?undefined:{'Content-Type':'application/json'},cache:'no-store',signal:controller.signal});
      let payload;try{payload=await response.json();}catch{throw new Error('本机生成接口尚未就绪，请使用更新后的启动器运行服务。');}
      if(!response.ok){const error=new Error(payload.error?.message||`请求失败（${response.status}）`);error.code=payload.error?.code;error.status=response.status;throw error;}return payload;
    }catch(error){if(error.name==='AbortError')throw new Error('本机服务响应超时，请稍后刷新任务记录，避免重复提交。');throw error;}finally{clearTimeout(timer);}
  }
  function ownedUrl(value){try{const u=new URL(value,location.href);return u.origin===location.origin&&u.pathname.startsWith(`${apiBase}/jobs/`)?u.href:null;}catch{return null;}}
  function activeJob(){return [...jobs.values()].find(job=>ACTIVE.has(job.status));}
  function supportedPhotoTypes(){const declared=capabilities?.tryOn?.garmentPhotoTypes,known=['flat-lay','model'];return Array.isArray(declared)?known.filter(type=>declared.includes(type)):known;}
  function updatePhotoTypes(){
    const allowed=supportedPhotoTypes(),select=$('[data-field="photoType"]'),help=$('[data-photo-type-help]');
    for(const option of select.options)option.disabled=!allowed.includes(option.value);
    if(!allowed.includes(select.value))select.value=allowed[0]||'';
    select.disabled=posting||allowed.length===0;help.hidden=allowed.length===2;
    help.textContent=!allowed.length?'当前服务未提供支持的商品图片类型。':allowed[0]==='flat-lay'?'当前服务仅支持平铺或商品白底图，请勿上传模特穿着图。':'当前服务仅支持模特穿着图。';
    return allowed;
  }
  function renderProgress(node,job){
    const progress=job?.progress,valid=Number.isInteger(progress?.current)&&Number.isInteger(progress?.total)&&progress.total>0&&progress.current>=0&&progress.current<=progress.total&&['step','frame'].includes(progress.unit);
    node.hidden=!ACTIVE.has(job?.status);node.dataset.determinate=String(valid);
    if(valid){node.setAttribute('aria-valuemin','0');node.setAttribute('aria-valuemax',String(progress.total));node.setAttribute('aria-valuenow',String(progress.current));node.setAttribute('aria-valuetext',`${progress.current} / ${progress.total} ${progress.unit==='frame'?'帧':'步'}`);node.firstElementChild.style.width=`${progress.current/progress.total*100}%`;node.firstElementChild.style.left='0';}
    else{for(const name of ['aria-valuemin','aria-valuemax','aria-valuenow','aria-valuetext'])node.removeAttribute(name);node.firstElementChild.style.removeProperty('width');node.firstElementChild.style.removeProperty('left');}
  }
  function elapsedLabel(job){if(!Number.isFinite(job?.elapsedMs)||job.elapsedMs<0)return '';const seconds=Math.floor(job.elapsedMs/1000),minutes=Math.floor(seconds/60);return `已用 ${minutes?`${minutes} 分 `:''}${seconds%60} 秒`;}
  const validSeed=value=>Number.isInteger(value)&&value>=0&&value<=2147483647;
  function seedState(){const input=$('[data-field="seed"]'),supported=capabilities?.tryOn?.supportsSeed===true,value=input.value===''?undefined:input.valueAsNumber;return {supported,value:supported?value:undefined,valid:!supported||(!input.validity.badInput&&(value===undefined||validSeed(value)))};}
  function renderSeedResult(){
    const hasResult=current?.status==='succeeded'&&current.result?.generated===true&&!!ownedUrl(current.result.url),hasSeed=validSeed(current?.seed);
    $('[data-result-settings]').hidden=!hasResult;$('[data-result-seed]').textContent=hasSeed?`本次种子 · ${current.seed}`:'此历史任务没有种子记录';
    $('[data-action="reuse-seed"]').hidden=!hasSeed;$('[data-action="reuse-seed"]').disabled=posting||capabilities?.tryOn?.supportsSeed!==true;
    $('[data-action="regenerate"]').disabled=$('[data-action="generate"]').disabled;
    const seed=seedState();$('[data-regenerate-help]').textContent=!files.person||!files.garment?'重新选择人物与商品图片后，可以再次生成。':!seed.supported?'再次生成会提交当前两张图片，使用服务默认设置。':seed.value===undefined?'再次生成会提交当前两张图片，使用新种子。':'再次生成会提交当前两张图片与设置中的固定种子。';
  }
  function updateSubmit(){
    const active=activeJob(),configured=!statusError&&capabilities?.tryOn?.configured===true,photoTypes=supportedPhotoTypes(),seed=seedState();
    $('[data-action="generate"]').disabled=posting||motionPosting||!configured||!photoTypes.length||!files.person||!files.garment||!seed.valid||!!active||!!activeMotionJob()||capabilities?.tryOn?.busy===true||capabilities?.motion?.busy===true;
    $('[data-action="generate"] span').textContent=posting?'正在提交图片':active?'已有任务进行中':'生成真实试穿';
    $('[data-submit-help]').textContent=posting?'正在提交真实人物与商品图片，请稍候。':active?'生成中可以关闭窗口，稍后查看任务。':!configured?'服务尚未连接，你可以先准备两张图片。':!photoTypes.length?'当前服务没有支持的商品图片类型，暂不能提交。':!files.person||!files.garment?'准备好人物与商品图片后，即可提交。':'点击生成即提交两张图片，具体效果由当前服务返回。';
    $$('[data-pick],[data-clear],[data-field]').forEach(node=>node.disabled=posting);
    $('[data-field="seed"]').disabled=posting||!seed.supported;$('[data-field="seed"]').setAttribute('aria-invalid',String(!seed.valid));$('[data-seed-error]').hidden=seed.valid;
    $('[data-action="new-variant"]').disabled=posting||!seed.supported||$('[data-field="seed"]').value==='';
    $('[data-seed-mode]').textContent=!seed.supported?'由服务决定':seed.value===undefined?'每次生成新变体':'使用固定种子';
    $('[data-seed-help]').textContent=seed.supported?'留空时每次分配新种子。固定种子便于在相同图片、模型与参数下复现；不代表效果一定更好。':'当前服务尚未声明可指定种子，将使用服务默认设置。';
    renderSeedResult();
    updatePhotoTypes();
    updateMotionControls();
  }
  function renderService(){
    const provider=capabilities?.tryOn,button=$('.gen-service');button.classList.toggle('is-connected',provider?.configured===true);button.classList.toggle('is-unavailable',!!statusError||provider?.configured===false);
    button.querySelector('span').textContent=statusError?'本机接口未就绪':!provider?'正在检查服务':!provider.configured?'生成服务未连接':provider.busy?'服务正在处理任务':provider.verifiedGeneration?'生成服务已验证':'已连接 · 等待生成验证';
    button.title=statusError||provider?.message||'刷新服务状态';
    const notice=capabilities?.privacy?.notice||(provider?.remote?'点击生成后，人物与商品图片将发送给当前配置的远程生成服务。':'图片准备在浏览器中；提交时由本机已配置的生成服务处理。');
    $('[data-privacy] span').textContent=notice;
    updateSubmit();
  }
  function adoptJob(job,{select=false}={}){
    if(destroyed||!job||typeof job.id!=='string'||!Object.hasOwn(LABELS,job.status)||removedIds.has(job.id))return;
    jobs.set(job.id,job);if(!ids.includes(job.id)){ids.unshift(job.id);ids=ids.slice(0,24);remember();}
    if(select||current?.id===job.id){current=job;renderCurrent();}renderHistory();updateSubmit();
  }
  function renderHistory(){
    const ordered=[...jobs.values()].sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt));
    $('[data-history-count]').textContent=`${ordered.length} 项`;
    $('[data-history-list]').innerHTML=ordered.length?ordered.map(job=>`<button type="button" class="gen-history-card ${current?.id===job.id?'is-selected':''}" data-job="${escapeHTML(job.id)}" aria-pressed="${current?.id===job.id}"><span class="gen-history-icon ${escapeHTML(job.status)}">${icon(job.status==='succeeded'?'check':job.status==='failed'?'close':ACTIVE.has(job.status)?'rotate':'photo')}</span><span><strong>${escapeHTML(LABELS[job.status])}</strong><small>${escapeHTML(formatTime(job.createdAt))}</small></span>${icon('chevron')}</button>`).join(''):'<p class="gen-history-empty">还没有提交任务。生成开始后，可以在这里继续查看。</p>';
  }
  function renderCurrent(){
    const job=current,hasResult=job?.status==='succeeded'&&job.result?.generated===true&&!!ownedUrl(job.result.url);
    $('[data-empty]').hidden=!!job;$('[data-task-state]').hidden=!job||hasResult;$('[data-result]').hidden=!hasResult;$('[data-result-toolbar]').hidden=!hasResult;
    $('[data-job-badge]').hidden=!job;$('[data-job-badge]').textContent=job?(job.status==='succeeded'&&!hasResult?'结果待核验':LABELS[job.status]):'';$('[data-job-badge]').dataset.state=job?.status||'';
    $('[data-preview-title]').textContent=hasResult?'你的试穿结果':'试穿预览';$('[data-action="delete"]').hidden=!job||ACTIVE.has(job.status)||!jobs.has(job.id);
    $('[data-task-time]').textContent=job?(ACTIVE.has(job.status)&&elapsedLabel(job)||formatTime(job.createdAt)):'';
    renderSeedResult();
    if(!job){lastResultUrl=null;$('[data-result-note]').textContent='真实服务 · 可恢复任务 · 本机结果管理';updateMotionControls();return;}
    if(hasResult){
      const url=ownedUrl(job.result.url),source=sources.get(job.id);if(url!==lastResultUrl){$('[data-result-image]').src=url;lastResultUrl=url;$('[data-compare]').checked=false;$('[data-split]').value='50';}
      $('[data-download]').href=url+(url.includes('?')?'&':'?')+'download=1';
      $('[data-compare]').disabled=!source;if(source)$('[data-original-image]').src=source.url;else{$('[data-original-image]').removeAttribute('src');$('[data-compare]').checked=false;}
      $('[data-result-note]').textContent=source?'生成内容可能存在细节偏差，请结合原图判断。':'已恢复真实生成结果；本次页面没有对应人物原图，原图对比不可用。';
      updateComparison();
    }else{
      lastResultUrl=null;$('[data-result-image]').removeAttribute('src');$('[data-task-symbol]').innerHTML=ACTIVE.has(job.status)?'<span class="gen-spinner"></span>':icon(job.status==='failed'?'close':'photo');
      $('[data-task-symbol]').classList.toggle('is-error',job.status==='failed');
      $('[data-task-title]').textContent=job.status==='succeeded'?'结果暂不可读取':LABELS[job.status];
      const error=typeof job.error==='string'?job.error:job.error?.message;
      $('[data-task-message]').textContent=error||job.message||(job.status==='succeeded'?'服务未返回有效的真实生成结果，暂不显示成功预览。':job.status==='cancelled'?'任务已取消。':'等待生成服务返回进展。');
      $('[data-task-message]').setAttribute('role',job.status==='failed'?'alert':'status');
      renderProgress($('[data-progress]'),job);$('[data-action="cancel"]').hidden=!ACTIVE.has(job.status);
      $('.gen-task-footnote').hidden=!ACTIVE.has(job.status);
      $('.gen-task-footnote').textContent='耗时取决于模型与设备。可以关闭窗口，稍后从任务记录继续查看。';
      const stage={preparing:'素材准备',uploading:'发送图片',queued:'排队等待',running:'生成中',completed:'校验结果'}[job.stage]||LABELS[job.status];
      const queue=ACTIVE.has(job.status)&&Number.isFinite(job.queuePosition)?` · 前方 ${Math.max(0,job.queuePosition)} 个任务`:'';
      $('[data-result-note]').textContent=job.id?`任务 ${job.id.slice(0,12)} · ${stage}${queue}`:'';
    }
    updateMotionControls();
  }
  function updateComparison(){
    const enabled=$('[data-compare]').checked&&!$('[data-compare]').disabled,position=Number($('[data-split]').value);
    $('[data-split]').disabled=!enabled;$('[data-split-value]').textContent=enabled?`${position}%`:'—';
    $('[data-original-layer]').hidden=!enabled;$('[data-split-line]').hidden=!enabled;$('[data-before-label]').hidden=!enabled;
    $('[data-original-layer]').style.clipPath=`inset(0 ${100-position}% 0 0)`;$('[data-split-line]').style.left=`${position}%`;
  }
  async function prepareFile(kind,file,{isCurrent=()=>true}={}){
    if(!file||posting)return;const epoch=++epochs[kind];feedback('正在读取图片…');
    try{
      const type=file.type,limit=capabilities?.limits?.maxImageBytes||12*1024*1024;
      if(!ACCEPTED.has(type))throw new Error('请选择 JPG、PNG 或 WebP 图片。');
      if(file.size>limit)throw new Error(`图片过大，请选择 ${Math.floor(limit/1024/1024)} MB 以内的文件。`);
      const size=await imageSize(file);if(size.width*size.height>(capabilities?.limits?.maxPixels||40000000))throw new Error('图片像素过高，请先缩小尺寸后再上传。');
      if(!size.width||!size.height)throw new Error('图片没有可读取的像素。');if(destroyed||epoch!==epochs[kind]||!isCurrent())return;
      if(urls[kind])URL.revokeObjectURL(urls[kind]);files[kind]=file;urls[kind]=URL.createObjectURL(file);
      const img=$(`[data-preview="${kind}"]`),drop=$(`[data-pick="${kind}"]`);img.src=urls[kind];img.hidden=false;drop.querySelector('.gen-drop-placeholder').hidden=true;drop.querySelector('.gen-replace').hidden=false;
      $(`[data-filename="${kind}"]`).textContent=file.name||'人物照片';$(`[data-filename="${kind}"]`).title=file.name||'人物照片';$(`[data-clear="${kind}"]`).hidden=false;
      feedback(`${kind==='person'?'人物照片':'商品图片'}已准备 · ${size.width} × ${size.height}`);updateSubmit();return true;
    }catch(error){if(!destroyed&&epoch===epochs[kind]&&isCurrent())feedback(error.message||'图片无法读取，请选择其他文件。',true);}
    finally{$(`[data-file="${kind}"]`).value='';}
  }
  function clearFile(kind){if(posting)return;epochs[kind]++;files[kind]=null;if(urls[kind])URL.revokeObjectURL(urls[kind]);urls[kind]=null;const img=$(`[data-preview="${kind}"]`),drop=$(`[data-pick="${kind}"]`);img.hidden=true;img.removeAttribute('src');drop.querySelector('.gen-drop-placeholder').hidden=false;drop.querySelector('.gen-replace').hidden=true;$(`[data-clear="${kind}"]`).hidden=true;$(`[data-filename="${kind}"]`).textContent='JPG / PNG / WebP';updateSubmit();}
  async function refresh({selectRecovered=true}={}){
    if(refreshing||destroyed)return;refreshing=true;const version=++requestVersion;
    try{capabilities=await api(capabilitiesUrl);statusError='';renderService();
      const data=await api(`${apiBase}/jobs`);if(destroyed||version!==requestVersion)return;const listed=Array.isArray(data.jobs)?data.jobs:[];
      const found=new Set(listed.map(job=>job.id));for(const job of listed)adoptJob(job);
      // Only remembered IDs are read from storage; images never are.
      for(const id of ids.slice(0,24)){if(found.has(id))continue;try{const value=await api(`${apiBase}/jobs/${encodeURIComponent(id)}`);adoptJob(value.job);}catch(error){if(error.status===404){forget(id);if(current?.id===id){current=null;renderCurrent();}}}}
      if(!current&&selectRecovered&&jobs.size){current=activeJob()||[...jobs.values()].sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt))[0];renderCurrent();}
      renderHistory();updateSubmit();schedulePoll();await refreshMotionJobs();
    }catch(error){statusError=error.message;renderService();feedback(error.message,true);}finally{refreshing=false;}
  }
  function schedulePoll(){clearTimeout(pollTimer);if(destroyed||!dialog.open||document.hidden)return;const active=[...jobs.values()].filter(job=>ACTIVE.has(job.status));if(active.length)pollTimer=setTimeout(poll,1800);else if(capabilities?.tryOn?.busy)pollTimer=setTimeout(()=>refresh({selectRecovered:false}),4000);}
  async function poll(){
    if(destroyed||!dialog.open)return;
    for(const job of [...jobs.values()].filter(item=>ACTIVE.has(item.status))){try{const data=await api(`${apiBase}/jobs/${encodeURIComponent(job.id)}`);if(destroyed)return;adoptJob(data.job);if(!ACTIVE.has(data.job?.status))try{capabilities=await api(capabilitiesUrl);renderService();}catch{/* A finished result stays available despite status refresh failure. */}}
      catch(error){if(error.status===404){forget(job.id);if(current?.id===job.id){current={...job,status:'cancelled',message:'本机任务已被删除或已过期。'};renderCurrent();}renderHistory();updateSubmit();}else feedback(error.message,true);}}
    schedulePoll();
  }
  async function submit(){
    if($('[data-action="generate"]').disabled)return;const seed=seedState();if(!seed.valid){updateSubmit();return;}updatePhotoTypes();if(!supportedPhotoTypes().includes($('[data-field="photoType"]').value))return;posting=true;feedback('');updateSubmit();
    const person=files.person,garment=files.garment;
    try{const [personImage,garmentImage]=await Promise.all([dataURL(person),dataURL(garment)]);
      const data=await api(`${apiBase}/jobs`,{method:'POST',timeout:45000,body:{personImage,garmentImage,category:$('[data-field="category"]').value,garmentPhotoType:$('[data-field="photoType"]').value,...(seed.value===undefined?{}:{seed:seed.value})}});
      if(!data.job?.id)throw new Error('服务没有返回任务编号，请刷新记录确认后再重试。');
      if(destroyed)return;sources.set(data.job.id,{url:URL.createObjectURL(person)});adoptJob(data.job,{select:true});feedback('任务已提交，将显示服务返回的真实进展。');schedulePoll();
    }catch(error){feedback(error.message||'提交失败，请稍后重试。',true);}finally{posting=false;updateSubmit();}
  }
  function forget(id){removedIds.add(id);jobs.delete(id);ids=ids.filter(value=>value!==id);remember();const source=sources.get(id);if(source)URL.revokeObjectURL(source.url);sources.delete(id);}
  async function downloadCurrent(){
    const job=current,url=job?.status==='succeeded'&&job.result?.generated===true&&ownedUrl(job.result.url);if(!url)return;
    const link=$('[data-download]');if(link.getAttribute('aria-busy')==='true')return;link.setAttribute('aria-busy','true');
    try{const response=await fetch(url,{cache:'no-store'});if(!response.ok)throw new Error('结果文件无法下载，可能已经过期。');const blob=await response.blob();if(!ACCEPTED.has(blob.type)||!blob.size)throw new Error('本机服务没有返回有效图片，请刷新任务记录。');
      if(destroyed)return;const objectURL=URL.createObjectURL(blob),anchor=document.createElement('a');anchor.href=objectURL;anchor.download=`yingshen-tryon-${job.id.slice(0,12)}.${blob.type==='image/jpeg'?'jpg':blob.type.split('/')[1]}`;document.body.append(anchor);anchor.click();anchor.remove();setTimeout(()=>URL.revokeObjectURL(objectURL),60000);
    }catch(error){feedback(error.message||'下载失败，请稍后重试。',true);}finally{link.removeAttribute('aria-busy');}
  }
  async function useResult(){
    const button=$('[data-action="use-result"]'),job=current,url=job?.status==='succeeded'&&job.result?.generated===true&&ownedUrl(job.result.url);
    if(button.disabled||!url||typeof onUseResult!=='function')return;button.disabled=true;
    try{const response=await fetch(url,{cache:'no-store',signal:AbortSignal.timeout(30000)});if(!response.ok)throw new Error('结果已过期或无法读取，请重新生成。');const blob=await response.blob();if(!ACCEPTED.has(blob.type)||!blob.size||blob.size>12*1048576)throw new Error('生成图片无法用于继续搭配。');if(destroyed)return;const file=new File([blob],`试穿结果-${job.id.slice(0,8)}.${blob.type==='image/jpeg'?'jpg':blob.type.split('/')[1]}`,{type:blob.type});await imageSize(file);if(destroyed)return;close();await onUseResult(file);}
    catch(error){if(!destroyed){if(!dialog.open)dialog.showModal();feedback(error.message||'无法载入试穿结果，请重试。',true);}}
    finally{button.disabled=false;}
  }
  async function removeCurrent(){
    if(!current)return;const job=current,active=ACTIVE.has(job.status);const buttons=$$('[data-action="delete"],[data-action="cancel"]');buttons.forEach(button=>button.disabled=true);
    try{const result=await api(`${apiBase}/jobs/${encodeURIComponent(job.id)}`,{method:'DELETE'});forget(job.id);current=active?{...job,status:'cancelled',message:result.remoteMayContinue?'本机任务已取消并删除；远程服务可能仍在完成已开始的任务。':'任务已取消，本机素材已清除。'}:null;renderCurrent();renderHistory();feedback(active?'已取消本机任务。':'本机结果已删除。');
      try{capabilities=await api(capabilitiesUrl);renderService();}catch{}updateSubmit();schedulePoll();
    }catch(error){feedback(error.message||'删除失败，请重试。',true);}finally{buttons.forEach(button=>button.disabled=false);}
  }
  function motionFeedback(message,error=false){const node=$('[data-motion-feedback]');node.hidden=!message;node.textContent=message;node.classList.toggle('is-error',error);}
  function invalidateFrameExtraction(){frameVersion++;frameController?.abort();frameController=null;extractingFrame=false;}
  async function useDrivingFrame(){
    if(destroyed||motionPosting||posting||drivingReading||extractingFrame||!drivingFile)return;
    const file=drivingFile,epoch=drivingEpoch,version=++frameVersion;let personEpoch=epochs.person;
    const isCurrent=()=>!destroyed&&drivingEpoch===epoch&&drivingFile===file&&frameVersion===version&&epochs.person===personEpoch;
    const controller=new AbortController();frameController=controller;extractingFrame=true;motionFeedback('正在本地提取视频首帧…');updateMotionControls();
    try{const blob=await firstFrameBlob(file,controller.signal);if(!isCurrent())return;const frame=new File([blob],`${file.name.replace(/\.[^.]+$/,'')}-首帧.png`,{type:'image/png'});personEpoch=epochs.person+1;
      if(await prepareFile('person',frame,{isCurrent})&&isCurrent()){motionSource='person';updateMotionControls();motionFeedback('已用视频首帧替换当前人物照片，初始姿态已对齐。尚未提交生成。');}
    }catch(error){if(isCurrent()&&error.name!=='AbortError')motionFeedback(error.message||'无法提取视频首帧。',true);}
    finally{if(frameVersion===version){extractingFrame=false;frameController=null;if(!destroyed)updateMotionControls();}}
  }
  function drivingLimits(){return {maxBytes:12582912,minDurationSeconds:3,maxDurationSeconds:15,minDimension:128,maxLongEdge:1920,maxShortEdge:1080,minFps:8,maxFps:60,acceptedMimeTypes:['video/mp4','video/webm'],...capabilities?.motion?.drivingVideoLimits};}
  async function prepareDrivingVideo(file){
    if(!file||motionPosting)return;invalidateFrameExtraction();const epoch=++drivingEpoch;drivingReading=true;motionFeedback('正在读取本地视频信息…');updateMotionControls();
    try{const limits=drivingLimits();if(!['video/mp4','video/webm'].includes(file.type)||!limits.acceptedMimeTypes.includes(file.type))throw new Error('请选择 MP4 或 WebM 动作视频。');if(file.size>limits.maxBytes)throw new Error(`动作视频超过 ${Math.floor(limits.maxBytes/1048576)} MB，请先压缩。`);
      const info=await videoMetadata(file);if(!Number.isFinite(info.duration)||info.duration<limits.minDurationSeconds||info.duration>limits.maxDurationSeconds)throw new Error(`请选择 ${limits.minDurationSeconds}–${limits.maxDurationSeconds} 秒的视频；当前文件时长无法使用。`);
      if(!info.width||!info.height||Math.min(info.width,info.height)<limits.minDimension)throw new Error(`视频尺寸太小，每边至少需要 ${limits.minDimension} 像素。`);
      if(Math.max(info.width,info.height)>limits.maxLongEdge||Math.min(info.width,info.height)>limits.maxShortEdge)throw new Error(`视频分辨率过高，请缩小至 ${limits.maxLongEdge} × ${limits.maxShortEdge} 以内，支持竖屏。`);
      if(destroyed||epoch!==drivingEpoch)return;const video=$('[data-driving-preview]');video.pause();if(drivingUrl)URL.revokeObjectURL(drivingUrl);drivingFile=file;drivingUrl=URL.createObjectURL(file);video.src=drivingUrl;video.autoplay=false;video.hidden=false;video.load();$('[data-driving-name]').textContent=file.name;$('[data-driving-name]').title=file.name;$('[data-action="clear-driving"]').hidden=false;motionFeedback(`视频已准备 · ${info.duration.toFixed(1)} 秒 · ${info.width} × ${info.height}。帧率和完整内容由服务在提交后校验。`);
    }catch(error){if(epoch===drivingEpoch)motionFeedback(error.message||'动作视频无法读取，请重新选择。',true);}
    finally{if(epoch===drivingEpoch){drivingReading=false;updateMotionControls();}$('[data-driving-file]').value='';}
  }
  function clearDrivingVideo(){if(motionPosting)return;invalidateFrameExtraction();drivingEpoch++;drivingReading=false;drivingFile=null;const video=$('[data-driving-preview]');video.pause();video.onloadeddata=null;video.removeAttribute('src');video.load();video.hidden=true;if(drivingUrl)URL.revokeObjectURL(drivingUrl);drivingUrl=null;$('[data-driving-name]').textContent='MP4 / WebM';$('[data-driving-name]').removeAttribute('title');$('[data-action="clear-driving"]').hidden=true;updateMotionControls();}
  function activeMotionJob(){return [...motionJobs.values()].find(job=>ACTIVE.has(job.status));}
  function motionUrl(value){try{const url=new URL(value,location.href);return url.origin===location.origin&&url.pathname.startsWith(`${motionApiBase}/jobs/`)?url.href:null;}catch{return null;}}
  function motionPresets(){return (Array.isArray(capabilities?.motion?.presets)?capabilities.motion.presets:[]).filter(value=>typeof value==='string'&&/^[a-z0-9-]{1,40}$/i.test(value)&&(value!=='custom'||capabilities?.motion?.acceptsDrivingVideo===true));}
  function motionLabel(value){const label=capabilities?.motion?.presetLabels?.[value];return (typeof label==='string'&&label)||{idle:'自然站姿',walk:'漫步',wave:'挥手',turn:'转身','tai-chi':'太极动作',custom:'自带动作视频'}[value]||value||'动作';}
  function tryonSource(){return current?.status==='succeeded'&&current.result?.generated===true&&ownedUrl(current.result.url)?current:null;}
  function updateMotionControls(){
    const cap=capabilities?.motion,presets=motionPresets(),select=$('[data-motion-preset]'),previous=select.value,source=tryonSource();
    if(select.dataset.options!==presets.join('|')){select.innerHTML=presets.length?presets.map(value=>`<option value="${escapeHTML(value)}">${escapeHTML(motionLabel(value))}</option>`).join(''):'<option value="">暂无可用动作</option>';select.dataset.options=presets.join('|');if(presets.includes(previous))select.value=previous;}
    const direct=cap?.acceptsPersonImage===true,sourceOptions=[];
    if(direct||!cap?.configured)sourceOptions.push(['person','当前人物照片']);if(source)sourceOptions.push(['tryon','当前试穿结果']);
    if(!sourceOptions.length)sourceOptions.push(['tryon','需要先生成试穿结果']);
    if(!sourceOptions.some(([value])=>value===motionSource))motionSource=sourceOptions[0][0];
    const sourceSelect=$('[data-motion-source]'),sourceMarkup=sourceOptions.map(([value,label])=>`<option value="${value}">${label}</option>`).join('');if(sourceSelect.innerHTML!==sourceMarkup)sourceSelect.innerHTML=sourceMarkup;sourceSelect.value=motionSource;
    const hasSource=motionSource==='person'?direct&&!!files.person:!!source;
    const src=motionSource==='person'?urls.person:source&&ownedUrl(source.result.url),img=$('[data-motion-source-image]');img.hidden=!src;$('[data-motion-source-empty]').hidden=!!src;if(src&&img.getAttribute('src')!==src)img.src=src;else if(!src)img.removeAttribute('src');
    $('[data-motion-source-caption]').textContent=motionSource==='person'?(files.person?'更换动作人物照片':'点击选择人物照片'):(source?'使用真实试穿生成结果':'在上方先完成一次试穿');$('[data-action="motion-pick"]').disabled=motionPosting||motionSource!=='person';
    $('[data-motion-service]').textContent=!cap?.configured?'动作服务未连接':cap.busy?'动作任务处理中':cap.verifiedGeneration?'动作服务已验证':'已连接 · 等待动作验证';
    $('[data-motion-service]').classList.toggle('is-connected',cap?.configured===true);
    const custom=select.value==='custom'&&cap?.acceptsDrivingVideo===true,limits=drivingLimits();$('[data-driving-input]').hidden=!custom;if(!custom)$('[data-driving-preview]').pause();
    $('[data-driving-limits]').textContent=`${Math.floor(limits.maxBytes/1048576)} MB 以内 · ${limits.minDurationSeconds}–${limits.maxDurationSeconds} 秒 · 最长边 ${limits.maxLongEdge}px / 短边 ${limits.maxShortEdge}px · ${limits.minFps}–${limits.maxFps}fps，由服务校验。`;
    $('[data-motion-description]').textContent=custom?'用自己的动作视频驱动照片，尝试小幅正面体态迁移。实验功能可能出现形变。':cap?.kind==='local-tps'?'上传一张照片即可尝试预设的轻微姿态。低清实验效果可能出现面部柔化或衣物变形，不代表走秀或完整转身。':'选择人物照片或已生成的试穿结果，查看当前服务支持的动作。';
    const selectedSpec=cap?.presetSpecs?.[select.value]||cap;
    const spec=[Number.isFinite(selectedSpec?.duration)?`${selectedSpec.duration} 秒`:null,Number.isFinite(selectedSpec?.fps)?`${selectedSpec.fps}fps`:null,typeof selectedSpec?.resolution==='string'?selectedSpec.resolution:null,custom||cap?.experimental?'实验版':null,cap?.paid?'付费生成':cap?.configured&&!cap.remote?'本机推理':null].filter(Boolean).join(' · ');
    $('[data-motion-spec]').textContent=spec||'规格由已连接服务提供';
    $('[data-motion-privacy] span').textContent=cap?.notice||(!cap?.configured?(cap?.message||'动作服务尚未连接；准备图片不会提交生成。'):cap.remote?`点击生成后，选定图片将发送至 ${cap.name||'当前配置的远程动作服务'}。${cap.paid?'本服务按实际生成计费。':''}`:'动作由当前本机模型处理，图片不发送到远程服务。');
    const active=activeMotionJob(),occupied=!!activeJob()||!!active||posting||capabilities?.tryOn?.busy||cap?.busy;
    $('[data-action="generate-motion"]').disabled=motionPosting||extractingFrame||!cap?.configured||!presets.length||!hasSource||!!occupied||!!statusError||(custom&&(!drivingFile||drivingReading));
    $('[data-action="generate-motion"] span').textContent=motionPosting?'正在提交图片':active?'动作正在生成':'生成动作视频';
    sourceSelect.disabled=motionPosting||!!active;select.disabled=motionPosting||!!active||!presets.length;
    $('[data-action="pick-driving"]').disabled=motionPosting||!!active||drivingReading;$('[data-action="clear-driving"]').disabled=motionPosting||!!active;
    $('[data-action="use-driving-frame"]').disabled=motionPosting||posting||!!active||drivingReading||extractingFrame||!drivingFile;$('[data-action="use-driving-frame"]').setAttribute('aria-busy',String(extractingFrame));
    $('[data-motion-help]').textContent=active?'任务仍在后台进行，可以关闭窗口后回来查看。':!cap?.configured?'动作服务尚未就绪，暂不能生成。':!presets.length?'当前服务尚未提供可用的动作预设。':!hasSource?(direct?'请选择一张人物照片或成功生成的试穿结果。':'当前动作服务需要先完成一次真实试穿。'):custom&&drivingReading?'正在读取本地动作视频。':custom&&!drivingFile?'请添加动作视频，并对照首帧与人物照片的姿态。':occupied?'请等待当前生成任务结束。':custom?'将提交选中的人物来源与动作视频；输入预览只保留在当前页面。':'只提交当前选中的来源图片；生成效果取决于服务与输入。';
  }
  function rememberMotion(){try{localStorage.setItem(MOTION_HISTORY_KEY,JSON.stringify(motionIds.slice(0,24)));}catch{}}
  function adoptMotion(job,{select=false}={}){if(destroyed||!job?.id||!Object.hasOwn(LABELS,job.status)||removedMotionIds.has(job.id))return;motionJobs.set(job.id,job);if(!motionIds.includes(job.id)){motionIds.unshift(job.id);motionIds=motionIds.slice(0,24);rememberMotion();}if(select||motionJob?.id===job.id){motionJob=job;renderMotionJob();}renderMotionHistory();updateSubmit();}
  function renderMotionHistory(){
    const ordered=[...motionJobs.values()].sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt));
    $('[data-motion-history]').innerHTML=ordered.length?ordered.map(job=>`<button type="button" class="gen-history-card ${motionJob?.id===job.id?'is-selected':''}" data-motion-job="${escapeHTML(job.id)}" aria-pressed="${motionJob?.id===job.id}"><span class="gen-history-icon ${escapeHTML(job.status)}">${icon(job.status==='succeeded'?'video':job.status==='failed'?'close':'rotate')}</span><span><strong>${escapeHTML(motionLabel(job.motion))} · ${escapeHTML(LABELS[job.status])}</strong><small>${escapeHTML(formatTime(job.createdAt))}</small></span>${icon('chevron')}</button>`).join(''):'<p class="gen-history-empty">动作生成开始后，可在这里恢复查看。</p>';
  }
  function renderMotionJob(){
    const job=motionJob,url=job?.status==='succeeded'&&job.result?.generated===true&&/^video\/(mp4|webm)$/.test(job.result.mimeType||'')&&motionUrl(job.result.url),video=$('[data-motion-video]');
    $('[data-motion-empty]').hidden=!!job;$('[data-motion-task]').hidden=!job||!!url;$('[data-motion-video-wrap]').hidden=!url;$('[data-action="motion-focus"]').disabled=!url;
    if(url){if(motionVideoUrl!==url){video.pause();video.src=url;video.load();motionVideoUrl=url;}video.autoplay=false;const detail=[motionLabel(job.motion),Number.isFinite(job.result.durationSeconds)?`${job.result.durationSeconds.toFixed(1)} 秒`:null,formatTime(job.createdAt),job.sourceJobId?'来源：试穿结果':'来源：人物照片'].filter(Boolean);$('[data-motion-result-detail]').textContent=detail.join(' · ');}
    else{video.pause();if(motionVideoUrl){video.removeAttribute('src');video.load();motionVideoUrl=null;}if(motionFocused)setMotionFocus(false);}
    if(job&&!url){$('[data-motion-task-icon]').innerHTML=ACTIVE.has(job.status)?'<span class="gen-spinner"></span>':icon(job.status==='failed'?'close':'video');$('[data-motion-task-title]').textContent=job.status==='succeeded'?'视频结果待核验':LABELS[job.status];const message=typeof job.error==='string'?job.error:job.error?.message;$('[data-motion-task-message]').textContent=[message||job.message||'等待动作服务返回进展。',ACTIVE.has(job.status)?elapsedLabel(job):''].filter(Boolean).join(' · ');$('[data-motion-task-message]').setAttribute('role',job.status==='failed'?'alert':'status');renderProgress($('[data-motion-progress]'),job);$('[data-action="cancel-motion"]').hidden=!motionJobs.has(job.id);$('[data-action="cancel-motion"]').textContent=ACTIVE.has(job.status)?'取消本机任务':'删除任务记录';}
    updateMotionControls();
  }
  function scheduleMotionPoll(){clearTimeout(motionTimer);if(destroyed||!dialog.open||document.hidden)return;if(activeMotionJob())motionTimer=setTimeout(pollMotion,1800);}
  async function refreshMotionJobs(){
    if(!capabilities?.motion||destroyed)return;
    try{const data=await api(`${motionApiBase}/jobs`),listed=Array.isArray(data.jobs)?data.jobs:[],found=new Set(listed.map(job=>job.id));for(const job of listed)adoptMotion(job);
      for(const id of motionIds.slice(0,24)){if(found.has(id))continue;try{const value=await api(`${motionApiBase}/jobs/${encodeURIComponent(id)}`);adoptMotion(value.job);}catch(error){if(error.status===404){forgetMotion(id);if(motionJob?.id===id){motionJob=null;renderMotionJob();}}}}
      if(!motionJob&&motionJobs.size){motionJob=activeMotionJob()||[...motionJobs.values()].sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt))[0];renderMotionJob();}renderMotionHistory();scheduleMotionPoll();
    }catch(error){motionFeedback(error.message,true);}
  }
  async function pollMotion(){
    if(destroyed||!dialog.open)return;
    for(const old of [...motionJobs.values()].filter(job=>ACTIVE.has(job.status))){try{const data=await api(`${motionApiBase}/jobs/${encodeURIComponent(old.id)}`);adoptMotion(data.job);if(!ACTIVE.has(data.job?.status)){try{capabilities=await api(capabilitiesUrl);renderService();}catch{}}}catch(error){if(error.status===404){forgetMotion(old.id);if(motionJob?.id===old.id){motionJob={...old,status:'cancelled',message:'动作任务已过期或从本机删除。'};renderMotionJob();}renderMotionHistory();updateSubmit();}else motionFeedback(error.message,true);}}
    scheduleMotionPoll();
  }
  async function submitMotion(){
    if($('[data-action="generate-motion"]').disabled)return;motionPosting=true;motionFeedback('');updateSubmit();
    try{const preset=$('[data-motion-preset]').value,source=motionSource==='tryon'?tryonSource():null;let body;
      if(motionSource==='person'){if(capabilities?.motion?.acceptsPersonImage!==true||!files.person)throw new Error('当前服务不支持直接人物照片，请先生成试穿结果。');body={personImage:await dataURL(files.person),motion:preset};}
      else{if(!source)throw new Error('请选择成功生成的真实试穿结果。');body={sourceJobId:source.id,motion:preset};}
      if(preset==='custom'){if(capabilities?.motion?.acceptsDrivingVideo!==true||!drivingFile)throw new Error('当前动作需要服务支持与一段有效的动作视频。');body.drivingVideo=await dataURL(drivingFile);}
      const data=await api(`${motionApiBase}/jobs`,{method:'POST',body,timeout:45000});if(!data.job?.id)throw new Error('服务没有返回动作任务编号，请刷新后确认。');adoptMotion(data.job,{select:true});motionFeedback('动作任务已提交，进展由当前服务返回。');scheduleMotionPoll();
    }catch(error){motionFeedback(error.message||'动作任务提交失败。',true);}finally{motionPosting=false;updateSubmit();}
  }
  function forgetMotion(id){removedMotionIds.add(id);motionJobs.delete(id);motionIds=motionIds.filter(value=>value!==id);rememberMotion();}
  async function deleteMotion(){
    if(!motionJob)return;const job=motionJob,active=ACTIVE.has(job.status),buttons=$$('[data-action="cancel-motion"],[data-action="delete-motion"]');buttons.forEach(button=>button.disabled=true);
    try{const result=await api(`${motionApiBase}/jobs/${encodeURIComponent(job.id)}`,{method:'DELETE'});forgetMotion(job.id);motionJob=active?{...job,status:'cancelled',message:result.remoteMayContinue?'本机等待已取消；已开始的远程动作任务可能继续执行。':'动作任务已取消，本机素材已清理。'}:null;renderMotionJob();renderMotionHistory();motionFeedback(active?'本机动作任务已取消。':'本机动作结果已删除。');try{capabilities=await api(capabilitiesUrl);renderService();}catch{}updateSubmit();scheduleMotionPoll();}
    catch(error){motionFeedback(error.message||'删除动作任务失败。',true);}finally{buttons.forEach(button=>button.disabled=false);}
  }
  async function downloadMotion(){
    const job=motionJob,url=job?.status==='succeeded'&&job.result?.generated===true&&motionUrl(job.result.url);if(!url)return;const button=$('[data-action="download-motion"]');button.disabled=true;
    try{const response=await fetch(url,{cache:'no-store'});if(!response.ok)throw new Error('本机动作视频无法下载，可能已过期。');const blob=await response.blob();if(!/^video\/(mp4|webm)$/.test(blob.type)||!blob.size)throw new Error('服务未返回有效视频文件。');if(destroyed)return;const objectUrl=URL.createObjectURL(blob),anchor=document.createElement('a');anchor.href=objectUrl;anchor.download=`yingshen-motion-${job.id.slice(0,12)}.${blob.type.split('/')[1]}`;document.body.append(anchor);anchor.click();anchor.remove();setTimeout(()=>URL.revokeObjectURL(objectUrl),60000);}
    catch(error){motionFeedback(error.message||'下载动作视频失败。',true);}finally{button.disabled=false;}
  }
  function setMotionFocus(value){motionFocused=value;dialog.classList.toggle('gen-motion-focused',value);const button=$('[data-action="motion-focus"]');button.setAttribute('aria-pressed',String(value));button.innerHTML=`${icon(value?'collapse':'expand')} ${value?'退出专注':'专注视频'}`;if(value)$('.gen-content').scrollTop=0;}
  function setWorkflow(motionEntry){if(motionFocused)setMotionFocus(false);dialog.classList.toggle('gen-motion-entry',motionEntry);$('[data-action="toggle-workflow"]').innerHTML=`${icon(motionEntry?'hanger':'video')} ${motionEntry?'返回试穿':'照片动作'}`;$('.gen-content').scrollTop=0;}
  async function open(options={}){
    const {personFile,view}=options,explicitPerson=Object.hasOwn(options,'personFile');
    if(destroyed)return;previousFocus=document.activeElement;if(!dialog.open)dialog.showModal();setWorkflow(view==='motion');
    const pendingRefresh=refresh();
    try{let file=explicitPerson?personFile:null;
      if(getPersonFile){try{const fromParent=await getPersonFile(),changed=!hasInheritedPersonFile||fromParent!==inheritedPersonFile;inheritedPersonFile=fromParent;hasInheritedPersonFile=true;if(!explicitPerson&&changed)file=fromParent;}catch(error){if(!explicitPerson)throw error;}}
      if(file instanceof Blob){if(!(file instanceof File))file=new File([file],'当前人物照片.'+(file.type.split('/')[1]||'png'),{type:file.type});await prepareFile('person',file);}
    }catch(error){feedback('当前人物照片无法读取，可以在这里重新选择。',true);}
    await pendingRefresh;schedulePoll();scheduleMotionPoll();
  }
  function close(){if(dialog.open)dialog.close();}
  function destroy(){if(destroyed)return;destroyed=true;requestVersion++;invalidateFrameExtraction();drivingEpoch++;clearTimeout(pollTimer);clearTimeout(motionTimer);clearTimeout(feedbackTimer);for(const video of $$('video')){video.pause();video.removeAttribute('src');video.load();}if(drivingUrl)URL.revokeObjectURL(drivingUrl);events.abort();for(const url of Object.values(urls))if(url)URL.revokeObjectURL(url);for(const source of sources.values())URL.revokeObjectURL(source.url);dialog.remove();}
  listen(dialog,'click',event=>{const pick=event.target.closest('[data-pick]'),clear=event.target.closest('[data-clear]'),job=event.target.closest('[data-job]'),action=event.target.closest('[data-action]')?.dataset.action;
    if(event.target.closest('[data-download]')){event.preventDefault();downloadCurrent();}
    if(pick&&!pick.disabled)$(`[data-file="${pick.dataset.pick}"]`).click();if(clear)clearFile(clear.dataset.clear);if(job){current=jobs.get(job.dataset.job)||null;renderCurrent();renderHistory();}
    if(action==='close')close();if(action==='refresh'||action==='refresh-history')refresh();if(action==='generate'||action==='regenerate')submit();if(action==='cancel'||action==='delete')removeCurrent();
    if(action==='reuse-seed'&&!$('[data-action="reuse-seed"]').disabled&&validSeed(current?.seed)){$('[data-field="seed"]').value=String(current.seed);$('[data-generation-settings]').open=true;updateSubmit();$('[data-field="seed"]').focus();feedback('已复用本次种子。点击再次生成才会提交当前图片与设置。');}
    if(action==='new-variant'&&!$('[data-action="new-variant"]').disabled){$('[data-field="seed"]').value='';updateSubmit();}
    if(action==='use-result')useResult();
    const motionItem=event.target.closest('[data-motion-job]');if(motionItem){motionJob=motionJobs.get(motionItem.dataset.motionJob)||null;renderMotionJob();renderMotionHistory();}
    if(action==='motion-pick')$('[data-file="person"]').click();if(action==='generate-motion')submitMotion();if(action==='cancel-motion'||action==='delete-motion')deleteMotion();if(action==='download-motion')downloadMotion();if(action==='refresh-motion')refresh();if(action==='motion-focus')setMotionFocus(!motionFocused);
    if(action==='pick-driving')$('[data-driving-file]').click();if(action==='clear-driving')clearDrivingVideo();if(action==='use-driving-frame')useDrivingFrame();
    if(action==='toggle-workflow')setWorkflow(!dialog.classList.contains('gen-motion-entry'));
  });
  listen(dialog,'change',event=>{if(event.target.matches('[data-file]'))prepareFile(event.target.dataset.file,event.target.files[0]);if(event.target.matches('[data-driving-file]'))prepareDrivingVideo(event.target.files[0]);if(event.target.matches('[data-compare]'))updateComparison();if(event.target.matches('[data-motion-source]')){motionSource=event.target.value;updateMotionControls();}if(event.target.matches('[data-motion-preset]'))updateMotionControls();});
  // Keep the parent studio shortcuts out of this modal; browser text editing and Escape stay native.
  listen(dialog,'keydown',event=>{event.stopPropagation();if(event.key==='Escape'&&motionFocused){event.preventDefault();setMotionFocus(false);}});
  listen($('[data-split]'),'input',updateComparison);
  listen($('[data-field="seed"]'),'input',updateSubmit);
  listen(dialog,'close',()=>{clearTimeout(pollTimer);clearTimeout(motionTimer);for(const video of $$('video'))video.pause();previousFocus?.focus?.({preventScroll:true});});
  listen(document,'visibilitychange',()=>{if(document.hidden){clearTimeout(pollTimer);clearTimeout(motionTimer);for(const video of $$('video'))video.pause();}else if(dialog.open)refresh({selectRecovered:false});});
  listen(window,'yingshen:open-generation',event=>open(event.detail||{}));
  for(const drop of $$('[data-pick]')){listen(drop,'dragover',event=>{event.preventDefault();if(!posting)drop.classList.add('is-dragover');});listen(drop,'dragleave',()=>drop.classList.remove('is-dragover'));listen(drop,'drop',event=>{event.preventDefault();drop.classList.remove('is-dragover');prepareFile(drop.dataset.pick,event.dataTransfer?.files[0]);});}
  const button=typeof trigger==='string'?document.querySelector(trigger):trigger;if(button)listen(button,'click',()=>open());
  listen($('[data-result-image]'),'error',()=>{if(current?.status==='succeeded'){$('[data-result-note]').textContent='结果文件暂时无法加载，可能已过期；请刷新任务记录。';feedback('生成结果无法加载，请刷新记录核对本机文件。',true);}});
  listen($('[data-motion-video]'),'error',()=>{if(motionJob?.status==='succeeded'&&motionVideoUrl)motionFeedback('本机动作视频无法播放，可能已过期或当前浏览器不支持编码。',true);});
  renderService();
  return {open,close,destroy,element:dialog};
}
