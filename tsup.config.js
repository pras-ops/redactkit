import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.js'],
  format: ['esm'],
  dts: true,
  outDir: 'dist',
  splitting: false,
  sourcemap: false,
  clean: true,
  bundle: true,
  // Keep @mlc-ai/web-llm as external dependency (not bundled)
  // Users will need to install it separately and handle polyfills
  external: ['@mlc-ai/web-llm'],
  platform: 'browser',
  target: 'es2020',
});

