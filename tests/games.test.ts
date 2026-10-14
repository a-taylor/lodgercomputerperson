import { describe, expect, it } from 'vitest';
import { guess, isAnswer, pass, scramble, startAnagrams, type AnagramsState } from '../src/sim/games/anagrams';
import { compareHands, evaluate, fold, hisKeep, show, startPoker } from '../src/sim/games/poker';
import { flip, startWar } from '../src/sim/games/war';
import { giveUp, guessLetter, revealed, solve, startWordPuzzle } from '../src/sim/games/wordPuzzle';
import { generateIdentity, type Identity } from '../src/sim/identity';
import { handleSay, wantsAttention } from '../src/sim/interactions';
import { gameOver, startGame, youStreak } from '../src/sim/play';
import { createRng } from '../src/sim/rng';
import { createSim, HOUR_MS, step, type SimState } from '../src/sim/sim';
import { world } from './helpers';

/** Card from rank (2-14) and suit (0-3). */
const c = (rank: number, suit = 0) => suit * 13 + rank - 2;

function tenant(seed = 1, mood = 70, traits: Partial<Identity['traits']> = {}): SimState {
  const base = generateIdentity(seed).person;
  const identity = { ...base, traits: { ...base.traits, bookish: 0.5, sociable: 0.8, ...traits } };
  const sim = createSim(world, seed, { startMinute: 14 * 60, identity });
  sim.playerName = 'Sam';
  sim.person.mood = mood;
  for (const id of ['food', 'water', 'energy', 'hygiene', 'fun'] as const) sim.person.needs[id] = 80;
  return sim;
}

describe('War', () => {
  it('plays out to a winner, scoring the higher card', () => {
    const g = startWar(createRng(1));
    let flips = 0;
    while (!g.over) {
      const before = g.scoreYou + g.scoreHim;
      const pot = g.pot;
      flip(g);
      flips++;
      const last = g.last!;
      if (last.taker === 'tie') expect(g.pot).toBe(pot + 1);
      else expect(g.scoreYou + g.scoreHim).toBe(before + 1 + pot);
    }
    expect(flips).toBeLessThanOrEqual(26);
    expect(g.winner).toBe(g.scoreYou > g.scoreHim ? 'you' : g.scoreHim > g.scoreYou ? 'him' : 'draw');
  });
});

describe('Poker', () => {
  it('ranks hands in the usual order', () => {
    const hands = [
      [c(10), c(11), c(12), c(13), c(14)], // straight flush
      [c(9), c(9, 1), c(9, 2), c(9, 3), c(2)], // four of a kind
      [c(5), c(5, 1), c(5, 2), c(3), c(3, 1)], // full house
      [c(2), c(6), c(9), c(11), c(13)], // flush
      [c(5), c(6, 1), c(7), c(8, 2), c(9)], // straight
      [c(7), c(7, 1), c(7, 2), c(2, 3), c(13)], // three of a kind
      [c(4), c(4, 1), c(9), c(9, 2), c(13)], // two pair
      [c(12), c(12, 1), c(3), c(5, 2), c(9)], // pair
      [c(2), c(5, 1), c(7), c(9, 2), c(13)], // high card
    ];
    expect(hands.map((h) => evaluate(h)[0])).toEqual([8, 7, 6, 5, 4, 3, 2, 1, 0]);
    for (let i = 1; i < hands.length; i++) expect(compareHands(hands[i - 1]!, hands[i]!)).toBeGreaterThan(0);
  });

  it('handles the ace-low straight and kickers', () => {
    expect(evaluate([c(14), c(2, 1), c(3), c(4), c(5, 2)])).toEqual([4, 5]);
    const kings = [c(13), c(13, 1), c(2), c(3, 2), c(4)];
    const queensAce = [c(12), c(12, 1), c(14), c(3, 2), c(4)];
    expect(compareHands(kings, queensAce)).toBeGreaterThan(0);
    const kingsBetterKicker = [c(13, 2), c(13, 3), c(9), c(3, 1), c(4, 2)];
    expect(compareHands(kingsBetterKicker, kings)).toBeGreaterThan(0);
  });

  it('he keeps his pairs and his best cards', () => {
    expect(hisKeep([c(8), c(8, 1), c(2), c(5, 2), c(11)])).toEqual([true, true, false, false, false]);
    expect(hisKeep([c(2), c(14, 1), c(7), c(9, 2), c(13)])).toEqual([false, true, false, false, true]);
  });

  it('folding hands him the win; showing compares hands', () => {
    const folded = startPoker(createRng(2));
    fold(folded);
    expect([folded.over, folded.winner, folded.folded]).toEqual([true, 'him', true]);

    const shown = startPoker(createRng(3));
    show(shown);
    const d = compareHands(shown.you, shown.him);
    expect(shown.winner).toBe(d > 0 ? 'you' : d < 0 ? 'him' : 'draw');
  });
});

