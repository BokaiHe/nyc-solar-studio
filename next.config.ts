import type { NextConfig } from 'next';

// A static site: building data ships as files in public/data/nyc, so the app
// runs on GitHub Pages without a server. NEXT_PUBLIC_BASE_PATH is the Pages
// project path (e.g. /solar-3d-web), empty for local development.
const basePath = process.env.NEXT_PUBLIC_BASE_PATH || undefined;

const nextConfig: NextConfig = {
  // Keep framework-generated AI instruction files out of the repository.
  agentRules: false,
  output: 'export',
  basePath,
  trailingSlash: true,
  images: { unoptimized: true },
  turbopack: {
    resolveAlias: {
      // ONNX Runtime's build that loads its WebAssembly from env.wasm.wasmPaths
      // (public/ort) instead of bundling a second 15 MB copy.
      'onnxruntime-web/wasm': './node_modules/onnxruntime-web/dist/ort.wasm.min.mjs',
    },
  },
};

export default nextConfig;
