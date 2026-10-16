import { describe, expect, it } from 'vitest';
import activitiesJson from '../src/data/activities.json';
import type { ActivityDef } from '../src/sim/activities';
import { CRITICAL, NEED_IDS } from '../src/sim/needs';
import {
  createSim,
  DAY_MS,
  HOUR_MS,
  isAsleep,
  MINUTE_MS,
  run,
  scoreActivities,
  step,
  type SimState,
} from '../src/sim/sim';
import { buildWorld } from '../src/sim/world';
import { houseDef, world } from './helpers';

const CORE = ['eat', 'drink', 'sleep', 'wash', 'tv', 'read', 'piano', 'feedDog'];
const LEISURE = ['tv', 'read', 'piano'];
const activityDefs = activitiesJson.activities as ActivityDef[];

interface Run {
  id: string;
  start: number;
  end: number;
}

interface WeekLog {
  sim: SimState;
  runs: Run[];
  /** Whether he was asleep at 03:00 and at 12:00 (body clock) on each day. */
  asleepAt: Map<number, { night: boolean; noon: boolean }>;
  minNeed: number;
  minMood: number;
  longestWalkTicks: number;
}

/** Leaves him alone for a week, starting 08:00 on day 0, and records what he did. */
function liveAWeek(seed: number, timeScale: number): WeekLog {
  const sim = createSim(world, seed, { timeScale });
  const runs: Run[] = [];
  const asleepAt = new Map<number, { night: boolean; noon: boolean }>();
  let current: Run | null = null;
  let minNeed = 100;
  let minMood = 100;
  let walkTicks = 0;
  let longestWalkTicks = 0;
  const end = 8 * HOUR_MS + 7 * DAY_MS;

  while (sim.clock.ms < end) {
    step(sim, world);
    const a = sim.person.activity;
    if (current && (!a || a.startedMs !== current.start || a.id !== current.id)) {
      current.end = sim.clock.ms;
      current = null;
    }
    if (a && !current) {
      current = { id: a.id, start: a.startedMs, end: end };
      runs.push(current);
    }

    walkTicks = sim.person.path.length > 0 ? walkTicks + 1 : 0;
    longestWalkTicks = Math.max(longestWalkTicks, walkTicks);
    for (const id of NEED_IDS) minNeed = Math.min(minNeed, sim.person.needs[id]);
    minNeed = Math.min(minNeed, sim.dog.food);
    if (sim.clock.ms > DAY_MS) minMood = Math.min(minMood, sim.person.mood);

    // Sample at 03:00 and 12:00 by his body clock.
    const bodyMs = sim.clock.ms - Math.round(sim.person.identity.chronotype * HOUR_MS);
    const msOfDay = bodyMs % DAY_MS;
    const day = Math.floor(bodyMs / DAY_MS);
    const slot = asleepAt.get(day) ?? { night: false, noon: false };
    if (Math.abs(msOfDay - 3 * HOUR_MS) < sim.clock.msPerTick) slot.night = isAsleep(sim, world);
    if (Math.abs(msOfDay - 12 * HOUR_MS) < sim.clock.msPerTick) slot.noon = isAsleep(sim, world);
    asleepAt.set(day, slot);
  }
  return { sim, runs, asleepAt, minNeed, minMood, longestWalkTicks };
}

/** Runs that started on a given day (day 0 starts at midnight). */
function runsOnDay(log: WeekLog, day: number): Run[] {
  return log.runs.filter((r) => Math.floor(r.start / DAY_MS) === day);
}

function hourOf(ms: number): number {
  return (ms % DAY_MS) / HOUR_MS;
}

/** Hour by his body clock, so early birds and night owls are judged by their own day. */
function bodyHourOf(sim: SimState, ms: number): number {
  return hourOf(ms - sim.person.identity.chronotype * HOUR_MS + DAY_MS);
}

