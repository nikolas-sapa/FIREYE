import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import cesium from 'vite-plugin-cesium';
import { fileURLToPath, URL } from 'node:url';
import { rename, rmdir } from 'node:fs/promises';
import { join } from 'node:path';
import { createImageLabMiddleware } from './server/image-lab';
import { createMonitoringMiddleware } from './server/monitoring';

const p = (rel: string) => fileURLToPath(new URL(rel, import.meta.url));
let thisBase = '/';
let thisOutDir = 'dist';

function imageLab(): Plugin {
  let key = '';
  let base = '/';
  const middleware = createImageLabMiddleware(() => key);
  return {
    name: 'fcc-local-image-lab',
    configResolved(config) { base = config.base; key = process.env.FAL_KEY || loadEnv(config.mode, config.envDir, '').FAL_KEY || ''; },
    configureServer(server) {
      if (base !== '/') server.middlewares.use(base, middleware);
      server.middlewares.use(middleware);
    },
    configurePreviewServer(server) {
      if (base !== '/') server.middlewares.use(base, middleware);
      server.middlewares.use(middleware);
    },
  };
}

function monitoring(): Plugin {
  let env: Record<string, string> = {};
  let base = '/';
  const middleware = createMonitoringMiddleware(() => ({
    firmsKey: process.env.FIRMS_MAP_KEY || env.FIRMS_MAP_KEY,
    windyKey: process.env.WINDY_API_KEY || env.WINDY_API_KEY,
    contact: process.env.FCC_APP_CONTACT || env.FCC_APP_CONTACT,
  }));
  return {
    name: 'fcc-local-monitoring',
    configResolved(config) { base = config.base; env = loadEnv(config.mode, config.envDir, ''); },
    configureServer(server) {
      if (base !== '/') server.middlewares.use(base, middleware);
      server.middlewares.use(middleware);
    },
    configurePreviewServer(server) {
      if (base !== '/') server.middlewares.use(base, middleware);
      server.middlewares.use(middleware);
    },
  };
}

export default defineConfig({
  base: process.env.VITE_BASE || '/',
  plugins: [react(), cesium(), {
    name: 'fcc-cesium-output',
    configResolved(config) { thisBase = config.base; thisOutDir = config.build.outDir; },
    closeBundle: {
      order: 'post', sequential: true,
      async handler() {
        const prefix = thisBase.replace(/^\/+|\/+$/g, '');
        if (!prefix) return;
        await rename(join(thisOutDir, prefix, 'cesium'), join(thisOutDir, 'cesium'));
        await rmdir(join(thisOutDir, prefix));
      },
    },
  }, imageLab(), monitoring()],
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
