import { describe, expect, it } from 'vitest';
import { generateIdentity, type Identity } from '../src/sim/identity';
import { handleSay, MAX_QUEUE } from '../src/sim/interactions';
import { splitChain } from '../src/sim/parser';
import { createSim, startActivity, step, type SimState } from '../src/sim/sim';
import { makeSave, parseSave } from '../src/storage/save';
import { world } from './helpers';

/** A settled, cheerful, musical tenant standing about. */
function tenant(seed = 1): SimState {
  const base = generateIdentity(11).person;
  const identity: Identity = {
    ...base,
    quirks: ['hummer'],
    traits: { musical: 0.9, bookish: 0.9, telly: 0.9, tidy: 0.5, sociable: 0.8 },
  };
  const sim = createSim(world, seed, { startMinute: 14 * 60, identity });
  sim.playerName = 'Sam';
  sim.person.mood = 100;
  for (const id of ['food', 'water', 'energy', 'hygiene', 'fun'] as const) sim.person.needs[id] = 90;
  return sim;
}

function stepUntil(sim: SimState, done: () => boolean, max = 200_000): boolean {
  for (let i = 0; i < max; i++) {
    if (done()) return true;
    step(sim, world);
  }
  return done();
}

/** The activities he starts, in order, until `count` have started or time runs out. */
function startedActivities(sim: SimState, count: number): string[] {
  const seen: string[] = [];
  let last = sim.person.activity;
  if (last) seen.push(last.id);
  stepUntil(sim, () => {
    const run = sim.person.activity;
    if (run && run !== last) seen.push(run.id);
    last = run;
    return seen.length >= count;
  });
  return seen;
}

/** Busy reading in the armchair. */
function reading(seed = 1): SimState {
  const sim = tenant(seed);
  startActivity(sim, world, 'read');
  stepUntil(sim, () => sim.person.activity?.step === 1 && sim.person.activity.doing);
  return sim;
}

describe('splitting chained requests', () => {
  it('splits on "then" and "and then"', () => {
    expect(splitChain('play the piano and then dance')).toEqual(['play the piano', 'dance']);
    expect(splitChain('Play the piano, then dance, then read a book')).toEqual(['Play the piano', 'dance', 'read a book']);
    expect(splitChain('please play the piano')).toEqual(['please play the piano']);
    expect(splitChain('then')).toEqual([]);
  });

  it('leaves words that merely contain "then" alone', () => {
    expect(splitChain('play something by the Athenians')).toHaveLength(1);
  });
});

describe('the request queue', () => {
  it('does chained requests in order', () => {
    for (const seed of [1, 2, 3]) {
      const sim = tenant(seed);
      expect(handleSay(sim, world, 'please play the piano and then dance')).toEqual({ kind: 'comply' });
      expect(sim.queue.map((q) => q.activity)).toEqual(['dance']);
      expect(startedActivities(sim, 2)).toEqual(['piano', 'dance']);
      expect(sim.queue).toEqual([]);
    }
  });

  it('keeps three in order while he is busy', () => {
    const sim = reading();
    expect(handleSay(sim, world, 'please play the piano, then watch tv, then dance')).toEqual({ kind: 'defer' });
    expect(sim.queue.map((q) => [q.activity, q.agreed])).toEqual([
      ['piano', true],
      ['tv', false],
      ['dance', false],
    ]);
    expect(startedActivities(sim, 4)).toEqual(['read', 'piano', 'tv', 'dance']);
  });

  it('decides on later requests when they come up, not when asked', () => {
    const sim = tenant();
    handleSay(sim, world, 'please play the piano and then put a record on');
    expect(sim.queue[0]).toMatchObject({ activity: 'music', agreed: false });
    // The records vanish before he gets to it.
    sim.supplies.records = [];
    stepUntil(sim, () => sim.queue.length === 0);
    expect(sim.speech?.key).toBe('refuse.noRecords');
    expect(sim.person.activity?.id).not.toBe('music');
    expect(sim.queue).toEqual([]);
  });

  it('adds new requests to the back while others are waiting', () => {
    const sim = reading();
    handleSay(sim, world, 'please play the piano');
    expect(handleSay(sim, world, 'please dance')).toEqual({ kind: 'defer' });
    expect(sim.speech?.key).toBe('queue.added');
    expect(sim.queue.map((q) => q.activity)).toEqual(['piano', 'dance']);
  });

  it(`remembers at most ${MAX_QUEUE} things`, () => {
    const sim = reading();
    handleSay(sim, world, 'please play the piano then dance then watch tv then exercise then have a bath then dance');
    expect(sim.queue).toHaveLength(MAX_QUEUE);
    expect(sim.speech?.key).toBe('queue.full');
  });

  it('lets an urgent need jump the queue', () => {
    const sim = reading();
    handleSay(sim, world, 'please play the piano');
    sim.person.needs.food = 3;
    const order = startedActivities(sim, 3);
    expect(order.indexOf('eat')).toBeGreaterThan(0);
    expect(order.indexOf('eat')).toBeLessThan(order.indexOf('piano'));
  });

  it('forgets requests that waited too long', () => {
    const sim = reading();
    handleSay(sim, world, 'please play the piano');
    sim.queue[0]!.untilMs = sim.clock.ms - 1;
    stepUntil(sim, () => !!sim.person.activity && sim.person.activity.id !== 'read');
    expect(sim.queue).toEqual([]);
    expect(sim.person.activity?.id).not.toBe('piano');
  });
});

describe('saves from before the queue', () => {
  function v1Save(pending: unknown) {
    const raw = JSON.parse(JSON.stringify(makeSave(tenant(), [], 0)));
    raw.version = 1;
    delete raw.state.queue;
    raw.state.pending = pending;
    return raw;
  }

  it('turn a put-off request into an agreed one at the front', () => {
    const pending = { activity: 'piano', node: null, game: null, untilMs: 123 };
    const { state } = parseSave(v1Save(pending), world);
    expect(state.queue).toEqual([{ ...pending, politeness: 0, agreed: true }]);
    expect('pending' in state).toBe(false);
  });

  it('start with an empty queue if nothing was put off', () => {
    const { state } = parseSave(v1Save(null), world);
    expect(state.queue).toEqual([]);
    expect('pending' in state).toBe(false);
  });
});