function checkWeek(log: WeekLog): void {
  const { sim, runs } = log;

  // Alive and well.
  expect(sim.person.alive).toBe(true);
  expect(sim.person.health).toBeGreaterThan(90);
  expect(log.minNeed).toBeGreaterThan(CRITICAL);
  expect(log.minMood).toBeGreaterThan(40);

  // Did every core activity, and finished them.
  for (const id of CORE) expect(runs.some((r) => r.id === id), id).toBe(true);

  // Never stuck: no walk takes more than a couple of minutes of ticks, nothing but sleep runs over three hours,
  // and there is never a long stretch without something new starting.
  expect(log.longestWalkTicks).toBeLessThan(2000);
  for (const r of runs.slice(0, -1)) {
    const limit = r.id === 'sleep' ? 12 * HOUR_MS : 3 * HOUR_MS;
    expect(r.end - r.start, `${r.id} at day ${Math.floor(r.start / DAY_MS)} ${hourOf(r.start).toFixed(2)}h`).toBeLessThan(limit);
  }

  // A plausible day, every full day of the week.
  const daySequences = new Set<string>();
  for (let day = 1; day <= 6; day++) {
    const today = runsOnDay(log, day);
    const count = (id: string) => today.filter((r) => r.id === id).length;
    const ctx = `day ${day}`;

    const bedtimes = today.filter((r) => r.id === 'sleep' && r.end - r.start > 4 * HOUR_MS);
    expect(bedtimes.length, ctx).toBe(1);
    expect(bodyHourOf(sim, bedtimes[0]!.start), ctx).toBeGreaterThanOrEqual(19);
    expect(log.asleepAt.get(day)!.night, `${ctx} 03:00`).toBe(true);
    expect(log.asleepAt.get(day)!.noon, `${ctx} 12:00`).toBe(false);

    expect(count('eat'), ctx).toBeGreaterThanOrEqual(2);
    expect(count('drink'), ctx).toBeGreaterThanOrEqual(2);
    expect(count('feedDog'), ctx).toBeGreaterThanOrEqual(1);
    expect(new Set(today.filter((r) => LEISURE.includes(r.id)).map((r) => r.id)).size, ctx).toBeGreaterThanOrEqual(2);

    // Meals happen at mealtimes, not at 3am, unless he's a night snacker.
    if (!sim.person.identity.quirks.includes('nightSnacker')) {
      for (const meal of today.filter((r) => r.id === 'eat')) expect(bodyHourOf(sim, meal.start), ctx).toBeGreaterThanOrEqual(5);
    }

    daySequences.add(today.filter((r) => r.id !== 'potter').map((r) => r.id).join(','));
  }
  expect(runs.filter((r) => r.id === 'wash').length).toBeGreaterThanOrEqual(6);
  // Varied: no two days follow exactly the same script.
  expect(daySequences.size).toBe(6);
}

describe('a week alone', () => {
  it('at real time, he stays alive and lives a plausible, varied day', () => {
    checkWeek(liveAWeek(1985, 1));
  }, 30_000);

  for (const seed of [1, 2, 3, 42, 777]) {
    it(`holds for seed ${seed} (10x time)`, () => {
      checkWeek(liveAWeek(seed, 10));
    });
  }
});

describe('choosing what to do', () => {
  function top(sim: SimState): string {
    return scoreActivities(sim, world).sort((a, b) => b.score - a.score)[0]!.id;
  }

  it('eats when hungry at a mealtime', () => {
    const sim = createSim(world, 1, { startMinute: 12 * 60 + 30 });
    sim.person.needs.food = 20;
    expect(top(sim)).toBe('eat');
  });

  it('drinks when thirsty', () => {
    const sim = createSim(world, 1, { startMinute: 15 * 60 });
    sim.person.needs.water = 15;
    expect(top(sim)).toBe('drink');
  });

  it('goes to bed when tired at night but not when tired in the afternoon', () => {
    const night = createSim(world, 1, { startMinute: 23 * 60 });
    night.person.needs.energy = 35;
    expect(top(night)).toBe('sleep');

    const afternoon = createSim(world, 1, { startMinute: 15 * 60 });
    afternoon.person.needs.energy = 35;
    expect(top(afternoon)).not.toBe('sleep');
  });

  it('feeds a hungry dog', () => {
    const sim = createSim(world, 1, { startMinute: 18 * 60 });
    sim.dog.food = 10;
    expect(top(sim)).toBe('feedDog');
  });

  it('prefers a different pastime to the one he just did', () => {
    const sim = createSim(world, 1, { startMinute: 15 * 60 });
    sim.person.needs.fun = 30;
    const before = scoreActivities(sim, world).find((s) => s.id === 'piano')!.score;
    sim.lastDone.piano = sim.clock.ms - 30 * MINUTE_MS;
    const after = scoreActivities(sim, world).find((s) => s.id === 'piano')!.score;
    expect(after).toBeLessThan(before / 2);
  });

  it('drops what he is doing when a need becomes critical', () => {
    const sim = createSim(world, 1, { startMinute: 15 * 60 });
    sim.person.needs.water = 100;
    sim.person.needs.fun = 0;
    let t = 0;
    while (sim.person.activity?.id !== 'tv' && sim.person.activity?.id !== 'read' && sim.person.activity?.id !== 'piano' && t++ < 50_000) {
      step(sim, world);
    }
    expect(['tv', 'read', 'piano']).toContain(sim.person.activity?.id);
    sim.person.needs.water = CRITICAL - 1;
    step(sim, world);
    step(sim, world);
    expect(sim.person.activity?.id).toBe('drink');
  });

  it('runs a multi-step activity through every step', () => {
    const sim = createSim(world, 1, { startMinute: 12 * 60 + 30, timeScale: 10 });
    sim.person.needs.food = 10;
    const nodes = new Set<string>();
    let t = 0;
    while (t++ < 100_000) {
      step(sim, world);
      const a = sim.person.activity;
      if (a?.id === 'eat' && a.doing) nodes.add(a.node);
      if (sim.lastDone.eat !== undefined) break;
    }
    expect([...nodes]).toEqual(['kitchen.fridge', 'kitchen.stove', 'kitchen.table']);
    expect(sim.person.needs.food).toBeGreaterThan(40);
  });
});

