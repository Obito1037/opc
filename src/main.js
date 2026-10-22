import './style.css';
import './polish-v2.css';
import './studio-v3.css';
import {LookHistory,sanitizePreferences,safeLookName,parseLookCollection,serializeLookCollection} from './studio-state.js';
import { catalog, defaultLook, palette, categories, applyProduct, validateImageFile, sanitizeLook } from './catalog.js';
import { icon, productArt } from './icons.js';

const $ = (query) => document.querySelector(query);
const $$ = (query) => [...document.querySelectorAll(query)];
let look = {...defaultLook}, category = 'clothing', motion = 'idle', mode = 'avatar', paused = false;
let uploaded = null, photoReady = false, busy = false, comparing = false;
let saved = readSaved(), activeProduct = 'sage-shirt', photoEngine, avatar, activeNav = 'studio';
let toastTimer, recordInProgress = false, abortRecording = null;
let mirror = null, liveReady = false;
let generationStudio=null,openingGeneration=false;
let productStudio=null,openingProduct=false;
const history=new LookHistory(look);
let preferences=readPreferences(),splitEnabled=false,splitPosition=.5,focused=false;
const systemDark=matchMedia('(prefers-color-scheme: dark)'),systemMotion=matchMedia('(prefers-reduced-motion: reduce)');
paused=preferences.motion==='reduced'||(preferences.motion==='system'&&systemMotion.matches);

$('#app').innerHTML = `
<aside class="rail">
  <a class="brand-mark" href="#" aria-label="映身首页">${icon('logo')}</a>
  <nav aria-label="主导航">
    <button class="rail-item active" data-nav="studio" aria-label="试穿空间">${icon('hanger')}<span>试穿</span></button>
    <button class="rail-item" data-nav="saved" aria-label="我的搭配">${icon('heart')}<span>搭配</span><i id="saved-count">${saved.length}</i></button>
    <button class="rail-item" data-nav="guide" aria-label="项目指南">${icon('help')}<span>指南</span></button>
  </nav>
  <div class="rail-bottom"><span class="rail-monogram">YS</span><span class="vertical-label">MADE FOR YOU</span></div>
</aside>
<div class="workspace">
  <header class="topbar">
    <a href="#" class="wordmark">映身<span>YINGSHEN</span></a>
    <div class="breadcrumb"><span>创作空间</span>${icon('chevron')}<strong>动态试穿实验室</strong></div>
    <div class="header-right"><span class="local-badge"><i></i>本机私享</span><button class="icon-button" id="theme-toggle" aria-label="切换外观" title="切换深浅外观">${icon('moon')}</button><button class="icon-button" id="studio-settings" aria-label="工作台设置" title="工作台设置">${icon('settings')}</button><button class="text-button" id="guide-button">项目介绍 ${icon('arrow')}</button></div>
  </header>
  <main>
    <section class="intro"><div><div class="eyebrow">YINGSHEN STUDIO</div><h1>你的风格，<em>随心而动。</em></h1><p>照片搭配、动态试妆与商品试穿，一处探索。</p></div><div class="studio-actions"><button id="ai-tryon" class="save-button ai-entry">${icon('sparkle')} AI 试穿与动作</button><div class="history-actions" role="group" aria-label="编辑记录"><button id="undo-look" class="icon-button" aria-label="撤销搭配修改" title="撤销 · Ctrl / ⌘ Z" disabled>${icon('undo')}</button><button id="redo-look" class="icon-button" aria-label="重做搭配修改" title="重做 · Ctrl / ⌘ Shift Z" disabled>${icon('redo')}</button><button id="reset-look" class="icon-button" aria-label="恢复默认搭配" title="恢复默认搭配">${icon('rotate')}</button></div><button id="focus-stage" class="save-button" aria-pressed="false">${icon('expand')} 专注预览</button></div></section>
    <div class="studio-layout">
      <section class="identity-panel panel">
        <div class="panel-heading"><h2>从你的照片开始</h2><span class="tiny-label">MY STUDIO</span></div>
        <div class="upload-zone" id="upload-zone" role="button" tabindex="0" aria-label="上传真人照片">
          <input id="photo-input" type="file" accept="image/jpeg,image/png,image/webp" hidden>
          <div class="upload-placeholder" id="upload-placeholder"><div class="photo-glyph">${icon('user')}<span>${icon('upload')}</span></div><strong>从一张你的照片开始</strong><p>点击上传，或拖拽照片到这里</p><span class="file-info">JPG / PNG / WebP · 最大 16 MB</span></div>
          <img id="photo-thumbnail" alt="本地上传的真人照片" hidden>
          <div class="change-photo" hidden>${icon('upload')} 更换照片</div>
        </div>
        <p class="upload-tip">保留你的脸、衣服纹理和完整背景。<br>正面、光线均匀的照片效果更好。<button id="demo-photo" class="sample-link">体验清晰样片 <span>AI 示例 ↗</span></button><button id="legacy-demo-photo" class="sample-link secondary">复杂背景样片 · CC0 ↗</button></p>
        <button class="primary-button" id="generate" disabled>${icon('sparkle')} 分析照片，开始搭配 <span>↗</span></button>
        <div class="status-line" id="analysis-status" role="status">上传后，照片仅在当前浏览器处理</div>
        <div class="divider"></div>
        <div class="section-label"><h3>形象设置</h3><span>PERSONALIZE</span></div>
        <label class="field-row"><span>展示方式</span><span class="mini-tag" id="mode-label">陈列人台</span></label>
        <div class="segmented" id="view-switch"><button data-mode="avatar" class="active">3D 陈列</button><button data-mode="photo" disabled>照片改色</button><button data-mode="mirror">动态试妆</button></div>
        <div id="photo-mode-control" hidden><label for="photo-render-mode">照片效果</label><select id="photo-render-mode"><option value="recolor">原衣改色 · 保留褶皱</option><option value="overlay">轮廓草图 · 非真实换衣</option></select><p>改色保留原有款式。换款草图仅供轮廓示意。</p></div>
        <div class="section-label colors-heading"><h3>服装色彩</h3><span id="color-label">鼠尾草绿</span></div>
        <div class="swatches">${palette.map(c=>`<button aria-label="服装颜色 ${c}" title="${c}" data-color="${c}" style="--swatch:${c}" class="${c===look.color?'selected':''}">${c===look.color?icon('check'):''}</button>`).join('')}<label class="custom-color" title="选择自定义服装颜色"><input id="custom-color" type="color" value="${look.color}" aria-label="自定义服装颜色"><span>＋</span></label></div>
        <div class="intensity-row"><label for="makeup-intensity">妆容浓度</label><output id="intensity-value">35%</output></div>
        <input class="range" id="makeup-intensity" type="range" min="0" max="100" value="35">
        <label class="toggle-row"><span>应用服装效果</span><input id="show-garment" type="checkbox" checked><span class="toggle"></span></label>
        <div class="privacy-note">${icon('lock')}<div><strong>本地预览，私享搭配</strong><p>改色与试妆在浏览器内完成。<br>AI 生成的数据去向在独立工作台说明。</p></div></div>
        <button class="clear-button" id="clear-photo" disabled>${icon('trash')} 清除当前照片</button>
      </section>
      <section class="stage-panel panel">
        <div class="stage-toolbar"><div class="stage-title"><span class="live-dot"></span><strong id="stage-mode-title">3D 动态搭配</strong><span class="version-tag">LIVE</span></div><button class="icon-button" id="reset-camera" aria-label="重置视角" title="重置视角">${icon('rotate')}</button></div>
        <div class="stage-body">
          <div class="stage-watermark" aria-hidden="true"></div>
          <div class="stage-corner"><span>LOOK 001</span><span>日常 · 自在</span></div>
          <div id="avatar-stage"></div>
          <div id="photo-stage" hidden><canvas id="photo-canvas"></canvas></div>
          <div id="mirror-stage" hidden><canvas id="mirror-canvas" hidden></canvas><div id="mirror-empty"><span class="mirror-symbol">${icon('video')}</span><span class="eyebrow">BEAUTY, IN REAL MOTION</span><h3>妆容，跟随真实的你。</h3><p>转头、微笑，看看颜色与配饰的变化。<br>支持摄像头或本地视频，全程本机处理。</p><div class="mirror-actions"><button id="start-camera" class="small-primary">${icon('video')} 开启摄像头</button><button id="choose-video" class="save-button">${icon('upload')} 上传视频</button></div><span class="mirror-help">MP4 / WebM / MOV · 最大 200 MB</span></div></div>
          <input type="file" id="video-input" accept="video/mp4,video/webm,video/quicktime" hidden>
          <div class="stage-bottom-note"><span class="model-label" id="model-label">服装陈列人台 · 非真人重建</span><span id="stage-hint">${icon('rotate')} 拖动旋转 · 滚轮缩放</span></div>
          <button class="compare-button" id="compare" hidden>${icon('layers')} 查看原图</button>
          <button class="mirror-stop" id="stop-mirror" hidden>${icon('close')} 关闭视频</button>
          <div class="stage-loader" id="stage-loader" hidden><span class="spinner"></span><strong>正在认识你的轮廓</strong><p id="loading-text">加载本地识别模型…</p></div>
        </div>
        <div id="split-controls" class="compare-controls" hidden><button id="split-toggle" class="text-button" aria-pressed="false">${icon('split')} 分屏对比</button><div id="split-range" hidden><label for="comparison-position">原图</label><input id="comparison-position" type="range" min="0" max="100" value="50" aria-label="原图与效果分屏位置"><output id="comparison-value">50%</output><span>效果</span></div></div>
        <div class="motion-bar"><span class="motion-label">让穿搭动起来</span><div class="motion-options">
          <button class="active" data-motion="idle">${icon('user')} 呼吸</button>
          <button data-motion="walk">${icon('walk')} 漫步</button>
          <button data-motion="wave">${icon('wave')} 挥手</button>
          <button data-motion="turn">${icon('rotate')} 转身</button>
        </div><button id="pause-motion" class="icon-button" aria-label="暂停动作">${icon('pause')}</button></div>
        <div class="stage-footer"><div><span class="small-label">CURRENT LOOK</span><strong id="current-look-name">鼠尾草 · 日常时刻</strong></div><button class="save-button" id="save-look">${icon('heart')} 收藏搭配</button></div>
      </section>
      <section class="wardrobe-panel panel">
        <div class="panel-heading"><h2>灵感衣橱</h2><span class="count-tag">${catalog.length} 件</span></div>
        <div class="category-tabs" role="tablist" aria-label="商品分类">${Object.entries(categories).map(([key,label])=>`<button role="tab" aria-selected="${key===category}" data-category="${key}" class="${key===category?'active':''}">${label}</button>`).join('')}</div>
        <button id="own-product" class="save-button own-product">${icon('upload')} 上传自己的鞋饰 / 色卡</button>
        <label class="search-field">${icon('search')}<input id="search-products" placeholder="找一件心动单品" aria-label="搜索单品"><span>⌕</span></label>
        <div class="catalog-caption"><span id="catalog-title">为日常留一点风格</span><span id="catalog-count">06 ITEMS</span></div>
        <div id="product-grid" class="product-grid"></div>
        <div class="collection-note"><span>THE EVERYDAY EDIT</span><strong>风格没有标准答案。</strong><p>在衣橱里，自由组合你的灵感。</p><span class="note-flower">✳</span></div>
        <p class="catalog-disclaimer">原创参数化示例单品 · 用于风格和色彩探索<br>不代表真实商品、尺码或面料仿真</p>
      </section>
    </div>
    <footer class="page-footer"><span>${icon('lock')} 改色与动态试妆，全程本机处理。</span><div><button id="export-photo">${icon('download')} 导出画面</button><button id="record-video">${icon('video')} 录制 6 秒动作</button></div><span class="prototype-label">YINGSHEN STUDIO / 0.4</span></footer>
  </main>
</div>
<dialog id="content-dialog"><div class="dialog-heading"><h2 id="dialog-title"></h2><button id="close-dialog" class="icon-button" aria-label="关闭">${icon('close')}</button></div><div id="dialog-body"></div></dialog>
<input id="collection-input" type="file" accept="application/json,.json" hidden><div class="toast" id="toast" role="status"></div>`;

