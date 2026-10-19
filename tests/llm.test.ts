import { describe, expect, it } from 'vitest';
import { generateIdentity, type Identity } from '../src/sim/identity';
import { handleSay } from '../src/sim/interactions';
import { MAX_INTENT_ITEMS, validateIntents } from '../src/sim/parser';
import { createSim, hashState, step, type SimState } from '../src/sim/sim';
import { ModelError, remoteModel, withBreaker, type RemoteModel } from '../src/llm/model';
import { world } from './helpers';

const ctx = { dogName: 'Biscuit' };

/** A fetch that answers with this status and body, counting calls. */
function fakeFetch(status: number, body: unknown) {
  const calls: { url: string; body: unknown }[] = [];
  const fn = (async (url: string, init?: RequestInit) => {
    calls.push({ url, body: JSON.parse(String(init?.body)) });
    return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status });
  }) as typeof fetch;
  return { fn, calls };
}

describe('checking a model answer', () => {
  it('keeps known intents and drops everything else', () => {
    const items = validateIntents({
      items: [
        { intent: 'piano', politeness: 1 },
        { intent: 'launchRockets', politeness: 0 },
        { intent: 'name', politeness: 0 },
        { intent: 'goTo' },
        { intent: 'goTo', room: 'dungeon' },
        { intent: 'goTo', room: 'kitchen', politeness: 7 },
        { intent: 'game', game: 'chess' },
        'tv',
      ],
    });
    expect(items).toEqual([
      { intent: 'piano', politeness: 1 },
      { intent: 'goTo', politeness: 0, room: 'kitchen' },
      { intent: 'game', politeness: 0 },
    ]);
  });

  it('caps the list and rejects the wrong shape', () => {
    const many = { items: Array.from({ length: 9 }, () => ({ intent: 'dance', politeness: 0 })) };
    expect(validateIntents(many)).toHaveLength(MAX_INTENT_ITEMS);
    expect(validateIntents(null)).toBeNull();
    expect(validateIntents('piano')).toBeNull();
    expect(validateIntents({ items: 'piano' })).toBeNull();
    expect(validateIntents({ items: [] })).toEqual([]);
  });
});

describe('the remote model', () => {
  it('sends only the line and the dog name, and returns checked items', async () => {
    const { fn, calls } = fakeFetch(200, { items: [{ intent: 'feedDog', politeness: 1 }, { intent: 'hack' }] });
    const model = remoteModel({ url: 'https://api.test/', fetch: fn });
    expect(await model.intents('could you give the pup some grub', ctx)).toEqual([{ intent: 'feedDog', politeness: 1 }]);
    expect(calls).toEqual([{ url: 'https://api.test/api/intent', body: { text: 'could you give the pup some grub', dogName: 'Biscuit' } }]);
  });

  it('caps the line it sends', async () => {
    const { fn, calls } = fakeFetch(200, { items: [] });
    await remoteModel({ url: 'https://api.test', fetch: fn }).intents('x'.repeat(5000), ctx);
    expect((calls[0]!.body as { text: string }).text).toHaveLength(200);
  });

  it('treats junk output as no answer, not a failure', async () => {
    expect(await remoteModel({ url: 'https://api.test', fetch: fakeFetch(200, 'not json').fn }).intents('hi', ctx)).toBeNull();
    expect(await remoteModel({ url: 'https://api.test', fetch: fakeFetch(200, { text: 'sure!' }).fn }).intents('hi', ctx)).toBeNull();
  });

  it('throws on a bad status or a timeout', async () => {
    await expect(remoteModel({ url: 'https://api.test', fetch: fakeFetch(500, {}).fn }).intents('hi', ctx)).rejects.toMatchObject({ status: 500 });
    const hang = ((_: string, init?: RequestInit) =>
      new Promise((_, reject) => init?.signal?.addEventListener('abort', () => reject(init.signal!.reason)))) as typeof fetch;
    await expect(remoteModel({ url: 'https://api.test', fetch: hang, timeoutMs: 20 }).intents('hi', ctx)).rejects.toBeInstanceOf(ModelError);
  });
});

