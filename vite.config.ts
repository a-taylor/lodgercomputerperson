/// <reference types="node" />
import { existsSync } from 'node:fs';
import { defineConfig, type Plugin } from 'vitest/config';

// The Penzilla art isn't in the public repo (its licence forbids redistribution), so fail early
// with a pointer to docs/art.md rather than at runtime with a missing image.
const REQUIRED_ART = ['assets/penzilla/AssetsSheet_House.png', 'assets/penzilla-protagonist/AnimationSheet.png'];

function requireArt(): Plugin {
  return {
    name: 'lcp-require-art',
    buildStart() {
      const missing = REQUIRED_ART.filter((f) => !existsSync(f));
      if (missing.length) this.error(`Penzilla art missing (${missing.join(', ')}), see docs/art.md`);
    },
  };
}

export default defineConfig({
  // Served from /lodgercomputerperson/ on GitHub Pages; VITE_BASE is set in the Pages build.
  base: process.env.VITE_BASE ?? '/',
  plugins: [requireArt()],
  // Top-level await loads the save before the game starts.
  build: { target: 'es2022' },
  test: {
    include: ['tests/**/*.test.ts'],
  },
});
