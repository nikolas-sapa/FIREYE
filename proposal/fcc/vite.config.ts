import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import cesium from 'vite-plugin-cesium';
import { fileURLToPath, URL } from 'node:url';
import { createImageLabMiddleware } from './server/image-lab';
import { createMonitoringMiddleware } from './server/monitoring';

const p = (rel: string) => fileURLToPath(new URL(rel, import.meta.url));

function imageLab(): Plugin {
  let key = '';
  return {
    name: 'fcc-local-image-lab',
    configResolved(config) { key = process.env.FAL_KEY || loadEnv(config.mode, config.envDir, '').FAL_KEY || ''; },
    configureServer(server) { server.middlewares.use(createImageLabMiddleware(() => key)); },
    configurePreviewServer(server) { server.middlewares.use(createImageLabMiddleware(() => key)); },
  };
}

function monitoring(): Plugin {
  let env: Record<string, string> = {};
  const middleware = createMonitoringMiddleware(() => ({
    firmsKey: process.env.FIRMS_MAP_KEY || env.FIRMS_MAP_KEY,
    windyKey: process.env.WINDY_API_KEY || env.WINDY_API_KEY,
    contact: process.env.FCC_APP_CONTACT || env.FCC_APP_CONTACT,
  }));
  return {
    name: 'fcc-local-monitoring',
    configResolved(config) { env = loadEnv(config.mode, config.envDir, ''); },
    configureServer(server) { server.middlewares.use(middleware); },
    configurePreviewServer(server) { server.middlewares.use(middleware); },
  };
}

export default defineConfig({
  plugins: [react(), cesium(), imageLab(), monitoring()],
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
