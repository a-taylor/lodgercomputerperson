// The Cloudflare Worker that answers /api/intent and /api/letter. It holds the Gemini key and runs
// the same code the tests cover in src/llm/gemini.ts. The game calls it straight from the
// browser, so it only answers pages served from localhost (CORS), and a rate limit covers anything
// that fakes its Origin outside a browser. Secrets come from .env.local under `wrangler dev`, and
// from `wrangler secret` once deployed.
import { handleIntentRequest, handleLetterRequest, type ApiReply, type GeminiOptions } from '../src/llm/gemini';

export interface Env {
  GEMINI_API_KEY?: string;
  GEMINI_MODEL?: string;
  /** Cloudflare's rate limiting binding (wrangler.jsonc). */
  LIMITER?: { limit(opts: { key: string }): Promise<{ success: boolean }> };
}

/** Each endpoint and the longest body it accepts; a real one is well under this. */
const ROUTES: Record<string, { handle: (raw: string, opts: GeminiOptions) => Promise<ApiReply>; maxBody: number }> = {
  '/api/intent': { handle: handleIntentRequest, maxBody: 2000 },
  '/api/letter': { handle: handleLetterRequest, maxBody: 4000 },
};

/** Pages served by `npm run dev` or `npm run preview`, on any port. */
const allowedOrigin = (origin: string | null) => !!origin && /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const route = ROUTES[new URL(req.url).pathname];
    if (!route) return json(404, { error: 'not found' });
    const origin = req.headers.get('origin');
    // Checked before anything else, so other sites can't use up the rate limit either.
    if (!allowedOrigin(origin)) return json(403, { error: 'origin not allowed' });
    // Tells the browser this page may read the answer; `Vary` stops caches mixing origins up.
    const cors = { 'access-control-allow-origin': origin!, vary: 'Origin' };
    // The browser's preflight: asks before sending JSON to another origin.
    if (req.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: { ...cors, 'access-control-allow-methods': 'POST', 'access-control-allow-headers': 'content-type', 'access-control-max-age': '86400' },
      });
    }
    if (req.method !== 'POST') return json(405, { error: 'POST only' }, cors);
    if (!env.GEMINI_API_KEY) return json(500, { error: 'GEMINI_API_KEY is not set' }, cors);
    // One key for everyone: there is only one player, so this mostly stops a runaway loop or a script.
    if (env.LIMITER && !(await env.LIMITER.limit({ key: 'api' })).success) return json(429, { error: 'slow down' }, cors);
    const raw = await req.text();
    if (raw.length > route.maxBody) return json(413, { error: 'too long' }, cors);
    const reply = await route.handle(raw, { apiKey: env.GEMINI_API_KEY, model: env.GEMINI_MODEL || undefined });
    // Shows in `wrangler dev`'s terminal (and `wrangler tail` once deployed).
    if (reply.status !== 200) console.warn(`[${new URL(req.url).pathname}] ${JSON.stringify(reply.body)}`);
    return json(reply.status, reply.body, cors);
  },
};
