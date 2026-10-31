/// <reference types="vitest/config" />
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  define: {
    __APP_BUILD_TIME__: JSON.stringify(new Date().toISOString()),
  },
  build: {
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL('./index.html', import.meta.url)),
        dropOverlay: fileURLToPath(new URL('./drop-overlay.html', import.meta.url)),
      },
    },
  },
  clearScreen: false,
  server: {
    host: '127.0.0.1',
    port: 1420,
    strictPort: true,
    watch: {
      ignored: ['**/src-tauri/target/**'],
    },
  },
  preview: {
    host: '127.0.0.1',
    port: 4171,
    strictPort: true,
  },
  test: {
    // 테마 대비 시험이 styles.css 원문을 `?raw`로 읽도록 이 파일만 CSS 처리 허용(Vitest 기본값은 CSS 내용을 비움)
    css: { include: [/\/src\/styles\.css/] },
  },
});
