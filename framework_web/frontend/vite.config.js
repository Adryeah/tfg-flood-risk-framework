import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Cesium se carga dinámicamente desde CDN dentro de tour-map.jsx
// (ver loadCesium() ahí). Decisión: el plugin oficial inyecta un
// <script src="/cesium/Cesium.js"> en index.html que se descarga
// ~800 KB en TODA la app aunque el visitante no llegue a /tour.
// Con CDN dinámico cargamos cero coste salvo cuando se necesita.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // mapcn (and other shadcn-style components) expect `@/lib/utils` etc.
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      },
    },
  },
  build: {
    target: 'es2020',
    sourcemap: true,
    rollupOptions: {
      output: {
        manualChunks: (id) => {
          if (id.includes('echarts')) return 'echarts';
        },
      },
    },
  },
});