describe('the circuit breaker', () => {
  function flaky(results: (Error | null)[]): RemoteModel & { calls: number } {
    const m = {
      calls: 0,
      async intents() {
        const r = results[m.calls++];
        if (r) throw r;
        return [{ intent: 'dance' as const, politeness: 0 as const }];
      },
    };
    return m;
  }

  it('stops asking after a failure, then tries again once it has cooled', async () => {
    let t = 0;
    const remote = flaky([new ModelError('down', 503), null]);
    const model = withBreaker(remote, { coolMs: 1000, now: () => t });
    expect(await model.intents('a', ctx)).toBeNull();
    expect(model.open).toBe(true);
    t = 999;
    expect(await model.intents('a', ctx)).toBeNull();
    expect(remote.calls).toBe(1);
    t = 1000;
    expect(await model.intents('a', ctx)).toEqual([{ intent: 'dance', politeness: 0 }]);
    expect(remote.calls).toBe(2);
  });

  it('waits longer after being rate limited', async () => {
    let t = 0;
    const model = withBreaker(flaky([new ModelError('slow down', 429)]), { coolMs: 1000, rateLimitedMs: 60_000, now: () => t });
    await model.intents('a', ctx);
    t = 59_999;
    expect(model.open).toBe(true);
    t = 60_000;
    expect(model.open).toBe(false);
  });

  it('never rejects, whatever the remote throws', async () => {
    const model = withBreaker({ intents: () => Promise.reject(new TypeError('boom')) });
    await expect(model.intents('a', ctx)).resolves.toBeNull();
  });
});

describe('thinking about a line he did not follow', () => {
  function tenant(): SimState {
    const identity: Identity = { ...generateIdentity(11).person, traits: { musical: 0.9, bookish: 0.9, telly: 0.9, tidy: 0.5, sociable: 0.8 } };
    const sim = createSim(world, 1, { startMinute: 14 * 60, identity });
    sim.person.mood = 100;
    for (const id of ['food', 'water', 'energy', 'hygiene', 'fun'] as const) sim.person.needs[id] = 90;
    return sim;
  }
  const UNMATCHED = 'zorp the blarg';

  it('is confused straight away without a model, as before', () => {
    const sim = tenant();
    handleSay(sim, world, UNMATCHED);
    expect(sim.speech?.key).toBe('confused');
    expect(sim.thinking).toBeUndefined();
  });

  it('thinks, then acts on the answer, still deciding for himself', () => {
    const sim = tenant();
    step(sim, world, [{ type: 'say', text: UNMATCHED, askModel: true }]);
    expect(sim.speech?.key).toBe('thinking');
    const id = sim.thinking!.id;
    step(sim, world, [{ type: 'understood', id, answer: { items: [{ intent: 'piano', politeness: 1 }, { intent: 'dance', politeness: 1 }] } }]);
    expect(sim.thinking).toBeUndefined();
    expect(sim.person.activity?.id).toBe('piano');
    expect(sim.queue.map((q) => q.activity)).toEqual(['dance']);
  });

  it('handles chat the model recognised', () => {
    const sim = tenant();
    step(sim, world, [{ type: 'say', text: UNMATCHED, askModel: true }]);
    step(sim, world, [{ type: 'understood', id: sim.thinking!.id, answer: { items: [{ intent: 'greet', politeness: 0 }] } }]);
    expect(sim.speech?.key).toBe('greet');
  });

  it('is confused when the model has no answer or a useless one', () => {
    for (const answer of [null, { items: [] }, { items: [{ intent: 'fly' }] }, 'junk']) {
      const sim = tenant();
      step(sim, world, [{ type: 'say', text: UNMATCHED, askModel: true }]);
      step(sim, world, [{ type: 'understood', id: sim.thinking!.id, answer }]);
      expect(sim.speech?.key).toBe('confused');
    }
  });

  it('ignores an answer to an older line', () => {
    const sim = tenant();
    step(sim, world, [{ type: 'say', text: UNMATCHED, askModel: true }]);
    const old = sim.thinking!.id;
    step(sim, world, [{ type: 'say', text: 'flibber', askModel: true }]);
    step(sim, world, [{ type: 'understood', id: old, answer: { items: [{ intent: 'piano', politeness: 0 }] } }]);
    expect(sim.thinking?.text).toBe('flibber');
    expect(sim.person.activity?.id).not.toBe('piano');
  });

  it('replays identically from the same commands', () => {
    const play = () => {
      const sim = tenant();
      step(sim, world, [{ type: 'say', text: UNMATCHED, askModel: true }]);
      const id = sim.thinking!.id;
      for (let i = 0; i < 40; i++) step(sim, world);
      step(sim, world, [{ type: 'understood', id, answer: { items: [{ intent: 'tv', politeness: 0 }] } }]);
      for (let i = 0; i < 2000; i++) step(sim, world);
      return hashState(sim);
    };
    expect(play()).toBe(play());
  });
});
