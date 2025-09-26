import { defineConfig } from 'vite';
import path from 'node:path';

export default defineConfig({
  root: 'examples',
  server: {
    open: '/basic.html',
  },
  resolve: {
    alias: {
      'virtual-list': path.resolve(__dirname, 'src/index.ts'),
    },
  },
  build: {
    outDir: '../dist-examples',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        basic: path.resolve(__dirname, 'examples/basic.html'),
      },
    },
  },
});
