import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwind from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwind()],
  server: {
    // 绑 127.0.0.1 而非默认 localhost（避免 macOS 上 IPv6 vs IPv4 不一致导致 chrome 连不上）
    host: '127.0.0.1',
    port: 4178,
    // strict：如果 4178 被占用直接报错，不自动切到其他端口（避免撞 server 的 4179）
    strictPort: true,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:4179',
        changeOrigin: true,
      },
      '/ws': {
        target: 'ws://127.0.0.1:4179',
        ws: true,
      },
    },
  },
});
