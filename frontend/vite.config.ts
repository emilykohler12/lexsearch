import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: '127.0.0.1',
    port: 5180,
    strictPort: true,
    // Same origin in development: the browser talks to Vite and Vite forwards /api.
    proxy: {
      '/api': 'http://127.0.0.1:4000',
    },
  },
  preview: {
    host: '127.0.0.1',
    port: 5180,
    proxy: {
      '/api': 'http://127.0.0.1:4000',
    },
  },
});
