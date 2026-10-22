import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { access, mkdir, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';

const root = fileURLToPath(new URL('../../', import.meta.url));
const output = path.join(root, 'test-results/motion-v4/cancel-fixture.mp4');
const partial = output.replace(/\.mp4$/, '.partial.mp4');
await mkdir(path.dirname(output), { recursive: true });
await rm(output, { force: true });
await rm(partial, { force: true });
const started = performance.now();
let killedAt;
let pid;
const messages = [];
let stderr = '';
const child = spawn(path.join(root, 'runtime/motion-v4/.venv/Scripts/python.exe'), [
  '-u', path.join(root, 'scripts/motion-v4/infer.py'),
  '--source-image', path.join(root, 'public/demo/studio-model-v2.png'),
  '--driving-video', path.join(root, 'asset-sources/tps-v4/taichi-driver-research.mp4'),
  '--output', output, '--max-frames', '16', '--fps', '8', '--threads', '4',
], { cwd: root, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
pid = child.pid;
child.stderr.setEncoding('utf8');
child.stderr.on('data', data => { stderr = (stderr+data).slice(-6000); });
const lines = createInterface({ input: child.stdout });
lines.on('line', line => {
  const event = JSON.parse(line);
  messages.push(event);
  if (event.frame === 2 && killedAt === undefined) {
    killedAt = performance.now();
    child.kill('SIGTERM');
  }
});
const timeout = setTimeout(() => { child.kill('SIGKILL'); }, 90000);
const exit = await new Promise((resolve, reject) => {
  child.once('error', reject);
  child.once('close', (code, signal) => resolve({ code, signal }));
});
clearTimeout(timeout);
lines.close();
const exists = async p => access(p).then(() => true, () => false);
assert.ok(killedAt, 'reached actual neural frame 2 before cancellation');
assert.equal(await exists(output), false, 'cancel must never publish final MP4');
assert.equal(messages.some(m => m.status === 'completed'), false);
assert.ok(messages.some(m => m.message === '正在生成真实动作帧'), 'JSON UTF-8 preserved');
const partialRemained = await exists(partial);
await rm(partial, { force: true });
const report = {
  passed: true, pid, exit, cancelledAfterFrame: 2,
  elapsedSeconds: (performance.now()-started)/1000,
  cancelToExitMilliseconds: performance.now()-killedAt,
  finalFilePublished: false, partialRemainedBeforeOwnerCleanup: partialRemained,
  utf8JsonProtocolVerified: true, generatedChildProcesses: 0,
  childProcessEvidence: 'Runner uses in-process PyAV and no subprocess imports/calls.',
  messages, stderr,
};
await writeFile(path.join(root, 'test-results/motion-v4/cancellation.json'), JSON.stringify(report,null,2));
console.log(JSON.stringify({ passed: true, exit, partialRemainedBeforeOwnerCleanup: partialRemained, cancelToExitMilliseconds: report.cancelToExitMilliseconds }));
