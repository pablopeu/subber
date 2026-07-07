import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// API + font requests are proxied to the export backend (see server/).
export default defineConfig({
  plugins: [react()],
  server: {
    host: true, // listen on all interfaces so the app is reachable over LAN
    proxy: {
      '/api': 'http://localhost:3001',
      '/fonts': 'http://localhost:3001',
    },
  },
});
