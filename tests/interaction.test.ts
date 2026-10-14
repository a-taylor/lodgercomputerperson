import { describe, expect, it } from 'vitest';
import { generateIdentity, type Identity } from '../src/sim/identity';
import { assessRequest, handleSay, wantsAttention, type Outcome } from '../src/sim/interactions';
import { parse } from '../src/sim/parser';
import { createSim, HOUR_MS, isAsleep, run, scoreActivities, startActivity, step, type SimState } from '../src/sim/sim';
import { poolFor } from '../src/sim/speech';
import { world } from './helpers';

const PIANO_PHRASINGS = [
  'please play the piano',
  'Could you play some piano?',
  'Play the piano, please',
  'would you mind playing the piano',
  'fancy a tune on the piano?',
  'pls play piano',
  'play the pinao please',
  'Would you like to play the piano for me?',
];

function identity(traits: Partial<Identity['traits']> = {}): Identity {
  const base = generateIdentity(11).person;
  return {
    ...base,
    quirks: ['hummer'],
    traits: { musical: 0.8, bookish: 0.5, telly: 0.5, tidy: 0.5, sociable: 0.8, ...traits },
  };
}

/** A settled, comfortable tenant standing about, with a given mood. */
function tenant(seed = 1, mood = 100, traits: Partial<Identity['traits']> = {}): SimState {
  const sim = createSim(world, seed, { startMinute: 14 * 60, identity: identity(traits) });
  sim.playerName = 'Sam';
  sim.person.mood = mood;
  for (const id of ['food', 'water', 'energy', 'hygiene', 'fun'] as const) sim.person.needs[id] = 80;
  return sim;
}

function ask(sim: SimState, text: string): Outcome | null {
  return handleSay(sim, world, text);
}

function stepUntil(sim: SimState, done: () => boolean, max = 20_000): boolean {
  for (let i = 0; i < max; i++) {
    if (done()) return true;
    step(sim, world);
  }
  return done();
}

function lastSpeechKey(sim: SimState): string {
  return sim.speech!.key;
}

describe('parser', () => {
  it('understands at least five ways of asking for the piano', () => {
    for (const text of PIANO_PHRASINGS) expect(parse(text).intent, text).toBe('piano');
  });

  it('tells polite from plain from rude', () => {
    expect(parse('please play the piano').politeness).toBe(1);
    expect(parse('could you dance').politeness).toBe(1);
    expect(parse('play the piano').politeness).toBe(0);
    expect(parse('play the piano NOW').politeness).toBe(-1);
    expect(parse('PLAY THE PIANO').politeness).toBe(-1);
    expect(parse('play the piano you lazy oaf!!').politeness).toBe(-1);
    expect(parse('dance, stupid').politeness).toBe(-1);
  });

  it('maps synonyms, rooms, the dog and names', () => {
    expect(parse('watch some telly').intent).toBe('tv');
    expect(parse('put a record on').intent).toBe('music');
    expect(parse('have a bath').intent).toBe('wash');
    expect(parse('go to bed').intent).toBe('sleep');
    expect(parse('feed Biscuit', { dogName: 'Biscuit' }).intent).toBe('feedDog');
    expect(parse('feed the pooch').intent).toBe('feedDog');
    const goTo = parse('go to the kitchen');
    expect([goTo.intent, goTo.room]).toEqual(['goTo', 'kitchen']);
    const name = parse('my name is andrew');
    expect([name.intent, name.name]).toEqual(['name', 'Andrew']);
    expect(parse('how are you?').intent).toBe('howAreYou');
    expect(parse('flibbertigibbet').intent).toBeNull();
  });

  it('forgives small typos but does not invent words', () => {
    expect(parse('plaese play the piano').politeness).toBe(1);
    expect(parse('watch televison').intent).toBe('tv');
    expect(parse('play some games').intent).toBe('game');
    expect(parse('some time').intent).toBeNull();
  });
});

describe('"please play the piano"', () => {
  it('works in every phrasing for a content tenant', () => {
    PIANO_PHRASINGS.forEach((text, i) => {
      const sim = tenant(100 + i);
      expect(ask(sim, text), text).toEqual({ kind: 'comply' });
      expect(stepUntil(sim, () => sim.person.activity?.id === 'piano' && sim.person.activity.doing), text).toBe(true);
      expect(sim.person.at).toBe('den.piano');
    });
  });

  it('happens later, not never, if he is busy reading', () => {
    const sim = tenant(5);
    startActivity(sim, world, 'read');
    stepUntil(sim, () => sim.person.activity?.step === 1 && sim.person.activity.doing);
    expect(ask(sim, 'please play the piano')).toEqual({ kind: 'defer' });
    expect(sim.person.activity?.id).toBe('read');
    expect(stepUntil(sim, () => sim.person.activity?.id === 'piano', 200_000)).toBe(true);
    expect(sim.speechLog.some((l) => l.key === 'deferDone')).toBe(true);
  });
});

