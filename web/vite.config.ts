import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Base path:
//   - GitHub Pages project page: `/itHub-self-service-portal/`
//   - Override with VITE_BASE_PATH if your repo or hosting differs
//   - Dev (npm run dev) uses '/' so Vite proxy at /api works
const base = process.env.VITE_BASE_PATH || '/';

export default defineConfig({
  base,
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:4000',
        changeOrigin: true,
      },
    },
  },
});