import path from 'node:path';
import { readFile, realpath, stat, mkdir, writeFile } from 'node:fs/promises';
import { lookup } from 'node:dns/promises';
import https from 'node:https';
import net from 'node:net';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { validateImage } from './image-validation.mjs';
import { validateVideo, MAX_VIDEO_BYTES } from './video-validation.mjs';

export const MOTION_PRESETS = Object.freeze({ idle: 'standing naturally with subtle movement', walk: 'taking a few natural steps forward', wave: 'gently waving one hand', turn: 'slowly turning slightly to the side' });
const fail = (code, message) => { throw Object.assign(new Error(message), { code }); };
export async function loadMotionImage(imagePath, inputRoot, minDimension = 32) {
  const [root, target] = await Promise.all([realpath(inputRoot), realpath(imagePath)]);
  const relative = path.relative(root, target);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) fail('INVALID_PATH', '动作源图片必须是本机受控任务图片。');
  const info = await stat(target); if (!info.isFile() || info.size > 12 * 1024 * 1024) fail('INVALID_IMAGE', '动作源图片无效或过大。');
  const buffer = await readFile(target), image = validateImage(buffer, { minDimension });
  return { buffer, ...image };
}
export function isPublicAddress(address) {
  const family = net.isIP(address);
  if (family === 4) {
    const [a, b, c] = address.split('.').map(Number);
    return !(a === 0 || a === 10 || a === 127 || a >= 224 || a === 169 && b === 254 || a === 172 && b >= 16 && b <= 31 || a === 192 && [0, 168].includes(b) || a === 100 && b >= 64 && b <= 127 || a === 198 && ([18, 19].includes(b) || b === 51 && c === 100) || a === 203 && b === 0 && c === 113);
  }
  if (family === 6) {
    const lower = address.toLowerCase();
    return /^[23]/.test(lower) && !lower.startsWith('2001:db8:') && !lower.startsWith('2002:') && !/^2001:0[:0]/.test(lower);
  }
  return false;
}
export async function downloadFashnVideo(urlString, { signal, lookupImpl = lookup, requestImpl = https.request } = {}) {
  let url;
  try { url = new URL(urlString); } catch { fail('INVALID_OUTPUT_URL', '动作服务返回的视频地址无效。'); }
  if (url.protocol !== 'https:' || url.hostname !== 'cdn.fashn.ai' || url.port && url.port !== '443' || url.username || url.password || url.hash || !/^\/[A-Za-z0-9_-]+\/output_\d+\.mp4$/.test(url.pathname))
    fail('INVALID_OUTPUT_URL', '动作结果必须来自 FASHN 官方 CDN 的 MP4 地址。');
  const addresses = await lookupImpl(url.hostname, { all: true, verbatim: true });
  if (!addresses.length || addresses.some(item => !isPublicAddress(item.address))) fail('UNSAFE_OUTPUT_ADDRESS', '动作结果地址解析到非公网地址，已拒绝下载。');
  // Pin the checked DNS answers into TLS lookup; no second resolution or redirect.
  const selected = addresses.find(item => item.family === 4) || addresses[0];
  return new Promise((resolve, reject) => {
    const request = requestImpl(url, { method: 'GET', signal, timeout: 60000, agent: false,
      lookup: (_host, options, callback) => options?.all ? callback(null, [selected]) : callback(null, selected.address, selected.family),
      headers: { Accept: 'video/mp4' } }, response => {
      if (response.statusCode !== 200) { response.resume(); reject(Object.assign(new Error('动作 CDN 下载失败；不跟随重定向。'), { code: 'VIDEO_DOWNLOAD_FAILED' })); return; }
      if (Number(response.headers['content-length']) > MAX_VIDEO_BYTES) { response.destroy(); reject(Object.assign(new Error('视频超过本机 80 MB 上限。'), { code: 'VIDEO_TOO_LARGE' })); return; }
      const chunks = []; let bytes = 0;
      response.on('data', chunk => { bytes += chunk.length; if (bytes > MAX_VIDEO_BYTES) response.destroy(Object.assign(new Error('视频超过本机 80 MB 上限。'), { code: 'VIDEO_TOO_LARGE' })); else chunks.push(chunk); });
      response.on('end', () => resolve(Buffer.concat(chunks))); response.on('error', reject);
    });
    request.on('timeout', () => request.destroy(new Error('视频下载超时。'))); request.on('error', reject); request.end();
  });
}
export function createFashnMotionProvider({ env = process.env, inputRoot, outputRoot, fetchImpl = fetch,
  downloadImpl = downloadFashnVideo, pollIntervalMs = 2000, timeoutMs = 420000 } = {}) {
  const enabled = env.MOTION_ENABLED === 'true', key = env.FASHN_API_KEY || '', kind = env.MOTION_PROVIDER || 'disabled';
  const configured = enabled && kind === 'fashn-api' && !!key;
  let verifiedGeneration = false, busy = false, lastError = null;
  const status = () => ({ configured, enabled, available: configured && verifiedGeneration && !lastError, verifiedGeneration, busy,
    kind, name: kind === 'fashn-api' ? 'FASHN Image to Video' : '未连接动作生成服务', remote: kind === 'fashn-api', paid: kind === 'fashn-api', duration: 5, resolution: '480p',
    presets: kind === 'fashn-api' ? Object.keys(MOTION_PRESETS) : [], lastError,
    message: kind !== 'fashn-api' ? '尚未选择已配置的动作生成服务。'
      : !enabled ? '动作生成默认关闭；尚未启用付费服务。' : !key ? '未配置 FASHN_API_KEY，动作服务不可用。'
      : lastError?.message || (verifiedGeneration ? '已完成真实动作生成。' : '已配置，尚未完成真实动作生成验证。') });
  async function submitMotion({ imagePath, motion = 'idle', signal, onProgress = () => {} }) {
    if (!configured) fail('MOTION_NOT_CONFIGURED', status().message);
    if (busy) fail('BUSY', '已有动作生成任务。');
    if (!Object.hasOwn(MOTION_PRESETS, motion)) fail('INVALID_MOTION', '动作预设无效。');
    const combined = AbortSignal.any([AbortSignal.timeout(timeoutMs), ...(signal ? [signal] : [])]);
    const json = async (route, data) => {
      const response = await fetchImpl(new URL(route, 'https://api.fashn.ai/v1/'), { signal: combined, redirect: 'error',
        method: data ? 'POST' : 'GET', headers: { Authorization: `Bearer ${key}`, ...(data ? { 'Content-Type': 'application/json' } : {}) }, ...(data ? { body: JSON.stringify(data) } : {}) });
      const chunks = []; let length = 0;
      for await (const chunk of response.body) { length += chunk.length; if (length > 65536) fail('INVALID_RESPONSE', '动作服务状态响应过大。'); chunks.push(chunk); }
      let body; try { body = JSON.parse(Buffer.concat(chunks).toString()); } catch { fail('INVALID_RESPONSE', '动作服务返回无效状态。'); }
      if (!response.ok) fail(response.status === 429 ? 'QUOTA_EXCEEDED' : [401, 403].includes(response.status) ? 'AUTH_REQUIRED' : 'UPSTREAM_HTTP_ERROR', `动作服务返回 HTTP ${response.status}，请检查账户和额度。`);
      return body;
    };
    busy = true;
    try {
      const image = await loadMotionImage(imagePath, inputRoot, 301); combined.throwIfAborted();
      onProgress({ status: 'uploading' });
      const submitted = await json('run', { model_name: 'image-to-video', inputs: {
        image: `data:${image.mimeType};base64,${image.buffer.toString('base64')}`, prompt: MOTION_PRESETS[motion], duration: 5, resolution: '480p' } });
      if (submitted.error || typeof submitted.id !== 'string' || !/^[A-Za-z0-9_-]+$/.test(submitted.id)) fail('UPSTREAM_REJECTED', '动作服务未接受生成任务。');
      onProgress({ status: 'queued' }); let output;
      while (!output) {
        const current = await json(`status/${submitted.id}`);
        if (current.status === 'completed') { if (!Array.isArray(current.output) || current.output.length !== 1 || typeof current.output[0] !== 'string') fail('INVALID_OUTPUT', '动作服务未返回单个视频。'); output = current.output[0]; }
        else if (['starting', 'in_queue', 'processing'].includes(current.status)) {
          onProgress({ status: current.status === 'processing' ? 'running' : 'queued' }); await delay(pollIntervalMs, undefined, { signal: combined });
        } else fail('GENERATION_FAILED', '动作服务生成失败；未自动重试或再次计费。');
      }
      onProgress({ status: 'running', message: '正在下载动作视频' });
      const buffer = await downloadImpl(output, { signal: combined }), video = validateVideo(buffer);
      combined.throwIfAborted(); await mkdir(outputRoot, { recursive: true });
      const filePath = path.join(outputRoot, randomUUID() + '.mp4'); await writeFile(filePath, buffer, { flag: 'wx', mode: 0o600 });
      verifiedGeneration = true; lastError = null; onProgress({ status: 'completed' });
      return { filePath, mimeType: 'video/mp4', provider: status().name, generated: true, ...video };
    } catch (error) {
      const code = combined.aborted ? 'ABORTED' : error.code || 'MOTION_NETWORK_ERROR';
      const message = combined.aborted ? '已取消本机等待；远程付费任务可能仍在执行。'
        : error.code ? String(error.message).split(key || '\0').join('[redacted]').slice(0, 600) : '动作服务连接失败，请检查服务与网络。';
      lastError = { code, message }; throw Object.assign(new Error(message), { code });
    } finally { busy = false; }
  }
  return { getProviderStatus: status, submitMotion };
}
