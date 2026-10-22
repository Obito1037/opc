import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, readdir, rm, stat, realpath } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createTryOnProvider } from './tryon-provider.mjs';
import { loadProviderConfig } from './runtime-config.mjs';
import { parseImageDataUri, validateImage, MAX_IMAGE_BYTES, MAX_IMAGE_PIXELS } from './image-validation.mjs';
import { createFashnMotionProvider } from './motion-provider.mjs';
import { createLocalMotionProvider } from './local-motion.mjs';
import { validateVideo, MAX_VIDEO_BYTES } from './video-validation.mjs';
import { parseDrivingVideoDataUri, MAX_DRIVING_VIDEO_BYTES } from './driving-video-validation.mjs';
import {isTryOnSeed,resolveTryOnSeed,MAX_TRYON_SEED} from './tryon-seed.mjs';

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const temporaryResultPattern=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(?:driver(?:\.partial)?|partial)\.mp4$/;
const maxBodyBytes = Math.ceil(MAX_IMAGE_BYTES / 3) * 8 + 8192;
const terminal = new Set(['succeeded', 'failed', 'cancelled']);
const stages = { preparing: '图片已保存在本机，准备生成', uploading: '正在发送图片到已配置的换装服务',
  queued: '服务已接收，等待处理', running: '服务正在生成试穿图片', completed: '正在校验并保存生成结果',
  validating_driver:'正在本机检查动作视频',normalizing_driver:'正在保留比例并整理动作视频' };
