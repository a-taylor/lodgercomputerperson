import { afterEach, describe, expect, it, vi } from 'vitest';
import worker, { type Env } from '../worker/index';

const allow = { limit: async () => ({ success: true }) };
const env: Env = { GEMINI_API_KEY: 'test-key', LIMITER: allow };
const LOCAL = 'http://localhost:5173';
const post = (body: string, { path = '/api/intent', origin = LOCAL as string | null } = {}) =>
  new Request(`http://worker${path}`, { method: 'POST', body, headers: origin ? { origin } : {} });

afterEach(() => vi.unstubAllGlobals());

describe('the /api/intent Worker', () => {
  it('asks Gemini with the secret key and lets the local page read the checked items', async () => {
    const gemini = vi.fn(async () =>
      Response.json({ candidates: [{ content: { parts: [{ text: '{"items":[{"intent":"piano","politeness":"polite"}]}' }] } }] }),
    );
    vi.stubGlobal('fetch', gemini);
    const res = await worker.fetch(post('{"text":"tinkle the ivories","dogName":"Biscuit"}'), env);
    expect(res.status).toBe(200);
    expect(res.headers.get('access-control-allow-origin')).toBe(LOCAL);
    expect(await res.json()).toEqual({ items: [{ intent: 'piano', politeness: 1 }] });
    expect((gemini.mock.calls[0] as unknown as [string, RequestInit])[1].headers).toMatchObject({ 'x-goog-api-key': 'test-key' });
  });

  it('answers the preflight for localhost pages on any port', async () => {
    for (const origin of ['http://localhost:5173', 'http://127.0.0.1:4173', 'http://localhost']) {
      const res = await worker.fetch(new Request('http://worker/api/intent', { method: 'OPTIONS', headers: { origin } }), env);
      expect(res.status).toBe(204);
      expect(res.headers.get('access-control-allow-origin')).toBe(origin);
      expect(res.headers.get('access-control-allow-headers')).toBe('content-type');
    }
  });

  it('turns away other origins, other paths and methods, big bodies and a missing key without calling Gemini', async () => {
    const gemini = vi.fn();
    vi.stubGlobal('fetch', gemini);
    const body = '{"text":"hi"}';
    for (const origin of [null, 'https://a-taylor.github.io', 'http://localhost.evil.example', 'https://localhost:5173']) {
      const res = await worker.fetch(post(body, { origin }), env);
      expect(res.status).toBe(403);
      expect(res.headers.get('access-control-allow-origin')).toBeNull();
    }
    expect((await worker.fetch(post(body, { path: '/elsewhere' }), env)).status).toBe(404);
    expect((await worker.fetch(new Request('http://worker/api/intent', { headers: { origin: LOCAL } }), env)).status).toBe(405);
    expect((await worker.fetch(post('a'.repeat(3000)), env)).status).toBe(413);
    expect((await worker.fetch(post(body), { ...env, GEMINI_API_KEY: undefined })).status).toBe(500);
    expect(gemini).not.toHaveBeenCalled();
  });

  it('answers 429 once the rate limit is used up, and checks the origin first so other sites cannot use it up', async () => {
    const gemini = vi.fn();
    vi.stubGlobal('fetch', gemini);
    const limit = vi.fn(async () => ({ success: false }));
    const limited = { ...env, LIMITER: { limit } };
    expect((await worker.fetch(post('{"text":"hi"}', { origin: 'https://elsewhere.example' }), limited)).status).toBe(403);
    expect(limit).not.toHaveBeenCalled();
    const res = await worker.fetch(post('{"text":"hi"}'), limited);
    expect(res.status).toBe(429);
    expect(res.headers.get('access-control-allow-origin')).toBe(LOCAL);
    expect(gemini).not.toHaveBeenCalled();
  });
});
