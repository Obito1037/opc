import { FaceLandmarker, FilesetResolver, PoseLandmarker, ImageSegmenter } from '@mediapipe/tasks-vision';
import { prepareRecolor, drawRecolor } from './photo-recolor.js';
import { getProductAnchors, normalizeProductOverlay, drawProductOverlay } from './product-overlay.js';

// Local inference only. The original image never leaves the browser.
// Clothing segmentation only controls fabric recolouring; it never cuts out the person.
const MODEL_PATHS = {
  pose: '/models/pose_landmarker_lite.task',
  face: '/models/face_landmarker.task',
  clothing: '/models/selfie_multiclass_256x256.tflite',
};
const STUDIO_COLOR = '#f5f5f7';
const clamp = (v, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, v));
const mix = (a, b, t) => a + (b - a) * t;
const pointMix = (a, b, t) => ({ x: mix(a.x, b.x, t), y: mix(a.y, b.y, t) });
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const nextFrame = () => new Promise(resolve => requestAnimationFrame(resolve));
const makeCanvas = (w, h) => {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
};
function path(ctx, points, close = true) {
  ctx.beginPath();
  points.forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y));
  if (close) ctx.closePath();
}
function validPoint(p, threshold = .5) {
  return p && p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1 &&
    (p.visibility ?? 1) >= threshold && (p.presence ?? 1) >= threshold;
}
/**
 * Local texture-preserving colour preview. This is not a reconstructed 3D human,
 * a generative clothing replacement model, or a physical fit estimator.
 */
export class PhotoEngine {
  constructor(canvas, { onStatus } = {}) {
    this.canvas = canvas;
    // CSS sizing must be independent of the bitmap dimensions; width:auto
    // otherwise feeds the resized bitmap aspect ratio back into ResizeObserver.
    this.previousCanvasStyle = { width: canvas.style.width, height: canvas.style.height };
    canvas.style.width = '100%'; canvas.style.height = '100%';
    this.ctx = canvas.getContext('2d', { alpha: true });
    this.onStatus = onStatus || (() => {});
    this.look = { garment: 'shirt', color: '#899a7b', shoe: 'sneakers',
      accessory: 'earrings', makeup: '#a34f59', makeupIntensity: .45, showGarment: true, photoMode: 'recolor' };
    this.hasPose = false; this.hasFace = false; this.feetDetected = false;
    this.motion = 'idle'; this.paused = false; this.comparison = false;
    this.splitComparison = null; this.presentationMotion = true; this.compositeDirty = false;
    this.productOverlay = null; this.productPose = null;
    this.stats = { compositeRebuilds: 0, fabricRebuilds: 0, renderedFrames: 0 };
    this.time = 0; this.lastFrame = 0; this.disposed = false; this.loadId = 0;
    this.triangles = []; this.vertices = []; this.bones = [];
    this.resizeObserver = new ResizeObserver(() => { this.resizePending = true; });
    this.resizeObserver.observe(canvas);
    this.tick = this.tick.bind(this);
    this.raf = requestAnimationFrame(this.tick);
  }

  status(phase, message, progress) {
    if (!this.disposed) this.onStatus({ phase, message, progress });
  }

  async initModels() {
    if (this.modelPromise) return this.modelPromise;
    this.modelPromise = (async () => {
      const files = await FilesetResolver.forVisionTasks('/mediapipe');
      const results = await Promise.allSettled([
        PoseLandmarker.createFromOptions(files, {
          baseOptions: { modelAssetPath: MODEL_PATHS.pose, delegate: 'CPU' },
          runningMode: 'IMAGE', numPoses: 1, outputSegmentationMasks: true,
          minPoseDetectionConfidence: .5, minPosePresenceConfidence: .5,
        }),
        FaceLandmarker.createFromOptions(files, {
          baseOptions: { modelAssetPath: MODEL_PATHS.face, delegate: 'CPU' },
          runningMode: 'IMAGE', numFaces: 1,
          outputFaceBlendshapes: false, outputFacialTransformationMatrixes: false,
        }),
        ImageSegmenter.createFromOptions(files, {
          baseOptions: { modelAssetPath: MODEL_PATHS.clothing, delegate: 'CPU' },
          runningMode: 'IMAGE', outputConfidenceMasks: true, outputCategoryMask: false,
        }),
      ]);
      this.modelErrors = [];
      for (let i = 0; i < results.length; i++) {
        const r = results[i], key = ['poseModel', 'faceModel', 'clothingModel'][i];
        if (r.status === 'fulfilled') {
          if (this.disposed) r.value.close();
          else this[key] = r.value;
        } else this.modelErrors.push(`${['人体', '人脸', '服装'][i]}识别模型不可用`);
      }
    })();
    return this.modelPromise;
  }

