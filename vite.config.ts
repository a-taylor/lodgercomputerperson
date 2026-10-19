/// <reference types="node" />
import { existsSync } from 'node:fs';
import { loadEnv } from 'vite';
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

// With LCP_WORKER_URL in .env.local, `npm run dev` passes /api/* to the Cloudflare Worker that
// holds the Gemini key (worker/index.ts; run it with `npm run dev:worker`), so the game can ask
// what a line it couldn't read meant. Builds (and GitHub Pages) have no such endpoint, and the game
// behaves as if there were no model.
export default defineConfig(({ command, mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const worker = command === 'serve' && mode !== 'test' ? env.LCP_WORKER_URL : undefined;
  // Tells the game the endpoint is there, which shows the setting.
  if (worker) process.env.VITE_LCP_API_URL = '/';
  return {
    // Served from /lodgercomputerperson/ on GitHub Pages; VITE_BASE is set in the Pages build.
    base: process.env.VITE_BASE ?? '/',
    plugins: [requireArt()],
    server: worker ? { proxy: { '/api': { target: worker, changeOrigin: true } } } : {},
    // Top-level await loads the save before the game starts.
    build: { target: 'es2022' },
    test: {
      include: ['tests/**/*.test.ts'],
      // Week-long sim runs take a few seconds locally and longer on CI runners.
      testTimeout: 30_000,
    },
  };
});
