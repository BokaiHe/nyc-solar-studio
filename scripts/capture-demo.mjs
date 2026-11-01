// Records the README demo: P.S. 321 from the city map to results, on a
// running local copy of the site (preferably the static export).
//
// Frames come from the Chrome DevTools screencast, each with its own
// timestamp; FFmpeg rebuilds a constant 60 fps video from them, and Pillow
// encodes the README's animated WebP (scripts/encode-webp.py).
//
// Usage: npm run demo:record -- [local-url]
// Environment: FFMPEG_PATH, PYTHON (with Pillow), PLAYWRIGHT_CHANNEL (default
// msedge), DEMO_LANG (en or zh, default en), DEMO_TMP (where raw frames go,
// about 1 GB; default the system temp folder), DEMO_HEADLESS=1 to hide the
// window (headed renders WebGL faster; keep the window uncovered).
import { chromium, expect } from '@playwright/test';
import { createWriteStream } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const url = new URL(process.argv[2] ?? 'http://localhost:8090/solar-3d-web/');
if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) throw Error('Use a local development or static-export URL.');
const ffmpeg = process.env.FFMPEG_PATH ?? 'ffmpeg';
const python = process.env.PYTHON ?? 'python';
if (spawnSync(ffmpeg, ['-version'], { stdio: 'ignore' }).status !== 0) throw Error('FFmpeg is required. Install it or set FFMPEG_PATH.');
if (spawnSync(python, ['-c', 'import PIL'], { stdio: 'ignore' }).status !== 0) throw Error('Python with Pillow is required (set PYTHON).');

const lang = process.env.DEMO_LANG === 'zh' ? 'zh' : 'en';
const L = lang === 'zh'
  ? { search: '搜索纽约地址或建筑', start: '设计这个屋顶', basemap: '卫星底图', plan: '2D 俯视', reset: '重置视角', detect: '✦ 自动识别禁装区', generate: '生成阵列', date: '模拟日期', time: '一天中的时间', play: '播放', pause: '暂停', heatmap: '查看逐块年发电表现', results: /^3\s*结果$/ }
  : { search: 'Search NYC addresses or buildings', start: 'Design this roof', basemap: 'Satellite', plan: 'Plan view', reset: 'Reset view', detect: '✦ Detect keep-out areas', generate: 'Generate array', date: 'Simulation date', time: 'Time of day', play: 'Play', pause: 'Pause', heatmap: 'Show annual panel yield', results: /^3\s*Results$/ };

const VIEWPORT = { width: 1440, height: 900 };
const VIDEO_FPS = 60;
const PREVIEW_FPS = 20;
const PREVIEW_WIDTH = 800;
const PREVIEW_QUALITY = 72;
const DURATION = 38;

