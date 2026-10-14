import { describe, expect, it } from 'vitest';
import lettersJson from '../src/data/letters.json';
import { catchUp, MAX_AWAY_MS } from '../src/sim/away';
import { makeMemorial } from '../src/sim/memorial';
import { startGame } from '../src/sim/play';
import { createSim, DAY_MS, hashState, HOUR_MS, isAsleep, run, SICK_BELOW, step, timeScaleOf, type SimState } from '../src/sim/sim';
import { makeSave, parseSave, SAVE_VERSION, SaveError, type Migration } from '../src/storage/save';
import { world } from './helpers';

const POOLS = lettersJson as Record<string, string[]>;

function saysOneOf(text: string, key: string): boolean {
  return POOLS[key]!.some((t) => new RegExp(t.split(/\{\w+\}/).map((p) => p.replace(/[.*+?^$()|[\]\\]/g, '\\$&')).join('.+?')).test(text));
}

/** A settled tenant who's been looked after, at a given hour of day 2, watched at 30x. */
function settled(seed: number, hour: number): SimState {
  const sim = createSim(world, seed, { startMinute: 8 * 60, timeScale: 30 });
  sim.playerName = 'Sam';
  while (sim.clock.ms < DAY_MS + hour * HOUR_MS) {
    step(sim, world, sim.tick % 20_000 === 0 ? [{ type: 'pat' }] : []);
  }
  return sim;
}

/** Save to JSON and back, as if the tab was closed and opened again. */
function reload(sim: SimState): SimState {
  return parseSave(JSON.parse(JSON.stringify(makeSave(sim, [], 1_000))), world).state;
}

describe('closing the tab for 12 hours', () => {
  // The phase 6 acceptance test.
  for (const [seed, leaveAt] of [
    [1, 20],
    [2, 14],
    [3, 9],
    [4, 23],
    [5, 2],
  ] as const) {
    it(`seed ${seed}, leaving at ${leaveAt}:00: he's plausibly asleep or about, fed or hungry, with a letter waiting`, () => {
      const sim = reload(settled(seed, leaveAt));
      const left = sim.clock.ms;
      const lettersBefore = sim.letters.length;
      const { letter, passedMs, died } = catchUp(sim, world, 12 * HOUR_MS);

      expect(passedMs).toBe(12 * HOUR_MS);
      expect(sim.clock.ms).toBe(left + 12 * HOUR_MS);
      expect(died).toBe(false);
      expect(sim.person.alive).toBe(true);

      // Asleep if he's come back in the small hours; and he slept at some point if a night went by.
      const hour = Math.floor((sim.clock.ms % DAY_MS) / HOUR_MS);
      const body = (hour - sim.person.identity.chronotype + 24) % 24;
      if (body >= 1 && body < 4.5) expect(isAsleep(sim, world), `back at ${hour}:00`).toBe(true);
      expect(isAsleep(sim, world) || (sim.lastDone.sleep ?? 0) > left, 'slept, or is asleep now').toBe(true);

      // Fed: plenty in the fridge, so not starving.
      expect(sim.person.needs.food).toBeGreaterThan(20);
      expect(sim.person.health).toBeGreaterThan(90);

      // A letter about the absence, unread and on top (he may have written a regular one too).
      expect(letter).not.toBeNull();
      expect(sim.letters.length).toBeGreaterThan(lettersBefore);
      expect(sim.letters.slice(lettersBefore).every((l) => !l.read)).toBe(true);
      expect(sim.letters[sim.letters.length - 1]).toBe(letter);
      expect(saysOneOf(letter!.text, 'away.opening')).toBe(true);
      // Watching speed survives the catch-up.
      expect(timeScaleOf(sim)).toBe(30);
    });
  }

  it('comes back hungry, and says so, if the fridge was empty', () => {
    // Leaving at teatime with an empty fridge, not having eaten since lunch.
    const sim = reload(settled(6, 18));
    sim.supplies.food = 0;
    sim.person.needs.food = 40;
    if (sim.person.activity?.id === 'eat') sim.person.activity = null;
    const { letter } = catchUp(sim, world, 12 * HOUR_MS);
    expect(sim.person.alive).toBe(true);
    expect(sim.person.needs.food).toBeLessThan(25);
    expect(letter!.text).toMatch(/food|hungry|stomach|meal|fridge/i);
    expect((sim.memory.at(-1)?.knocks ?? 0) + (sim.memory.at(-2)?.knocks ?? 0)).toBeGreaterThan(0);
  });

  it('is deterministic', () => {
    const a = reload(settled(7, 20));
    const b = reload(settled(7, 20));
    catchUp(a, world, 12 * HOUR_MS);
    catchUp(b, world, 12 * HOUR_MS);
    expect(hashState(a)).toBe(hashState(b));
  });

  it('short absences pass quietly, without a letter', () => {
    const sim = reload(settled(8, 15));
    const { letter } = catchUp(sim, world, 10 * 60_000);
    expect(letter).toBeNull();
  });

  it('caps very long absences', () => {
    const sim = reload(settled(9, 12));
    const { passedMs } = catchUp(sim, world, 60 * DAY_MS);
    expect(passedMs).toBe(MAX_AWAY_MS);
  });

  it('a game left half-played is abandoned', () => {
    const sim = reload(settled(10, 15));
    startGame(sim, world, 'war');
    catchUp(sim, world, 2 * HOUR_MS);
    expect(sim.game!.over).toBe(true);
    expect(sim.game!.winner).toBeNull();
  });
});

