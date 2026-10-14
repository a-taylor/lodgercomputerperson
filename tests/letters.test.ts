import { describe, expect, it } from 'vitest';
import lettersJson from '../src/data/letters.json';
import { generateIdentity, type Identity } from '../src/sim/identity';
import { handleSay } from '../src/sim/interactions';
import { countPhrase, UNIQUE_WITHIN, writeLetter } from '../src/sim/letters';
import { remember } from '../src/sim/memory';
import { createSim, DAY_MS, HOUR_MS, step, type Command, type SimState } from '../src/sim/sim';
import { world } from './helpers';

const POOLS = lettersJson as Record<string, string[]>;

/** True if the text contains some line from the pool, whatever its slots were filled with. */
function saysOneOf(text: string, key: string): boolean {
  return POOLS[key]!.some((template) => {
    const pattern = template
      .split(/\{\w+\}/)
      .map((part) => part.replace(/[.*+?^$()|[\]\\]/g, '\\$&'))
      .join('.+?');
    return new RegExp(pattern).test(text);
  });
}

function tenant(seed = 1, traits: Partial<Identity['traits']> = {}): SimState {
  const base = generateIdentity(seed).person;
  const identity = { ...base, traits: { ...base.traits, ...traits } };
  const sim = createSim(world, seed, { startMinute: 14 * 60, identity });
  sim.playerName = 'Sam';
  sim.lastInteractionMs = sim.clock.ms;
  return sim;
}

/** A month in the life, with a reasonable player: groceries daily, a pat now and then, a record weekly. */
function liveAMonth(seed: number): SimState {
  const sim = createSim(world, seed, { timeScale: 30 });
  sim.playerName = 'Sam';
  const ticksPerHour = HOUR_MS / sim.clock.msPerTick;
  const days = 32;
  for (let hour = 0; hour < days * 24; hour++) {
    const day = Math.floor(hour / 24);
    const commands: Command[] = [];
    if (hour % 24 === 10) commands.push({ type: 'deliver', item: 'food' }, { type: 'deliver', item: 'water' });
    if (hour % 24 === 11) commands.push({ type: 'deliver', item: 'dogFood' }, { type: 'pat' });
    if (hour % 24 === 15 && day % 7 === 3) commands.push({ type: 'deliver', item: 'record' });
    if (hour % 24 === 16 && day % 5 === 1) commands.push({ type: 'deliver', item: 'book' });
    if (hour % 24 === 18 && day % 3 === 0) commands.push({ type: 'say', text: 'please play the piano' });
    step(sim, world, commands);
    for (let t = 1; t < ticksPerHour; t++) step(sim, world);
  }
  return sim;
}

describe('no repeated letter within 30 letters', () => {
  it('holds for 40 letters written from exactly the same situation', () => {
    const sim = tenant(3);
    const texts: string[] = [];
    for (let i = 0; i < 40; i++) {
      texts.push(writeLetter(sim).text);
      sim.clock.ms += HOUR_MS;
    }
    for (let i = 0; i < texts.length; i++) {
      const window = texts.slice(Math.max(0, i - UNIQUE_WITHIN), i);
      expect(window, `letter ${i}`).not.toContain(texts[i]);
    }
  });

  it('holds across a month of his real letters', () => {
    const sim = liveAMonth(12);
    // He writes on his own every day or two; top up with requests to get well past 30.
    let asked = 0;
    while (sim.letters.length < 36 && asked < 40) {
      writeLetter(sim);
      sim.clock.ms += 3 * HOUR_MS;
      asked++;
    }
    const texts = sim.letters.map((l) => l.text);
    expect(texts.length).toBeGreaterThanOrEqual(36);
    for (let i = 0; i < texts.length; i++) {
      expect(texts.slice(Math.max(0, i - UNIQUE_WITHIN), i)).not.toContain(texts[i]);
    }
  }, 30_000);
});