describe('neglect', () => {
  it('kills him slowly if there is nothing to eat or drink', () => {
    const bare = buildWorld(
      houseDef,
      activityDefs.filter((a) => a.id !== 'eat' && a.id !== 'drink'),
    );
    const sim = createSim(bare, 1, { timeScale: 60 });
    // He survives the first day...
    run(sim, bare, (DAY_MS / sim.clock.msPerTick) | 0);
    expect(sim.person.alive).toBe(true);
    expect(sim.person.mood).toBeLessThan(50);
    // ...but not indefinitely.
    let t = 0;
    while (sim.person.alive && t++ < 2_000_000) step(sim, bare);
    expect(sim.person.alive).toBe(false);
    expect(sim.person.activity).toBeNull();
    expect(sim.clock.ms).toBeGreaterThan(1.5 * DAY_MS);
  });
});

describe('activity data', () => {
  it('rejects activities at unknown nodes or with unknown needs', () => {
    const badNode = structuredClone(activityDefs);
    badNode[0]!.steps[0]!.node = 'attic.trunk';
    expect(() => buildWorld(houseDef, badNode)).toThrow(/unknown node/);

    const badNeed = structuredClone(activityDefs);
    (badNeed[0]!.adverts as Record<string, number>).happiness = 10;
    expect(() => buildWorld(houseDef, badNeed)).toThrow(/unknown need/);
  });

  it('has all eight core activities', () => {
    for (const id of CORE) expect(world.activities.byId.has(id), id).toBe(true);
  });
});

describe('needs near the threshold', () => {
  it('finishes a drink and a meal instead of bouncing between needs', () => {
    // From a real save: food, water and energy all hovering around CRITICAL, nothing ever finished.
    const sim = createSim(world, 7, { startMinute: 9 * 60 + 29 });
    sim.playerName = 'Sam';
    Object.assign(sim.person.needs, { food: 8.2, water: 6.2, energy: 7.75, hygiene: 71, fun: 0 });
    run(sim, world, (3 * HOUR_MS) / sim.clock.msPerTick);
    expect(sim.lastDone.drink).toBeDefined();
    expect(sim.lastDone.eat).toBeDefined();
    expect(sim.person.needs.water).toBeGreaterThan(20);
    expect(sim.person.needs.food).toBeGreaterThan(20);
  });

  it('rests properly in bed when ill, even if not tired', () => {
    const sim = createSim(world, 7, { startMinute: 15 * 60 });
    sim.playerName = 'Sam';
    Object.assign(sim.person, { health: 40, sick: true });
    sim.person.needs.energy = 100;
    const naps: number[] = [];
    let started: number | null = null;
    for (let i = 0; i < (8 * HOUR_MS) / sim.clock.msPerTick; i++) {
      step(sim, world);
      const asleep = isAsleep(sim, world);
      if (asleep && started === null) started = sim.clock.ms;
      if (!asleep && started !== null) {
        naps.push(sim.clock.ms - started);
        started = null;
      }
    }
    expect(naps.length).toBeGreaterThan(0);
    for (const nap of naps) expect(nap).toBeGreaterThanOrEqual(2 * HOUR_MS - MINUTE_MS);
  });
});
