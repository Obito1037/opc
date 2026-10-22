/** Optional server-side real VTON adapter. Never import this module into the browser.
 * Public demos are not a production backend; explicit configuration is required.
 * Official API schema checked 2026-10-21. See docs/ai-provider-research-v2.md.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFile, realpath, stat, mkdir, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const maxImageBytes = 12 * 1024 * 1024;
const categories = new Set(['tops', 'bottoms', 'one-pieces']);
const isLocal = (url) => ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);

export class TryOnProviderError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'TryOnProviderError';
    this.code = code;
    this.details = details;
  }
}
const fail = (code, message, details) => { throw new TryOnProviderError(code, message, details); };
const safeMessage = (value) => String(typeof value === 'object' ? value?.message || value?.error || value?.name || '上游服务失败' : value || '上游服务失败')
  .replace(/Bearer\s+\S+/gi, 'Bearer [redacted]').replace(/hf_[A-Za-z0-9]+/g, '[redacted]').slice(0, 600);

function imageMime(buffer) {
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'image/png';
  if (buffer.length >= 3 && buffer[0] === 255 && buffer[1] === 216 && buffer[2] === 255) return 'image/jpeg';
  if (buffer.length >= 12 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  fail('INVALID_IMAGE', '仅支持真实的 PNG、JPEG、WebP 图片。');
}

async function loadImage(filename, inputRoot) {
  if (typeof filename !== 'string' || !filename) fail('INVALID_IMAGE', '请提供人物图片和商品图片。');
  const [root, target] = await Promise.all([realpath(inputRoot), realpath(filename)]);
  const relative = path.relative(root, target);
  if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) fail('INVALID_PATH', '图片必须位于已配置的上传目录中。');
  const info = await stat(target);
  if (!info.isFile() || info.size > maxImageBytes || info.size < 12) fail('INVALID_IMAGE', '图片无效或超过 12 MB。');
  const buffer = await readFile(target);
  if (buffer.length > maxImageBytes) fail('INVALID_IMAGE', '图片超过 12 MB。');
  return { buffer, mime: imageMime(buffer), name: path.basename(target) };
}

async function readLimited(response, limit = maxImageBytes) {
  if (Number(response.headers.get('content-length')) > limit) fail('OUTPUT_TOO_LARGE', '服务返回文件过大。');
  const chunks = []; let total = 0;
  for await (const chunk of response.body) {
    total += chunk.length;
    if (total > limit) fail('OUTPUT_TOO_LARGE', '服务返回文件过大。');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

/** Dependency injection is for isolated protocol tests; no network is contacted on import. */
export function createTryOnProvider({ env = process.env, inputRoot = projectRoot, outputRoot = path.join(projectRoot, 'runtime', 'tryon-results'), fetchImpl = globalThis.fetch, pollIntervalMs = 2000, timeoutMs = 300000 } = {}) {
  const kind = env.TRYON_PROVIDER || 'disabled';
  const key = env.FASHN_API_KEY || '';
  const hfToken = env.TRYON_HF_TOKEN || '';
  let endpoint;
  let configurationError = '';
  if (kind === 'gradio') {
    try {
      endpoint = new URL(env.TRYON_GRADIO_URL || '');
      if (endpoint.username || endpoint.password || endpoint.search || endpoint.hash || (endpoint.protocol !== 'https:' && !(endpoint.protocol === 'http:' && isLocal(endpoint)))) throw new Error();
      endpoint = new URL(endpoint.href.replace(/\/+$/, '') + '/');
    } catch { configurationError = 'TRYON_GRADIO_URL 必须是本地 HTTP 或远程 HTTPS 服务地址。'; }
  }
  if (kind === 'fashn-api') endpoint = new URL('https://api.fashn.ai/v1/');
  const configured = kind === 'fashn-api' ? Boolean(key) : kind === 'gradio' && !configurationError;
  const name = kind === 'fashn-api' ? 'FASHN v1.6 API' : kind === 'gradio' ? 'FASHN v1.5 Gradio' : '未连接真实换装服务';
  let lastError = null;
  let verifiedGeneration = false;
  let busy = false;

  function getProviderStatus() {
    return {
      configured, available: configured && verifiedGeneration && !lastError,
      name, kind, busy, verifiedGeneration,
      remote: Boolean(endpoint && !isLocal(endpoint)),
      message: !configured ? configurationError || (kind === 'fashn-api' ? '尚未配置 FASHN_API_KEY。' : '真实 AI 换装尚未连接；本地预览不等于生成式换衣。')
        : lastError ? lastError.message : verifiedGeneration ? '服务已完成过真实生成。' : '服务已配置，尚未完成真实生成验证。',
      lastError: lastError ? { code: lastError.code, message: lastError.message } : null,
    };
  }

  async function submitTryOn({ personPath, garmentPath, category = 'tops', garmentPhotoType = 'flat-lay', seed = 42, steps = 30, signal, onProgress = () => {}, allowRemoteUpload = false } = {}) {
    if (!configured) fail('NOT_CONFIGURED', getProviderStatus().message);
    if (busy) fail('BUSY', '已有真实换装任务正在处理。');
    if (!categories.has(category)) fail('INVALID_CATEGORY', '此换装服务仅支持上衣、下装和连体服装。');
    if (!['flat-lay', 'model'].includes(garmentPhotoType)) fail('INVALID_PHOTO_TYPE', '服装图类型无效。');
    if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) fail('INVALID_SEED', '种子值无效。');
    if (!Number.isInteger(steps) || steps < 10 || steps > 50) fail('INVALID_STEPS', '生成步数须为 10–50。');
    if (!isLocal(endpoint) && !allowRemoteUpload) fail('REMOTE_UPLOAD_NOT_ENABLED', '云端换装会发送人物和商品图片；请在产品流程明确告知后启用云端提交。');
    const jobSignal = AbortSignal.any([AbortSignal.timeout(timeoutMs), ...(signal ? [signal] : [])]);
    const startedAt = Date.now();
    busy = true;
    const progress = (status, extra = {}) => onProgress({ status, provider: name, elapsedMs: Date.now() - startedAt, ...extra });
    const auth = kind === 'fashn-api' ? { Authorization: `Bearer ${key}` } : hfToken ? { Authorization: `Bearer ${hfToken}` } : {};
    const request = async (url, init = {}) => {
      const result = await fetchImpl(url, { ...init, headers: { ...auth, ...init.headers }, signal: jobSignal, redirect: 'error' });
      if (!result.ok) {
        const detail = safeMessage((await readLimited(result, 16384)).toString());
        fail(result.status === 401 || result.status === 403 ? 'AUTH_REQUIRED' : result.status === 429 ? 'QUOTA_EXCEEDED' : 'UPSTREAM_HTTP_ERROR', `换装服务返回 HTTP ${result.status}：${detail}`, { status: result.status });
      }
      return result;
    };
    const json = async (url, init) => JSON.parse((await readLimited(await request(url, init), 20 * 1024 * 1024)).toString());
    const postJson = (url, data) => json(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
    try {
      jobSignal.throwIfAborted();
      const [person, garment] = await Promise.all([loadImage(personPath, inputRoot), loadImage(garmentPath, inputRoot)]);
      progress('uploading');
      let resultBuffer; let upstreamJobId;
      if (kind === 'fashn-api') {
        const dataUri = (image) => `data:${image.mime};base64,${image.buffer.toString('base64')}`;
        const submitted = await postJson(new URL('run', endpoint), {
          model_name: 'tryon-v1.6', inputs: { model_image: dataUri(person), garment_image: dataUri(garment), category, garment_photo_type: garmentPhotoType, mode: 'quality', num_samples: 1, seed, output_format: 'png', return_base64: true, segmentation_free: true },
        });
        if (submitted.error || typeof submitted.id !== 'string') fail('UPSTREAM_REJECTED', safeMessage(submitted.error || '服务未返回任务编号。'));
        upstreamJobId = submitted.id;
        progress('queued', { upstreamJobId });
        while (!resultBuffer) {
          jobSignal.throwIfAborted();
          const current = await json(new URL(`status/${encodeURIComponent(upstreamJobId)}`, endpoint));
          if (current.status === 'completed') {
            const output = current.output?.[0];
            if (typeof output !== 'string' || !/^data:image\/(png|jpeg|webp);base64,/.test(output)) fail('INVALID_OUTPUT', '服务未返回请求的 base64 图片。');
            resultBuffer = Buffer.from(output.slice(output.indexOf(',') + 1), 'base64');
          } else if (['starting', 'in_queue', 'processing'].includes(current.status)) {
            progress(current.status === 'processing' ? 'running' : 'queued', { upstreamJobId });
            await delay(pollIntervalMs, undefined, { signal: jobSignal });
          } else fail('GENERATION_FAILED', safeMessage(current.error || `未知任务状态：${current.status}`));
        }
      } else {
        const config = await json(new URL('config', endpoint));
        const dependency = config.dependencies?.find((entry) => entry.api_name === 'try_on');
        if (!dependency || dependency.inputs?.length !== 8) fail('INCOMPATIBLE_PROVIDER', '该 Gradio 服务未提供兼容的 FASHN v1.5 try_on 接口。');
        const prefix = config.api_prefix || '/gradio_api';
        if (!/^\/[A-Za-z0-9_/-]*$/.test(prefix)) fail('INCOMPATIBLE_PROVIDER', '服务 API 路径无效。');
        const api = (suffix) => new URL(`${prefix.replace(/^\//, '')}/${suffix}`, endpoint);
        const uploads = [];
        for (const [index, source] of [person, garment].entries()) {
          const form = new FormData();
          form.append('files', new Blob([source.buffer], { type: source.mime }), `${index === 0 ? 'person' : 'garment'}.${source.mime.split('/')[1]}`);
          const uploaded = await json(api('upload'), { method: 'POST', body: form });
          if (!Array.isArray(uploaded) || typeof uploaded[0] !== 'string') fail('UPLOAD_FAILED', '上游未返回图片上传路径。');
          uploads.push({ path: uploaded[0], meta: { _type: 'gradio.FileData' } });
        }
        const sessionHash = randomUUID().replaceAll('-', '');
        const submitted = await postJson(api('queue/join'), {
          data: [...uploads, category, garmentPhotoType, steps, 1.5, seed, true],
          fn_index: dependency.id ?? config.dependencies.indexOf(dependency), session_hash: sessionHash,
        });
        if (typeof submitted.event_id !== 'string') fail('UPSTREAM_REJECTED', safeMessage(submitted.detail || '服务未返回任务编号。'));
        upstreamJobId = submitted.event_id;
        progress('queued', { upstreamJobId });
        const stream = await request(api(`queue/data?session_hash=${encodeURIComponent(sessionHash)}`));
        let pending = ''; let output; let receivedBytes = 0;
        const decoder = new TextDecoder();
        for await (const chunk of stream.body) {
          receivedBytes += chunk.length;
          if (receivedBytes > 1024 * 1024) fail('INVALID_STREAM', '服务状态流超出合理长度。');
          pending += decoder.decode(chunk, { stream: true });
          let newline;
          while ((newline = pending.indexOf('\n')) >= 0) {
            const line = pending.slice(0, newline).trimEnd(); pending = pending.slice(newline + 1);
            if (!line.startsWith('data:')) continue;
            const event = JSON.parse(line.slice(5).trim());
            if (event.msg === 'estimation') progress('queued', { upstreamJobId, queuePosition: event.rank, estimatedSeconds: event.rank_eta });
            if (event.msg === 'process_starts') progress('running', { upstreamJobId });
            if (event.msg === 'process_completed') {
              if (!event.success) {
                const message = safeMessage(event.output?.error || '上游生成失败。');
                fail(/quota|runs limit/i.test(message) ? 'QUOTA_EXCEEDED' : 'GENERATION_FAILED', message);
              }
              output = event.output?.data?.[0];
            }
          }
          if (output) break;
        }
        if (!output) fail('INCOMPLETE_STREAM', '连接已断开，未收到完整生成结果。');
        const resultUrl = output.url ? new URL(output.url, endpoint) : typeof output.path === 'string' ? api(`file=${encodeURIComponent(output.path)}`) : null;
        if (!resultUrl || resultUrl.origin !== endpoint.origin) fail('INVALID_OUTPUT', '上游返回的图片地址不属于已配置的服务。');
        resultBuffer = await readLimited(await request(resultUrl));
      }
      if (!resultBuffer.length || resultBuffer.length > maxImageBytes) fail('INVALID_OUTPUT', '生成结果无效或超过 12 MB。');
      const mimeType = imageMime(resultBuffer);
      await mkdir(outputRoot, { recursive: true });
      const filePath = path.join(outputRoot, `${randomUUID()}.${mimeType === 'image/jpeg' ? 'jpg' : mimeType.split('/')[1]}`);
      await writeFile(filePath, resultBuffer, { flag: 'wx' });
      verifiedGeneration = true; lastError = null;
      const result = { filePath, mimeType, provider: name, upstreamJobId, elapsedMs: Date.now() - startedAt, generated: true };
      progress('completed', { upstreamJobId });
      return result;
    } catch (error) {
      lastError = error instanceof TryOnProviderError ? error : new TryOnProviderError(jobSignal.aborted ? 'ABORTED' : 'NETWORK_OR_IO_ERROR', jobSignal.aborted ? '任务等待已取消或超时；远程任务可能仍在执行。' : safeMessage(error.message));
      for (const credential of [key, hfToken]) if (credential) lastError.message = lastError.message.split(credential).join('[redacted]');
      progress('failed', { code: lastError.code, message: lastError.message });
      throw lastError;
    } finally { busy = false; }
  }
  return { getProviderStatus, submitTryOn };
}

const provider = createTryOnProvider();
export const getProviderStatus = provider.getProviderStatus;
export const submitTryOn = provider.submitTryOn;
