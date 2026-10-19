// The Cloudflare Worker that answers /api/intent. It holds the Gemini key (a secret: .env.local
// under `wrangler dev`, `wrangler secret put` once deployed) and runs the same code the tests
// cover in src/llm/gemini.ts. The game reaches it through the Vite dev server's proxy.
import { handleIntentRequest } from '../src/llm/gemini';

export interface Env {
  GEMINI_API_KEY?: string;
  GEMINI_MODEL?: string;
}

/** Longest request body accepted; a real one is well under this. */
const MAX_BODY = 2000;

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    if (new URL(req.url).pathname !== '/api/intent') return json(404, { error: 'not found' });
    if (req.method !== 'POST') return json(405, { error: 'POST only' });
    if (!env.GEMINI_API_KEY) return json(500, { error: 'GEMINI_API_KEY is not set' });
    const raw = await req.text();
    if (raw.length > MAX_BODY) return json(413, { error: 'too long' });
    const reply = await handleIntentRequest(raw, { apiKey: env.GEMINI_API_KEY, model: env.GEMINI_MODEL || undefined });
    // Shows in `wrangler dev`'s terminal (and `wrangler tail` once deployed).
    if (reply.status !== 200) console.warn(`[intent] ${JSON.stringify(reply.body)}`);
    return json(reply.status, reply.body);
  },
};
