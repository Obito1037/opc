import { FaceLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';
import { PhotoEngine } from './photo-engine.js';

const QUALITY = { auto: { size: 384, interval: 100 }, balanced: { size: 480, interval: 83 }, quality: { size: 640, interval: 56 } };
const clamp = value => Math.max(0, Math.min(1, value));

// Real local camera/video frames drive this view. No generated human movement.
export class LiveMirror {
  constructor(canvas, { onStatus = () => {}, onEnded = () => {} } = {}) {
    this.canvas = canvas; this.ctx = canvas.getContext('2d'); this.onStatus = onStatus; this.onEnded = onEnded;
    this.video = document.createElement('video'); this.video.muted = true; this.video.playsInline = true; this.video.loop = true;
    this.look = { makeup: '#a34f59', makeupIntensity: .45, accessory: 'none' };
    this.overlay = Object.create(PhotoEngine.prototype); this.overlay.hasPose = false; this.overlay.pose = null;
    this.frame = 0; this.face = null; this.paused = false; this.active = false; this.disposed = false;
    this.source = 'none'; this.comparison = false; this.splitComparison = null; this.hasFace = false;
    this.lastDetect = 0; this.lastVideoTime = -1; this.lastRender = 0; this.lastRenderedTime = -1;
    this.sourceId = 0; this.requestId = 0; this.inFlight = false; this.quality = 'auto'; this.backend = 'loading';
    this.stats = { inferences: 0, inferenceMs: 0, mainThreadInferenceMs: 0, renderedFrames: 0, skippedBusy: 0 };
    this.tick = this.tick.bind(this);
  }
  async init() {
    if (this.initPromise) return this.initPromise;
    this.initPromise = (async () => {
      this.onStatus('正在加载本地动态人脸识别…');
      if (typeof Worker !== 'undefined' && typeof OffscreenCanvas !== 'undefined' && typeof createImageBitmap === 'function') {
        try { await this.initWorker(); return; }
        catch (error) {
          this.worker?.terminate(); this.worker = null;
          if (this.disposed) throw error;
          console.warn('Local face worker unavailable; using limited-rate CPU fallback:', error.message);
        }
      }
      const files = await FilesetResolver.forVisionTasks('/mediapipe');
      const model = await FaceLandmarker.createFromOptions(files, {
        baseOptions: { modelAssetPath: '/models/face_landmarker.task', delegate: 'CPU' },
        runningMode: 'VIDEO', numFaces: 1, minFaceDetectionConfidence: .5, minTrackingConfidence: .5,
      });
      if (this.disposed) { model.close(); throw new Error('动态预览已关闭'); }
      this.model = model; this.backend = 'main-thread-fallback';
    })();
    return this.initPromise;
  }
  initWorker() {
    return new Promise((resolve, reject) => {
      const worker = this.worker = new Worker(new URL('./face-inference.worker.js', import.meta.url), { type: 'module' });
      const timer = setTimeout(() => finish(new Error('人脸工作线程加载超时')), 20000);
      let initialized = false;
      const finish = error => {
        clearTimeout(timer); this.cancelWorkerInit = null;
        if (error) reject(error); else { initialized = true; this.backend = 'worker'; resolve(); }
      };
      this.cancelWorkerInit = () => finish(new Error('动态预览已关闭'));
      worker.onmessage = ({ data }) => {
        if (data.type === 'ready') finish();
        else if (data.type === 'result') {
          this.inFlight = false;
          if (!this.disposed && this.active && data.sourceId === this.sourceId) this.acceptResult(data.face, data.inferenceMs);
        } else if (data.type === 'error') {
          if (!initialized) finish(new Error(data.message));
          else { this.inFlight = false; this.fail('人脸跟踪中断，请重新开启视频'); }
        }
      };
      worker.onerror = event => {
        event.preventDefault();
        if (!initialized) finish(new Error(event.message || '工作线程不可用'));
        else { this.inFlight = false; this.fail('人脸跟踪中断，请重新开启视频'); }
      };
      worker.postMessage({ type: 'init' });
    });
  }
  async camera() {
    this.stopSource();
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('此浏览器无法使用摄像头，请上传一段视频');
    const id = this.sourceId;
    const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 960 }, height: { ideal: 720 } }, audio: false });
    if (this.disposed || id !== this.sourceId) { stream.getTracks().forEach(t => t.stop()); throw new Error('动态预览已关闭'); }
    this.stream = stream; this.video.srcObject = stream; this.source = 'camera';
    for (const track of stream.getVideoTracks()) track.addEventListener('ended', () => {
      if (this.stream === stream && !this.disposed) this.fail('摄像头连接已结束，可重新开启或上传视频');
    }, { once: true });
    try { await this.begin(); } catch (error) { if (id === this.sourceId) this.stopSource(); throw error; }
  }
  async loadVideo(file) {
    if (!['video/mp4', 'video/webm', 'video/quicktime'].includes(file.type)) throw new Error('请选择 MP4、WebM 或 MOV 视频');
    if (file.size > 200 * 1024 * 1024) throw new Error('视频超过 200 MB，请先裁剪');
    this.stopSource(); const id = this.sourceId;
    this.url = URL.createObjectURL(file); this.video.src = this.url; this.source = 'video';
    try { await this.begin(); } catch (error) { if (id === this.sourceId) this.stopSource(); throw error; }
  }
  async begin() {
    const id = this.sourceId;
    const ready = new Promise((resolve, reject) => {
      const finish = error => { clearTimeout(timer); this.cancelVideoReady = null; error ? reject(error) : resolve(); };
      const timer = setTimeout(() => finish(new Error('视频未能解码，请改用 H.264 MP4 或 WebM')), 15000);
      this.cancelVideoReady = () => finish(new Error('动态预览已关闭'));
      this.video.onloadeddata = () => finish();
      this.video.onerror = () => finish(new Error('无法读取视频，请换一个文件'));
      if (this.video.readyState >= 2) finish();
    });
    await Promise.all([this.init(), ready]);
    if (this.disposed || id !== this.sourceId) throw new Error('动态预览已关闭');
    await this.video.play();
    if (this.disposed || id !== this.sourceId) throw new Error('动态预览已关闭');
    if (!this.video.videoWidth || !this.video.videoHeight) throw new Error('视频没有可用的画面轨道，请换一个包含画面的视频');
    this.video.onloadeddata = null;
    this.video.onerror = () => { if (this.active && !this.disposed) this.fail('视频播放中断，请重新上传兼容的视频'); };
    const ratio = Math.min(1, 960 / this.video.videoWidth, 1080 / this.video.videoHeight);
    this.canvas.width = Math.round(this.video.videoWidth * ratio); this.canvas.height = Math.round(this.video.videoHeight * ratio);
    this.input = document.createElement('canvas'); this.inputCtx = this.input.getContext('2d'); this.resizeInput();
    this.active = true; this.paused = false;
    this.onStatus(this.source === 'camera' ? '摄像头已开启 · 转头、微笑查看妆容' : '视频已加载 · 妆容随真实动作跟踪');
    cancelAnimationFrame(this.frame); this.frame = requestAnimationFrame(this.tick);
  }
  resizeInput() {
    if (!this.input || !this.video.videoWidth) return;
    const size = QUALITY[this.quality].size;
    const ratio = Math.min(1, size / this.video.videoWidth, size / this.video.videoHeight);
    this.input.width = Math.max(4, Math.round(this.video.videoWidth * ratio / 4) * 4);
    this.input.height = Math.max(4, Math.round(this.video.videoHeight * ratio));
  }
  setQuality(value) { if (QUALITY[value]) { this.quality = value; this.resizeInput(); } }
  setLook(look) { this.look = { ...this.look, ...look }; this.render(); }
  setComparison(value) { this.comparison = !!value; this.render(); }
  setSplitComparison(value) { this.splitComparison = Number.isFinite(value) ? clamp(value) : null; this.render(); }
  setPaused(value) {
    this.paused = !!value;
    if (value) this.video.pause();
    else if (this.active) this.video.play().catch(() => this.fail('视频无法继续播放，请重新上传'));
  }
  acceptResult(face, inferenceMs) {
    this.stats.inferences++; this.stats.inferenceMs += inferenceMs;
    this.averageInference = this.averageInference ? this.averageInference * .8 + inferenceMs * .2 : inferenceMs;
    this.face = face?.map(p => ({ ...p, x: p.x * this.canvas.width, y: p.y * this.canvas.height })) || null;
    const detected = !!face;
    if (detected !== this.hasFace || this.stats.inferences === 1) {
      this.hasFace = detected;
      this.onStatus(detected ? '人脸跟踪中 · 妆容随转头实时更新' : '没有检测到人脸 · 请正对镜头或换清晰视频');
    }
    this.renderDirty = true;
  }
  async detect(now) {
    if (this.inFlight) { this.stats.skippedBusy++; return; }
    this.inFlight = true; const sourceId = this.sourceId;
    this.lastDetect = now; this.lastVideoTime = this.video.currentTime;
    try {
      this.inputCtx.drawImage(this.video, 0, 0, this.input.width, this.input.height);
      if (this.worker) {
        const bitmap = await createImageBitmap(this.input);
        if (this.disposed || !this.active || sourceId !== this.sourceId) { bitmap.close(); this.inFlight = false; return; }
        this.worker.postMessage({ type: 'detect', id: ++this.requestId, sourceId, bitmap, timestamp: now }, [bitmap]);
      } else {
        const started = performance.now(); const result = this.model.detectForVideo(this.input, now);
        const elapsed = performance.now() - started; this.stats.mainThreadInferenceMs += elapsed;
        this.acceptResult(result.faceLandmarks[0] || null, elapsed); this.inFlight = false;
      }
    } catch (error) {
      this.inFlight = false;
      if (!this.disposed && sourceId === this.sourceId) this.fail('人脸跟踪暂停：' + error.message);
    }
  }
  tick(now) {
    if (this.disposed || !this.active) return;
    if (!document.hidden && this.video.readyState >= 2) {
      const interval = Math.max(QUALITY[this.quality].interval, this.backend === 'main-thread-fallback' ? 170 : 0,
        this.quality === 'auto' ? (this.averageInference || 0) * 1.3 : 0);
      if (!this.paused && now - this.lastDetect >= interval && this.video.currentTime !== this.lastVideoTime) this.detect(now);
      if (this.renderDirty || (!this.paused && now - this.lastRender >= 1000 / 30 && this.video.currentTime !== this.lastRenderedTime)) {
        this.render(); this.lastRender = now;
      }
    }
    this.frame = requestAnimationFrame(this.tick);
  }
  render() {
    if (!this.active || this.video.readyState < 2) return;
    this.renderDirty = false; this.stats.renderedFrames++; this.lastRenderedTime = this.video.currentTime;
    const ctx = this.ctx; ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.drawImage(this.video, 0, 0, this.canvas.width, this.canvas.height);
    if (this.face && !this.comparison) {
      ctx.save();
      if (this.splitComparison !== null) {
        ctx.beginPath(); ctx.rect(this.canvas.width * this.splitComparison, 0, this.canvas.width, this.canvas.height); ctx.clip();
      }
      this.overlay.face = this.face; this.overlay.look = this.look;
      this.overlay.drawMakeup(ctx); this.overlay.drawAccessory(ctx); ctx.restore();
    }
    if (this.splitComparison !== null && !this.comparison)
      PhotoEngine.prototype.drawSplitDivider.call(this, ctx, this.canvas.width, this.canvas.height);
  }
  capture() { this.render(); return this.active ? this.canvas.toDataURL('image/png') : null; }
  getPerformanceStats() { return { ...this.stats, backend: this.backend, quality: this.quality, inFlight: this.inFlight,
    averageInferenceMs: this.stats.inferences ? this.stats.inferenceMs / this.stats.inferences : 0 }; }
  fail(message) { this.stopSource(); this.onEnded(message); }
  stopSource() {
    this.sourceId++; this.active = false; cancelAnimationFrame(this.frame); this.cancelVideoReady?.(); this.video.pause();
    this.video.onerror = null; this.video.onloadeddata = null;
    this.stream?.getTracks().forEach(t => t.stop()); this.stream = null; this.video.srcObject = null;
    this.video.removeAttribute('src'); this.video.load();
    if (this.url) URL.revokeObjectURL(this.url); this.url = null;
    this.face = null; this.hasFace = false; this.lastDetect = 0; this.lastVideoTime = -1;
    this.lastRenderedTime = -1; this.renderDirty = false; this.source = 'none';
    if (this.input) { this.input.width = this.input.height = 1; this.input = null; this.inputCtx = null; }
  }
  dispose() {
    this.disposed = true; this.stopSource(); this.cancelWorkerInit?.();
    this.worker?.terminate(); this.worker = null; this.model?.close(); this.model = null; this.inFlight = false;
  }
}
