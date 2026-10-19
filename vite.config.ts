/// <reference types="node" />
import { existsSync } from 'node:fs';
import { loadEnv } from 'vite';
import { defineConfig, type Plugin } from 'vitest/config';
import { DEFAULT_MODEL, handleIntentRequest } from './src/llm/gemini';

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

// With a Gemini key in .env.local, `npm run dev` also answers /api/intent, so the game can ask
// what a line it couldn't read meant. The key stays in this process; the browser never sees it.
// Builds (and GitHub Pages) have no such endpoint, and the game behaves as if there were no model.
const MAX_BODY = 2000;

function intentApi(apiKey: string, model: string): Plugin {
  return {
    name: 'lcp-intent-api',
    configureServer(server) {
      server.middlewares.use('/api/intent', (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405;
          res.end();
          return;
        }
        let raw = '';
        req.on('data', (chunk: Buffer) => {
          raw += chunk;
          if (raw.length > MAX_BODY) req.destroy();
        });
        req.on('end', async () => {
          const reply = await handleIntentRequest(raw, { apiKey, model });
          if (reply.status !== 200) server.config.logger.warn(`[intent] ${JSON.stringify(reply.body)}`);
          res.statusCode = reply.status;
          res.setHeader('content-type', 'application/json');
          res.end(JSON.stringify(reply.body));
        });
      });
    },
  };
}

export default defineConfig(({ command, mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const apiKey = command === 'serve' && mode !== 'test' ? env.GEMINI_API_KEY : undefined;
  // Tells the game the endpoint is there, which shows the setting.
  if (apiKey) process.env.VITE_LCP_API_URL = '/';
  return {
    // Served from /lodgercomputerperson/ on GitHub Pages; VITE_BASE is set in the Pages build.
    base: process.env.VITE_BASE ?? '/',
    plugins: [requireArt(), ...(apiKey ? [intentApi(apiKey, env.GEMINI_MODEL || DEFAULT_MODEL)] : [])],
    // Top-level await loads the save before the game starts.
    build: { target: 'es2022' },
    test: {
      include: ['tests/**/*.test.ts'],
      // Week-long sim runs take a few seconds locally and longer on CI runners.
      testTimeout: 30_000,
    },
  };
});
