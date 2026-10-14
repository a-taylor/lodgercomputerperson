import { describe, expect, it } from 'vitest';
import { createSim, hashState, HOUR_MS, MAX_TIME_SCALE, step, TICK_MS, timeScaleOf } from '../src/sim/sim';
import { world } from './helpers';

describe('changing speed while playing', () => {
  it('speeds the clock up and down', () => {
    const sim = createSim(world, 1);
    step(sim, world, [{ type: 'setSpeed', timeScale: 60 }]);
    expect(timeScaleOf(sim)).toBe(60);
    const before = sim.clock.ms;
    step(sim, world);
    expect(sim.clock.ms - before).toBe(60 * TICK_MS);
    step(sim, world, [{ type: 'setSpeed', timeScale: 1 }]);
    expect(timeScaleOf(sim)).toBe(1);
  });

  it('ignores nonsense speeds', () => {
    const sim = createSim(world, 1, { timeScale: 30 });
    for (const timeScale of [0, -5, 2.5, NaN, MAX_TIME_SCALE + 1]) step(sim, world, [{ type: 'setSpeed', timeScale }]);
    expect(timeScaleOf(sim)).toBe(30);
  });

  it('works while he is still moving in', () => {
    const sim = createSim(world, 1, { startEmpty: true });
    step(sim, world, [{ type: 'setSpeed', timeScale: 120 }]);
    expect(sim.moveIn.stage).toBe('empty');
    expect(timeScaleOf(sim)).toBe(120);
  });

  it('does not count as keeping him company', () => {
    const sim = createSim(world, 1);
    sim.lastInteractionMs = null;
    step(sim, world, [{ type: 'setSpeed', timeScale: 10 }]);
    expect(sim.lastInteractionMs).toBeNull();
  });

  it('a day at high speed is still a plausible day', () => {
    const sim = createSim(world, 3);
    step(sim, world, [{ type: 'setSpeed', timeScale: 600 }]);
    const did = new Set<string>();
    while (sim.clock.ms < 8 * HOUR_MS + 48 * HOUR_MS) {
      step(sim, world);
      if (sim.person.activity?.id) did.add(sim.person.activity.id);
    }
    expect(sim.person.alive).toBe(true);
    for (const id of ['eat', 'drink', 'sleep']) expect(did.has(id), id).toBe(true);
  });

  it('is deterministic', () => {
    const play = () => {
      const sim = createSim(world, 9);
      for (let t = 0; t < 5000; t++) step(sim, world, t === 1000 ? [{ type: 'setSpeed', timeScale: 300 }] : t === 3000 ? [{ type: 'setSpeed', timeScale: 2 }] : []);
      return hashState(sim);
    };
    expect(play()).toBe(play());
  });
});