class ApiError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}
const fail = (status, code, message) => { throw new ApiError(status, code, message); };
function safeChild(root, name) {
  const resolved = path.resolve(root, name), relative = path.relative(root, resolved);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Unsafe storage path');
  return resolved;
}
function send(res, status, body) {
  if (res.destroyed || res.writableEnded) return;
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' });
  res.end(JSON.stringify(body));
}
async function readJson(req, fields = ['personImage', 'garmentImage', 'category', 'garmentPhotoType','seed']) {
  if (!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] || '')) fail(415, 'INVALID_CONTENT_TYPE', '请使用 application/json 提交图片。');
  if (req.headers['content-encoding'] && req.headers['content-encoding'] !== 'identity') fail(415, 'INVALID_CONTENT_ENCODING', '不支持压缩请求体。');
  if (Number(req.headers['content-length']) > maxBodyBytes) fail(413, 'BODY_TOO_LARGE', '每个上传文件不能超过 12 MB。');
  const chunks = []; let size = 0;
  await new Promise((resolve, reject) => {
    const cleanup = () => { req.off('data', data); req.off('end', end); req.off('error', error); req.off('aborted', aborted); };
    const data = chunk => {
      size += chunk.length;
      if (size > maxBodyBytes) { cleanup(); req.resume(); reject(new ApiError(413, 'BODY_TOO_LARGE', '两张图片各不能超过 12 MB。')); }
      else chunks.push(chunk);
    };
    const end = () => { cleanup(); resolve(); };
    const error = () => { cleanup(); reject(new ApiError(400, 'UPLOAD_INTERRUPTED', '图片上传连接已中断。')); };
    const aborted = error;
    req.on('data', data); req.on('end', end); req.on('error', error); req.on('aborted', aborted);
  });
  let value;
  try { value = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { fail(400, 'INVALID_JSON', '请求 JSON 格式无效。'); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(400, 'INVALID_REQUEST', '生成参数无效。');
  const allowed = new Set(fields);
  if (Object.keys(value).some(key => !allowed.has(key))) fail(400, 'INVALID_REQUEST', '请求包含不支持的字段；只能提交图片数据和服装类型。');
  return value;
}

/** Starts no network requests. Tests may inject a protocol fixture provider;
 * the production caller always uses createTryOnProvider and real configuration. */
export async function createTryOnApi({ runtimeRoot, env = process.env, providerFactory, motionProviderFactory,
  now = Date.now, jobTtlMs = 24 * 60 * 60 * 1000, sourceTtlMs = 15 * 60 * 1000, maxJobs = 20 } = {}) {
  runtimeRoot = path.resolve(runtimeRoot);
  const jobsRoot = path.join(runtimeRoot, 'tryon-jobs'), resultsRoot = path.join(runtimeRoot, 'tryon-results');
  await Promise.all([mkdir(jobsRoot, { recursive: true }), mkdir(resultsRoot, { recursive: true })]);
  const config = await loadProviderConfig(runtimeRoot, env);
  const providerOptions = { env: config.error ? {} : config.env, inputRoot: jobsRoot, outputRoot: resultsRoot };
  let selectedFactory = providerFactory || createTryOnProvider;
  if (!providerFactory && config.env.TRYON_PROVIDER === 'local-catvton' && !config.error) {
    try { selectedFactory = (await import('./local-vton.mjs')).createLocalVtonProvider; }
    catch { selectedFactory = () => ({ getProviderStatus: () => ({ configured: false, available: false, verifiedGeneration: false,
      kind: 'local-catvton', name: '本地 CatVTON', remote: false, busy: false, message: '本地换装运行程序尚未安装完成。' }) }); }
  }
  const provider = await selectedFactory(providerOptions);
  const motionProvider = await (motionProviderFactory || (config.env.MOTION_PROVIDER === 'local-tps' ? createLocalMotionProvider : createFashnMotionProvider))(providerOptions);
  const jobs = new Map(); let activeJob = null, acceptingUpload = false, closed = false, validatedGeneration = false, validatedMotion = false;
  function activeSourceBudget(job) {
    const status = (job.kind === 'motion' ? motionProvider : provider).getProviderStatus();
    // A local CPU inference may legitimately take longer than the orphan-file
    // cleanup window. Only active local jobs receive their bounded runtime;
    // finished/interrupted jobs still lose inputs immediately.
    if (!status.remote && status.kind === 'local-catvton') {
      const duration = Number.isFinite(status.maxDurationMs) && status.maxDurationMs >= 30000
        ? Math.min(status.maxDurationMs, 60 * 60 * 1000) : 30 * 60 * 1000;
      return Math.max(sourceTtlMs, duration);
    }
    return sourceTtlMs;
  }
  const dir = id => { if (!uuidPattern.test(id)) throw new Error('Invalid job identifier'); return safeChild(jobsRoot, id); };
  const resultPath = name => {
    if (!/^[0-9a-f-]+\.(?:png|jpg|jpeg|webp|mp4)$/.test(name)) throw new Error('Invalid result identifier');
    return safeChild(resultsRoot, name);
  };
  function publicJob(job) {
    return { id: job.id, kind: job.kind || 'tryon', status: job.finalizing ? 'running' : job.status,
      stage: job.finalizing ? 'completed' : job.stage, message: job.finalizing ? '正在清理本机输入图片' : job.message,
      category: job.category, garmentPhotoType: job.garmentPhotoType, createdAt: job.createdAt,
      ...(job.kind!=='motion'&&isTryOnSeed(job.seed)?{seed:job.seed}:{}),
      ...(job.kind === 'motion' ? { motion: job.motion, sourceJobId: job.sourceJobId || null,hasDrivingVideo:job.hasDrivingVideo===true } : {}),
      updatedAt: job.updatedAt, expiresAt: job.expiresAt, elapsedMs: Math.max(0, (job.finishedAt || now()) - job.createdAt),
      ...(Number.isFinite(job.queuePosition) ? { queuePosition: job.queuePosition } : {}),
      ...(Number.isFinite(job.estimatedSeconds) ? { estimatedSeconds: job.estimatedSeconds } : {}),
      ...(job.error ? { error: job.error } : {}),
      ...(job.progress ? { progress: job.progress } : {}),
      ...(!job.finalizing && job.status === 'succeeded' && job.resultName ? { result: { url: `/api/${job.kind === 'motion' ? 'motion' : 'tryon'}/jobs/${job.id}/result`,
        mimeType: job.mimeType, generated: true, width: job.width, height: job.height,
        ...(job.durationSeconds ? { durationSeconds: job.durationSeconds } : {}), provider: job.provider } } : {}) };
  }
  function persist(job) {
    job.writePromise = (job.writePromise || Promise.resolve()).then(async () => {
      if (job.deleted) return;
      const stored = { ...publicJob(job), resultName: job.resultName, mimeType: job.mimeType,
        width: job.width, height: job.height, durationSeconds: job.durationSeconds, provider: job.provider, finishedAt: job.finishedAt, inputsPending: job.inputsPending };
      await writeFile(path.join(dir(job.id), 'job.json'), JSON.stringify(stored), { mode: 0o600 });
    }).catch(() => { /* A failed local status snapshot must not fabricate provider success. */ });
    return job.writePromise;
  }
  async function removeInputs(job) {
    let removed = true;
    for (const name of ['person.png', 'person.jpg', 'person.webp', 'garment.png', 'garment.jpg', 'garment.webp','driving.mp4','driving.webm'])
      await rm(safeChild(dir(job.id), name), { force: true }).catch(() => { removed = false; });
    job.inputsPending = !removed; return removed;
  }
  async function removeJob(job) {
    job.deleted = true; job.controller?.abort();
    await job.writePromise;
    try {
      if (job.resultName) await rm(resultPath(job.resultName), { force: true });
      // dir() verifies a UUID and resolves the target strictly inside jobsRoot.
      await rm(dir(job.id), { recursive: true, force: true }); jobs.delete(job.id);
    } catch {
      job.deleted = false; job.status = 'failed'; job.stage = 'failed';
      job.message = '本机文件删除失败，请关闭占用文件的程序后重试删除。';
      job.error = { code: 'DELETE_FAILED', message: job.message }; await persist(job);
      fail(500, 'DELETE_FAILED', job.message);
    }
  }
  async function cleanup() {
    for (const job of [...jobs.values()]) {
      if (job.inputsPending) await removeInputs(job);
      if (!terminal.has(job.status) && now() - job.createdAt > activeSourceBudget(job)) {
        job.controller?.abort(); job.status = 'cancelled'; job.stage = 'cancelled'; job.finishedAt = now();
        const providerStatus = (job.kind === 'motion' ? motionProvider : provider).getProviderStatus();
        job.message = providerStatus.remote ? '任务已超时，已删除本机输入图片；远程任务可能仍在执行。' : '本机任务已超时，正在停止生成并清理输入图片。';
        await removeInputs(job); await persist(job);
      }
      if (now() >= job.expiresAt) await removeJob(job);
    }
    const retained = new Set([...jobs.values()].map(job => job.resultName).filter(Boolean));
    for (const file of await readdir(resultsRoot, { withFileTypes: true })) {
      const temporary=temporaryResultPattern.test(file.name);
      if (!file.isFile() || !temporary&&!/^[0-9a-f-]+\.(?:png|jpg|jpeg|webp|mp4)$/.test(file.name) || retained.has(file.name)) continue;
      const filename = temporary?safeChild(resultsRoot,file.name):resultPath(file.name), info = await stat(filename).catch(() => null);
      if (info && now() - info.mtimeMs > sourceTtlMs) await rm(filename, { force: true }).catch(() => {});
    }
  }
  for (const entry of await readdir(jobsRoot, { withFileTypes: true })) {
    if (!entry.isDirectory() || !uuidPattern.test(entry.name)) continue;
    let stored;
    try {
      const bytes = await readFile(path.join(dir(entry.name), 'job.json'));
      if (bytes.length > 16384) throw new Error();
      stored = JSON.parse(bytes.toString());
      if (stored.id !== entry.name || !Number.isFinite(stored.createdAt) || !Number.isFinite(stored.expiresAt)) throw new Error();
      if (stored.resultName) resultPath(stored.resultName);
    } catch { await rm(dir(entry.name), { recursive: true, force: true }); continue; }
    const job = { ...stored, controller: new AbortController() }; jobs.set(job.id, job);
    if (!terminal.has(job.status)) { job.status = 'failed'; job.stage = 'failed'; job.finishedAt = now();
      job.error = { code: 'SERVER_RESTARTED', message: '服务重启中断了本机等待；上游任务可能仍在执行。' }; job.message = job.error.message; }
    if (job.status === 'succeeded') {
      const present = job.resultName && await stat(resultPath(job.resultName)).catch(() => null);
      if (!present?.isFile()) { job.status = 'failed'; job.resultName = null; job.message = '本机生成结果已不存在。'; job.error = { code: 'RESULT_MISSING', message: job.message }; }
    }
    await removeInputs(job); await persist(job);
  }
  await cleanup();
  const timer = setInterval(() => cleanup().catch(() => {}), 60000); timer.unref();

  function capabilities() {
    const status = provider.getProviderStatus();
    const motionStatus = motionProvider.getProviderStatus();
    return { version: '0.4.0', tryOn: { ...status,
      supportsSeed:!!status.configured&&['local-catvton','fashn-api','gradio'].includes(status.kind),seedRange:{min:0,max:MAX_TRYON_SEED},seedDefault:'random-per-job',
      verifiedGeneration: validatedGeneration && status.verifiedGeneration,
      available: validatedGeneration && status.available,
      busy: !!activeJob || acceptingUpload || status.busy,
      ...(config.error ? { configured: false, available: false, message: config.error } : {}) },
      motion: { ...motionStatus, acceptsPersonImage: motionStatus.kind === 'local-tps',acceptsDrivingVideo:motionStatus.kind==='local-tps'&&motionStatus.acceptsDrivingVideo===true,
        available: validatedMotion && motionStatus.available, verifiedGeneration: validatedMotion && motionStatus.verifiedGeneration,
        busy: !!activeJob || acceptingUpload || motionStatus.busy,
        notice: !motionStatus.configured ? motionStatus.message : motionStatus.remote
          ? '点击生成会把试穿结果发送给 FASHN；生成一次 5 秒 / 480p 视频，按官方规则扣除 1 credit。取消本机等待不保证停止远程任务或退款。'
          : motionStatus.acceptsDrivingVideo?'人物图与动作视频只在本机处理。自带视频用于约 3 秒 / 8fps / 256p 小幅正面动作实验，可能形变，不保证走秀、转身或衣物细节稳定。':'在本机执行动作迁移，人物图不会外发。动作由已验证的驱动片段决定，可能出现形变。',
        ...(config.error ? { configured: false, available: false, message: config.error } : {}) },
      limits: { maxImageBytes: MAX_IMAGE_BYTES, maxVideoBytes: MAX_VIDEO_BYTES,maxDrivingVideoBytes:MAX_DRIVING_VIDEO_BYTES, maxPixels: MAX_IMAGE_PIXELS, maxConcurrent: 1, maxJobs, jobTtlMs, sourceTtlMs,
        activeSourceTtlMsByProvider: { tryOn: activeSourceBudget({ kind: 'tryon' }), motion: activeSourceBudget({ kind: 'motion' }) } },
      privacy: { remoteUpload: status.remote,
        notice: !status.configured ? '尚未连接真实换装服务；此状态不会向外发送图片。'
          : status.remote ? `点击生成会把人物和商品图片发送给 ${status.name}；本机输入在任务结束后删除，结果最多保留 24 小时。取消本机等待不保证停止远程任务。`
            : '图片交给配置的本机换装服务处理；本机输入在任务结束后删除，结果最多保留 24 小时。',
        inputRetention: 'until-job-ends', resultRetentionMs: jobTtlMs } };
  }
  async function run(job) {
    let candidateResult;
    try {
      const onProgress = event => {
          if (job.deleted || job.controller.signal.aborted) return;
          if (['uploading', 'queued', 'running', 'completed'].includes(event.status)) {
            job.status = event.status === 'queued' ? 'queued' : 'running'; job.stage = event.status;
            job.message = stages[event.status]; job.updatedAt = now();
            if(job.kind==='motion'&&['validating_driver','normalizing_driver'].includes(event.stage)){job.stage=event.stage;job.message=stages[event.stage];}
            for (const [current, total, unit] of [[event.step, event.totalSteps, 'step'], [event.frame, event.totalFrames, 'frame']]) {
              if (Number.isInteger(current) && Number.isInteger(total) && total > 0 && total <= 10000 && current >= 0 && current <= total) {
                job.progress = { current, total, unit };
                if (event.status === 'running') job.message = unit === 'step'
                  ? `正在生成试穿图 · 第 ${current} / ${total} 步` : `正在生成动作 · 第 ${current} / ${total} 帧`;
              }
            }
            job.queuePosition = event.queuePosition; job.estimatedSeconds = event.estimatedSeconds; persist(job);
          }
        };
      const result = job.kind === 'motion'
        ? await motionProvider.submitMotion({ imagePath: job.personPath, drivingVideoPath:job.drivingVideoPath,motion: job.motion, signal: job.controller.signal, onProgress })
        : await provider.submitTryOn({ personPath: job.personPath, garmentPath: job.garmentPath,
          category: job.category, garmentPhotoType: job.garmentPhotoType,seed:job.seed, signal: job.controller.signal,
          allowRemoteUpload: true, onProgress });
      const resolved = await realpath(result.filePath), root = await realpath(resultsRoot);
      if (path.dirname(resolved) !== root || !result.generated) throw new Error('INVALID_RESULT');
      const name = path.basename(resolved); resultPath(name);
      candidateResult = resolved;
      if (job.deleted || job.controller.signal.aborted) { await rm(resolved, { force: true }); return; }
      const info = await stat(resolved);
      if (info.size > (job.kind === 'motion' ? MAX_VIDEO_BYTES : MAX_IMAGE_BYTES)) throw new Error('INVALID_RESULT');
      const image = job.kind === 'motion' ? validateVideo(await readFile(resolved)) : validateImage(await readFile(resolved), { minDimension: 1 });
      job.resultName = name; job.mimeType = image.mimeType; job.width = image.width; job.height = image.height;
      job.durationSeconds = image.durationSeconds;
      job.finalizing = true; job.provider = result.provider; job.status = 'succeeded'; job.stage = 'completed'; job.message = job.kind === 'motion' ? '动作视频已生成。' : '真实试穿图片已生成。';
      if (job.kind === 'motion') validatedMotion = true; else validatedGeneration = true;
      job.finishedAt = job.updatedAt = now(); job.expiresAt = now() + jobTtlMs;
    } catch (error) {
      if (!job.deleted) {
        job.finalizing = true;
        job.status = job.controller.signal.aborted ? 'cancelled' : 'failed'; job.stage = job.status;
        const code = job.controller.signal.aborted ? 'CANCELLED' : error.code || 'GENERATION_FAILED';
        const remote=(job.kind==='motion'?motionProvider:provider).getProviderStatus().remote;
        const message = job.controller.signal.aborted ? remote?'已取消本机等待；远程任务可能仍在执行。':'本机生成已取消，正在清理输入文件。'
          : error.code === 'NETWORK_OR_IO_ERROR' ? '无法连接换装服务或读取本机图片，请检查服务后重试。'
            : typeof error.code === 'string' ? error.message : '换装结果无法读取或未通过图片校验，请重试。';
        job.error = { code, message }; job.message = message; job.finishedAt = job.updatedAt = now();
      }
    } finally {
      if (candidateResult && job.status !== 'succeeded') await rm(candidateResult, { force: true }).catch(() => {});
      const inputsRemoved = await removeInputs(job);
      if (!inputsRemoved && !job.deleted) {
        job.status = job.stage = 'failed'; job.message = '本机输入图片清理失败，请使用删除任务重试清理。';
        job.error = { code: 'INPUT_CLEANUP_FAILED', message: job.message };
        if (candidateResult) await rm(candidateResult, { force: true }).catch(() => {});
        job.resultName = null;
      }
      job.finalizing = false; await persist(job);
      if (activeJob === job) activeJob = null;
    }
  }
  async function submit(req, res) {
    if (closed) fail(503, 'SERVER_CLOSING', '服务正在停止，请稍后重试。');
    const status = capabilities().tryOn;
    if (!status.configured) fail(503, 'NOT_CONFIGURED', status.message);
    if (activeJob || acceptingUpload || status.busy) fail(429, 'BUSY', '已有任务在处理，请等待完成或取消后重试。');
    acceptingUpload = true;
    let job;
    try {
      const body = await readJson(req), category = body.category || 'tops', garmentPhotoType = body.garmentPhotoType || 'flat-lay';
      if(body.seed!==undefined&&!isTryOnSeed(body.seed))fail(400,'INVALID_SEED','种子须为 0–2147483647 的整数。');
      if (!['tops', 'bottoms', 'one-pieces'].includes(category)) fail(400, 'INVALID_CATEGORY', '请选择上衣、下装或连体服装。');
      if (!['flat-lay', 'model'].includes(garmentPhotoType)) fail(400, 'INVALID_PHOTO_TYPE', '商品图类型必须为平铺图或模特图。');
      if(Array.isArray(status.garmentPhotoTypes)&&!status.garmentPhotoTypes.includes(garmentPhotoType))fail(400,'UNSUPPORTED_PHOTO_TYPE','当前服务不支持此商品图类型，请选择平铺或白底商品图。');
      const person = parseImageDataUri(body.personImage), garment = parseImageDataUri(body.garmentImage);
      await cleanup();
      if (jobs.size >= maxJobs) fail(429, 'STORAGE_LIMIT', '本机已保留 20 个任务，请先删除一些历史结果。');
      const id = randomUUID(), createdAt = now();
      job = { id, kind: 'tryon', category, garmentPhotoType,seed:resolveTryOnSeed(body.seed), createdAt, updatedAt: createdAt, expiresAt: createdAt + jobTtlMs,
        status: 'queued', stage: 'preparing', message: stages.preparing, controller: new AbortController(),
        personPath: path.join(dir(id), `person.${person.extension}`), garmentPath: path.join(dir(id), `garment.${garment.extension}`) };
      await mkdir(dir(id), { mode: 0o700 });
      await Promise.all([writeFile(job.personPath, person.buffer, { flag: 'wx', mode: 0o600 }),
        writeFile(job.garmentPath, garment.buffer, { flag: 'wx', mode: 0o600 })]);
      jobs.set(id, job); activeJob = job; await persist(job);
      send(res, 202, { job: publicJob(job) });
      setImmediate(() => { job.runPromise = run(job); });
    } catch (error) { if (job) { await removeJob(job); if (activeJob === job) activeJob = null; } throw error; }
    finally { acceptingUpload = false; }
  }
  async function submitMotion(req, res) {
    if (closed) fail(503, 'SERVER_CLOSING', '服务正在停止，请稍后重试。');
    const status = capabilities().motion;
    if (!status.configured) fail(503, 'MOTION_NOT_CONFIGURED', status.message);
    if (status.busy || activeJob || acceptingUpload) fail(429, 'BUSY', '已有生成任务，请等待或取消后重试。');
    acceptingUpload = true; let job;
    try {
      const body = await readJson(req, ['sourceJobId', 'personImage', 'motion','drivingVideo']), motion = body.motion || 'idle';
      if (!Array.isArray(status.presets) || !status.presets.includes(motion)) fail(400, 'INVALID_MOTION', '请选择此服务已验证支持的动作预设。');
      const custom=motion==='custom';
      if(custom&&!status.acceptsDrivingVideo)fail(400,'DRIVING_VIDEO_NOT_SUPPORTED','当前动作服务不接受用户驱动视频。');
      if(!custom&&body.drivingVideo!==undefined)fail(400,'INVALID_DRIVING_VIDEO','只有自带动作模式可以提交驱动视频。');
      let driver;
      if(custom){try{driver=parseDrivingVideoDataUri(body.drivingVideo);}catch{fail(400,'INVALID_DRIVING_VIDEO','请上传 3–15 秒、最高 1080p 的 MP4 或 WebM，且不超过 12 MB。');}}
      if (!!body.sourceJobId === !!body.personImage) fail(400, 'INVALID_SOURCE', '请选择一个成功试穿结果或一张人物图片作为动作源。');
      let image, sourceJobId;
      if (body.personImage) {
        if (!status.acceptsPersonImage) fail(400, 'SOURCE_JOB_REQUIRED', '此动作服务仅接受已成功生成的试穿结果。');
        image = parseImageDataUri(body.personImage);
      } else {
        if (typeof body.sourceJobId !== 'string' || !uuidPattern.test(body.sourceJobId)) fail(400, 'INVALID_SOURCE', '动作源任务编号无效。');
        const source = jobs.get(body.sourceJobId);
        if (!source || now() >= source.expiresAt) fail(410, 'SOURCE_EXPIRED', '试穿结果已删除或过期，请先重新生成。');
        if (source.kind === 'motion' || source.finalizing || source.status !== 'succeeded' || !source.resultName) fail(409, 'SOURCE_NOT_READY', '动作源必须是成功生成的试穿图片。');
        const filename = resultPath(source.resultName), info = await stat(filename).catch(() => null);
        if (!info?.isFile() || info.size > MAX_IMAGE_BYTES) fail(410, 'SOURCE_EXPIRED', '本机试穿结果已不存在。');
        const buffer = await readFile(filename); image = { buffer, ...validateImage(buffer) }; sourceJobId = source.id;
      }
      await cleanup(); if (jobs.size >= maxJobs) fail(429, 'STORAGE_LIMIT', '本机任务记录已满，请先删除部分历史记录。');
      const id = randomUUID(), createdAt = now();
      job = { id, kind: 'motion', motion, sourceJobId, hasDrivingVideo:!!driver,createdAt, updatedAt: createdAt, expiresAt: createdAt + jobTtlMs,
        status: 'queued', stage: 'preparing', message: '动作源已保存在本机，准备生成视频', controller: new AbortController(),
        personPath: path.join(dir(id), `person.${image.extension}`),...(driver?{drivingVideoPath:path.join(dir(id),`driving.${driver.extension}`)}:{}) };
      await mkdir(dir(id), { mode: 0o700 }); await writeFile(job.personPath, image.buffer, { flag: 'wx', mode: 0o600 });
      if(driver)await writeFile(job.drivingVideoPath,driver.buffer,{flag:'wx',mode:0o600});
      jobs.set(id, job); activeJob = job; await persist(job); send(res, 202, { job: publicJob(job) });
      setImmediate(() => { job.runPromise = run(job); });
    } catch (error) { if (job) { await removeJob(job); if (activeJob === job) activeJob = null; } throw error; }
    finally { acceptingUpload = false; }
  }
  async function handle(req, res) {
    let url;
    try { url = new URL(req.url, 'http://localhost'); } catch { return false; }
    if (!url.pathname.startsWith('/api/')) return false;
    try {
      const port = req.socket.localPort, host = req.headers.host;
      if (![`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`].includes(host)) fail(403, 'INVALID_HOST', '此接口只接受本机服务地址。');
      if (req.headers.origin && req.headers.origin !== `http://${host}` || req.headers['sec-fetch-site'] === 'cross-site') fail(403, 'CROSS_ORIGIN_DENIED', '请从本机应用页面发起请求。');
      if (url.pathname === '/api/capabilities' && req.method === 'GET') { send(res, 200, capabilities()); return true; }
      if (['/api/tryon/jobs', '/api/motion/jobs'].includes(url.pathname)) {
        const kind = url.pathname.includes('/motion/') ? 'motion' : 'tryon';
        if (req.method === 'POST') await (kind === 'motion' ? submitMotion : submit)(req, res);
        else if (req.method === 'GET') { await cleanup(); send(res, 200, { jobs: [...jobs.values()]
          .filter(job => (job.kind || 'tryon') === kind && !job.deleted).sort((a, b) => b.createdAt - a.createdAt).map(publicJob) }); }
        else fail(405, 'METHOD_NOT_ALLOWED', '此接口支持 GET 和 POST。');
        return true;
      }
      const match = /^\/api\/(tryon|motion)\/jobs\/([0-9a-f-]+)(\/result)?$/.exec(url.pathname);
      if (!match || !uuidPattern.test(match[2])) fail(404, 'NOT_FOUND', '任务不存在或已过期。');
      const job = jobs.get(match[2]);
      if (job && (job.kind || 'tryon') !== match[1]) fail(404, 'NOT_FOUND', '任务类型不匹配。');
      if (!job || now() >= job.expiresAt) { if (job) await removeJob(job); fail(404, 'NOT_FOUND', '任务不存在或已过期。'); }
      if (match[3]) {
        if (!['GET', 'HEAD'].includes(req.method)) fail(405, 'METHOD_NOT_ALLOWED', '结果接口只支持 GET 和 HEAD。');
        if (job.finalizing || job.status !== 'succeeded' || !job.resultName) fail(409, 'RESULT_NOT_READY', '尚无可下载的生成结果。');
        const filename = resultPath(job.resultName), info = await stat(filename).catch(() => null);
        if (!info?.isFile()) fail(404, 'RESULT_MISSING', '本机结果已不存在。');
        let start = 0, end = info.size - 1, status = 200;
        if (req.headers.range) {
          const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range);
          if (!range || !range[1] && !range[2]) { res.writeHead(416, { 'Content-Range': `bytes */${info.size}` }); res.end(); return true; }
          if (range[1]) { start = Number(range[1]); end = range[2] ? Math.min(Number(range[2]), end) : end; }
          else start = Math.max(0, info.size - Number(range[2]));
          if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start > end || start >= info.size) {
            res.writeHead(416, { 'Content-Range': `bytes */${info.size}` }); res.end(); return true;
          }
          status = 206;
        }
        res.writeHead(status, { 'Content-Type': job.mimeType, 'Content-Length': end - start + 1, 'Cache-Control': 'no-store',
          'Accept-Ranges': 'bytes', ...(status === 206 ? { 'Content-Range': `bytes ${start}-${end}/${info.size}` } : {}),
          'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
          'Content-Disposition': `${url.searchParams.get('download') === '1' ? 'attachment' : 'inline'}; filename="yingshen-${job.id}.${job.mimeType === 'image/jpeg' ? 'jpg' : job.mimeType.split('/')[1]}"` });
        if (req.method === 'HEAD') res.end(); else createReadStream(filename, { start, end }).on('error', () => res.destroy()).pipe(res);
      } else if (req.method === 'GET') send(res, 200, { job: publicJob(job) });
      else if (req.method === 'DELETE') {
        const cancelled = !terminal.has(job.status), remoteMayContinue = cancelled && (job.kind === 'motion' ? motionProvider : provider).getProviderStatus().remote;
        await removeJob(job); send(res, 200, { deleted: true, cancelled, remoteMayContinue });
      } else fail(405, 'METHOD_NOT_ALLOWED', '任务接口支持 GET 和 DELETE。');
    } catch (error) {
      send(res, error.status || (error.code === 'INVALID_IMAGE' ? 400 : 500), { error: { code: error.code || 'INTERNAL_ERROR',
        message: error.status || error.code === 'INVALID_IMAGE' ? error.message : '本机服务暂时无法完成操作，请稍后重试。' } });
      if (!req.complete) req.resume();
    }
    return true;
  }
  async function close() {
    closed = true; clearInterval(timer); activeJob?.controller.abort();
    if (activeJob?.runPromise) await Promise.race([activeJob.runPromise, new Promise(resolve => { const t = setTimeout(resolve, 3000); t.unref(); })]);
  }
  return { handle, capabilities, cleanup, close };
}
