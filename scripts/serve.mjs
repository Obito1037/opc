import http from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createTryOnApi } from '../server/tryon-api.mjs';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.wasm': 'application/wasm',
  '.task': 'application/octet-stream', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
  '.svg': 'image/svg+xml', '.webp': 'image/webp', '.txt': 'text/plain; charset=utf-8',
  '.webm': 'video/webm', '.mp4': 'video/mp4', '.glb': 'model/gltf-binary', '.gltf': 'model/gltf+json' };

export async function createStudioServer({ root = path.join(projectRoot, 'dist'),
  runtimeRoot = path.join(projectRoot, 'runtime'), env = process.env, providerFactory, motionProviderFactory } = {}) {
  root = path.resolve(root);
  const api = await createTryOnApi({ runtimeRoot, env, ...(providerFactory ? { providerFactory } : {}), ...(motionProviderFactory ? { motionProviderFactory } : {}) });
  const server = http.createServer(async (req, res) => {
    try {
      if (await api.handle(req, res)) return;
      if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405, { Allow: 'GET, HEAD' }); return res.end('Method not allowed'); }
      let pathname;
      try { pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname); }
      catch { res.writeHead(400); return res.end('Bad request'); }
      if (pathname === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        return res.end(JSON.stringify({ service: 'yingshen-tryon-studio', app: 'yingshen', version: '0.4.0', status: 'ready', tryOnApi: true }));
      }
      if (pathname.includes('\0')) { res.writeHead(400); return res.end('Bad request'); }
      const file = path.resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
      if (!file.startsWith(root + path.sep)) { res.writeHead(403); return res.end('Forbidden'); }
      try {
        const info = await stat(file); if (!info.isFile()) throw new Error();
        const headers = { 'Content-Type': mime[path.extname(file).toLowerCase()] || 'application/octet-stream',
          'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'Accept-Ranges': 'bytes',
          'Cache-Control': pathname.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache' };
        let start = 0, end = info.size - 1, status = 200;
        if (req.headers.range) {
          const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range);
          if (!range || !range[1] && !range[2]) { res.writeHead(416, { 'Content-Range': `bytes */${info.size}` }); return res.end(); }
          if (range[1]) { start = Number(range[1]); end = range[2] ? Number(range[2]) : end; }
          else start = Math.max(0, info.size - Number(range[2]));
          end = Math.min(end, info.size - 1);
          if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start > end || start >= info.size) {
            res.writeHead(416, { 'Content-Range': `bytes */${info.size}` }); return res.end();
          }
          status = 206; headers['Content-Range'] = `bytes ${start}-${end}/${info.size}`;
        }
        headers['Content-Length'] = Math.max(0, end - start + 1); res.writeHead(status, headers);
        if (req.method === 'HEAD' || !info.size) return res.end();
        createReadStream(file, { start, end }).on('error', () => res.destroy()).pipe(res);
      } catch { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('文件不存在'); }
    } catch {
      if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('本机服务暂时无法处理请求');
    }
  });
  server.requestTimeout = 45000; server.headersTimeout = 10000;
  server.on('close', () => { api.close().catch(() => {}); });
  return { server, api };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 5173);
  const { server, api } = await createStudioServer();
  server.on('error', error => {
    console.error(error.code === 'EADDRINUSE' ? `端口 ${port} 已被使用。已有映身服务可直接访问 http://127.0.0.1:${port}，请勿关闭其他应用。` : '映身本地服务启动失败。');
    api.close().catch(() => {}); process.exitCode = 1;
  });
  server.listen(port, '127.0.0.1', () => console.log(`映身 YINGSHEN → http://127.0.0.1:${port}`));
  const stop = () => { api.close().finally(() => { server.close(); server.closeIdleConnections(); }); };
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
}
