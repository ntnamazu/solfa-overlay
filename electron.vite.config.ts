import react from '@vitejs/plugin-react';
import { defineConfig } from 'electron-vite';

export default defineConfig({
  main: {},
  // sandbox: true の preload は ESM を読み込めないため CJS 出力（既定）を維持する
  preload: {},
  renderer: {
    plugins: [react()],
  },
});