describe('sickness and death', () => {
  it('neglect makes him sick, he warns you, and he keeps to his bed', () => {
    const sim = createSim(world, 11, { startMinute: 9 * 60, timeScale: 60 });
    sim.playerName = 'Sam';
    sim.supplies.food = 0;
    sim.supplies.water = 0;
    while (!sim.person.sick && sim.person.alive) step(sim, world);
    expect(sim.person.health).toBeLessThan(SICK_BELOW);
    const start = sim.clock.ms;
    let inBed = 0;
    let awakeTicks = 0;
    const warnings = new Set<string>();
    while (sim.clock.ms < start + DAY_MS && sim.person.alive) {
      step(sim, world);
      if (sim.speech) warnings.add(sim.speech.key);
      const h = (sim.clock.ms % DAY_MS) / HOUR_MS;
      if (h > 9 && h < 20) {
        awakeTicks++;
        if (isAsleep(sim, world)) inBed++;
      }
    }
    expect(warnings.has('knock.sick') || warnings.has('knock.dying')).toBe(true);
    expect(inBed / awakeTicks).toBeGreaterThan(0.3);
  });

  it('recovers once you feed him', () => {
    const sim = createSim(world, 12, { timeScale: 60 });
    sim.person.health = 40;
    sim.person.sick = true;
    run(sim, world, Math.round((3 * DAY_MS) / sim.clock.msPerTick));
    expect(sim.person.sick).toBe(false);
    expect(sim.person.health).toBeGreaterThan(65);
  });

  it('death is slow, and warned', () => {
    const sim = createSim(world, 13, { timeScale: 60 });
    sim.playerName = 'Sam';
    sim.supplies.food = 0;
    sim.supplies.water = 0;
    const start = sim.clock.ms;
    const keys = new Set<string>();
    while (sim.person.alive && sim.clock.ms < start + 10 * DAY_MS) {
      step(sim, world);
      if (sim.speech) keys.add(sim.speech.key);
    }
    expect(sim.person.alive).toBe(false);
    expect(sim.clock.ms - start).toBeGreaterThan(1.5 * DAY_MS);
    expect(keys.has('knock.sick')).toBe(true);
    expect(keys.has('knock.dying')).toBe(true);
  });

  it('a death while you were away is reported, with no letter', () => {
    const sim = createSim(world, 14, { timeScale: 30 });
    sim.supplies.food = 0;
    sim.supplies.water = 0;
    const { died, letter } = catchUp(sim, world, 10 * DAY_MS);
    expect(died).toBe(true);
    expect(letter).toBeNull();
  });

  it('he is remembered', () => {
    const sim = createSim(world, 15, { timeScale: 60 });
    run(sim, world, Math.round((3 * DAY_MS) / sim.clock.msPerTick));
    const entry = makeMemorial(sim, 123);
    expect(entry).toMatchObject({ name: sim.person.identity.name, seed: 15, dogName: sim.dog.identity.name, daysLived: 3, diedAt: 123 });
    expect(entry.look).toEqual(sim.person.identity.look);
  });
});

describe('save files', () => {
  it('round-trip through JSON, and carry on exactly as if never saved', () => {
    const straight = createSim(world, 20, { timeScale: 30 });
    run(straight, world, 20_000);
    const saved = createSim(world, 20, { timeScale: 30 });
    run(saved, world, 10_000);
    const restored = reload(saved);
    run(restored, world, 10_000);
    expect(hashState(restored)).toBe(hashState(straight));
  });

  it('keeps the memorial and timestamps', () => {
    const sim = createSim(world, 21);
    const memorial = [makeMemorial(createSim(world, 3), 5)];
    const file = parseSave(JSON.stringify(makeSave(sim, memorial, 999)), world);
    expect(file.memorial).toEqual(memorial);
    expect([file.savedAt, file.lastSeen, file.version]).toEqual([999, 999, SAVE_VERSION]);
  });

  it('rejects things that are not saves', () => {
    for (const bad of ['not json', '{}', JSON.stringify({ format: 'other' }), JSON.stringify({ format: 'lodger-computer-person', version: 1 })]) {
      expect(() => parseSave(bad, world)).toThrow(SaveError);
    }
  });

  it('rejects saves from a newer version', () => {
    const file = { ...makeSave(createSim(world, 1), [], 0), version: SAVE_VERSION + 1 };
    expect(() => parseSave(JSON.stringify(file), world)).toThrow(/newer version/);
  });

  it('runs migrations in order to bring old saves up to date', () => {
    const v0 = { format: 'lodger-computer-person', version: 0, savedAt: 1, lastSeen: 1, tenant: makeSave(createSim(world, 4), [], 1).state };
    const migrations: Record<number, Migration> = {
      0: ({ tenant, ...rest }) => ({ ...rest, state: tenant }),
    };
    const file = parseSave(v0, world, migrations, 1);
    expect(file.version).toBe(1);
    expect(file.state.seed).toBe(4);
    expect(() => parseSave(v0, world, {}, 1)).toThrow(/Can't upgrade/);
  });

  it('fills in anything an older save is missing', () => {
    const raw = JSON.parse(JSON.stringify(makeSave(createSim(world, 22), [], 0)));
    delete raw.state.letters;
    delete raw.state.gameResults;
    delete raw.state.person.sick;
    const { state } = parseSave(raw, world);
    expect(state.letters).toEqual([]);
    expect(state.gameResults).toEqual([]);
    expect(state.person.sick).toBe(false);
    run(state, world, 1000);
  });
});
