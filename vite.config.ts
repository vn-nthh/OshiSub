import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
// Note: COEP/COOP handled via server.headers (credentialless mode)
import { viteStaticCopy } from 'vite-plugin-static-copy';
import path from 'path';
import fs from 'fs';

import { cloudflare } from "@cloudflare/vite-plugin";

// ─── Pre-transform plugin ────────────────────────────────────────────────────
// Serves ORT runtime files (*.mjs, *.wasm) directly from node_modules in dev.
// enforce: 'pre' ensures our configureServer runs BEFORE Vite's transform
// middleware, so the response is sent raw without Vite processing it as a
// module (which triggers the "public file cannot be imported" error).
const ortDevServePlugin: Plugin = {
  name: 'ort-dev-serve',
  enforce: 'pre',
  configureServer(server) {
    server.middlewares.use((req, res, next) => {
      const url = req.url ?? '';
      // Match /ort/<filename> — strip ?import and other query params
      const match = url.match(/^\/ort\/(ort-wasm[^?#]+)/);
      if (!match) return next();

      const filename = match[1];
      const filePath = path.resolve('./node_modules/onnxruntime-web/dist', filename);

      if (!fs.existsSync(filePath)) return next();

      const isMjs = filename.endsWith('.mjs');
      res.setHeader('Content-Type', isMjs ? 'application/javascript' : 'application/wasm');
      res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
      res.setHeader('Cache-Control', 'public, max-age=86400');

      fs.createReadStream(filePath).pipe(res as unknown as NodeJS.WritableStream);
    });
  },
};

const ORT_FILES = [
  'ort-wasm-simd-threaded.mjs',
  'ort-wasm-simd-threaded.wasm',
  'ort-wasm-simd-threaded.jsep.mjs',
  'ort-wasm-simd-threaded.jsep.wasm',
  'ort-wasm-simd-threaded.asyncify.mjs',
  'ort-wasm-simd-threaded.asyncify.wasm',
];

export default defineConfig({
  plugins: [
    ortDevServePlugin,
    react(),
    // Production: copy ORT files to dist/ort/ after bundle
    viteStaticCopy({
      targets: ORT_FILES.map((f) => ({
        src: `node_modules/onnxruntime-web/dist/${f}`,
        dest: 'ort',
      })),
    }),
    cloudflare()
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  worker: {
    format: 'es',
  },
  optimizeDeps: {
    exclude: ['@ffmpeg/ffmpeg', '@ffmpeg/util', 'onnxruntime-web', 'onnxruntime-web/wasm'],
  },
  assetsInclude: ['**/*.wasm'],
  server: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      // credentialless: allows cross-origin fetches (e.g. HuggingFace CDN) without CORP headers
      // Still enables SharedArrayBuffer, and is supported by Chrome/Edge 96+
      'Cross-Origin-Embedder-Policy': 'credentialless',
    },
  },
});