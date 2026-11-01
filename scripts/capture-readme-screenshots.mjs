// Cuts the README screenshots out of the recorded demo (docs/demo.mp4), at the
// settled end of each storyboard chapter, so stills and animation always match.
// Run after `npm run demo:record`.
//
// Usage: npm run readme:screenshots
// Environment: FFMPEG_PATH.
import { mkdir, readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';

const ffmpeg = process.env.FFMPEG_PATH ?? 'ffmpeg';
const OUT = 'docs/screenshots';
const recording = JSON.parse(await readFile('docs/demo-recording.json', 'utf8'));
const chapters = recording.chapters;
// A still just before the next chapter begins (or the recording ends).
const endOf = (index) => (index + 1 < chapters.length ? chapters[index + 1].seconds : recording.durationSeconds) - 0.3;

const shots = [
  ['map', 0],
  ['model', 1],
  ['zones', 3],
  ['shadows', 5],
  ['yield', 6],
  ['results', 7],
];
await mkdir(OUT, { recursive: true });
for (const [name, chapter] of shots) {
  const path = `${OUT}/readme-${name}.jpg`;
  const result = spawnSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-ss', endOf(chapter).toFixed(2), '-i', 'docs/demo.mp4', '-frames:v', '1', '-q:v', '3', path], { encoding: 'utf8' });
  if (result.status !== 0) throw Error(result.stderr || `Could not extract ${path}`);
  console.log(`saved ${path} (${chapters[chapter].title})`);
}