function toast(message) { clearTimeout(toastTimer); $('#toast').textContent=message; $('#toast').classList.add('visible'); toastTimer=setTimeout(()=>$('#toast').classList.remove('visible'),4200); }
function readSaved() { try { const value=JSON.parse(localStorage.getItem('yingshen-looks')||'[]');return Array.isArray(value)?value.slice(0,24).filter(x=>x&&typeof x.id==='string').map(x=>({id:/^[a-z0-9-]{1,64}$/i.test(x.id)?x.id:crypto.randomUUID(),name:safeLookName(x.name),date:String(x.date||'').slice(0,30),look:sanitizeLook(x.look)})):[]; } catch { return []; } }
function persistSaved() { try {localStorage.setItem('yingshen-looks',JSON.stringify(saved));$('#saved-count').textContent=saved.length;return true;} catch { toast('浏览器存储不可用，当前搭配仍可导出');return false;} }
function showDialog(title,html) { $('#dialog-title').textContent=title;$('#dialog-body').innerHTML=html;$('#content-dialog').showModal(); }
function escapeHTML(text) {return String(text).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function readPreferences(){try{return sanitizePreferences(JSON.parse(localStorage.getItem('yingshen-preferences')||'{}'));}catch{return sanitizePreferences();}}
function reduceMotion(){return preferences.motion==='reduced'||(preferences.motion==='system'&&systemMotion.matches);}
function updatePauseButton(){$('#pause-motion').innerHTML=icon(paused?'play':'pause');$('#pause-motion').setAttribute('aria-label',paused?'播放动作':'暂停动作');}
function applyPreferences({persist=false}={}){
  const dark=preferences.theme==='dark'||(preferences.theme==='system'&&systemDark.matches),reduced=reduceMotion();
  document.documentElement.dataset.theme=dark?'dark':'light';document.documentElement.dataset.reducedMotion=String(reduced);
  document.body.dataset.renderQuality=preferences.quality;$('.stage-body').dataset.backdrop=preferences.backdrop;
  $('#theme-toggle').innerHTML=icon(dark?'sun':'moon');$('#theme-toggle').setAttribute('aria-label',dark?'切换到浅色外观':'切换到深色外观');
  avatar?.setQuality?.(preferences.quality);avatar?.setBackdrop?.(preferences.backdrop);mirror?.setQuality?.(preferences.quality);photoEngine?.setPresentationMotion?.(!reduced);
  if(reduced)paused=true;
  avatar?.setPaused(paused||mode!=='avatar');photoEngine?.setPaused(paused||mode!=='photo');mirror?.setPaused(paused);updatePauseButton();
  if(mode==='photo')$('.motion-label').textContent=reduced?'静态预览 · 已减少动态':'画面微动 · 非肢体动作';
  if(persist)try{localStorage.setItem('yingshen-preferences',JSON.stringify(preferences));}catch{toast('浏览器无法保存设置，本次仍然生效');}
}
function showSettings(){
  showDialog('工作台设置',`<p class="dialog-lead">让画面和操作，适合你的习惯。</p><div class="settings-list"><label class="settings-row"><span><strong>外观</strong><small>选择浅色、深色，或跟随设备</small></span><select id="theme-setting">${[['system','跟随系统'],['light','浅色'],['dark','深色']].map(([v,t])=>`<option value="${v}" ${preferences.theme===v?'selected':''}>${t}</option>`).join('')}</select></label><label class="settings-row"><span><strong>流畅度与画质</strong><small>自动适配，也可以优先流畅或细节</small></span><select id="quality-setting">${[['auto','自动适配'],['balanced','流畅优先'],['quality','精细画质']].map(([v,t])=>`<option value="${v}" ${preferences.quality===v?'selected':''}>${t}</option>`).join('')}</select></label><label class="settings-row"><span><strong>动态效果</strong><small>减少自动播放和界面过渡</small></span><select id="motion-setting">${[['system','跟随系统'],['reduced','减少动态'],['full','标准动态']].map(([v,t])=>`<option value="${v}" ${preferences.motion===v?'selected':''}>${t}</option>`).join('')}</select></label><label class="settings-row"><span><strong>陈列背景</strong><small>换一种氛围，观察整套搭配</small></span><select id="backdrop-setting">${[['pearl','珍珠白'],['ink','深空灰'],['rose','柔雾粉']].map(([v,t])=>`<option value="${v}" ${preferences.backdrop===v?'selected':''}>${t}</option>`).join('')}</select></label></div><div class="shortcut-list"><h3>键盘快捷操作</h3><span>撤销 <kbd>Ctrl / ⌘ Z</kbd></span><span>重做 <kbd>Ctrl / ⌘ Shift Z</kbd></span><span>收藏搭配 <kbd>Ctrl / ⌘ S</kbd></span><span>播放 / 暂停 <kbd>空格</kbd></span><span>专注预览 <kbd>F</kbd></span></div><p class="dialog-footnote">设置只保存在这台设备。减少动态后，仍可手动播放动作。</p>`);
}
function syncHistory(){$('#undo-look').disabled=!history.canUndo;$('#redo-look').disabled=!history.canRedo;}
function changeHistory(direction){if(busy)return toast('请等待当前处理完成');const next=history[direction]();if(next){look=next;updateLook({record:false});}}
function toggleFocus(){focused=!focused;$('.workspace').classList.toggle('focused',focused);$('#focus-stage').setAttribute('aria-pressed',String(focused));$('#focus-stage').innerHTML=`${icon(focused?'collapse':'expand')} ${focused?'退出专注':'专注预览'}`;window.dispatchEvent(new Event('resize'));}
function syncSplit(){
  const available=mode==='photo'&&photoReady||mode==='mirror'&&liveReady;
  $('#split-controls').hidden=!available;$('#split-range').hidden=!splitEnabled;$('#split-toggle').setAttribute('aria-pressed',String(splitEnabled));
  $('#comparison-value').value=`${Math.round(splitPosition*100)}%`;
  photoEngine?.setSplitComparison?.(available&&mode==='photo'&&splitEnabled?splitPosition:null);
  mirror?.setSplitComparison?.(available&&mode==='mirror'&&splitEnabled?splitPosition:null);
}
function renderCatalog() {
  $('#product-grid').dataset.context=`${mode}:${category}:${look.photoMode}`;
  const search=$('#search-products').value.trim();
  const products=catalog.filter(p=>p.category===category&&`${p.name}${p.subtitle}`.includes(search)&&(mode!=='mirror'||p.accessory!=='necklace'));
  $('#catalog-count').textContent=`${String(products.length).padStart(2,'0')} ITEMS`;
  $('#catalog-title').textContent={clothing:'为日常留一点风格',shoes:'每一步，都有自己的节奏',accessories:'小细节，点亮整套搭配',makeup:'让气色，成为你的风格'}[category];
  if(mode==='photo'&&look.photoMode!=='overlay'&&category==='clothing')$('#catalog-title').textContent='选取色彩 · 保留原衣款式';
  $('#product-grid').innerHTML=products.map(p=>`<button class="product-card ${isSelected(p)?'selected':''}" data-product="${p.id}" aria-pressed="${isSelected(p)}"><div class="product-image"><span class="product-label">${p.label}</span>${productArt(p.icon,p.color)}<span class="product-check">${icon('check')}</span></div><strong>${p.name}</strong><span class="product-subtitle">${p.subtitle}</span><div class="product-color"><i style="background:${p.color}"></i><span>${p.category==='makeup'?'预览色号':'试穿此款'}</span></div></button>`).join('') || '<p class="empty-catalog">没有找到这件单品，试试其他关键词。</p>';
  if(mode==='photo'&&look.photoMode!=='overlay'&&category==='clothing')$$('.product-card').forEach(card=>{card.querySelector('.product-subtitle').textContent='应用配色 · 保留原有款式';card.querySelector('.product-color span').textContent='选择此配色';});
}
function isSelected(p) { if(p.category==='clothing')return p.garment===look.garment&&p.color===look.color; if(p.category==='shoes')return p.shoe===look.shoe;if(p.category==='accessories')return p.accessory===look.accessory;return p.makeup===look.makeup; }
function updateLook({record=true,group=null}={}) {
  look=sanitizeLook(look);if(record)history.commit(look,{group});syncHistory();
  avatar?.setLook(look);photoEngine?.setLook(look);mirror?.setLook(look);
  $$('.swatches button').forEach(b=>{b.classList.toggle('selected',b.dataset.color===look.color);b.innerHTML=b.dataset.color===look.color?icon('check'):'';});
  $('#color-label').textContent=({'#899a7b':'鼠尾草绿','#e8e1d2':'云朵白','#b69372':'沙丘棕','#374641':'森林墨','#b77b76':'暮玫瑰','#78939f':'雾蓝','#675d79':'烟紫','#c5a05d':'暖金'})[look.color]||look.color;
  $('#makeup-intensity').value=Math.round(look.makeupIntensity*100);$('#intensity-value').value=`${Math.round(look.makeupIntensity*100)}%`;
  $('#show-garment').checked=look.showGarment;
  $('#photo-render-mode').value=look.photoMode||'recolor';
  $('#custom-color').value=look.color;
  const product=catalog.find(p=>p.category==='clothing'&&isSelected(p));
  $('#current-look-name').textContent=product?.name||`${{shirt:'基础上衣',jacket:'休闲外套',dress:'轻盈连衣裙'}[look.garment]} · 自定义配色`;
  $$('.product-card').forEach(card=>{const p=catalog.find(item=>item.id===card.dataset.product),selected=p&&isSelected(p);card.classList.toggle('selected',!!selected);card.setAttribute('aria-pressed',String(!!selected));});
  if($('#product-grid').dataset.context!==`${mode}:${category}:${look.photoMode}`)renderCatalog();
  if(mode==='photo')updatePhotoLabels();
  if(mode==='mirror')updateMirrorLabel();
  if(mode==='photo'){$('[data-category="shoes"]').disabled=look.photoMode!=='overlay';if(category==='shoes'&&look.photoMode!=='overlay')$('[data-category="clothing"]').click();}
}
function updateMirrorLabel(){
  const makeup=catalog.find(p=>p.category==='makeup'&&p.makeup===look.makeup);
  const accessory=catalog.find(p=>p.category==='accessories'&&p.accessory===look.accessory);
  $('#current-look-name').textContent=(makeup?.name||'自选唇色')+(look.accessory!=='none'&&accessory?' · '+accessory.name:'');
}
function setMode(next) {
  if(recordInProgress&&next!==mode)return toast('请等当前录制结束后切换展示方式');
  if(next==='photo'&&!photoReady)return toast('先上传照片并点击「分析照片，开始搭配」');
  if(mode==='mirror'&&next!=='mirror')stopMirror();
  mode=next;$('#avatar-stage').hidden=next!=='avatar';$('#photo-stage').hidden=next!=='photo';$('#mirror-stage').hidden=next!=='mirror';
  $$('#view-switch button').forEach(b=>b.classList.toggle('active',b.dataset.mode===next));
  $('#stage-mode-title').textContent={avatar:'3D 服装陈列',photo:'照片 · 保真改色',mirror:'动态试妆镜'}[next];
  $('#mode-label').textContent={avatar:'陈列人台',photo:'你的照片',mirror:'真实动作'}[next];
  $('#model-label').textContent={avatar:'服装陈列人台 · 非真人重建',photo:'原照与面料纹理保留 · 不改变款式',mirror:'妆容与配饰跟随视频中的真实动作'}[next];
  $('#stage-hint').innerHTML=next==='avatar'?`${icon('rotate')} 拖动旋转 · 滚轮缩放`:`${icon('lock')} 本机处理`;
  $('#compare').hidden=next==='avatar'||(next==='mirror'&&!liveReady);$('#reset-camera').disabled=next!=='avatar';
  comparing=false;photoEngine?.setComparison(false);mirror?.setComparison(false);$('#compare').classList.remove('active');
  splitEnabled=false;syncSplit();
  $('#compare').innerHTML=`${icon('layers')} ${next==='mirror'?'查看原视频':'查看原图'}`;
  $('#photo-mode-control').hidden=next!=='photo';
  $('.stage-body').dataset.mode=next;
  $('.motion-bar').classList.toggle('mirror-mode',next==='mirror');
  $('.motion-label').textContent=next==='mirror'?'真实动作 · 自然转头和微笑':next==='photo'?(reduceMotion()?'静态预览 · 已减少动态':'画面微动 · 非肢体动作'):'让穿搭动起来';
  for(const name of ['idle','walk','wave','turn'])$(`[data-motion="${name}"]`).disabled=next!=='avatar'&&(next==='mirror'||!photoEngine?.report?.motionAvailable||name!=='idle');
  $('[data-motion="idle"]').innerHTML=`${icon('user')} ${next==='photo'?'运镜':'呼吸'}`;
  $('[data-motion="wave"]').innerHTML=`${icon('wave')} 挥手`;
  if(next==='photo')setMotion('idle');
  $('#pause-motion').disabled=next==='mirror'&&!liveReady;
  avatar?.setPaused(paused||mode!=='avatar');photoEngine?.setPaused(paused||mode!=='photo');
  for(const key of ['clothing','shoes'])$(`[data-category="${key}"]`).disabled=next==='mirror'||(next==='photo'&&key==='shoes'&&look.photoMode!=='overlay');
  if(next==='mirror'&&!['accessories','makeup'].includes(category))$('[data-category="makeup"]').click();
  if(next==='photo'&&look.photoMode!=='overlay'&&category==='shoes')$('[data-category="clothing"]').click();
  if(next==='photo')updatePhotoLabels();
  if(next==='mirror')updateMirrorLabel();
  for(const swatch of $$('.swatches button'))swatch.disabled=next==='mirror';
  $('#show-garment').disabled=next==='mirror';
  $('#custom-color').disabled=next==='mirror';
  renderCatalog();
  syncSplit();
  window.dispatchEvent(new Event('resize'));
}
function updatePhotoLabels(){
  const recolor=look.photoMode!=='overlay';
  $('#stage-mode-title').textContent=recolor?'照片 · 保真改色':'照片 · 轮廓草图';
  $('#model-label').textContent=recolor?'保留原照、面料纹理与款式':'二维轮廓草图 · 非真实换衣';
  if(recolor)$('#current-look-name').textContent='原衣保留 · '+$('#color-label').textContent;
  if(recolor&&photoEngine?.report?.recolorAvailable===false){$('#stage-mode-title').textContent='照片 · 原照保留';$('#model-label').textContent='服装边界不可靠 · 保留原照，可继续试妆';}
  if(photoEngine?.productOverlay){$('#stage-mode-title').textContent='照片 · 商品试搭';$('#model-label').textContent='商品图片叠加 · 可微调，不代表真实贴合';}
}
async function startMirror(file){
  if(busy||recordInProgress)return toast('请等待当前处理完成');
  setMode('mirror');busy=true;$('#stage-loader').hidden=false;
  $('#stage-loader strong').textContent='准备动态试妆';
  try{
    const {LiveMirror}=await import('./live-mirror.js');
    mirror?.dispose();mirror=new LiveMirror($('#mirror-canvas'),{onStatus:status,onEnded:message=>{abortRecording?.(message);stopMirror();status(message);toast(message);}});
    mirror.setQuality?.(preferences.quality);
    mirror.setLook(look);
    if(file)await mirror.loadVideo(file);else await mirror.camera();
    liveReady=true;paused=false;$('#pause-motion').innerHTML=icon('pause');$('#pause-motion').setAttribute('aria-label','暂停动作');
    $('#mirror-canvas').hidden=false;$('#mirror-empty').hidden=true;$('#stop-mirror').hidden=false;
    $('#compare').hidden=false;$('#compare').classList.remove('active');$('#compare').innerHTML=`${icon('layers')} 查看原视频`;comparing=false;
    $('#pause-motion').disabled=false;
    syncSplit();if(reduceMotion()){paused=true;mirror.setPaused(true);updatePauseButton();}
  }catch(error){stopMirror();toast(error.name==='NotAllowedError'?'摄像头未开启，可以改用本地视频':error.message);status('动态试妆未启动，请上传视频或重新开启摄像头');}
  finally{busy=false;$('#stage-loader').hidden=true;$('#stage-loader strong').textContent='正在认识你的轮廓';}
}
function stopMirror(){
  mirror?.dispose();mirror=null;liveReady=false;
  $('#mirror-canvas').hidden=true;$('#mirror-empty').hidden=false;$('#stop-mirror').hidden=true;
  if(mode==='mirror'){$('#compare').hidden=true;$('#pause-motion').disabled=true;}
  splitEnabled=false;syncSplit();
}
function setMotion(value) {
  motion=value;avatar?.setMotion(value);photoEngine?.setMotion(value);
  $$('.motion-options button').forEach(b=>b.classList.toggle('active',b.dataset.motion===value));
}
function status(message) {const text=typeof message==='string'?message:message?.message||message?.stage||'正在识别';$('#analysis-status').textContent=text;$('#loading-text').textContent=text;}
async function upload(file) {
  if(busy||recordInProgress)return toast('正在处理或录制，请稍候再更换照片');
  const error=validateImageFile(file);if(error)return toast(error);
  busy=true;$('#generate').disabled=true;$('#clear-photo').disabled=true;
  const url=URL.createObjectURL(file), image=new Image();
  try {
    await new Promise((resolve,reject)=>{image.onload=resolve;image.onerror=reject;image.src=url;});
    if(image.naturalWidth<128||image.naturalHeight<128)throw new Error('照片太小，请选择至少 128 × 128 像素的图片');
    if(image.naturalWidth*image.naturalHeight>48000000)throw new Error('照片像素过大，请缩小到 4800 万像素以内');
    if(uploaded)URL.revokeObjectURL(uploaded.url);
    if(mode!=='avatar')setMode('avatar');
    photoReady=false;$('#view-switch [data-mode="photo"]').disabled=true;
    productStudio?.destroy();productStudio=null;photoEngine?.dispose();photoEngine=null;
    uploaded={image,url,name:file.name,file};$('#photo-thumbnail').src=url;$('#photo-thumbnail').hidden=false;
    $('#upload-placeholder').hidden=true;$('.change-photo').hidden=false;
    $('#generate').disabled=false;$('#clear-photo').disabled=false;
    status('照片已准备好 · 点击下方按钮开始识别');$('#photo-input').value='';
    toast('照片已加载，点击「分析照片，开始搭配」');
  } catch(error) {URL.revokeObjectURL(url);toast(error.message||'图片解码失败，请换一张照片');}
  finally{busy=false;$('#generate').disabled=!uploaded;$('#clear-photo').disabled=!uploaded;}
}
async function generate() {
  if(!uploaded||busy)return;if(recordInProgress)return toast('请等待录制完成');busy=true;$('#generate').disabled=true;$('#stage-loader').hidden=false;
  try {
    const {PhotoEngine}=await import('./photo-engine.js');
    productStudio?.destroy();productStudio=null;photoEngine?.dispose();photoEngine=new PhotoEngine($('#photo-canvas'),{onStatus:status});
    photoEngine.setPresentationMotion?.(!reduceMotion());
    const result=await photoEngine.load(uploaded.image);
    photoReady=true;$('#view-switch [data-mode="photo"]').disabled=false;
    photoEngine.setLook(look);photoEngine.setMotion(motion);photoEngine.setComparison(false);
    comparing=false;$('#compare').innerHTML=`${icon('layers')} 查看原图`;$('#compare').classList.remove('active');
    setMode('photo');
    const pose=result?.poseDetected??photoEngine.hasPose,face=result?.faceDetected??photoEngine.hasFace;
    if(pose||face){status(`${result.recolorAvailable?'服装纹理已识别':'服装改色暂不可用'} · ${face?'人脸已识别':'人脸未识别'}`);toast(result.recolorAvailable?'已准备好保真改色：试试不同颜色':'已保留完整原照，可预览识别成功的部位');}
    else if(result?.limitations?.some(text=>/模型不可用|运行环境加载失败/.test(text))){status('本地识别模型未就绪，请检查模型文件或重启应用');toast('当前保留原图，模型未加载成功；请查看项目运行说明');}
    else {status('未识别到有效身体或人脸，请换一张正面清晰照片');toast('当前显示原图；没有识别到人体时不会生成虚假试穿');}
  } catch(error) {status('识别未完成：'+error.message);toast('识别未完成，请重试或查看项目指南');console.error(error);}
  finally {busy=false;$('#generate').disabled=!uploaded;$('#stage-loader').hidden=true;}
}
function clearPhoto() {
  if(busy||recordInProgress)return toast('请等待当前处理或录制完成');setMode('avatar');productStudio?.destroy();productStudio=null;photoEngine?.dispose();photoEngine=null;
  if(uploaded)URL.revokeObjectURL(uploaded.url);uploaded=null;photoReady=false;
  $('#photo-thumbnail').removeAttribute('src');$('#photo-thumbnail').hidden=true;$('#upload-placeholder').hidden=false;$('.change-photo').hidden=true;
  $('#generate').disabled=true;$('#clear-photo').disabled=true;$('#view-switch [data-mode="photo"]').disabled=true;
  status('照片已从当前应用释放，可上传新照片');toast('已清除当前照片');
}
function download(url,name) {const a=document.createElement('a');a.href=url;a.download=name;a.click();}
function exportColors(){return preferences.backdrop==='ink'?{background:'#17191e',ink:'#f5f5f7',muted:'#a6a8b1'}:preferences.backdrop==='rose'?{background:'#f5ecef',ink:'#29252c',muted:'#747078'}:{background:'#f5f5f7',ink:'#1d1d1f',muted:'#74747a'};}
function capture() {
  if(recordInProgress)return toast('正在录制，请稍候');
  const data=mode==='avatar'?avatar?.capture():mode==='mirror'?mirror?.capture():photoEngine?.capture();if(!data)return toast('画面还未准备好');
  const capturedMode=mode,capturedPhotoMode=look.photoMode,capturedProduct=!!photoEngine?.productOverlay,colors=exportColors();
  const image=new Image();image.onload=()=>{
    const c=document.createElement('canvas');c.width=image.width;c.height=image.height+76;const ctx=c.getContext('2d');ctx.fillStyle=colors.background;ctx.fillRect(0,0,c.width,c.height);ctx.drawImage(image,0,0);
    ctx.fillStyle=colors.ink;ctx.font=`bold ${Math.max(14,c.width/42)}px sans-serif`;ctx.fillText('映身 YINGSHEN · '+({avatar:'3D 服装陈列',mirror:'真实视频试妆',photo:capturedProduct?'商品图片试搭':capturedPhotoMode==='overlay'?'轮廓草图':'原衣改色'}[capturedMode]),22,c.height-43);
    ctx.fillStyle=colors.muted;ctx.font='12px sans-serif';ctx.fillText('风格预览 · 非真实尺码 / 布料仿真',22,c.height-19);
    download(c.toDataURL('image/png'),`映身-搭配-${Date.now()}.png`);toast('搭配画面已导出');
  };image.src=data;
}
async function recordVideo() {
  if(recordInProgress)return;
  if(mode==='mirror'&&!liveReady)return toast('请先开启摄像头或上传视频');
  const canvas=mode==='avatar'?$('#avatar-stage canvas'):mode==='mirror'?$('#mirror-canvas'):$('#photo-canvas');
  if(!canvas?.captureStream||!window.MediaRecorder)return toast('当前浏览器不支持录制，请使用最新版 Edge 或 Chrome');
  const mime=['video/webm;codecs=vp9','video/webm;codecs=vp8','video/webm'].find(t=>MediaRecorder.isTypeSupported(t));
  if(!mime)return toast('当前浏览器不支持 WebM 录制，仍可导出图片');
  let stream,recorder,frameTimer,countdown,recording,recordingError=null;const previousPaused=paused;
  try {
    // Draw to an independent 2D capture surface. This also records a solid
    // background and provenance label, and works when the WebGL canvas is
    // partially outside the viewport (where browser capture can skip frames).
    recording=document.createElement('canvas');
    const ratio=Math.min(1,960/canvas.width,1080/canvas.height);
    recording.width=Math.max(2,Math.round(canvas.width*ratio/2)*2);
    recording.height=Math.max(2,Math.round(canvas.height*ratio/2)*2)+56;
    recording.className='recording-preview';
    recording.setAttribute('aria-label','正在录制的实时预览');
    document.body.appendChild(recording);
    const ctx=recording.getContext('2d');
    const recordedMode=mode,colors=exportColors();
    const label={avatar:'3D 服装陈列',photo:'照片运镜 · 非肢体动作',mirror:'真实视频 · 动态试妆'}[recordedMode];
    const paint=()=>{ctx.fillStyle=colors.background;ctx.fillRect(0,0,recording.width,recording.height);ctx.drawImage(canvas,0,0,recording.width,recording.height-56);ctx.fillStyle=colors.ink;ctx.font='14px sans-serif';ctx.fillText(`映身 YINGSHEN · ${label}`,18,recording.height-28);ctx.font='10px sans-serif';ctx.fillStyle=colors.muted;ctx.fillText('风格预览 · 非真实尺码 / 布料仿真',18,recording.height-11);};
    paint();stream=recording.captureStream(24);recorder=new MediaRecorder(stream,{mimeType:mime});const chunks=[];
    recordInProgress=true;$('#record-video').disabled=true;
    abortRecording=message=>{recordingError=message;if(recorder.state!=='inactive')recorder.stop();};
    recorder.onerror=e=>abortRecording?.(e.error?.message||'浏览器视频编码失败');
    if(paused)$('#pause-motion').click();
    recorder.ondataavailable=e=>{if(e.data.size)chunks.push(e.data);};
    recorder.onstop=()=>{clearInterval(frameTimer);clearInterval(countdown);recording.remove();const blob=new Blob(chunks,{type:mime});stream.getTracks().forEach(t=>t.stop());recordInProgress=false;abortRecording=null;$('#record-video').disabled=false;$('#record-video').innerHTML=`${icon('video')} 录制 6 秒动作`;if(previousPaused&&!paused)$('#pause-motion').click();if(recordingError)return toast('录制中断：'+recordingError);if(blob.size<1000)return toast('没有录到有效画面，请保持此页面可见后重试');const url=URL.createObjectURL(blob);download(url,`映身-动作预览-${Date.now()}.webm`);setTimeout(()=>URL.revokeObjectURL(url),10000);toast('6 秒动态预览已导出为 WebM 视频');};
    recorder.start(250);frameTimer=setInterval(()=>{paint();stream.getVideoTracks()[0]?.requestFrame?.();},1000/24);toast('开始录制当前画面，可继续旋转或更换单品');
    let seconds=6;$('#record-video').textContent=`● 录制中 ${seconds}s`;countdown=setInterval(()=>{seconds--;$('#record-video').textContent=`● 录制中 ${seconds}s`;if(seconds<=0){clearInterval(countdown);if(recorder.state!=='inactive')recorder.stop();}},1000);
  } catch(e){clearInterval(frameTimer);clearInterval(countdown);recording?.remove();stream?.getTracks().forEach(t=>t.stop());recordInProgress=false;abortRecording=null;$('#record-video').disabled=false;$('#record-video').innerHTML=`${icon('video')} 录制 6 秒动作`;toast('录制失败：'+e.message);}
}
function saveLook() {
  if(saved.length>=24)return toast('已收藏 24 套，请在「搭配」中删除一些后重试');
  saved.unshift({id:crypto.randomUUID(),look:{...look},name:$('#current-look-name').textContent,date:new Date().toLocaleDateString('zh-CN')});
  if(persistSaved())toast('已收藏搭配 · 仅保存单品设置，不保存你的照片');
}
function showSaved() {
  showDialog('我的搭配',`<p class="dialog-lead">给灵感取个名字，也可以带到另一台设备。只保存搭配参数。</p><div class="saved-actions"><button id="import-collection" class="save-button">${icon('upload')} 导入搭配</button><button id="export-collection" class="save-button" ${saved.length?'':'disabled'}>${icon('download')} 导出收藏</button><span>${saved.length} / 24 套</span></div><div class="saved-grid">${saved.length?saved.map(s=>`<article class="saved-card">${productArt(s.look.garment,s.look.color)}<input class="rename-look" data-rename-look="${s.id}" value="${escapeHTML(s.name||'我的搭配')}" maxlength="50" aria-label="搭配名称"><span>${escapeHTML(s.date||'')}</span><div><button data-load-look="${s.id}" class="small-primary">应用搭配</button><button data-delete-look="${s.id}" class="icon-button" aria-label="删除此搭配">${icon('trash')}</button></div></article>`).join(''):'<div class="empty-saved">还没有收藏。<br>在试穿空间搭配后，点击「收藏搭配」。</div>'}</div>`);
}
function exportCollection(){if(!saved.length)return;const url=URL.createObjectURL(new Blob([serializeLookCollection(saved)],{type:'application/json'}));download(url,`映身-搭配收藏-${new Date().toISOString().slice(0,10)}.json`);setTimeout(()=>URL.revokeObjectURL(url),10000);toast('收藏已导出，不包含照片或视频');}
async function importCollection(file){
  if(!file)return;
  try{if(file.size>65536)throw new Error('搭配文件超过 64 KB');const items=parseLookCollection(await file.text());if(saved.length+items.length>24)throw new Error(`最多保存 24 套，请先删除 ${saved.length+items.length-24} 套后重试`);saved.unshift(...items.map(item=>({...item,id:crypto.randomUUID(),date:new Date().toLocaleDateString('zh-CN')})));if(persistSaved())toast(`已导入 ${items.length} 套搭配`);if($('#content-dialog').open)$('#content-dialog').close();showSaved();}catch(error){toast(error.message||'导入失败');}finally{$('#collection-input').value='';}
}
function showGuide() {
  showDialog('映身 · 看见另一种可能',`
    <div class="guide-banner"><span>YINGSHEN / OPC PROJECT · 0.4</span><h3>从「想象合不合适」<br>到「先看见，再选择」。</h3></div>
    <p class="dialog-lead">面向网购场景的数字媒体交互原型。选择 AI 服装试穿、照片改色、动态试妆或 3D 搭配，按当前服务能力体验。</p>
    <div class="guide-steps"><article><b>01</b><h4>AI 服装试穿</h4><p>打开「AI 试穿与动作」，准备人物与商品两张图片。按服务支持的类型选择平铺商品图或模特图，提交后可查看进展、取消任务、恢复记录及下载结果。</p></article><article><b>02</b><h4>照片与动态试妆</h4><p>主工作台可分析照片，给原有上衣改色。动态试妆支持本地视频或摄像头，唇妆、腮红、眼镜与耳饰随清晰单人脸移动，并可暂停比较。</p></article><article><b>03</b><h4>观察与分享</h4><p>3D 陈列人台支持漫步、挥手和转身，可搭配示意衣服、鞋履与配饰。收藏搭配、导出 PNG，或录制 6 秒 WebM 视频。</p></article></div>
    <div class="capability-note"><h4>更自在地试一试</h4><p>用撤销与重做比较搭配，用左右分屏观察照片和试妆变化。点击「专注预览」放大画面，收藏可以重命名、导入和导出。右上角设置支持深浅主题、三档画质、背景与减少动态。</p><h4>这一版，真实做到什么</h4><p><strong>AI 服装试穿：</strong>已接入本机模型，可上传人物与平铺商品图生成试穿；复杂纹理和衣物细节仍可能改变。当前面向衣服，不承诺鞋履、饰品和化妆品都能通过商品图生成。未连接服务时可以准备图片，不能生成；只有真实任务返回并校验后才显示结果。</p><p><strong>照片与动作：</strong>主工作台默认只改变原衣颜色，不改变款式；复杂印花识别不可靠时保留原照。「轮廓草图」是二维覆盖，轻微运镜不是肢体动作。AI 照片动作支持自带视频的小幅体态实验；可用视频首帧作人物照，让姿态更接近。当前输出约 3 秒、8fps、256p，不适合完整走秀或转身。</p><p><strong>3D 与实时试妆：</strong>仍可直接使用。3D 是连续蒙皮陈列人台，不是照片重建的本人。视频跟踪适用于清晰单人脸；大幅转头、遮挡和光线变化仍可能影响配饰贴合。所有预览用于外观探索，不能确认真实尺码或面料垂坠。</p></div>
    <div class="capability-note"><h4>自己的商品，继续搭配</h4><p>点击「上传自己的鞋饰 / 色卡」，将眼镜、耳饰、项链或单只鞋的商品图放到已识别的位置；支持透明图片、去白底和手动微调。色卡可以点击或用键盘取色。此入口是二维图片试搭，不移除照片中的原商品，不代表真实贴合。</p><p>AI 试穿结果可点击「继续搭配鞋饰」直接带入工作台，原衣改色会自动关闭以保留生成的衣服。照片动作也可直接使用「轻微姿态 · 实验」预设，无需额外上传视频；输出 3 秒、8fps、256p，面部仍可能柔化，不保证身份与纹理保持。</p></div>
    <div class="guide-tech"><span>复用开源基础</span><a href="https://github.com/mrdoob/three.js" target="_blank" rel="noreferrer">Three.js · MIT ↗</a><a href="https://github.com/google-ai-edge/mediapipe" target="_blank" rel="noreferrer">MediaPipe · Apache-2.0 ↗</a><a href="https://github.com/Zheng-Chong/CatVTON" target="_blank" rel="noreferrer">CatVTON · CC BY-NC-SA 4.0 ↗</a><a href="https://github.com/yoyo-nb/Thin-Plate-Spline-Motion-Model" target="_blank" rel="noreferrer">TPS Motion · MIT ↗</a></div>
    <p class="dialog-footnote">隐私：主工作台改色、试妆与摄像头画面在浏览器处理；离开动态试妆会关闭摄像头。AI 生成点击提交后交给已配置服务处理，本机或远程处理方式会在按钮旁说明。生成结果暂存在本机并自动过期，浏览器只记任务编号；搭配收藏只保存参数。</p><p class="dialog-footnote">清晰样片为 AI 生成的虚构成年模特，已标注「AI 示例」。复杂背景样片：Kwaku Berko · <a href="https://commons.wikimedia.org/wiki/File:Fashion_runway2.jpg" target="_blank" rel="noreferrer">Fashion runway2</a> · CC0，保留用于观察困难输入的边界。</p>`);
}

renderCatalog();
$('#avatar-stage').addEventListener('stageerror',e=>toast(e.detail));
async function initializeAvatar(){
  const pending=document.createElement('div');pending.className='avatar-loading';pending.innerHTML='<span class="spinner"></span><span>准备你的陈列空间…</span>';$('#avatar-stage').append(pending);
  try{const {AvatarStage}=await import('./avatar.js');avatar=new AvatarStage($('#avatar-stage'));avatar.setLook(look);avatar.setMotion(motion);applyPreferences();await avatar.ready;}
  catch(error){$('#avatar-stage').innerHTML='<div class="webgl-error">3D 暂时不可用，请检查浏览器硬件加速。<br>仍可使用照片和视频试妆。</div>';console.error(error);}
  finally{pending.remove();}
}
applyPreferences();initializeAvatar();
$('#photo-input').addEventListener('change',e=>upload(e.target.files[0]));
$('#upload-zone').addEventListener('click',()=>{if(!busy)$('#photo-input').click();});
$('#upload-zone').addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();$('#photo-input').click();}});
$('#upload-zone').addEventListener('dragover',e=>{e.preventDefault();$('#upload-zone').classList.add('dragover');});
$('#upload-zone').addEventListener('dragleave',()=>$('#upload-zone').classList.remove('dragover'));
$('#upload-zone').addEventListener('drop',e=>{e.preventDefault();$('#upload-zone').classList.remove('dragover');upload(e.dataTransfer.files[0]);});
$('#generate').addEventListener('click',generate);
async function loadDemo(url,name,type){try{const response=await fetch(url);if(!response.ok)throw new Error();await upload(new File([await response.blob()],name,{type}));}catch{toast('示例照片暂不可用，请上传自己的照片');}}
$('#demo-photo').addEventListener('click',()=>loadDemo('/demo/studio-model-v2.png','AI-清晰测试样片.png','image/png'));
$('#legacy-demo-photo').addEventListener('click',()=>loadDemo('/demo/fashion-runway2.jpg','CC0-Fashion-runway2.jpg','image/jpeg'));
$('#photo-render-mode').addEventListener('change',e=>{look.photoMode=e.target.value;updateLook();setMode('photo');});
$('#start-camera').addEventListener('click',()=>startMirror());
$('#choose-video').addEventListener('click',()=>$('#video-input').click());
$('#video-input').addEventListener('change',e=>{if(e.target.files[0])startMirror(e.target.files[0]);e.target.value='';});
$('#stop-mirror').addEventListener('click',()=>{if(recordInProgress)return toast('请等待录制结束');stopMirror();status('视频已关闭，摄像头资源已释放');});
$('#clear-photo').addEventListener('click',clearPhoto);
$('#search-products').addEventListener('input',renderCatalog);
$('.category-tabs').addEventListener('click',e=>{const b=e.target.closest('[data-category]');if(!b)return;category=b.dataset.category;$$('[data-category]').forEach(el=>{el.classList.toggle('active',el===b);el.setAttribute('aria-selected',String(el===b));});$('#search-products').value='';renderCatalog();});
$('#product-grid').addEventListener('click',e=>{const b=e.target.closest('[data-product]');if(!b)return;const p=catalog.find(p=>p.id===b.dataset.product);activeProduct=p.id;look=applyProduct(look,p);updateLook();if(mode==='photo'){if(p.category==='shoes'&&!photoEngine?.feetDetected)toast('当前照片脚部不清晰，鞋履不会覆盖；可切换 3D 查看此搭配');else if(p.category==='clothing'&&!photoEngine?.hasPose)toast('当前照片未识别到完整身体，服装不会覆盖');else if((p.category==='makeup'||p.category==='accessories')&&!photoEngine?.hasFace)toast('当前照片未识别到清晰人脸，面部效果未启用');}});
$('.swatches').addEventListener('click',e=>{const b=e.target.closest('[data-color]');if(b){look.color=b.dataset.color;updateLook();}});
$('#makeup-intensity').addEventListener('input',e=>{look.makeupIntensity=Number(e.target.value)/100;updateLook({group:'intensity'});});
$('#custom-color').addEventListener('input',e=>{look.color=e.target.value;updateLook({group:'custom-color'});});
$('#show-garment').addEventListener('change',e=>{look.showGarment=e.target.checked;updateLook();});
$('#view-switch').addEventListener('click',e=>{const b=e.target.closest('[data-mode]');if(b&&!b.disabled){if(busy)return toast('请等待当前加载完成');setMode(b.dataset.mode);}});
$('.motion-options').addEventListener('click',e=>{const b=e.target.closest('[data-motion]');if(b&&!b.disabled)setMotion(b.dataset.motion);});
$('#pause-motion').addEventListener('click',()=>{paused=!paused;avatar?.setPaused(paused||mode!=='avatar');photoEngine?.setPaused(paused||mode!=='photo');mirror?.setPaused(paused);updatePauseButton();});
$('#reset-camera').addEventListener('click',()=>avatar?.resetCamera());
$('#compare').addEventListener('click',()=>{splitEnabled=false;syncSplit();comparing=!comparing;if(mode==='mirror')mirror?.setComparison(comparing);else photoEngine?.setComparison(comparing);$('#compare').classList.toggle('active',comparing);$('#compare').innerHTML=`${icon('layers')} ${comparing?'返回效果':mode==='mirror'?'查看原视频':'查看原图'}`;});
$('#split-toggle').addEventListener('click',()=>{splitEnabled=!splitEnabled;comparing=false;photoEngine?.setComparison(false);mirror?.setComparison(false);$('#compare').classList.remove('active');$('#compare').innerHTML=`${icon('layers')} ${mode==='mirror'?'查看原视频':'查看原图'}`;syncSplit();});
$('#comparison-position').addEventListener('input',e=>{splitPosition=Number(e.target.value)/100;syncSplit();});
$('#undo-look').addEventListener('click',()=>changeHistory('undo'));$('#redo-look').addEventListener('click',()=>changeHistory('redo'));
$('#reset-look').addEventListener('click',()=>{look={...defaultLook};updateLook();toast('已恢复默认搭配，可撤销');});
$('#focus-stage').addEventListener('click',toggleFocus);
$('#studio-settings').addEventListener('click',showSettings);
async function continueGeneratedLook(file){
  await upload(file);
  if(uploaded?.file!==file)throw new Error('工作台正在处理其他任务，请稍后载入。');
  look.showGarment=false;look.photoMode='recolor';updateLook();
  await generate();
  if(!photoReady)throw new Error('照片分析未完成，可以在工作台重新分析。');
  $('#own-product').click();
}
$('#ai-tryon').addEventListener('click',async()=>{
  if(openingGeneration||busy||recordInProgress)return toast('请等待当前处理完成');
  openingGeneration=true;
  try{
    if(!generationStudio){const {mountGenerationStudio}=await import('./generation-studio.js');generationStudio=mountGenerationStudio({getPersonFile:()=>uploaded?.file,onUseResult:continueGeneratedLook});generationStudio.element.addEventListener('close',()=>{avatar?.setPaused(paused||mode!=='avatar');photoEngine?.setPaused(paused||mode!=='photo');mirror?.setPaused(paused);});}
    avatar?.setPaused(true);photoEngine?.setPaused(true);mirror?.setPaused(true);
    await generationStudio.open();
  }catch(error){toast(error.message||'生成工作台暂时无法打开');avatar?.setPaused(paused||mode!=='avatar');photoEngine?.setPaused(paused||mode!=='photo');mirror?.setPaused(paused);}
  finally{openingGeneration=false;}
});
$('#own-product').addEventListener('click',async()=>{
  if(openingProduct||busy||recordInProgress)return toast('请等待当前处理完成');
  if(!uploaded)return toast('先上传一张人物照片，再来试搭自己的商品');
  openingProduct=true;
  try{
    if(!photoReady)await generate();
    if(!photoReady||!photoEngine)return;
    setMode('photo');
    if(!productStudio){const {mountProductStudio}=await import('./product-studio.js');productStudio=mountProductStudio({getEngine:()=>photoEngine,onMakeup:color=>{look.makeup=color;if(!look.makeupIntensity)look.makeupIntensity=.35;updateLook({group:'product-color'});},onClose:()=>{photoEngine?.setPaused(paused||mode!=='photo');updatePhotoLabels();}});}
    photoEngine.setPaused(true);productStudio.open();
  }catch(error){toast(error.message||'商品试搭暂时无法打开');}
  finally{openingProduct=false;if(!productStudio?.element.open)photoEngine?.setPaused(paused||mode!=='photo');}
});
$('#theme-toggle').addEventListener('click',()=>{preferences.theme=document.documentElement.dataset.theme==='dark'?'light':'dark';applyPreferences({persist:true});});
systemDark.addEventListener('change',()=>{if(preferences.theme==='system')applyPreferences();});systemMotion.addEventListener('change',()=>{if(preferences.motion==='system')applyPreferences();});
$('#save-look').addEventListener('click',saveLook);
$('#export-photo').addEventListener('click',capture);
$('#record-video').addEventListener('click',recordVideo);
$('#guide-button').addEventListener('click',showGuide);
$$('[data-nav]').forEach(b=>b.addEventListener('click',()=>{if(b.dataset.nav==='saved')showSaved();else if(b.dataset.nav==='guide')showGuide();else if($('#content-dialog').open)$('#content-dialog').close();}));
$('#close-dialog').addEventListener('click',()=>$('#content-dialog').close());
$('#content-dialog').addEventListener('click',e=>{if(e.target===$('#content-dialog'))$('#content-dialog').close();});
$('#dialog-body').addEventListener('click',e=>{const load=e.target.closest('[data-load-look]'),del=e.target.closest('[data-delete-look]');if(load){const s=saved.find(s=>s.id===load.dataset.loadLook);if(s){look=sanitizeLook(s.look);updateLook();$('#content-dialog').close();toast('已应用收藏搭配');}}if(del){saved=saved.filter(s=>s.id!==del.dataset.deleteLook);persistSaved();$('#content-dialog').close();showSaved();}if(e.target.closest('#export-collection'))exportCollection();if(e.target.closest('#import-collection'))$('#collection-input').click();});
$('#dialog-body').addEventListener('change',e=>{const keys={'theme-setting':'theme','quality-setting':'quality','motion-setting':'motion','backdrop-setting':'backdrop'},key=keys[e.target.id];if(key){preferences=sanitizePreferences({...preferences,[key]:e.target.value});applyPreferences({persist:true});}const id=e.target.dataset.renameLook;if(id){const s=saved.find(s=>s.id===id);if(s){s.name=safeLookName(e.target.value);e.target.value=s.name;if(persistSaved())toast('搭配名称已保存');}}});
$('#collection-input').addEventListener('change',e=>importCollection(e.target.files[0]));
document.addEventListener('keydown',e=>{if(e.defaultPrevented||e.isComposing||e.target.isContentEditable||/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)||$('#content-dialog').open)return;const key=e.key.toLowerCase();if((e.ctrlKey||e.metaKey)&&key==='z'){e.preventDefault();changeHistory(e.shiftKey?'redo':'undo');}else if((e.ctrlKey||e.metaKey)&&key==='y'){e.preventDefault();changeHistory('redo');}else if((e.ctrlKey||e.metaKey)&&key==='s'){e.preventDefault();saveLook();}else if(!e.ctrlKey&&!e.metaKey&&!e.altKey&&key==='f'){e.preventDefault();toggleFocus();}else if(e.code==='Space'&&!e.target.closest('button,a,[role="button"]')){e.preventDefault();$('#pause-motion').click();}else if(e.key==='Escape'&&focused){toggleFocus();}});
window.addEventListener('beforeunload',()=>{if(uploaded)URL.revokeObjectURL(uploaded.url);photoEngine?.dispose();avatar?.dispose();mirror?.dispose();});
window.__YINGSHEN__={getState:()=>({look:{...look},mode,motion,paused,photoReady,liveReady,liveFace:!!mirror?.hasFace,liveSource:mirror?.source||null,avatarReady:!!avatar?.model?.ready,hasPose:!!photoEngine?.hasPose,hasFace:!!photoEngine?.hasFace,segmentationAvailable:!!photoEngine?.report?.segmentationAvailable,feetDetected:!!photoEngine?.feetDetected,photoReport:photoEngine?.report||null,saved:saved.length,canUndo:history.canUndo,canRedo:history.canRedo,preferences:{...preferences},splitEnabled,splitPosition,focused,avatarPerformance:avatar?.getPerformanceStats?.()||null,visionPerformance:mirror?.getPerformanceStats?.()||photoEngine?.getPerformanceStats?.()||null}),ready:()=>!!avatar?.model?.ready};
