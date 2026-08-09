import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist',
    sourcemap: false,
    emptyOutDir: true,
  },
  test: {
    environment: 'jsdom',
    setupFiles: './src/test-setup.ts',
    css: true,
    testTimeout: 10_000,
  },
});