describe('refusals have reasons', () => {
  /** Asks in many slightly different worlds and collects the refusal reasons and what he said. */
  function refusals(setup: (sim: SimState) => void, text: string, seeds = 60) {
    const reasons = new Set<string>();
    let count = 0;
    for (let seed = 1; seed <= seeds; seed++) {
      const sim = tenant(seed);
      setup(sim);
      const out = ask(sim, text);
      if (out?.kind !== 'refuse') continue;
      count++;
      reasons.add(out.reason);
      expect(sim.speech!.key).toBe(out.reason === 'asleep' ? 'asleep' : `refuse.${out.reason}`);
      expect(poolFor(sim.speech!.key).lines.length).toBeGreaterThan(0);
    }
    return { reasons: [...reasons], count };
  }

  it.each([
    ['too tired', (s: SimState) => ((s.person.needs.energy = 10), (s.person.mood = 20)), 'please dance', 'tired'],
    ['too hungry', (s: SimState) => ((s.person.needs.food = 10), (s.person.mood = 20)), 'please play the piano', 'hungry'],
    ['just did it', (s: SimState) => ((s.lastDone.piano = s.clock.ms - 10 * 60_000), (s.person.mood = 20)), 'play the piano', 'justDid'],
    ['does not like it', (s: SimState) => ((s.person.identity.traits.musical = 0), (s.person.mood = 30)), 'play the piano', 'dislike'],
    ['rude and unhappy', (s: SimState) => (s.person.mood = 30), 'play the piano NOW', 'rude'],
    ['in a bad mood', (s: SimState) => (s.person.mood = 5), 'play the piano', 'mood'],
  ])('%s', (_, setup, text, reason) => {
    const { reasons, count } = refusals(setup, text);
    expect(count).toBeGreaterThan(10);
    expect(reasons).toEqual([reason]);
  });

  it.each([
    ['no records', (s: SimState) => (s.supplies.records = []), 'put a record on', 'noRecords'],
    ['no food', (s: SimState) => ((s.supplies.food = 0), (s.person.needs.food = 30)), 'please eat something', 'noFood'],
    ['not sleepy', (s: SimState) => (s.person.needs.energy = 95), 'please go to bed', 'notTired'],
    ['full up', (s: SimState) => (s.person.needs.food = 95), 'please have some dinner', 'full'],
    ['already doing it', (s: SimState) => startActivity(s, world, 'tv'), 'please watch tv', 'already'],
  ])('always refuses when %s', (_, setup, text, reason) => {
    const { reasons, count } = refusals(setup, text, 20);
    expect(count).toBe(20);
    expect(reasons).toEqual([reason]);
  });

  it('sleep-talks when asleep', () => {
    const sim = tenant(3);
    sim.clock.ms = 23 * HOUR_MS;
    sim.person.needs.energy = 20;
    startActivity(sim, world, 'sleep');
    stepUntil(sim, () => isAsleep(sim, world));
    expect(ask(sim, 'please play the piano')).toEqual({ kind: 'refuse', reason: 'asleep' });
    expect(lastSpeechKey(sim)).toBe('asleep');
    expect(isAsleep(sim, world)).toBe(true);
  });

  it('never refuses without saying why, whatever state he is in', () => {
    const texts = ['please play the piano', 'dance NOW', 'put a record on', 'go to bed', 'eat', 'wash please', 'watch tv', 'read a book'];
    for (let seed = 1; seed <= 150; seed++) {
      const sim = tenant(seed, (seed * 37) % 100);
      for (const id of ['food', 'water', 'energy', 'hygiene', 'fun'] as const) sim.person.needs[id] = (seed * (id.length + 13)) % 100;
      const out = ask(sim, texts[seed % texts.length]!);
      if (out?.kind === 'refuse') {
        expect(out.reason).toBeTruthy();
        expect(sim.speech?.key.startsWith('refuse.') || sim.speech?.key === 'asleep').toBe(true);
      }
    }
  });
});

