import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  base: process.env.STOFFPLAN_BASE_PATH || '/',
  plugins: [react()],
  test: { include: ['tests/**/*.test.ts'], testTimeout: 20000 },
  worker: { format: 'es' },
});
