import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  build: {
    lib: {
      entry: resolve(__dirname, 'src/index.js'),
      name: 'Preprocessor',
      fileName: 'index',
      formats: ['es']
    },
    rollupOptions: {
      external: [], // Bundle everything
      output: {
        format: 'es',
        dir: 'dist'
      }
    }
  },
  resolve: {
    alias: {
      'perf_hooks': 'perf_hooks' // Will be polyfilled
    }
  },
  optimizeDeps: {
    include: ['@mlc-ai/web-llm']
  }
});

