import { describe, expect, it } from 'vitest';
import { cleanName, generateIdentity, NAMES, type Identity } from '../src/sim/identity';
import { createSim, DAY_MS, HOUR_MS, step } from '../src/sim/sim';
import { world } from './helpers';

const LEISURE = ['piano', 'music', 'read', 'tv'] as const;

interface Habits {
  /** Share of leisure time slots going to each pastime. */
  leisure: Record<(typeof LEISURE)[number], number>;
  /** Mean clock hour he goes to bed (hours after midnight can exceed 24). */
  bedtime: number;
}

/** Lives `days` days at 10x and summarises his habits. */
function habits(seed: number, days = 4, identity?: Identity): Habits {
  const sim = createSim(world, seed, { timeScale: 10, identity });
  const counts: Record<string, number> = {};
  const beds: number[] = [];
  let last = '';
  while (sim.clock.ms < days * DAY_MS + 8 * HOUR_MS) {
    step(sim, world);
    const a = sim.person.activity;
    const key = a ? `${a.id}@${a.startedMs}` : '';
    if (!a || key === last) continue;
    last = key;
    counts[a.id] = (counts[a.id] ?? 0) + 1;
    if (a.id === 'sleep' && sim.clock.ms > DAY_MS) {
      const h = (sim.clock.ms % DAY_MS) / HOUR_MS;
      if (h > 16 || h < 4) beds.push(h < 12 ? h + 24 : h);
    }
  }
  const total = LEISURE.reduce((n, id) => n + (counts[id] ?? 0), 0);
  const leisure = Object.fromEntries(LEISURE.map((id) => [id, (counts[id] ?? 0) / total])) as Habits['leisure'];
  return { leisure, bedtime: beds.reduce((a, b) => a + b, 0) / beds.length };
}

function leisureDistance(a: Habits, b: Habits): number {
  return LEISURE.reduce((d, id) => d + Math.abs(a.leisure[id] - b.leisure[id]), 0);
}

describe('seeded identity', () => {
  it('has 256 unique names', () => {
    expect(NAMES.length).toBe(256);
    expect(new Set(NAMES).size).toBe(256);
  });

  it('is the same for the same seed', () => {
    expect(generateIdentity(1234)).toEqual(generateIdentity(1234));
  });

  it('draws from the data and stays in range', () => {
    for (let seed = 1; seed <= 300; seed++) {
      const { person, dog } = generateIdentity(seed);
      expect(NAMES).toContain(person.name);
      expect(dog.name.length).toBeGreaterThan(0);
      for (const v of Object.values(person.traits)) expect(v).toBeGreaterThanOrEqual(0), expect(v).toBeLessThanOrEqual(1);
      expect(Math.abs(person.chronotype)).toBeLessThanOrEqual(1.5);
      expect(person.quirks.length).toBeGreaterThanOrEqual(1);
      expect(new Set(person.quirks).size).toBe(person.quirks.length);
    }
  });

  it('gives visibly different people and dogs', () => {
    const looks = new Set<string>();
    const dogs = new Set<string>();
    for (let seed = 1; seed <= 200; seed++) {
      const { person, dog } = generateIdentity(seed);
      looks.add(JSON.stringify(person.look));
      dogs.add(JSON.stringify(dog));
    }
    expect(looks.size).toBeGreaterThanOrEqual(198);
    // Dogs have a smaller space (about 2,500 equally likely combinations), so a few repeats in 200 are expected.
    expect(dogs.size).toBeGreaterThanOrEqual(185);

    const a = generateIdentity(1);
    const b = generateIdentity(2);
    expect(a.person.name).not.toBe(b.person.name);
    expect(a.person.look).not.toEqual(b.person.look);
    expect(a.dog).not.toEqual(b.dog);
  });

  it('does not change the sim when the seed is the same but identity is generated separately', () => {
    // Identity uses its own random stream, so it is fully determined before the sim starts.
    const sim = createSim(world, 99);
    expect(sim.person.identity).toEqual(generateIdentity(99).person);
    expect(sim.dog.identity).toEqual(generateIdentity(99).dog);
  });
});

describe('two seeds, two different people', () => {
  // The phase 3 acceptance test: different seeds look different and live differently.
  for (const [s1, s2] of [
    [1, 2],
    [3, 4],
    [5, 6],
    [1985, 42],
  ] as const) {
    it(`seeds ${s1} and ${s2} differ in look and habits`, () => {
      const a = generateIdentity(s1);
      const b = generateIdentity(s2);
      expect(a.person.look).not.toEqual(b.person.look);

      const ha = habits(s1);
      const hb = habits(s2);
      const differentPastimes = leisureDistance(ha, hb) >= 0.2;
      const differentBedtimes = Math.abs(ha.bedtime - hb.bedtime) >= 0.75;
      expect(differentPastimes || differentBedtimes, JSON.stringify({ ha, hb })).toBe(true);
    });
  }
});

describe('traits drive behaviour', () => {
  const base = generateIdentity(7).person;
  const withTraits = (patch: Partial<Identity>, traits: Partial<Identity['traits']> = {}): Identity => ({
    ...structuredClone(base),
    quirks: ['hummer'],
    ...patch,
    traits: { musical: 0.5, bookish: 0.5, telly: 0.5, tidy: 0.5, sociable: 0.5, ...traits },
  });

  it('a musical person plays the piano and records far more than an unmusical one', () => {
    const musical = habits(7, 6, withTraits({}, { musical: 1 }));
    const tuneless = habits(7, 6, withTraits({}, { musical: 0 }));
    const share = (h: Habits) => h.leisure.piano + h.leisure.music;
    expect(share(musical)).toBeGreaterThan(share(tuneless) * 1.5);
    expect(musical.leisure.piano).toBeGreaterThan(tuneless.leisure.piano * 1.5);
  });

  it('a bookworm reads more and a couch potato watches more TV', () => {
    const bookworm = habits(8, 6, withTraits({}, { bookish: 1, telly: 0 }));
    const couch = habits(8, 6, withTraits({}, { bookish: 0, telly: 1 }));
    expect(bookworm.leisure.read).toBeGreaterThan(couch.leisure.read * 2);
    expect(couch.leisure.tv).toBeGreaterThan(bookworm.leisure.tv * 2);
  });

  it('an early bird goes to bed well before a night owl', () => {
    const lark = habits(9, 6, withTraits({ chronotype: -1.5 }));
    const owl = habits(9, 6, withTraits({ chronotype: 1.5 }));
    expect(owl.bedtime - lark.bedtime).toBeGreaterThan(1.5);
  });
});

describe('names', () => {
  it('tidies what the player types', () => {
    expect(cleanName('  Ada   Lovelace ')).toBe('Ada Lovelace');
    expect(cleanName('   ')).toBeNull();
    expect(cleanName('x'.repeat(40))).toHaveLength(20);
  });
});
