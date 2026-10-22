import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createTryOnProvider } from '../server/tryon-provider.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../test-results/ai-provider-v2/mock');
await mkdir(root, { recursive: true });
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+iB2QAAAAASUVORK5CYII=', 'base64');
const input = path.join(root, 'fixture.png');
await writeFile(input, png);
const images = { personPath: input, garmentPath: input, category: 'tops' };
const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });

test('unconfigured service refuses generation without any network traffic', async () => {
  const provider = createTryOnProvider({ env: {}, fetchImpl: () => { throw new Error('Unexpected network'); } });
  assert.equal(provider.getProviderStatus().configured, false);
  assert.equal(provider.getProviderStatus().available, false);
  await assert.rejects(provider.submitTryOn(images), { code: 'NOT_CONFIGURED' });
});

test('remote endpoint requires explicit upload enablement and never sends files beforehand', async () => {
  const provider = createTryOnProvider({ env: { TRYON_PROVIDER: 'fashn-api', FASHN_API_KEY: 'test-only' }, fetchImpl: () => { throw new Error('Unexpected network'); } });
  await assert.rejects(provider.submitTryOn(images), { code: 'REMOTE_UPLOAD_NOT_ENABLED' });
  assert.equal(provider.getProviderStatus().verifiedGeneration, false);
});

test('input files outside configured root are rejected before upload', async () => {
  const provider = createTryOnProvider({ env: { TRYON_PROVIDER: 'gradio', TRYON_GRADIO_URL: 'http://127.0.0.1:7860' }, inputRoot: path.join(root, 'results'), fetchImpl: () => { throw new Error('Unexpected network'); } });
  await mkdir(path.join(root, 'results'), { recursive: true });
  await assert.rejects(provider.submitTryOn(images), { code: 'INVALID_PATH' });
});

test('FASHN API submits once, polls real states, and saves requested inline output', async () => {
  let submitted = 0; let polls = 0;
  const progress = [];
  const provider = createTryOnProvider({
    env: { TRYON_PROVIDER: 'fashn-api', FASHN_API_KEY: 'test-only' }, inputRoot: root, outputRoot: path.join(root, 'results'), pollIntervalMs: 0,
    fetchImpl: async (url, init) => {
      assert.equal(init.headers.Authorization, 'Bearer test-only');
      if (url.pathname.endsWith('/run')) {
        submitted++;
        const body = JSON.parse(init.body);
        assert.equal(body.model_name, 'tryon-v1.6');
        assert.equal(body.inputs.return_base64, true);
        assert.equal(body.inputs.num_samples, 1);
        assert.match(body.inputs.model_image, /^data:image\/png;base64,/);
        return json({ id: 'job-1', error: null });
      }
      assert.equal(url.pathname, '/v1/status/job-1');
      return ++polls === 1 ? json({ status: 'processing' }) : json({ status: 'completed', output: [`data:image/png;base64,${png.toString('base64')}`] });
    },
  });
  const result = await provider.submitTryOn({ ...images, allowRemoteUpload: true, onProgress: (event) => progress.push(event.status) });
  assert.equal(submitted, 1);
  assert.deepEqual(await readFile(result.filePath), png);
  assert.deepEqual(progress, ['uploading', 'queued', 'running', 'completed']);
  assert.equal(provider.getProviderStatus().available, true);
});

test('Gradio adapter handles fragmented event stream and retrieves same-origin image', async () => {
  let uploads = 0;
  const progress = [];
  const provider = createTryOnProvider({
    env: { TRYON_PROVIDER: 'gradio', TRYON_GRADIO_URL: 'http://127.0.0.1:7860' }, inputRoot: root, outputRoot: path.join(root, 'results'),
    fetchImpl: async (url, init) => {
      if (url.pathname === '/config') return json({ api_prefix: '/gradio_api', dependencies: [{ id: 2, api_name: 'try_on', inputs: Array(8).fill(0) }] });
      if (url.pathname.endsWith('/upload')) { assert.ok(init.body instanceof FormData); return json([`/tmp/upload-${++uploads}.png`]); }
      if (url.pathname.endsWith('/queue/join')) {
        const body = JSON.parse(init.body);
        assert.equal(body.fn_index, 2);
        assert.equal(body.data[0].path, '/tmp/upload-1.png');
        assert.equal(body.data[1].path, '/tmp/upload-2.png');
        return json({ event_id: 'event-1' });
      }
      if (url.pathname.endsWith('/queue/data')) {
        const text = 'data: {"msg":"estimation","rank":1}\n\ndata: {"msg":"process_starts"}\n\ndata: {"msg":"process_completed","success":true,"output":{"data":[{"url":"http://127.0.0.1:7860/gradio_api/file=result.png"}]}}\n\n';
        return new Response(new ReadableStream({ start(controller) {
          const bytes = new TextEncoder().encode(text);
          for (let i = 0; i < bytes.length; i += 7) controller.enqueue(bytes.slice(i, i + 7));
          controller.close();
        } }));
      }
      assert.equal(url.pathname, '/gradio_api/file=result.png');
      return new Response(png);
    },
  });
  const result = await provider.submitTryOn({ ...images, onProgress: (event) => progress.push(event.status) });
  assert.deepEqual(await readFile(result.filePath), png);
  assert.equal(uploads, 2);
  assert.deepEqual(progress, ['uploading', 'queued', 'queued', 'running', 'completed']);
});

test('real public ZeroGPU quota response is a failure, never a fake preview result', async () => {
  // Captured from the official Space on 2026-10-21. Kept inline so tests do not
  // depend on ignored test-results/ artifacts or perform network requests.
  const recording = 'data: {"msg":"process_completed","output":{"error":"You have exceeded your ZeroGPU runs limit. Authenticate with a Hugging Face token for more quota - https://huggingface.co/settings/tokens","duration":10,"visible":true,"title":"ZeroGPU quota exceeded"},"success":false}\n\n';
  const provider = createTryOnProvider({
    env: { TRYON_PROVIDER: 'gradio', TRYON_GRADIO_URL: 'http://127.0.0.1:7860' }, inputRoot: root,
    fetchImpl: async (url) => {
      if (url.pathname === '/config') return json({ api_prefix: '/gradio_api', dependencies: [{ id: 2, api_name: 'try_on', inputs: Array(8).fill(0) }] });
      if (url.pathname.endsWith('/upload')) return json(['/tmp/upload.png']);
      if (url.pathname.endsWith('/queue/join')) return json({ event_id: 'quota-event' });
      return new Response(recording);
    },
  });
  await assert.rejects(provider.submitTryOn(images), { code: 'QUOTA_EXCEEDED' });
  assert.equal(provider.getProviderStatus().available, false);
  assert.equal(provider.getProviderStatus().verifiedGeneration, false);
  assert.equal(provider.getProviderStatus().busy, false);
});

test('FASHN API failed job is not retried and remains unverified', async () => {
  let posts = 0;
  const provider = createTryOnProvider({
    env: { TRYON_PROVIDER: 'fashn-api', FASHN_API_KEY: 'test-only' }, inputRoot: root,
    fetchImpl: async (url) => url.pathname.endsWith('/run') ? (posts++, json({ id: 'failed-job' })) : json({ status: 'failed', error: { name: 'PoseError', message: 'No pose detected' } }),
  });
  await assert.rejects(provider.submitTryOn({ ...images, allowRemoteUpload: true }), { code: 'GENERATION_FAILED' });
  assert.equal(posts, 1);
  assert.equal(provider.getProviderStatus().available, false);
});
