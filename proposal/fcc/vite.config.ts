import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import cesium from 'vite-plugin-cesium';
import { fileURLToPath, URL } from 'node:url';

const p = (rel: string) => fileURLToPath(new URL(rel, import.meta.url));

export default defineConfig({
  plugins: [react(), cesium()],
  resolve: {
    alias: [
      { find: /^@ds$/, replacement: p('./src/design-system/index.ts') },
      { find: /^@ds\//, replacement: p('./src/design-system/') },
      { find: /^@\//, replacement: p('./src/') },
    ],
  },
  build: {
    chunkSizeWarningLimit: 6000,
    rollupOptions: {
      input: { main: p('./index.html'), console: p('./console.html') },
    },
  },
  server: { port: 5173, host: 'localhost' },
});
