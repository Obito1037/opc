import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFile, stat, mkdir, rm, realpath } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { loadMotionImage } from './motion-provider.mjs';
import { validateVideo, MAX_VIDEO_BYTES } from './video-validation.mjs';
import { validateDrivingVideo, MAX_DRIVING_VIDEO_BYTES, DRIVING_VIDEO_LIMITS } from './driving-video-validation.mjs';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const exists = async filename => !!filename && !!(await stat(filename).catch(() => null))?.isFile();
const error=(code,message)=>Object.assign(new Error(message),{code});
const safeErrors={INVALID_DRIVING_VIDEO:'驱动视频未通过检查。请使用 3–15 秒、最高 1080p / 60fps、无 HDR 的 MP4 或 WebM，且不超过 12 MB。',
  INVALID_PATH:'动作输入必须位于本机任务目录。',INVALID_IMAGE:'动作源图片无效或过大。',INVALID_VIDEO:'本地动作结果无效或不完整。',
  LOCAL_RUNTIME_FAILED:'本地动作运行程序启动失败。',LOCAL_GENERATION_FAILED:'本地动作迁移失败，请检查运行环境和源图片。',
  LOCAL_IO_ERROR:'无法读取或保存本机动作文件。',LOCAL_CLEANUP_FAILED:'本机动作临时文件清理失败，请关闭占用文件的程序后重试。',ABORTED:'本地动作任务已取消或超时。'};
function safeError(cause,aborted){const code=aborted?'ABORTED':Object.hasOwn(safeErrors,cause?.code)?cause.code:
  ['ENOENT','EACCES','EPERM','ENOSPC'].includes(cause?.code)?'LOCAL_IO_ERROR':'LOCAL_GENERATION_FAILED';return error(code,safeErrors[code]);}
