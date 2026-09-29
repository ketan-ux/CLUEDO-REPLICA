import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: here,
  plugins: [react()],
  resolve: {
    alias: {
      '@shared': path.resolve(here, '../shared'),
      '@client': path.resolve(here, 'src'),
    },
  },
  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: false,
    // The sandbox preview proxies this dev server through a public host name.
    allowedHosts: true,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8787',
        changeOrigin: true,
        ws: true,
      },
    },
  },
  build: {
    outDir: path.resolve(here, '../dist'),
    emptyOutDir: true,
    sourcemap: false,
  },
});
