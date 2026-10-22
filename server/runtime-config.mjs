import { readFile } from 'node:fs/promises';
import path from 'node:path';

// Configuration stays on the server. The HTTP API never accepts or returns keys.
export async function loadProviderConfig(runtimeRoot, env = process.env) {
  let config = {}, motion = {}, error = '';
  try {
    const bytes = await readFile(path.join(runtimeRoot, 'config.json'));
    if (bytes.length > 16384) throw new Error('Configuration too large');
    const parsed = JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/, ''));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Invalid configuration');
    config = parsed.tryOn || {};
    if (!config || typeof config !== 'object' || Array.isArray(config)) throw new Error('Invalid configuration');
    for (const key of ['provider', 'fashnApiKey', 'gradioUrl', 'hfToken', 'localPython', 'localScript', 'localModelDir'])
      if (key in config && (typeof config[key] !== 'string' || config[key].length > 4096)) throw new Error('Invalid setting');
    motion = parsed.motion || {};
    if (!motion || typeof motion !== 'object' || Array.isArray(motion)) throw new Error('Invalid motion configuration');
    for(const key of ['enabled','acceptsDrivingVideo'])if (key in motion && typeof motion[key] !== 'boolean') throw new Error('Invalid motion enabled setting');
    for (const key of ['provider', 'localPython', 'localScript', 'drivingManifest', 'localCheckpoint', 'localUpstream'])
      if (key in motion && (typeof motion[key] !== 'string' || motion[key].length > 4096)) throw new Error('Invalid motion setting');
  } catch (cause) { if (cause.code !== 'ENOENT') error = '本机 runtime/config.json 无法读取或格式无效，请修正后重启服务。'; }
  return { env: {
    TRYON_PROVIDER: env.TRYON_PROVIDER ?? config.provider ?? 'disabled',
    FASHN_API_KEY: env.FASHN_API_KEY ?? config.fashnApiKey ?? '',
    TRYON_GRADIO_URL: env.TRYON_GRADIO_URL ?? config.gradioUrl ?? '',
    TRYON_HF_TOKEN: env.TRYON_HF_TOKEN ?? config.hfToken ?? '',
    TRYON_LOCAL_PYTHON: env.TRYON_LOCAL_PYTHON ?? config.localPython,
    TRYON_LOCAL_SCRIPT: env.TRYON_LOCAL_SCRIPT ?? config.localScript,
    TRYON_LOCAL_MODEL_DIR: env.TRYON_LOCAL_MODEL_DIR ?? config.localModelDir,
    MOTION_PROVIDER: env.MOTION_PROVIDER ?? motion.provider ?? 'disabled',
    MOTION_ENABLED: env.MOTION_ENABLED ?? String(motion.enabled === true),
    MOTION_ACCEPTS_DRIVING_VIDEO: env.MOTION_ACCEPTS_DRIVING_VIDEO ?? String(motion.acceptsDrivingVideo === true),
    MOTION_LOCAL_PYTHON: env.MOTION_LOCAL_PYTHON ?? motion.localPython,
    MOTION_LOCAL_SCRIPT: env.MOTION_LOCAL_SCRIPT ?? motion.localScript,
    MOTION_DRIVING_MANIFEST: env.MOTION_DRIVING_MANIFEST ?? motion.drivingManifest,
    MOTION_LOCAL_CHECKPOINT: env.MOTION_LOCAL_CHECKPOINT ?? motion.localCheckpoint,
    MOTION_LOCAL_UPSTREAM: env.MOTION_LOCAL_UPSTREAM ?? motion.localUpstream,
  }, error };
}
