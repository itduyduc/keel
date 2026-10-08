import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// In dev, Vite serves the UI and hands everything else to the Duy My Linear server.
const server = process.env.PLUMB_DEV_SERVER || 'http://127.0.0.1:4747';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': { target: server, changeOrigin: false },
      '/auth': { target: server, changeOrigin: false },
      '/mcp': { target: server, changeOrigin: false },
      '/version': { target: server, changeOrigin: false },
    },
  },
  build: { outDir: 'dist', emptyOutDir: true, sourcemap: true },
});
