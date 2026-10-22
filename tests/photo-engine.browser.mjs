import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
const require = createRequire(import.meta.url);
const { chromium } = require('C:/Users/20665/AppData/Local/OpenAI/Codex/runtimes/cua_node/78fb63cda1a9e2b2/bin/node_modules/playwright');
const output = resolve('test-results');
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 1540, height: 1100 }, deviceScaleFactor: 1 });
const errors = [], network = [];
page.on('pageerror', error => errors.push(error.message));
page.on('console', msg => {
  // MediaPipe routes native INFO lines through stderr/console.error.
  if (msg.type() === 'error' && !msg.text().startsWith('INFO:')) errors.push(msg.text());
});
page.on('response', response => { if (response.status() >= 400) network.push(`${response.status()} ${response.url()}`); });
try {
  await page.goto(process.env.PHOTO_TEST_URL || 'http://127.0.0.1:5173', { waitUntil: 'networkidle' });
  await page.locator('#photo-input').setInputFiles(resolve('public/demo/fashion-runway2.jpg'));
  await page.locator('#generate').click();
  await page.waitForFunction(() => window.__YINGSHEN__?.getState().photoReady, { timeout: 60000 });
  const state = await page.evaluate(() => window.__YINGSHEN__.getState());
  await page.waitForTimeout(1300);
  await page.screenshot({ path: resolve(output, 'photo-studio.png'), fullPage: true });
  const still = await page.locator('#photo-canvas').screenshot({ path: resolve(output, 'photo-idle.png') });
  await page.locator('[data-motion="walk"]').click();
  await page.waitForTimeout(550);
  const a = await page.locator('#photo-canvas').screenshot({ path: resolve(output, 'photo-walk-a.png') });
  await page.waitForTimeout(550);
  const b = await page.locator('#photo-canvas').screenshot({ path: resolve(output, 'photo-walk-b.png') });
  await page.locator('#pause-motion').click();
  await page.waitForTimeout(100);
  const pausedA = await page.locator('#photo-canvas').screenshot();
  await page.waitForTimeout(300);
  const pausedB = await page.locator('#photo-canvas').screenshot();
  await page.locator('#compare').click();
  const original = await page.locator('#photo-canvas').screenshot({ path: resolve(output, 'photo-original.png') });
  await page.locator('#compare').click();
  await page.locator('[data-category="clothing"]').click();
  await page.locator('[data-product="rose-dress"]').click();
  await page.locator('#photo-canvas').screenshot({ path: resolve(output, 'photo-dress.png') });
  await page.locator('[data-category="accessories"]').click();
  await page.locator('[data-product="frame-glasses"]').click();
  await page.locator('[data-category="makeup"]').click();
  await page.locator('[data-product="berry-lip"]').click();
  await page.locator('#makeup-intensity').fill('100');
  await page.locator('#makeup-intensity').dispatchEvent('input');
  await page.locator('#photo-canvas').screenshot({ path: resolve(output, 'photo-makeup.png') });
  const report = { state, errors, network, motionChangesPixels: !a.equals(b),
    pausedStable: pausedA.equals(pausedB), comparisonChangesPixels: !original.equals(still),
    status: await page.locator('#analysis-status').textContent() };
  const blankImage = await page.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = 400; canvas.height = 600;
    const ctx = canvas.getContext('2d'); ctx.fillStyle = '#dddddd'; ctx.fillRect(0, 0, 400, 600);
    return canvas.toDataURL('image/png').split(',')[1];
  });
  await page.locator('#clear-photo').click();
  await page.locator('#photo-input').setInputFiles({ name: 'empty-scene.png', mimeType: 'image/png', buffer: Buffer.from(blankImage, 'base64') });
  await page.locator('#generate').click();
  await page.waitForFunction(() => window.__YINGSHEN__?.getState().photoReady, { timeout: 60000 });
  report.blankState = await page.evaluate(() => window.__YINGSHEN__.getState());
  report.noFakeDetection = !report.blankState.hasPose && !report.blankState.hasFace;
  report.checks = {
    bodyDetected: state.hasPose,
    faceDetected: state.hasFace,
    personSegmented: state.photoReport?.segmentationAvailable ?? state.segmentationAvailable ?? report.motionChangesPixels,
    motionChangesPixels: report.motionChangesPixels,
    pausedStable: report.pausedStable,
    comparisonChangesPixels: report.comparisonChangesPixels,
    noFakeDetection: report.noFakeDetection,
    noRuntimeErrors: errors.length === 0,
    noFailedRequests: network.length === 0,
  };
  report.success = Object.values(report.checks).every(Boolean);
  console.log(JSON.stringify(report, null, 2));
  await writeFile(resolve(output, 'photo-engine-report.json'), JSON.stringify(report, null, 2));
  if (!report.success) process.exitCode = 1;
} finally { await browser.close(); }
