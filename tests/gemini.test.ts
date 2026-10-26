import { describe, expect, it } from 'vitest';
import { askGemini, handleIntentRequest, RESPONSE_SCHEMA, systemPrompt } from '../src/llm/gemini';
import { MODEL_INTENTS } from '../src/sim/parser';

/** A fetch standing in for Gemini: answers with `answer` as the model's JSON text, recording the request. */
function fakeGemini(answer: unknown, status = 200) {
  const calls: { url: string; headers: Record<string, string>; body: Record<string, unknown> }[] = [];
  const fn = (async (url: string, init?: RequestInit) => {
    calls.push({ url, headers: init?.headers as Record<string, string>, body: JSON.parse(String(init?.body)) });
    const text = typeof answer === 'string' ? answer : JSON.stringify(answer);
    return new Response(status === 200 ? JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] }) : 'nope', { status });
  }) as typeof fetch;
  return { fn, calls };
}

const opts = (fetch: typeof globalThis.fetch) => ({ apiKey: 'test-key', model: 'gemini-test', fetch });

describe('asking Gemini', () => {
  it('sends the key in a header, the line as the user turn, and our schema', async () => {
    const { fn, calls } = fakeGemini({ items: [] });
    await askGemini('give the pup some grub', 'Biscuit', opts(fn));
    const call = calls[0]!;
    expect(call.url).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-test:generateContent');
    expect(call.url).not.toContain('test-key');
    expect(call.headers['x-goog-api-key']).toBe('test-key');
    expect(call.body.contents).toEqual([{ role: 'user', parts: [{ text: 'give the pup some grub' }] }]);
    expect(call.body.generationConfig).toMatchObject({ responseMimeType: 'application/json', responseSchema: RESPONSE_SCHEMA });
  });

  it('describes every intent it may use, and the dog by name', () => {
    const prompt = systemPrompt('Biscuit');
    for (const id of MODEL_INTENTS) expect(prompt).toContain(`- ${id}:`);
    expect(prompt).toContain('Biscuit');
  });

  it('turns politeness words into numbers and drops what is not on our lists', async () => {
    const { fn } = fakeGemini({
      items: [
        { intent: 'piano', politeness: 'polite' },
        { intent: 'goTo', room: 'kitchen', politeness: 'rude' },
        { intent: 'summonDemon', politeness: 'plain' },
        { intent: 'dance', politeness: 'grovelling' },
      ],
    });
    expect(await askGemini('x', 'Biscuit', opts(fn))).toEqual([
      { intent: 'piano', politeness: 1 },
      { intent: 'goTo', politeness: -1, room: 'kitchen' },
      { intent: 'dance', politeness: 0 },
    ]);
  });

  it('treats junk as no requests', async () => {
    expect(await askGemini('x', 'Biscuit', opts(fakeGemini('not json').fn))).toEqual([]);
    expect(await askGemini('x', 'Biscuit', opts(fakeGemini({ reply: 'hi' }).fn))).toEqual([]);
  });

  it('tries once more when Gemini is overloaded, but not after other failures', async () => {
    const answers = [fakeGemini(null, 503).fn, fakeGemini({ items: [{ intent: 'piano', politeness: 'plain' }] }).fn];
    let calls = 0;
    const flaky = ((...a: Parameters<typeof fetch>) => answers[calls++]!(...a)) as typeof fetch;
    expect(await askGemini('x', 'Biscuit', opts(flaky))).toEqual([{ intent: 'piano', politeness: 0 }]);
    expect(calls).toBe(2);

    for (const status of [503, 400]) {
      const { fn, calls: made } = fakeGemini(null, status);
      await expect(askGemini('x', 'Biscuit', opts(fn))).rejects.toMatchObject({ status });
      expect(made).toHaveLength(status === 503 ? 2 : 1);
    }
  });
});

describe('the dev server endpoint', () => {
  it('answers with checked items', async () => {
    const { fn } = fakeGemini({ items: [{ intent: 'feedDog', politeness: 'plain' }] });
    const reply = await handleIntentRequest(JSON.stringify({ text: 'feed the mutt', dogName: 'Biscuit' }), opts(fn));
    expect(reply).toEqual({ status: 200, body: { items: [{ intent: 'feedDog', politeness: 0 }] } });
  });

  it('rejects a bad request without calling Gemini', async () => {
    const { fn, calls } = fakeGemini({ items: [] });
    expect((await handleIntentRequest('{', opts(fn))).status).toBe(400);
    expect((await handleIntentRequest(JSON.stringify({ text: '   ' }), opts(fn))).status).toBe(400);
    expect(calls).toHaveLength(0);
  });

  it('passes on rate limiting as 429 and other failures as 502', async () => {
    const req = JSON.stringify({ text: 'hi' });
    expect((await handleIntentRequest(req, opts(fakeGemini(null, 429).fn))).status).toBe(429);
    expect((await handleIntentRequest(req, opts(fakeGemini(null, 400).fn))).status).toBe(502);
    const down = (() => Promise.reject(new TypeError('offline'))) as typeof fetch;
    expect((await handleIntentRequest(req, opts(down))).status).toBe(502);
  });

  it("reports Google's own one-line reason", async () => {
    const fn = (async () =>
      new Response(JSON.stringify({ error: { code: 400, message: 'API key not valid. Please pass a valid API key.' } }), { status: 400 })) as typeof fetch;
    const reply = await handleIntentRequest(JSON.stringify({ text: 'hi' }), opts(fn));
    expect(reply.body).toEqual({ error: 'Gemini answered 400: API key not valid. Please pass a valid API key.' });
  });
});
