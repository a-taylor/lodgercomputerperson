import { afterEach, describe, expect, it, vi } from 'vitest';
import worker from '../worker/index';

const env = { GEMINI_API_KEY: 'test-key' };
const post = (body: string, path = '/api/intent') => new Request(`http://worker${path}`, { method: 'POST', body });

afterEach(() => vi.unstubAllGlobals());

describe('the /api/intent Worker', () => {
  it('asks Gemini with the secret key and returns the checked items', async () => {
    const gemini = vi.fn(async () =>
      Response.json({ candidates: [{ content: { parts: [{ text: '{"items":[{"intent":"piano","politeness":"polite"}]}' }] } }] }),
    );
    vi.stubGlobal('fetch', gemini);
    const res = await worker.fetch(post('{"text":"tinkle the ivories","dogName":"Biscuit"}'), env);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ items: [{ intent: 'piano', politeness: 1 }] });
    expect((gemini.mock.calls[0] as unknown as [string, RequestInit])[1].headers).toMatchObject({ 'x-goog-api-key': 'test-key' });
  });

  it('turns away other paths, other methods, big bodies and a missing key without calling Gemini', async () => {
    const gemini = vi.fn();
    vi.stubGlobal('fetch', gemini);
    expect((await worker.fetch(post('{}', '/elsewhere'), env)).status).toBe(404);
    expect((await worker.fetch(new Request('http://worker/api/intent'), env)).status).toBe(405);
    expect((await worker.fetch(post('a'.repeat(3000)), env)).status).toBe(413);
    expect((await worker.fetch(post('{"text":"hi"}'), {})).status).toBe(500);
    expect(gemini).not.toHaveBeenCalled();
  });
});