describe('Anagrams', () => {
  it('never shows the word itself', () => {
    const rng = createRng(4);
    for (const w of ['planet', 'teapot', 'garden', 'violin']) expect(scramble(rng, w)).not.toBe(w);
  });

  it('accepts the word, or another real word with the same letters', () => {
    expect(isAnswer('Garden!', 'garden')).toBe(true);
    expect(isAnswer('gardne', 'garden')).toBe(false);
  });

  it('scores you for solving, and passes to him after three misses', () => {
    const rng = createRng(5);
    const g = startAnagrams(rng);
    guess(g, g.words[0]!, rng);
    expect(g.scoreYou).toBe(1);
    expect(g.round).toBe(1);
    guess(g, 'zzz', rng);
    guess(g, 'zzz', rng);
    guess(g, 'zzz', rng);
    expect(g.round).toBe(2);
    expect(g.last!.solvedBy).not.toBe('you');
    pass(g, rng);
    pass(g, rng);
    pass(g, rng);
    expect(g.over).toBe(true);
  });
});

describe('Guess my word', () => {
  it('you win by finding every letter', () => {
    const g = startWordPuzzle(createRng(6));
    for (const letter of new Set(g.word)) guessLetter(g, letter);
    expect([g.over, g.winner, revealed(g)]).toEqual([true, 'you', g.word]);
  });

  it('he wins after seven misses, and a wrong solve costs two', () => {
    const g = startWordPuzzle(createRng(7));
    const missing = [...'abcdefghijklmnopqrstuvwxyz'].filter((l) => !g.word.includes(l));
    solve(g, 'wrongword');
    expect(g.misses).toBe(2);
    for (const l of missing.slice(0, 5)) guessLetter(g, l);
    expect([g.over, g.winner]).toEqual([true, 'him']);
  });

  it('giving up lets him win', () => {
    const g = startWordPuzzle(createRng(8));
    giveUp(g);
    expect(g.winner).toBe('him');
  });
});

describe('letting him win vs always winning', () => {
  /** Plays anagrams through the real commands. Winning means solving every word; letting him win means passing. */
  function playAnagrams(sim: SimState, letHimWin: boolean): void {
    startGame(sim, world, 'anagrams');
    while (!sim.game!.over) {
      const g = sim.game as AnagramsState;
      step(sim, world, [letHimWin ? { type: 'game', action: { kind: 'pass' } } : { type: 'game', action: { kind: 'guess', text: g.words[g.round]! } }]);
    }
    step(sim, world);
  }

  it('shifts his mood: letting him win sometimes beats always winning', () => {
    const alwaysWin = tenant(9, 60, { bookish: 1 });
    const sometimes = tenant(9, 60, { bookish: 1 });
    for (let i = 0; i < 8; i++) {
      playAnagrams(alwaysWin, false);
      playAnagrams(sometimes, i % 2 === 1);
    }
    expect(alwaysWin.gameResults.every((r) => r === 'you')).toBe(true);
    expect(sometimes.gameResults.filter((r) => r === 'him').length).toBeGreaterThanOrEqual(2);
    expect(sometimes.person.mood - alwaysWin.person.mood).toBeGreaterThan(25);
    expect(alwaysWin.person.mood).toBeLessThan(60);
    expect(alwaysWin.speechLog.some((l) => l.key === 'game.youAlwaysWin')).toBe(true);
  });

  it('a win or two for you is fine; a run of them stings more each time', () => {
    const sim = tenant(1, 50);
    const deltas: number[] = [];
    for (let i = 0; i < 6; i++) {
      const before = sim.person.mood;
      gameOver(sim, 'war', 'you');
      deltas.push(sim.person.mood - before);
    }
    expect(deltas[0]).toBeGreaterThan(0);
    expect(deltas[1]).toBeGreaterThan(0);
    expect(deltas[2]).toBeLessThan(0);
    expect(deltas[5]).toBeLessThan(deltas[2]!);
    const before = sim.person.mood;
    gameOver(sim, 'war', 'him');
    expect(sim.person.mood).toBeGreaterThan(before);
    expect(youStreak(sim.gameResults)).toBe(0);
  });
});

