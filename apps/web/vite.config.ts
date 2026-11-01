import { fileURLToPath, URL } from 'node:url';
import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vite';

export const sharedAlias = {
  '@': fileURLToPath(new URL('./src', import.meta.url)),
  // 前端直接编译 shared 源码（后端用的是 dist）
  '@quoteflow/shared': fileURLToPath(new URL('../../packages/shared/src/index.ts', import.meta.url)),
};

export default defineConfig({
  plugins: [vue()],
  resolve: { alias: sharedAlias },
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    proxy: {
      // 浏览器主流程（M17）另起一套 API 时用 QF_API_TARGET 指过去
      '/api': { target: process.env.QF_API_TARGET ?? 'http://127.0.0.1:3000', changeOrigin: false },
    },
  },
  build: { chunkSizeWarningLimit: 2000 },
});
