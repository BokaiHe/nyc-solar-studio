// Copies the ONNX Runtime WebAssembly build into public/ort so the static
// site serves it next to the obstacle model (see obstacle.worker.ts). Runs
// before dev and build; the copies are not committed.
import { copyFileSync, mkdirSync } from 'node:fs';

const source = 'node_modules/onnxruntime-web/dist';
const target = 'public/ort';
mkdirSync(target, { recursive: true });
for (const name of ['ort-wasm-simd-threaded.mjs', 'ort-wasm-simd-threaded.wasm']) {
  copyFileSync(`${source}/${name}`, `${target}/${name}`);
}