  async load(imageElement) {
    const id = ++this.loadId;
    this.hasPose = this.hasFace = this.feetDetected = false;
    this.pose = this.face = this.mask = this.recolor = null;
    this.productOverlay = this.productPose = null;
    this.fabricKey = null; this.compositeDirty = false;
    this.triangles = []; this.vertices = []; this.bones = [];
    const imageW = imageElement.naturalWidth || imageElement.width;
    const imageH = imageElement.naturalHeight || imageElement.height;
    if (!imageW || !imageH) throw new Error('图片尚未解码，请重新选择照片。');
    // Bound memory, inference cost and export size even for large phone photos.
    const ratio = Math.min(1, 1280 / Math.max(imageW, imageH));
    // Float segmentation rows need 16-byte alignment in the bundled native
    // runtime. A non-multiple-of-four width can abort CopyToBuffer (upstream
    // google-ai-edge/mediapipe#6331); align by at most three pixels.
    this.width = Math.max(4, Math.round(imageW * ratio / 4) * 4);
    this.height = Math.max(4, Math.round(imageH * ratio));
    this.original = makeCanvas(this.width, this.height);
    this.original.getContext('2d').drawImage(imageElement, 0, 0, this.width, this.height);
    this.composite = makeCanvas(this.width, this.height);
    this.composite.getContext('2d').drawImage(this.original, 0, 0);
    this.render();
    this.status('loading', '正在加载本地人体、人脸与衣物分割模型…', .15);
    const warnings = [];
    try { await this.initModels(); }
    catch (error) {
      console.warn('Local MediaPipe initialization failed:', error);
      warnings.push('识别运行环境加载失败，请检查本地模型和 WASM 文件。');
    }
    if (this.disposed || id !== this.loadId) return { cancelled: true };
    warnings.push(...(this.modelErrors || []));
    this.status('detecting', '正在分析真实人体关键点、面部与人物轮廓…', .5);
    await nextFrame();
    let poseResult;
    try {
      if (this.poseModel) {
        poseResult = this.poseModel.detect(this.original);
        const landmarks = poseResult.landmarks[0];
        // Product anchors are validated individually: a portrait may contain
        // reliable ears/shoulders while cropped hips correctly disable clothes.
        if (landmarks) this.productPose = landmarks.map(p => ({ ...p, x: p.x * this.width, y: p.y * this.height }));
        // Cropped or undetected joints must not be presented as detected feet/body.
        this.hasPose = !!landmarks && [11, 12, 23, 24].every(i => validPoint(landmarks[i]));
        if (this.hasPose) {
          this.pose = landmarks.map(p => ({ ...p, x: p.x * this.width, y: p.y * this.height }));
          this.feetDetected = [27, 28, 29, 30, 31, 32].every(i => validPoint(landmarks[i]));
          const mpMask = poseResult.segmentationMasks?.[0];
          if (mpMask) this.makeMask(mpMask);
        }
      }
    } catch (error) {
      console.warn('Pose detection failed:', error);
      warnings.push('人体识别未完成，服装与动作预览暂不可用。');
    } finally { poseResult?.close(); }
    await nextFrame();
    if (this.disposed || id !== this.loadId) return { cancelled: true };
    try {
      if (this.faceModel) {
        // Full-body photos make a face too small for the short-range detector.
        // When a body exists, inspect that person's head, which also prevents
        // a poster or a bystander from receiving the selected person's makeup.
        let faceInput = this.original, region = { x: 0, y: 0, w: this.width, h: this.height };
        if (this.hasPose && (this.pose[0].visibility ?? 0) > .5) {
          const nose = this.pose[0], shoulderWidth = distance(this.pose[11], this.pose[12]);
          const half = Math.max(24, shoulderWidth * .7);
          region.x = clamp(nose.x - half, 0, this.width - 1);
          region.y = clamp(nose.y - half, 0, this.height - 1);
          region.w = Math.min(half * 2, this.width - region.x);
          region.h = Math.min(half * 2, this.height - region.y);
          faceInput = makeCanvas(512, 512);
          faceInput.getContext('2d').drawImage(this.original, region.x, region.y, region.w, region.h, 0, 0, 512, 512);
        }
        const result = this.faceModel.detect(faceInput);
        this.hasFace = !!result.faceLandmarks[0]?.length;
        if (this.hasFace) this.face = result.faceLandmarks[0].map(p => ({
          ...p, x: region.x + p.x * region.w, y: region.y + p.y * region.h,
        }));
        if (faceInput !== this.original) faceInput.width = faceInput.height = 1;
      }
    } catch (error) {
      console.warn('Face detection failed:', error);
      warnings.push('人脸识别未完成，妆容与面部配饰暂不可用。');
    }
    if (this.disposed || id !== this.loadId) return { cancelled: true };
    if (this.clothingModel && this.hasPose) {
      this.status('detecting', '正在分离真实衣物与皮肤，保留面料褶皱和原图光影…', .8);
      await nextFrame();
      let clothingResult;
      try {
        clothingResult = this.clothingModel.segment(this.original);
        const labels = this.clothingModel.getLabels();
        const labelIndex = labels.findIndex(label => /cloth/i.test(label));
        const clothing = clothingResult.confidenceMasks?.[labelIndex >= 0 ? labelIndex : 4];
        if (clothing) this.recolor = prepareRecolor(this.original, clothing.getAsFloat32Array(), clothing.width, clothing.height, this.pose);
      } catch (error) { console.warn('Clothing segmentation failed:', error); }
      finally { clothingResult?.close(); }
    }
    if (this.disposed || id !== this.loadId) return { cancelled: true };
    if (this.hasPose && !this.recolor) warnings.push('衣物区域未可靠识别：已保留原衣服，不会用图形覆盖代替。');
    if (!this.hasPose) warnings.push('未识别到完整肩部与髋部：请使用清晰、无遮挡的单人正面全身照。');
    if (!this.hasFace) warnings.push('未识别到清晰人脸：妆容和眼镜不会自动套在猜测位置。');
    if (this.hasPose && !this.feetDetected) warnings.push('脚部不完整或被遮挡：鞋履覆盖已停用。');
    
    this.rebuild();
    this.report = {
      poseDetected: this.hasPose, faceDetected: this.hasFace,
      feetDetected: this.feetDetected, segmentationAvailable: !!this.mask,
      recolorAvailable: !!this.recolor, recolorCoverage: this.recolor?.coverage || 0,
      motionAvailable: false, presentationMotionAvailable: true, width: this.width, height: this.height,
      poseLandmarkCount: this.pose?.length || 0, faceLandmarkCount: this.face?.length || 0,
      limitations: [...warnings, '照片模式对现有上装调色，保留原有款式、面料与背景；不等于生成式换装或尺码测量。',
        '照片动效仅为轻微镜头展示，不生成肢体动作；真实动作请使用实时试妆或视频。'],
    };
    const message = this.hasPose
      ? `已识别 33 个身体关键点${this.hasFace ? '和 478 个面部关键点' : ''}${this.recolor ? '，保真面料调色已就绪' : ''}`
      : this.hasFace ? '已识别人脸，可预览妆容与面部配饰；全身动作需要完整人体照'
        : '未识别到人体或人脸，已保留原图；请换一张清晰的单人照片';
    this.status(this.hasPose || this.hasFace ? 'ready' : 'warning', message, 1);
    this.render();
    return this.report;
  }