await mkdir('docs', { recursive: true });
// Absolute, because FFmpeg reads the frame list relative to its own folder.
const frameRoot = resolve(process.env.DEMO_TMP ?? tmpdir());
await mkdir(frameRoot, { recursive: true });
const temporary = await mkdtemp(join(frameRoot, 'solar-demo-'));
const headless = process.env.DEMO_HEADLESS === '1';
const browser = await chromium.launch({
  channel: process.env.PLAYWRIGHT_CHANNEL ?? 'msedge',
  headless,
  args: [
    '--ignore-gpu-blocklist',
    '--enable-gpu-rasterization',
    '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding',
    '--disable-background-timer-throttling',
    ...(headless ? [] : ['--window-position=0,0']),
  ],
});
let completed = false;
try {
  const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 1 });
  const page = await context.newPage();
  const errors = [];
  const chapters = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript((language) => {
    localStorage.setItem('nyc-solar-tour-seen', '1');
    localStorage.setItem('nyc-solar-language', language);
    localStorage.removeItem('nyc-solar-workspace-v1');
  }, lang);
  await page.goto(url.href);
  const search = page.getByRole('combobox', { name: L.search });
  await expect(search).toBeVisible({ timeout: 30000 });
  // The aerial map draws its first tiles after the page is interactive.
  await page.waitForTimeout(4000);

  // ---- screencast capture ---------------------------------------------------
  const cdp = await context.newCDPSession(page);
  const frames = [];
  const pending = [];
  let capturing = true;
  cdp.on('Page.screencastFrame', ({ data, metadata, sessionId }) => {
    cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => {});
    if (!capturing) return;
    const file = join(temporary, `f${String(frames.length).padStart(6, '0')}.jpg`);
    frames.push({ file, t: metadata.timestamp });
    pending.push(new Promise((done, fail) => {
      const out = createWriteStream(file);
      out.on('finish', done).on('error', fail);
      out.end(Buffer.from(data, 'base64'));
    }));
  });
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 92, maxWidth: VIEWPORT.width, maxHeight: VIEWPORT.height, everyNthFrame: 1 });

  // ---- storyboard (docs/demo-storyboard.md) -----------------------------------
  const start = performance.now();
  const at = async (seconds) => {
    const remaining = seconds * 1000 - (performance.now() - start);
    if (remaining > 0) await page.waitForTimeout(remaining);
  };
  const chapter = (title) => chapters.push({ title, seconds: +((performance.now() - start) / 1000).toFixed(2) });
  // Toolbar buttons start with an icon glyph, so names match as substrings.
  const button = (name) => page.getByRole('button', { name });

  chapter('Search an address on the citywide map');
  await at(1.5);
  await search.click();
  await search.pressSequentially('180 7th Avenue Brooklyn', { delay: 55 });
  await expect(page.getByRole('option').first()).toBeVisible({ timeout: 15000 });
  await page.waitForTimeout(500);
  await search.press('Enter');
  await expect(button(L.start)).toBeVisible({ timeout: 20000 });
  await at(8);

  chapter('Open the LoD2 roof in 3D with its neighbors');
  await button(L.start).click();
  await expect(page.locator('canvas').last()).toBeVisible({ timeout: 20000 });
  await at(11.5);

  chapter('Aerial basemap and 2D plan view');
  await button(L.basemap).click();
  await page.waitForTimeout(700);
  await button(L.plan).click();
  await at(14);

  chapter('Detect keep-out areas with the U-Net');
  await button(L.detect).click();
  await expect(page.locator('[data-tour="zones"] p.text-accent')).toBeVisible({ timeout: 30000 });
  await at(18.5);

  chapter('Generate the array around them');
  await button(L.generate).click();
  await page.waitForFunction(() => /(^|\D)[1-9]\d*\s*(块组件|panels?)/.test(document.querySelector('[data-tour="panel"]')?.textContent ?? ''), null, { timeout: 30000 });
  await at(23);

  // Winter solstice from late morning: sunset is near 16:30, so playback
  // (5 min per 120 ms) stops in daylight around 14:30.
  chapter('Winter solstice shadows in 3D');
  await button(L.reset).click();
  await page.getByLabel(L.date).fill('2026-12-21');
  await page.getByLabel(L.time).fill('660');
  await page.waitForTimeout(400);
  await button(L.play).click();
  await at(29);
  await button(L.pause).click();

  chapter('Per-panel annual yield');
  await page.getByLabel(L.time).fill('780');
  await button(L.heatmap).click();
  await at(32.5);

  chapter('Results');
  await button(L.results).click();
  await at(DURATION);
  if (performance.now() - start > (DURATION + 6) * 1000) throw Error('Recording exceeded its timing budget; retry on an idle machine.');
  if (errors.length) throw Error(errors.join('\n'));

  capturing = false;
  await cdp.send('Page.stopScreencast');
  await Promise.all(pending);
  await context.close();
  if (frames.length < DURATION * 10) throw Error(`Only ${frames.length} frames captured; the browser was probably throttled.`);

  // ---- assemble ---------------------------------------------------------------
  // Each frame lasts until the next one arrived; the video is trimmed to DURATION.
  const t0 = frames[0].t;
  const lines = ['ffconcat version 1.0'];
  for (let index = 0; index < frames.length; index += 1) {
    const next = index + 1 < frames.length ? frames[index + 1].t : frames[index].t + 1 / VIDEO_FPS;
    lines.push(`file '${frames[index].file.replaceAll('\\', '/')}'`);
    lines.push(`duration ${Math.max(0.001, next - frames[index].t).toFixed(6)}`);
  }
  lines.push(`file '${frames.at(-1).file.replaceAll('\\', '/')}'`);
  const list = join(temporary, 'frames.ffconcat');
  await writeFile(list, lines.join('\n') + '\n');
  const convert = (args) => {
    const result = spawnSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', ...args], { encoding: 'utf8' });
    if (result.status !== 0) throw Error(result.stderr || 'FFmpeg conversion failed');
  };
  const source = ['-f', 'concat', '-safe', '0', '-i', list];
  convert([...source, '-t', String(DURATION), '-vf', `fps=${VIDEO_FPS},format=yuv420p`, '-an', '-c:v', 'libx264', '-preset', 'slow', '-crf', '20', '-movflags', '+faststart', resolve('docs/demo.mp4')]);
  const preview = spawnSync(python, ['scripts/encode-webp.py', resolve('docs/demo.mp4'), resolve('docs/demo.webp'), String(PREVIEW_WIDTH), String(PREVIEW_FPS), String(PREVIEW_QUALITY)], { encoding: 'utf8', env: { ...process.env, FFMPEG_PATH: ffmpeg } });
  if (preview.status !== 0) throw Error(preview.stderr || 'WebP preview encoding failed');
  process.stdout.write(preview.stdout);
  const capturedSeconds = frames.at(-1).t - t0;
  await writeFile('docs/demo-recording.json', JSON.stringify({
    recordedAt: new Date().toISOString(),
    url: url.href,
    language: lang,
    durationSeconds: DURATION,
    capture: { method: 'Chrome DevTools screencast (timestamped frames)', headless, frames: frames.length, capturedSeconds: +capturedSeconds.toFixed(2), averageCaptureFps: +(frames.length / capturedSeconds).toFixed(1) },
    outputs: {
      'docs/demo.mp4': `${VIDEO_FPS} fps H.264, ${VIEWPORT.width}×${VIEWPORT.height}`,
      'docs/demo.webp': `${PREVIEW_FPS} fps animated WebP, ${PREVIEW_WIDTH} px wide`,
    },
    chapters,
  }, null, 2) + '\n');
  completed = true;
  console.log(`Recorded ${frames.length} frames over ${capturedSeconds.toFixed(1)} s → docs/demo.mp4, docs/demo.webp`);
} finally {
  await browser.close();
  if (completed) await rm(temporary, { recursive: true, force: true });
  else console.error(`Raw frames kept in ${temporary}`);
}
