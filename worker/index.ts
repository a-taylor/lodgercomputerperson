// The Cloudflare Worker that answers /api/intent and /api/letter. It holds the Gemini key and runs
// the same code the tests cover in src/llm/gemini.ts. The game calls it straight from the
// browser, so it only answers pages served from localhost (CORS), and a rate limit covers anything
// that fakes its Origin outside a browser, with a hard daily cap behind it (worker/counter.ts).
// Secrets come from .env.local under `wrangler dev`, and from `wrangler secret` once deployed.
import { handleIntentRequest, handleLetterRequest, type ApiReply, type GeminiOptions } from '../src/llm/gemini';
import type { DailyCounter } from './counter';

// Wrangler finds the Durable Object class by this export (wrangler.jsonc, durable_objects).
export { DailyCounter } from './counter';

export interface Env {
  GEMINI_API_KEY?: string;
  GEMINI_MODEL?: string;
  /** Cloudflare's rate limiting binding (wrangler.jsonc). */
  LIMITER?: { limit(opts: { key: string }): Promise<{ success: boolean }> };
  /** The daily counter, a Durable Object (worker/counter.ts), and how many requests a day it allows. */
  DAILY?: { getByName(name: string): Pick<DailyCounter, 'take'> };
  DAILY_LIMIT?: number | string;
}

/** Used when DAILY_LIMIT isn't set (wrangler.jsonc sets it). */
const DEFAULT_DAILY_LIMIT = 300;

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
    // The hard cap: one count per request that gets this far, kept by the Durable Object.
    if (env.DAILY && !(await underDailyLimit(env.DAILY, env.DAILY_LIMIT))) return json(429, { error: 'daily limit reached' }, cors);
    const reply = await route.handle(raw, { apiKey: env.GEMINI_API_KEY, model: env.GEMINI_MODEL || undefined });
    // Shows in `wrangler dev`'s terminal (and `wrangler tail` once deployed).
    if (reply.status !== 200) console.warn(`[${new URL(req.url).pathname}] ${JSON.stringify(reply.body)}`);
    return json(reply.status, reply.body, cors);
  },
};

async function underDailyLimit(daily: NonNullable<Env['DAILY']>, limit: Env['DAILY_LIMIT']): Promise<boolean> {
  const max = Number(limit ?? DEFAULT_DAILY_LIMIT);
  const today = new Date().toISOString().slice(0, 10);
  // One counter for everything, so every request goes to the same instance.
  return daily.getByName('global').take(today, Number.isFinite(max) ? max : DEFAULT_DAILY_LIMIT);
}
