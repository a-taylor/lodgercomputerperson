import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Top-level await loads the save before the game starts.
  build: { target: 'es2022' },
  test: {
    include: ['tests/**/*.test.ts'],
  },
});