export async function createLocalMotionProvider({ env = process.env, inputRoot, outputRoot, spawnImpl = spawn } = {}) {
  const python = env.MOTION_LOCAL_PYTHON || path.join(projectRoot, 'runtime/motion-v4/.venv/Scripts/python.exe');
  const script = env.MOTION_LOCAL_SCRIPT || path.join(projectRoot, 'scripts/motion-v4/infer.py');
  const manifestPath = env.MOTION_DRIVING_MANIFEST || path.join(projectRoot, 'runtime/motion-v4/presets.json');
  const customCheckpoint=env.MOTION_LOCAL_CHECKPOINT||path.join(projectRoot,'asset-sources/tps-v4/taichi.pth.tar');
  const customUpstream=env.MOTION_LOCAL_UPSTREAM||path.join(projectRoot,'asset-sources/tps-v4/upstream');
  const presets = {}; let manifestError = '';
  try {
    const bytes = await readFile(manifestPath); if (bytes.length > 16384) throw new Error();
    const manifest = JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/, ''));
    if (!manifest||Array.isArray(manifest)||manifest.version !== 1 || manifest.verified !== true || !manifest.presets || typeof manifest.presets !== 'object'||Array.isArray(manifest.presets)) throw new Error();
    for (const [name, item] of Object.entries(manifest.presets)) {
      if (name==='custom'||!/^[a-z][a-z0-9-]{0,31}$/.test(name) || !item || typeof item !== 'object'||Array.isArray(item) || item.verified !== true || typeof item.file !== 'string') continue;
      // Omission keeps upstream amplitude. A malformed explicit value must not
      // silently turn a reviewed subtle driver into a full-strength motion.
      const motionStrength=Object.hasOwn(item,'motionStrength')?item.motionStrength:1;
      if(!Number.isFinite(motionStrength)||motionStrength<0.05||motionStrength>1)continue;
      if(Object.hasOwn(item,'normalizeDriving')&&typeof item.normalizeDriving!=='boolean')continue;
      const file = path.resolve(path.dirname(manifestPath), item.file);
      if (!await exists(file)) continue;
      const maxFrames = Number.isInteger(item.maxFrames) && item.maxFrames >= 8 && item.maxFrames <= 240 ? item.maxFrames : 16;
      const fps = Number.isInteger(item.fps) && item.fps >= 4 && item.fps <= 30 ? item.fps : 8;
      if (maxFrames / fps > 30) continue;
      const checkpoint = typeof item.checkpoint === 'string' ? path.resolve(path.dirname(manifestPath), item.checkpoint) : path.join(projectRoot, 'asset-sources/tps-v4/taichi.pth.tar');
      const upstream = typeof item.upstream === 'string' ? path.resolve(path.dirname(manifestPath), item.upstream) : path.join(projectRoot, 'asset-sources/tps-v4/upstream');
      if (!await exists(checkpoint) || !await exists(path.join(upstream, 'config/taichi-256.yaml'))) continue;
      presets[name] = { file, maxFrames, fps, checkpoint, upstream,
        motionStrength,normalizeDriving:item.normalizeDriving===true,
        startSeconds: Number.isFinite(item.startSeconds) && item.startSeconds >= 0 && item.startSeconds <= 3600 ? item.startSeconds : 0,
        mode: item.mode === 'standard' ? 'standard' : 'relative', sourceFit: item.sourceFit === 'stretch' ? 'stretch' : 'contain',
        label: typeof item.label === 'string' ? item.label.slice(0, 40) : name };
    }
  } catch { for (const key of Object.keys(presets)) delete presets[key]; manifestError = '未找到已验证的动作驱动清单；本地动作服务尚不可用。'; }
  const enabled = env.MOTION_ENABLED === 'true', runtimeReady = await exists(python) && await exists(script);
  const customRequested=env.MOTION_ACCEPTS_DRIVING_VIDEO==='true';
  const customReady=enabled&&customRequested&&runtimeReady&&await exists(customCheckpoint)&&await exists(path.join(customUpstream,'config/taichi-256.yaml'));
  const configured = enabled && runtimeReady && (Object.keys(presets).length > 0||customReady);
  let busy = false, verifiedGeneration = false, lastError = null;
  const getProviderStatus = () => ({ configured, available: configured && verifiedGeneration && !lastError,
    enabled, kind: 'local-tps', name: '本地 TPS 动作迁移（实验）', remote: false, paid: false,
    acceptsPersonImage: true, acceptsDrivingVideo:customReady,experimental:true,drivingVideoLimits:DRIVING_VIDEO_LIMITS,
    presets: [...Object.keys(presets),...(customReady?['custom']:[])], presetLabels: {...Object.fromEntries(Object.entries(presets).map(([key, item]) => [key, item.label])),...(customReady?{custom:'自带动作视频'}:{})},
    presetSpecs:{...Object.fromEntries(Object.entries(presets).map(([key,item])=>[key,{duration:item.maxFrames/item.fps,fps:item.fps,resolution:'256p',motionStrength:item.motionStrength}])),
      ...(customReady?{custom:{duration:3,fps:8,resolution:'256p',motionStrength:0.25}}:{})},
    duration: customReady&&!Object.keys(presets).length?3:null, fps:customReady?8:null, resolution: '256p', busy, verifiedGeneration, lastError,
    message: !enabled ? '本地动作迁移尚未启用。' : !runtimeReady ? '本地动作运行环境尚未准备完成。' : !configured ? customRequested?'本地动作模型文件尚未准备完成。':manifestError||'没有经过验证的动作驱动。'
      : lastError?.message || (Object.hasOwn(presets,'owned-subtle')
        ?`可选自有驱动「轻微姿态 · 实验」${customReady?'，或上传本人动作视频':''}；不保证身份、衣物纹理与肢体稳定，不适合高质量全身走秀或转身。`
        :customReady?'可使用本人驱动视频做小幅正面动作实验；尚不保证衣物与肢体稳定，不能用于可靠走秀或转身展示。':verifiedGeneration ? '已完成真实本地动作迁移。' : '运行环境与驱动已准备，尚未在本进程验证生成。') });
  async function loadDriver(filename){
    const [base,actual]=await Promise.all([realpath(inputRoot),realpath(filename)]),relative=path.relative(base,actual);
    if(!relative||relative.startsWith('..')||path.isAbsolute(relative))throw error('INVALID_PATH',safeErrors.INVALID_PATH);
    const info=await stat(actual);if(!info.isFile()||info.size>MAX_DRIVING_VIDEO_BYTES)throw error('INVALID_DRIVING_VIDEO',safeErrors.INVALID_DRIVING_VIDEO);
    const mime=path.extname(actual).toLowerCase()==='.mp4'?'video/mp4':path.extname(actual).toLowerCase()==='.webm'?'video/webm':null;
    validateDrivingVideo(await readFile(actual),mime);return actual;
  }
  async function submitMotion({ imagePath, drivingVideoPath, motion, signal, onProgress = () => {} }) {
    if (!configured) throw error('MOTION_NOT_CONFIGURED', getProviderStatus().message);
    if (busy) throw error('BUSY', '已有本地动作任务。');
    const custom=motion==='custom';
    let preset = custom&&customReady?{maxFrames:24,fps:8,checkpoint:customCheckpoint,upstream:customUpstream,startSeconds:0,mode:'relative',sourceFit:'contain',motionStrength:0.25}:presets[motion];
    if (!preset||custom&&!customReady) throw error('INVALID_MOTION', '该动作尚未配置或未经本机驱动验证。');
    if(custom&&!drivingVideoPath||!custom&&drivingVideoPath)throw error('INVALID_DRIVING_VIDEO',safeErrors.INVALID_DRIVING_VIDEO);
    if(signal?.aborted)throw error('ABORTED',safeErrors.ABORTED);
    busy = true;const verifiedBefore=verifiedGeneration; const combined = AbortSignal.any([AbortSignal.timeout(12 * 60 * 1000), ...(signal ? [signal] : [])]);
    const output = path.join(outputRoot, randomUUID() + '.mp4');
    const temporary=[output.replace(/\.mp4$/,'.partial.mp4'),output.replace(/\.mp4$/,'.driver.mp4'),output.replace(/\.mp4$/,'.driver.partial.mp4')];
    try {
      await loadMotionImage(imagePath, inputRoot); combined.throwIfAborted(); await mkdir(outputRoot, { recursive: true });
      if(custom)preset={...preset,file:await loadDriver(drivingVideoPath)};
      onProgress({ status: 'running' });
      await new Promise((resolve, reject) => {
        // Only trusted local configuration controls executables/driver paths;
        // neither shell text nor arbitrary paths are accepted from HTTP clients.
        const child = spawnImpl(python, ['-u', script, '--source-image', imagePath, '--driving-video', preset.file,
          '--output', output, '--max-frames', String(preset.maxFrames), '--fps', String(preset.fps), '--threads', '4',
          '--checkpoint', preset.checkpoint, '--upstream', preset.upstream, '--start-seconds', String(preset.startSeconds),
          '--mode', preset.mode, '--source-fit', preset.sourceFit,'--motion-strength',String(preset.motionStrength),...(custom||preset.normalizeDriving?['--normalize-driving']:[])], {
          cwd: projectRoot, windowsHide: true, shell: false, stdio: ['ignore', 'pipe', 'pipe'],
          env: { ...process.env, PYTHONUNBUFFERED: '1',PYTHONIOENCODING:'utf-8' } });
        let pending = '', bytes = 0, stderrBytes = 0, aborted = false,failure=null;
        const abort = () => { aborted = true; child.kill(); };
        combined.addEventListener('abort', abort, { once: true }); if (combined.aborted) abort();
        child.stdout.on('data', data => {
          bytes += data.length;
          if (bytes > 1024 * 1024) { child.kill(); return; }
          pending += data.toString('utf8'); let newline;
          while ((newline = pending.indexOf('\n')) >= 0) {
            const line = pending.slice(0, newline); pending = pending.slice(newline + 1);
            try { const event = JSON.parse(line);if(event?.status==='failed')failure=safeError({code:event.errorCode||event.code});
              else if (['queued', 'running', 'completed'].includes(event?.status))
              onProgress({ status: event.status,...(['validating_driver','normalizing_driver'].includes(event.stage)?{stage:event.stage}:{}), ...(Number.isInteger(event.frame) && Number.isInteger(event.totalFrames) ? { frame: event.frame, totalFrames: event.totalFrames } : {}) }); } catch { /* Non-JSON diagnostics stay local. */ }
          }
        });
        child.stderr.on('data', data => { stderrBytes += data.length; if (stderrBytes > 2 * 1024 * 1024) child.kill(); });
        child.on('error', () => { combined.removeEventListener('abort', abort); reject(error('LOCAL_RUNTIME_FAILED', '本地动作运行程序启动失败。')); });
        child.on('close', code => { combined.removeEventListener('abort', abort);
          if (aborted) reject(error('ABORTED', '本地动作任务已取消或超时。'));
          else if(failure)reject(failure);
          else if (code !== 0) reject(error('LOCAL_GENERATION_FAILED', '本地动作迁移失败，请检查运行环境和源图片。'));
          else resolve(); });
      });
      combined.throwIfAborted();
      const outputInfo = await stat(output); if (!outputInfo.isFile() || outputInfo.size > MAX_VIDEO_BYTES) throw error('INVALID_VIDEO', '本地动作结果过大或无效。');
      const video = validateVideo(await readFile(output));combined.throwIfAborted();
      if((custom||preset.normalizeDriving)&&(video.width!==256||video.height!==256||Math.abs(video.durationSeconds-preset.maxFrames/preset.fps)>0.15))throw error('INVALID_VIDEO',safeErrors.INVALID_VIDEO);
      verifiedGeneration = true; lastError = null; return { filePath: output, generated: true, provider: getProviderStatus().name, ...video };
    } catch (cause) {
      await rm(output,{force:true}).catch(()=>{});const safe=safeError(cause,combined.aborted);lastError={code:safe.code,message:safe.message};throw safe;
    } finally {
      const removed=await Promise.allSettled(temporary.map(file=>rm(file,{force:true})));busy=false;
      if(removed.some(item=>item.status==='rejected')){
        await rm(output,{force:true}).catch(()=>{});verifiedGeneration=verifiedBefore;
        lastError={code:'LOCAL_CLEANUP_FAILED',message:safeErrors.LOCAL_CLEANUP_FAILED};throw error(lastError.code,lastError.message);
      }
    }
  }
  return { getProviderStatus, submitMotion };
}