describe('letters he writes on his own', () => {
  it('arrive every day or two, unprompted', () => {
    const sim = liveAMonth(5);
    const natural = sim.letters.length;
    expect(natural).toBeGreaterThanOrEqual(10);
    expect(natural).toBeLessThanOrEqual(25);
    expect(sim.speechLog.some((l) => l.key === 'letter.done') || natural > 0).toBe(true);
  }, 30_000);

  it('are addressed to you and signed by him', () => {
    const sim = tenant(4);
    const { text } = writeLetter(sim);
    expect(text.split('\n')[0]).toMatch(/Sam|friend/);
    expect(text).toContain(sim.person.identity.name);
  });

  it('come when you ask for one', () => {
    const sim = tenant(6);
    sim.person.mood = 100;
    sim.lastLetterMs = sim.clock.ms;
    expect(handleSay(sim, world, 'could you write me a letter, please?')).toEqual({ kind: 'comply' });
    for (let i = 0; i < 40_000 && sim.letters.length === 0; i++) step(sim, world);
    expect(sim.letters).toHaveLength(1);
    expect(sim.letters[0]!.read).toBe(false);
    step(sim, world, [{ type: 'readLetter', id: sim.letters[0]!.id }]);
    expect(sim.letters[0]!.read).toBe(true);
  });
});

describe('letters say what really happened', () => {
  it('mentions hunger when he is hungry', () => {
    const sim = tenant(1);
    sim.person.needs.food = 10;
    expect(saysOneOf(writeLetter(sim).text, 'need.food')).toBe(true);
  });

  it('reports how he feels', () => {
    const happy = tenant(1);
    happy.person.mood = 95;
    expect(saysOneOf(writeLetter(happy).text, 'feeling.great')).toBe(true);
    const sad = tenant(1);
    sad.person.mood = 10;
    expect(saysOneOf(writeLetter(sad).text, 'feeling.awful')).toBe(true);
  });

  it('tells you what he has been doing, with counts', () => {
    const sim = tenant(2);
    remember(sim, (log) => (log.activities.piano = 4));
    const { text } = writeLetter(sim);
    expect(saysOneOf(text, 'did.piano')).toBe(true);
    expect(text).toContain('four times');
  });

  it('thanks you for a record of his favourite music, by name', () => {
    const sim = tenant(8);
    const fav = sim.person.identity.favouriteMusic;
    remember(sim, (log) => log.records.push(fav));
    const { text } = writeLetter(sim);
    expect(saysOneOf(text, 'event.recordFavourite')).toBe(true);
    expect(text).toContain(fav);
  });

  it('asks for food when the fridge is nearly empty', () => {
    const sim = tenant(1);
    sim.supplies.food = 1;
    expect(saysOneOf(writeLetter(sim).text, 'want.food')).toBe(true);
  });

  it('complains if things ran out, and if you were rude', () => {
    const sim = tenant(1);
    remember(sim, (log) => {
      log.ranOut.push('dogFood');
      log.rude = 3;
    });
    const { text } = writeLetter(sim);
    expect(saysOneOf(text, 'review.neglect')).toBe(true);
    expect(text).toMatch(/dog food/);
    expect(saysOneOf(text, 'review.rude')).toBe(true);
  });

  it('rates you as a caretaker', () => {
    const good = tenant(1);
    good.person.mood = 85;
    remember(good, (log) => {
      log.deliveries = { food: 3, water: 2 };
      log.pats = 6;
      log.polite = 4;
    });
    expect(saysOneOf(writeLetter(good).text, 'review.great')).toBe(true);

    const bad = tenant(1);
    bad.person.mood = 20;
    bad.lastInteractionMs = bad.clock.ms - 2 * DAY_MS;
    remember(bad, (log) => log.ranOut.push('food'));
    expect(saysOneOf(writeLetter(bad).text, 'review.poor')).toBe(true);
  });

  it('notices that you always win at games', () => {
    const sim = tenant(1);
    remember(sim, (log) => {
      for (let i = 0; i < 4; i++) log.games.push({ kind: 'war', winner: 'you' });
    });
    expect(saysOneOf(writeLetter(sim).text, 'games.alwaysYou')).toBe(true);
  });

  it('counts in words', () => {
    expect([1, 2, 3, 12].map(countPhrase)).toEqual(['once', 'twice', 'three times', 'lots of times']);
  });
});