  makeMask(mpMask) {
    const values = mpMask.getAsFloat32Array();
    const small = makeCanvas(mpMask.width, mpMask.height), ctx = small.getContext('2d');
    const pixels = ctx.createImageData(small.width, small.height);
    // Keep the main connected silhouette. Low-confidence detached regions
    // (posters, background people, stage lights) otherwise float beside it.
    const labels = new Int32Array(values.length), queue = new Int32Array(values.length);
    let component = 0, largest = 0, largestSize = 0;
    const w = small.width, h = small.height;
    for (let start = 0; start < values.length; start++) {
      if (labels[start] || values[start] < .5) continue;
      component++;
      let read = 0, end = 1;
      queue[0] = start; labels[start] = component;
      while (read < end) {
        const i = queue[read++], x = i % w;
        const neighbors = [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1,
          i >= w ? i - w : -1, i < w * (h - 1) ? i + w : -1];
        for (const n of neighbors) if (n >= 0 && !labels[n] && values[n] >= .5) {
          labels[n] = component; queue[end++] = n;
        }
      }
      if (end > largestSize) { largestSize = end; largest = component; }
    }
    for (let i = 0; i < values.length; i++) {
      pixels.data[i * 4] = pixels.data[i * 4 + 1] = pixels.data[i * 4 + 2] = 255;
      const adjacent = labels[i] === largest || (i > 0 && labels[i - 1] === largest) ||
        labels[i + 1] === largest || labels[i - w] === largest || labels[i + w] === largest;
      pixels.data[i * 4 + 3] = largest && adjacent ? clamp((values[i] - .4) / .5) * 255 : 0;
    }
    ctx.putImageData(pixels, 0, 0);
    this.mask = makeCanvas(this.width, this.height);
    this.mask.getContext('2d').drawImage(small, 0, 0, this.width, this.height);
    small.width = small.height = 1;
  }

