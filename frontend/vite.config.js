import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// In dev, forward API + uploaded images to the backend (override with API_URL, e.g. for a test backend).
const api = process.env.API_URL || 'http://localhost:4000';

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': api,
      '/uploads': api,
    },
  },
});