describe('politeness', () => {
  it('raises the odds in the model', () => {
    const sim = tenant(1, 50);
    const odds = ([1, 0, -1] as const).map((p) => assessRequest(sim, world, 'piano', p).chance);
    expect(odds[0]).toBeGreaterThan(odds[1]!);
    expect(odds[1]).toBeGreaterThan(odds[2]!);
  });

  it('changes how often he says yes, measurably', () => {
    const rate = (text: string) => {
      let yes = 0;
      const trials = 400;
      for (let seed = 1; seed <= trials; seed++) {
        const out = ask(tenant(seed, 50), text);
        if (out?.kind === 'comply' || out?.kind === 'defer') yes++;
      }
      return yes / trials;
    };
    const polite = rate('please play the piano');
    const plain = rate('play the piano');
    const rude = rate('play the piano NOW');
    expect(polite - plain).toBeGreaterThan(0.15);
    expect(plain - rude).toBeGreaterThan(0.15);
  });

  it('rudeness sours his mood, politeness lifts it', () => {
    const rude = tenant(1, 60);
    ask(rude, 'dance NOW');
    expect(rude.person.mood).toBeLessThan(60);
    const polite = tenant(1, 60);
    const out = ask(polite, 'please dance');
    if (out?.kind !== 'refuse') expect(polite.person.mood).toBeGreaterThan(60);
  });
});

describe('deliveries', () => {
  it('stocks the cupboards up to a limit', () => {
    const sim = tenant();
    sim.supplies.food = 2;
    step(sim, world, [{ type: 'deliver', item: 'food' }]);
    expect(sim.supplies.food).toBe(8);
    expect(sim.speech!.key).toBe('deliver.food');
    sim.supplies.food = 30;
    step(sim, world, [{ type: 'deliver', item: 'food' }]);
    expect(sim.supplies.food).toBe(30);
    expect(sim.speech!.key).toBe('deliver.full');
  });

  it('a new record is a treat, and his favourite music most of all', () => {
    let favourite = 0;
    let other = 0;
    for (let seed = 1; seed <= 60; seed++) {
      const sim = tenant(seed, 50);
      step(sim, world, [{ type: 'deliver', item: 'record' }]);
      const genre = sim.supplies.records[sim.supplies.records.length - 1]!;
      const lift = sim.person.mood - 50;
      if (genre === sim.person.identity.favouriteMusic) favourite = Math.max(favourite, lift);
      else other = Math.max(other, lift);
    }
    expect(favourite).toBeGreaterThan(other);
    expect(other).toBeGreaterThan(0);
  });

  it('makes him keen to play the new record', () => {
    const sim = tenant();
    const before = scoreActivities(sim, world).find((s) => s.id === 'music')!.score;
    step(sim, world, [{ type: 'deliver', item: 'record' }]);
    const after = scoreActivities(sim, world).find((s) => s.id === 'music')!.score;
    expect(after).toBeGreaterThan(before * 2);
  });
});

describe('running out', () => {
  it('he knocks to ask for food, and eats once it arrives', () => {
    const sim = createSim(world, 4, { startMinute: 12 * 60, timeScale: 10 });
    sim.playerName = 'Sam';
    sim.supplies.food = 0;
    sim.person.needs.food = 25;
    expect(stepUntil(sim, () => sim.knock?.reason === 'food', 100_000)).toBe(true);
    expect(sim.speech!.key).toBe('knock.food');

    const eatenBefore = sim.lastDone.eat;
    step(sim, world, [{ type: 'deliver', item: 'food' }]);
    expect(stepUntil(sim, () => sim.lastDone.eat !== eatenBefore, 100_000)).toBe(true);
    expect(sim.supplies.food).toBe(5);
  });

  it('without food he goes hungry, and health starts to fall', () => {
    const sim = createSim(world, 4, { timeScale: 60 });
    sim.supplies.food = 0;
    run(sim, world, 20 * 3600 * 2);
    expect(sim.person.needs.food).toBe(0);
    expect(sim.person.health).toBeLessThan(100);
  });
});