  setLook(look = {}) {
    const before = JSON.stringify(this.look);
    const validEnums = { garment: ['shirt', 'jacket', 'dress'], shoe: ['sneakers', 'boots'],
      accessory: ['none', 'glasses', 'earrings', 'necklace'], photoMode: ['recolor', 'overlay'] };
    for (const [key, valid] of Object.entries(validEnums)) {
      if (valid.includes(look[key])) this.look[key] = look[key];
    }
    for (const key of ['color', 'makeup']) if (/^#[0-9a-f]{6}$/i.test(look[key])) this.look[key] = look[key];
    if (Number.isFinite(look.makeupIntensity)) this.look.makeupIntensity = clamp(look.makeupIntensity);
    if (typeof look.showGarment === 'boolean') this.look.showGarment = look.showGarment;
    if (before !== JSON.stringify(this.look)) this.compositeDirty = true;
  }

  setMotion(motion) {
    if (['idle', 'walk', 'wave', 'turn'].includes(motion)) this.motion = motion;
    if (this.original)
      this.status('ready', '照片使用保真镜头动效；真实肢体动作请使用实时试妆或视频，单张照片不生成背面', 1);
    this.render();
  }
  setPaused(paused) { this.paused = !!paused; this.lastFrame = 0; this.render(); }
  setComparison(comparison) { this.comparison = !!comparison; this.render(); }
  setSplitComparison(value) {
    this.splitComparison = Number.isFinite(value) ? clamp(value) : null; this.render();
  }
  setPresentationMotion(value) {
    this.presentationMotion = !!value; this.time = 0; this.lastFrame = 0; this.render();
  }
  capture() { this.render(); return this.original ? this.canvas.toDataURL('image/png') : null; }
  getPerformanceStats() { return { ...this.stats, backend: 'cached-canvas', presentationMotion: this.presentationMotion }; }

  productGeometry() { return { face: this.face, pose: this.productPose || this.pose, width: this.width, height: this.height }; }
  setProductOverlay(options) {
    if (this.disposed) return { available: false, message: '照片预览已关闭。' };
    this.productOverlay = normalizeProductOverlay(options);
    this.compositeDirty = true;
    return this.getProductAnchorStatus(this.productOverlay.type);
  }
  clearProductOverlay() {
    if (!this.productOverlay) return;
    this.productOverlay = null; this.compositeDirty = true;
  }
  getProductAnchorStatus(type = this.productOverlay?.type) {
    if (!this.original || this.disposed) return { available: false, message: '请先上传清晰的人物照片。' };
    const { available, message } = getProductAnchors(this.productGeometry(), type);
    return { available, message };
  }
  getProductPreviewCanvas() {
    if (!this.original || this.disposed) return null;
    if (this.compositeDirty) this.rebuild();
    return this.composite;
  }

  rebuild() {
    if (!this.original || this.disposed) return;
    this.compositeDirty = false; this.stats.compositeRebuilds++;
    const fabricKey = JSON.stringify([this.look.photoMode, this.look.showGarment,
      this.look.color, this.look.photoMode === 'overlay' ? this.look.garment : null,
      this.look.photoMode === 'overlay' ? this.look.shoe : null, this.productOverlay?.type === 'shoe']);
    if (!this.fabric) this.fabric = makeCanvas(this.width, this.height);
    if (this.fabricKey !== fabricKey) {
      this.fabric.width = this.width; this.fabric.height = this.height;
      const fabricCtx = this.fabric.getContext('2d'); fabricCtx.drawImage(this.original, 0, 0);
      this.person = this.original;
      if (this.hasPose && this.look.showGarment) {
        if (this.look.photoMode === 'overlay') this.drawGarment(fabricCtx);
        else drawRecolor(fabricCtx, this.recolor, this.look.color);
      }
      if (this.look.photoMode === 'overlay' && this.hasPose && this.feetDetected && this.productOverlay?.type !== 'shoe') this.drawShoes(fabricCtx);
      this.fabricKey = fabricKey; this.stats.fabricRebuilds++;
    }
    const ctx = this.composite.getContext('2d');
    ctx.clearRect(0, 0, this.width, this.height);
    ctx.drawImage(this.fabric, 0, 0);
    if (this.hasFace) this.drawMakeup(ctx);
    if (!this.productOverlay || this.productOverlay.type === 'shoe') this.drawAccessory(ctx);
    drawProductOverlay(ctx, this.productOverlay, this.productGeometry());
  }

  drawGarment(ctx) {
    const p = this.pose, left = p[11].x < p[12].x ? 11 : 12, right = left === 11 ? 12 : 11;
    const sl = p[left], sr = p[right], hl = p[left + 12], hr = p[right + 12];
    const sw = distance(sl, sr), chest = pointMix(sl, sr, .5);
    const hip = pointMix(hl, hr, .5), torso = distance(chest, hip);
    if (sw < 12 || torso < 15) return;
    const dress = this.look.garment === 'dress', jacket = this.look.garment === 'jacket';
    const hemY = Math.max(hl.y, hr.y) + torso * (dress ? .8 : .13);
    const outside = jacket ? .13 : .075;
    const neckL = pointMix(sl, sr, .32), neckR = pointMix(sl, sr, .68);
    neckL.y += sw * .01; neckR.y += sw * .01;
    const a = { x: sl.x - sw * outside, y: sl.y + sw * .025 };
    const b = { x: sr.x + sw * outside, y: sr.y + sw * .025 };
    const lowerL = { x: hl.x - sw * (dress ? .38 : .15), y: hemY };
    const lowerR = { x: hr.x + sw * (dress ? .38 : .15), y: hemY };
    ctx.save();
    const fill = ctx.createLinearGradient(a.x, a.y, b.x, hemY);
    fill.addColorStop(0, this.look.color); fill.addColorStop(.45, this.look.color); fill.addColorStop(1, this.shade(this.look.color, -.2));
    ctx.fillStyle = fill; ctx.strokeStyle = this.shade(this.look.color, -.23);
    ctx.lineWidth = Math.max(1, sw * .009); ctx.lineJoin = 'round';
    // Sleeves follow the actual upper arms instead of assuming an A-pose.
    for (const index of [left, right]) {
      const shoulder = p[index], elbow = p[index + 2], wrist = p[index + 4];
      if ((elbow.visibility ?? 0) < .45) continue;
      const endpoint = pointMix(shoulder, jacket ? wrist : elbow, jacket ? .87 : .56);
      const dx = endpoint.x - shoulder.x, dy = endpoint.y - shoulder.y, length = Math.hypot(dx, dy) || 1;
      const nx = -dy / length, ny = dx / length, radius = sw * (jacket ? .17 : .15);
      path(ctx, [
        { x: shoulder.x + nx * radius, y: shoulder.y + ny * radius },
        { x: endpoint.x + nx * radius * .78, y: endpoint.y + ny * radius * .78 },
        { x: endpoint.x - nx * radius * .78, y: endpoint.y - ny * radius * .78 },
        { x: shoulder.x - nx * radius, y: shoulder.y - ny * radius },
      ]);
      ctx.fill(); ctx.stroke();
      ctx.strokeStyle = 'rgba(255,255,255,.25)';
      path(ctx, [{ x: endpoint.x - nx * radius * .7, y: endpoint.y - ny * radius * .7 },
        { x: endpoint.x + nx * radius * .7, y: endpoint.y + ny * radius * .7 }], false);
      ctx.stroke(); ctx.strokeStyle = this.shade(this.look.color, -.23);
    }
    const waistL = { x: hl.x - sw * .075, y: mix(chest.y, hip.y, .75) };
    const waistR = { x: hr.x + sw * .075, y: waistL.y };
    ctx.beginPath(); ctx.moveTo(neckL.x, neckL.y);
    ctx.lineTo(a.x, a.y);
    ctx.quadraticCurveTo(sl.x - sw * .06, mix(sl.y, hl.y, .5), waistL.x, waistL.y);
    ctx.lineTo(lowerL.x, lowerL.y);
    ctx.quadraticCurveTo(hip.x, hemY + sw * .045, lowerR.x, lowerR.y);
    ctx.lineTo(waistR.x, waistR.y);
    ctx.quadraticCurveTo(sr.x + sw * .06, mix(sr.y, hr.y, .5), b.x, b.y);
    ctx.lineTo(neckR.x, neckR.y);
    ctx.quadraticCurveTo(chest.x, chest.y + sw * (jacket ? .2 : .13), neckL.x, neckL.y);
    ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.save(); ctx.clip();
    // Soft fabric highlights and folds, rendered only on look changes.
    for (let i = 0; i < 5; i++) {
      const x = mix(lowerL.x, lowerR.x, (i + 1) / 6);
      const grad = ctx.createLinearGradient(x - sw * .04, 0, x + sw * .04, 0);
      grad.addColorStop(0, 'rgba(0,0,0,0)'); grad.addColorStop(.5, 'rgba(0,0,0,.075)'); grad.addColorStop(1, 'rgba(255,255,255,.06)');
      ctx.fillStyle = grad;
      path(ctx, [{ x: mix(chest.x, x, .6), y: chest.y + torso * .5 },
        { x: x - sw * .05, y: hemY }, { x: x + sw * .05, y: hemY }]);
      ctx.fill();
    }
    ctx.restore();
    if (jacket) {
      const neck = pointMix(neckL, neckR, .5);
      ctx.strokeStyle = this.shade(this.look.color, -.4); ctx.lineWidth = sw * .012;
      path(ctx, [{ x: neck.x, y: neck.y + sw * .1 }, { x: hip.x, y: hemY }], false); ctx.stroke();
      ctx.fillStyle = this.shade(this.look.color, .12);
      for (const side of [-1, 1]) {
        path(ctx, [{ x: neck.x + side * sw * .18, y: neck.y },
          { x: neck.x + side * sw * .05, y: neck.y + torso * .35 },
          { x: neck.x + side * sw * .23, y: neck.y + torso * .18 }]);
        ctx.fill(); ctx.stroke();
        ctx.strokeStyle = 'rgba(0,0,0,.2)';
        path(ctx, [{ x: hip.x + side * sw * .15, y: hip.y - torso * .12 },
          { x: hip.x + side * sw * .35, y: hip.y - torso * .12 }], false); ctx.stroke();
      }
      for (let i = 1; i < 4; i++) {
        ctx.fillStyle = '#d4c7ad'; ctx.beginPath();
        ctx.arc(mix(neck.x, hip.x, i / 4) + sw * .025, mix(neck.y + torso * .2, hemY, i / 4), Math.max(1, sw * .014), 0, Math.PI * 2); ctx.fill();
      }
    }
    if (dress) {
      ctx.strokeStyle = this.shade(this.look.color, -.22); ctx.lineWidth = sw * .035;
      path(ctx, [waistL, waistR], false); ctx.stroke();
    }
    ctx.restore();
    // Restore exposed crossing forearms so they occlude the clothes naturally.
    for (const index of [13, 14]) {
      const elbow = p[index], wrist = p[index + 2];
      if ((elbow.visibility ?? 0) < .6 || (wrist.visibility ?? 0) < .6) continue;
      if (jacket) continue;
      const start = pointMix(elbow, wrist, -.08);
      ctx.save(); ctx.beginPath();
      ctx.lineWidth = sw * .105; ctx.lineCap = 'round'; ctx.strokeStyle = '#fff';
      // A capsule clip, not a rectangular crop, preserves background transparency.
      const ang = Math.atan2(wrist.y - start.y, wrist.x - start.x), r = sw * .055;
      ctx.arc(start.x, start.y, r, ang + Math.PI / 2, ang + Math.PI * 1.5);
      ctx.arc(wrist.x, wrist.y, r * .8, ang - Math.PI / 2, ang + Math.PI / 2);
      ctx.closePath(); ctx.clip();
      ctx.drawImage(this.person, 0, 0);
      ctx.restore();
    }
  }

  shade(hex, amount) {
    const n = parseInt(hex.slice(1), 16);
    return `rgb(${[n >> 16, n >> 8 & 255, n & 255].map(x => Math.round(clamp(x * (1 + amount), 0, 255))).join(',')})`;
  }

  drawShoes(ctx) {
    const p = this.pose, sw = distance(p[11], p[12]);
    for (const [ankleId, heelId, toeId] of [[27, 29, 31], [28, 30, 32]]) {
      const ankle = p[ankleId], heel = p[heelId], toe = p[toeId];
      const len = Math.max(distance(heel, toe), sw * .16), boot = this.look.shoe === 'boots';
      const direction = Math.atan2(toe.y - heel.y, toe.x - heel.x);
      ctx.save(); ctx.translate(heel.x, heel.y); ctx.rotate(direction);
      ctx.fillStyle = boot ? '#55473d' : '#eeeee4';
      ctx.strokeStyle = boot ? '#3c332d' : '#b4b5a9'; ctx.lineWidth = Math.max(1, sw * .008);
      ctx.beginPath(); ctx.moveTo(-len * .12, len * .15);
      ctx.lineTo(-len * .11, -len * (boot ? .72 : .3));
      ctx.quadraticCurveTo(len * .2, -len * (boot ? .77 : .44), len * .35, -len * .24);
      ctx.quadraticCurveTo(len * 1.1, -len * .2, len * 1.15, len * .08);
      ctx.quadraticCurveTo(len * .7, len * .29, -len * .12, len * .15);
      ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.strokeStyle = boot ? '#262725' : '#fff'; ctx.lineWidth = len * .08;
      path(ctx, [{ x: -len * .07, y: len * .14 }, { x: len, y: len * .15 }], false); ctx.stroke();
      if (!boot) {
        ctx.lineWidth = Math.max(1, len * .025); ctx.strokeStyle = '#9a9d92';
        for (let i = 0; i < 3; i++) {
          path(ctx, [{ x: len * (.25 + i * .12), y: -len * .16 }, { x: len * (.31 + i * .12), y: 0 }], false); ctx.stroke();
        }
      }
      ctx.restore();
    }
  }

  drawMakeup(ctx) {
    const f = this.face, intensity = this.look.makeupIntensity;
    if (!intensity) return;
    const outer = [61, 40, 37, 0, 267, 270, 291, 321, 314, 17, 84, 91];
    const inner = [78, 81, 13, 311, 308, 402, 14, 178];
    ctx.save(); ctx.globalCompositeOperation = 'multiply';
    ctx.fillStyle = this.look.makeup; ctx.globalAlpha = intensity * .75;
    path(ctx, outer.map(i => f[i]));
    // Exclude the mouth opening/teeth using the even-odd rule.
    inner.forEach((index, i) => i ? ctx.lineTo(f[index].x, f[index].y) : ctx.moveTo(f[index].x, f[index].y));
    ctx.closePath(); ctx.fill('evenodd');
    ctx.globalCompositeOperation = 'soft-light'; ctx.globalAlpha = intensity * .55;
    const fw = distance(f[234], f[454]), r = fw * .13;
    for (const cheek of [f[50], f[280]]) {
      const gradient = ctx.createRadialGradient(cheek.x, cheek.y, 0, cheek.x, cheek.y, r);
      gradient.addColorStop(0, this.look.makeup); gradient.addColorStop(1, `${this.look.makeup}00`);
      ctx.fillStyle = gradient;
      ctx.beginPath(); ctx.ellipse(cheek.x, cheek.y, r, r * .62, 0, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
  }

  drawSplitDivider(ctx, width, height) {
    if (this.splitComparison <= 0 || this.splitComparison >= 1) return;
    const x = width * this.splitComparison, y = height / 2;
    ctx.save(); ctx.strokeStyle = '#fff'; ctx.lineWidth = 2;
    ctx.shadowColor = 'rgba(0,0,0,.24)'; ctx.shadowBlur = 4;
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, height); ctx.stroke();
    ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(x, y, 14, 0, Math.PI * 2); ctx.fill();
    ctx.shadowBlur = 0; ctx.strokeStyle = '#626269'; ctx.lineWidth = 1.6;
    ctx.beginPath(); ctx.moveTo(x - 4, y - 4); ctx.lineTo(x - 7, y); ctx.lineTo(x - 4, y + 4);
    ctx.moveTo(x + 4, y - 4); ctx.lineTo(x + 7, y); ctx.lineTo(x + 4, y + 4); ctx.stroke(); ctx.restore();
  }

  drawAccessory(ctx) {
    const f = this.face, accessory = this.look.accessory;
    if (accessory === 'none') return;
    ctx.save();
    if (f && accessory === 'glasses') {
      const left = pointMix(f[33], f[133], .5), right = pointMix(f[263], f[362], .5);
      const d = distance(left, right), angle = Math.atan2(right.y - left.y, right.x - left.x);
      const center = pointMix(left, right, .5);
      ctx.translate(center.x, center.y); ctx.rotate(angle);
      ctx.strokeStyle = '#3b3933'; ctx.lineWidth = Math.max(1.5, d * .027); ctx.fillStyle = 'rgba(186,204,195,.14)';
      for (const side of [-1, 1]) {
        ctx.beginPath(); ctx.roundRect(side * d * .5 - d * .37, -d * .24, d * .74, d * .49, d * .12); ctx.fill(); ctx.stroke();
      }
      ctx.beginPath(); ctx.moveTo(-d * .13, -d * .04); ctx.quadraticCurveTo(0, -d * .1, d * .13, -d * .04); ctx.stroke();
      path(ctx, [{ x: -d * .87, y: -d * .07 }, { x: -d, y: -d * .14 }], false); ctx.stroke();
      path(ctx, [{ x: d * .87, y: -d * .07 }, { x: d, y: -d * .14 }], false); ctx.stroke();
    } else if (f && accessory === 'earrings') {
      const fw = distance(f[234], f[454]), r = fw * .046;
      for (const index of [132, 361]) {
        const ear = f[index]; ctx.strokeStyle = '#c6a55d'; ctx.lineWidth = Math.max(1.5, fw * .013);
        ctx.beginPath(); ctx.ellipse(ear.x, ear.y + r * 1.8, r * .75, r * 1.5, 0, 0, Math.PI * 2); ctx.stroke();
        ctx.fillStyle = '#f8ead2'; ctx.beginPath(); ctx.arc(ear.x, ear.y + r * .25, r * .35, 0, Math.PI * 2); ctx.fill();
      }
    } else if (this.hasPose && accessory === 'necklace') {
      const p = this.pose, middle = pointMix(p[11], p[12], .5), w = distance(p[11], p[12]);
      const l = pointMix(p[11], middle, .55), r = pointMix(p[12], middle, .55);
      ctx.strokeStyle = '#bd9954'; ctx.lineWidth = Math.max(1.2, w * .008);
      ctx.beginPath(); ctx.moveTo(l.x, l.y);
      ctx.quadraticCurveTo(middle.x, middle.y + w * .45, r.x, r.y); ctx.stroke();
      ctx.fillStyle = '#ead3a0'; ctx.beginPath();
      ctx.arc(middle.x, middle.y + w * .225, w * .025, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
  }

  render() {
    if (!this.original || this.disposed) return;
    if (this.compositeDirty) this.rebuild();
    this.stats.renderedFrames++;
    const rect = this.canvas.getBoundingClientRect();
    const cssW = rect.width || 600, cssH = rect.height || 700;
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    const width = Math.round(cssW * dpr), height = Math.round(cssH * dpr);
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width; this.canvas.height = height;
    }
    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = STUDIO_COLOR; ctx.fillRect(0, 0, width, height);
    const scale = Math.min(width / this.width, height / this.height) * .98;
    const ox = (width - this.width * scale) / 2, oy = (height - this.height * scale) / 2;
    ctx.save();
    if (this.splitComparison !== null && !this.comparison) {
      // Both halves share exactly the same camera transform: a comparison must
      // never make the subject appear to move when the divider is dragged.
      ctx.drawImage(this.original, ox, oy, this.width * scale, this.height * scale);
      ctx.beginPath(); ctx.rect(width * this.splitComparison, 0, width, height); ctx.clip();
      ctx.drawImage(this.composite, ox, oy, this.width * scale, this.height * scale);
    } else if (this.comparison) ctx.drawImage(this.original, ox, oy, this.width * scale, this.height * scale);
    else {
      ctx.translate(ox, oy); ctx.scale(scale, scale);
      // A small camera push preserves body pixels and the original background.
      // This presentation effect does not pretend to generate human movement.
      const phase = this.presentationMotion ? this.time * (this.motion === 'idle' ? .5 : .8) : 0;
      const zoom = 1 + (1 - Math.cos(phase)) * .0025;
      const pan = this.motion === 'turn' ? Math.sin(phase) * this.width * .002 : 0;
      ctx.translate(this.width / 2 + pan, this.height / 2);
      ctx.scale(zoom, zoom); ctx.translate(-this.width / 2, -this.height / 2);
      ctx.drawImage(this.composite, 0, 0);
    }
    ctx.restore();
    if (this.splitComparison !== null && !this.comparison) this.drawSplitDivider(ctx, width, height);
  }

  tick(now) {
    if (this.disposed) return;
    if (this.resizePending || this.compositeDirty) { this.resizePending = false; this.render(); }
    // Photo motion needs only 30 fps; inference is never repeated per frame.
    if (!this.lastFrame || now - this.lastFrame >= 1000 / 30) {
      if (!this.paused) this.time += this.lastFrame ? Math.min((now - this.lastFrame) / 1000, .1) : 0;
      this.lastFrame = now;
      if (!this.paused && this.presentationMotion && this.splitComparison === null && !this.comparison
        && this.original && !document.hidden && this.canvas.getClientRects().length) this.render();
    }
    this.raf = requestAnimationFrame(this.tick);
  }

  dispose() {
    this.disposed = true; this.loadId++;
    cancelAnimationFrame(this.raf); this.resizeObserver.disconnect();
    this.canvas.style.width = this.previousCanvasStyle.width;
    this.canvas.style.height = this.previousCanvasStyle.height;
    this.poseModel?.close(); this.faceModel?.close(); this.clothingModel?.close();
    this.poseModel = this.faceModel = this.clothingModel = null; this.recolor = null;
    for (const key of ['original', 'composite', 'person', 'fabric', 'mask', 'texture']) {
      if (this[key]) { this[key].width = this[key].height = 1; this[key] = null; }
    }
    this.pose = this.face = null; this.vertices = []; this.triangles = [];
    this.productOverlay = this.productPose = null;
  }
}
