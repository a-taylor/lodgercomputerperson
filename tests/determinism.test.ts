import { describe, expect, it } from 'vitest';
import { createRng, nextFloat } from '../src/sim/rng';
import { createSim, hashState, run, step, type SimState } from '../src/sim/sim';
import { world } from './helpers';

const TICKS = 20 * 60 * 30; // half an hour of sim time at 20 Hz

function trace(seed: number, ticks: number): string[] {
  const sim = createSim(world, seed);
  const out: string[] = [];
  for (let i = 0; i < ticks; i++) {
    step(sim, world);
    if (i % 500 === 0) out.push(hashState(sim));
  }
  return out;
}

describe('rng', () => {
  it('produces the same sequence for the same seed', () => {
    const a = createRng(123);
    const b = createRng(123);
    for (let i = 0; i < 1000; i++) expect(nextFloat(a)).toBe(nextFloat(b));
  });

  it('stays in [0, 1)', () => {
    const r = createRng(1);
    for (let i = 0; i < 10000; i++) {
      const v = nextFloat(r);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

describe('seeded simulation', () => {
  it('is identical for the same seed, tick by tick', () => {
    expect(trace(1985, TICKS)).toEqual(trace(1985, TICKS));
  });

  it('differs between seeds', () => {
    const a = createSim(world, 1);
    const b = createSim(world, 2);
    run(a, world, TICKS);
    run(b, world, TICKS);
    expect(hashState(a)).not.toBe(hashState(b));
  });

  it('matches a recorded fingerprint', () => {
    const sim = createSim(world, 1985);
    run(sim, world, TICKS);
    // If this changes, sim behaviour changed. Update it deliberately, not casually.
    expect(hashState(sim)).toMatchInlineSnapshot(`"b75886d6"`);
  });

  it('resumes identically from a JSON round-trip of its state', () => {
    const straight = createSim(world, 77);
    run(straight, world, TICKS);

    const first = createSim(world, 77);
    run(first, world, TICKS / 2);
    const restored = JSON.parse(JSON.stringify(first)) as SimState;
    run(restored, world, TICKS / 2);

    expect(restored).toEqual(straight);
  });

  it('applies commands deterministically', () => {
    const play = () => {
      const sim = createSim(world, 5);
      for (let i = 0; i < 5000; i++) {
        step(sim, world, i % 700 === 0 ? [{ type: 'goTo', node: world.house.nodeIds[i % world.house.nodeIds.length]! }] : []);
      }
      return hashState(sim);
    };
    expect(play()).toBe(play());
  });

  it('does not touch Math.random', () => {
    const original = Math.random;
    Math.random = () => {
      throw new Error('Math.random used in sim');
    };
    try {
      const sim = createSim(world, 3);
      run(sim, world, 5000);
    } finally {
      Math.random = original;
    }
  });

  it('wanders around the whole house over time', () => {
    const sim = createSim(world, 2024, { timeScale: 60 });
    const rooms = new Set<string>();
    for (let i = 0; i < TICKS; i++) {
      step(sim, world);
      rooms.add(world.house.nodes.get(sim.person.at)!.room);
    }
    expect(rooms.size).toBe(world.house.def.rooms.length);
  });
});
