import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

// 기본 빌드: GitHub Pages(https://jdh-ops.github.io/hero/)용
// single 모드: 모든 걸 index.html 하나에 넣은 미리보기용
export default defineConfig(({ mode }) => ({
  base: mode === 'single' ? './' : '/hero/',
  plugins: mode === 'single' ? [viteSingleFile()] : [],
  build: {
    outDir: mode === 'single' ? 'dist-single' : 'dist',
    chunkSizeWarningLimit: 2000,
  },
}));