describe('playing together', () => {
  it('you can ask for a game by name', () => {
    const sim = tenant(2, 100);
    expect(handleSay(sim, world, "let's play poker, please")).toEqual({ kind: 'comply' });
    expect(sim.game?.kind).toBe('poker');
    expect(sim.person.activity?.id).toBe('game');
  });

  it('an unsociable tenant turns games down in plain words', () => {
    for (let seed = 1; seed <= 30; seed++) {
      const sim = tenant(seed, 30, { sociable: 0 });
      handleSay(sim, world, "let's play poker");
      if (sim.speech!.key === 'refuse.dislike') {
        expect(sim.speech!.text).not.toMatch(/playing a game/);
        return;
      }
    }
    throw new Error('expected at least one "dislike" refusal');
  });

  it('or just ask him to play cards and let him pick', () => {
    const sim = tenant(3, 100);
    handleSay(sim, world, 'could we play cards?');
    expect(sim.game).not.toBeNull();
  });

  it('he invites you when bored, and "yes" starts the game', () => {
    const sim = tenant(4, 70, { sociable: 1 });
    sim.person.needs.fun = 30;
    sim.lastKnockMs = sim.clock.ms - 10 * HOUR_MS;
    // Two hours since you last did anything: not lonely yet, but not busy with you either.
    sim.lastInteractionMs = sim.clock.ms - 2 * HOUR_MS;
    expect(wantsAttention(sim)?.reason).toBe('game');
    for (let i = 0; i < 20_000 && !sim.invitation; i++) step(sim, world);
    expect(sim.invitation).not.toBeNull();
    expect(sim.speech!.key).toBe('knock.game');
    const invited = sim.invitation!.game;
    step(sim, world, [{ type: 'say', text: 'yes!' }]);
    expect(sim.game?.kind).toBe(invited);
  });

  it('saying no disappoints him a little', () => {
    const sim = tenant(5, 70);
    sim.invitation = { game: 'war', untilMs: sim.clock.ms + HOUR_MS };
    step(sim, world, [{ type: 'answerInvite', accept: false }]);
    expect(sim.person.mood).toBeLessThan(70);
    expect(sim.speech!.key).toBe('invite.no');
  });

  it('a pressing need ends the game without a result', () => {
    const sim = tenant(6, 80);
    startGame(sim, world, 'war');
    step(sim, world);
    sim.person.needs.water = 2;
    step(sim, world);
    expect(sim.game!.over).toBe(true);
    expect(sim.game!.winner).toBeNull();
    expect(sim.speechLog.some((l) => l.key === 'game.abandon')).toBe(true);
  });

  it('is deterministic, move for move', () => {
    const play = () => {
      const sim = tenant(7, 80);
      startGame(sim, world, 'war');
      for (let i = 0; i < 40; i++) step(sim, world, [{ type: 'game', action: { kind: 'flip' } }]);
      return sim;
    };
    expect(play()).toEqual(play());
  });
});