describe('patting, phone and alarm', () => {
  it('a pat cheers him up, but too many get old', () => {
    const sim = tenant(1, 50);
    const lifts: number[] = [];
    for (let i = 0; i < 5; i++) {
      const before = sim.person.mood;
      step(sim, world, [{ type: 'pat' }]);
      lifts.push(sim.person.mood - before);
    }
    expect(lifts[0]).toBeGreaterThan(5);
    expect(lifts[0]).toBeGreaterThan(lifts[2]!);
    expect(lifts[4]).toBeLessThanOrEqual(0.5);
    expect(sim.speech!.key).toBe('pat.enough');
  });

  it('a pat wakes him, which he does not love', () => {
    const sim = tenant(2, 60);
    sim.clock.ms = 23 * HOUR_MS;
    sim.person.needs.energy = 20;
    startActivity(sim, world, 'sleep');
    stepUntil(sim, () => isAsleep(sim, world));
    step(sim, world, [{ type: 'pat' }]);
    expect(isAsleep(sim, world)).toBe(false);
    expect(sim.speech!.key).toBe('pat.woken');
    expect(sim.person.mood).toBeLessThan(60);
  });

  it('a sociable tenant answers the phone and chats', () => {
    let answered = 0;
    for (let seed = 1; seed <= 20; seed++) {
      const sim = tenant(seed, 80, { sociable: 1 });
      step(sim, world, [{ type: 'phone' }]);
      if (sim.person.activity?.id !== 'phone') continue;
      answered++;
      expect(stepUntil(sim, () => sim.person.activity?.doing === true)).toBe(true);
      expect(sim.person.at).toBe('living.phone');
    }
    expect(answered).toBeGreaterThanOrEqual(16);
  });

  it('the alarm wakes him', () => {
    const sim = tenant(3);
    sim.clock.ms = 23 * HOUR_MS;
    sim.person.needs.energy = 20;
    startActivity(sim, world, 'sleep');
    stepUntil(sim, () => isAsleep(sim, world));
    step(sim, world, [{ type: 'alarm' }]);
    expect(isAsleep(sim, world)).toBe(false);
    expect(sim.speech!.key).toBe('alarm.grumpy');

    step(sim, world, [{ type: 'alarm' }]);
    expect(sim.speech!.key).toBe('alarm.awake');
  });
});

describe('knocking on the glass', () => {
  it('says hello through the glass after moving in', () => {
    const sim = createSim(world, 8, { startEmpty: true, emptyTicks: 20 });
    expect(stepUntil(sim, () => sim.knock !== null, 50_000)).toBe(true);
    expect(sim.knock!.reason).toBe('hello');
    expect(sim.speech!.key).toBe('knock.hello');
    expect(sim.moveIn.stage).toBe('done');
  });

  it('does not knock in the middle of the night', () => {
    const sim = tenant(6);
    sim.supplies.water = 0;
    sim.clock.ms = 2 * HOUR_MS;
    expect(wantsAttention(sim)?.reason).toBe('water');
    expect(scoreActivities(sim, world).find((s) => s.id === 'knock')!.score).toBe(0);
  });

  it('gets lonely without company', () => {
    const sim = tenant(7, 80, { sociable: 1 });
    sim.lastInteractionMs = sim.clock.ms - 10 * HOUR_MS;
    sim.lastKnockMs = sim.clock.ms - 10 * HOUR_MS;
    expect(wantsAttention(sim)?.reason).toBe('lonely');
    step(sim, world, [{ type: 'say', text: 'hello' }]);
    expect(wantsAttention(sim)).toBeNull();
  });
});

describe('talking', () => {
  it('learns your name when you tell him', () => {
    const sim = tenant();
    sim.playerName = null;
    ask(sim, 'Hi! My name is Robin.');
    expect(sim.playerName).toBe('Robin');
    expect(sim.speech!.text.length).toBeGreaterThan(0);
  });

  it('does not repeat himself straight away', () => {
    const sim = tenant();
    const said: string[] = [];
    for (let i = 0; i < 4; i++) said.push((ask(sim, 'hello'), sim.speech!.text));
    expect(new Set(said).size).toBe(4);
  });

  it('answers "how are you" from how he actually is', () => {
    const happy = tenant(1, 90);
    ask(happy, 'how are you?');
    expect(happy.speech!.key).toBe('howAreYou.good');
    const glum = tenant(1, 20);
    ask(glum, 'how are you?');
    expect(glum.speech!.key).toBe('howAreYou.bad');
  });

  it('is deterministic, commands and all', () => {
    const play = () => {
      const sim = createSim(world, 21, { timeScale: 10 });
      const script: Record<number, Parameters<typeof step>[2]> = {
        10: [{ type: 'say', text: 'please play the piano' }],
        500: [{ type: 'deliver', item: 'record' }],
        900: [{ type: 'pat' }],
        1500: [{ type: 'phone' }],
        4000: [{ type: 'say', text: 'go to the kitchen' }],
      };
      for (let t = 0; t < 8000; t++) step(sim, world, script[t] ?? []);
      return sim;
    };
    expect(play()).toEqual(play());
  });
});
