import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

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
    // false: no se publican ~13 MB de sourcemaps ni se expone el fuente.
    // Cambiar a 'hidden' si se añade un error-tracker que los consuma.
    sourcemap: false,
    rollupOptions: {
      output: {
        // Separa las libs pesadas en chunks propios: cachean entre deploys
        // y, con el lazy por ruta de App.jsx, maplibre solo lo bajan las
        // rutas de mapa y ag-grid solo /portfolio.
        manualChunks: (id) => {
          if (!id.includes('node_modules')) return undefined;
          if (id.includes('echarts') || id.includes('zrender')) return 'echarts';
          if (id.includes('maplibre-gl')) return 'maplibre';
          if (id.includes('ag-grid')) return 'aggrid';
          return undefined;
        },
      },
    },
  },
});