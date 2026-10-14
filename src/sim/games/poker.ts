// Five-card draw, one hand. You can swap cards once, then show or fold. Folding lets him win.
import type { Rng } from '../rng';
import { newDeck, rank, suit } from './cards';
import type { GameCommon, Said } from './types';

export interface PokerState extends GameCommon {
  kind: 'poker';
  deck: number[];
  you: number[];
  him: number[];
  /** Cards you are keeping when you draw. */
  held: boolean[];
  stage: 'draw' | 'show' | 'done';
  himDrew: number;
  folded: boolean;
  youHand: string | null;
  himHand: string | null;
}

export const HAND_NAMES = [
  'high card',
  'a pair',
  'two pair',
  'three of a kind',
  'a straight',
  'a flush',
  'a full house',
  'four of a kind',
  'a straight flush',
];

/** A comparable score: [category, tiebreak ranks...], higher is better. */
export function evaluate(cards: readonly number[]): number[] {
  const ranks = cards.map(rank).sort((a, b) => b - a);
  const counts = new Map<number, number>();
  for (const r of ranks) counts.set(r, (counts.get(r) ?? 0) + 1);
  // Group by count then rank, e.g. full house 3-3-3-2-2 -> [3s, 2s].
  const groups = [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0]);
  const byGroup = groups.map(([r]) => r);
  const flush = new Set(cards.map(suit)).size === 1;
  const unique = [...new Set(ranks)];
  let straightHigh = 0;
  if (unique.length === 5) {
    if (unique[0]! - unique[4]! === 4) straightHigh = unique[0]!;
    else if (unique.join() === '14,5,4,3,2') straightHigh = 5; // ace low
  }
  const shape = groups.map(([, c]) => c).join('');
  if (straightHigh && flush) return [8, straightHigh];
  if (shape === '41') return [7, ...byGroup];
  if (shape === '32') return [6, ...byGroup];
  if (flush) return [5, ...ranks];
  if (straightHigh) return [4, straightHigh];
  if (shape === '311') return [3, ...byGroup];
  if (shape === '221') return [2, ...byGroup];
  if (shape === '2111') return [1, ...byGroup];
  return [0, ...ranks];
}

export function compareHands(a: readonly number[], b: readonly number[]): number {
  const ea = evaluate(a);
  const eb = evaluate(b);
  for (let i = 0; i < Math.max(ea.length, eb.length); i++) {
    const d = (ea[i] ?? 0) - (eb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

export function startPoker(rng: Rng): PokerState {
  const deck = newDeck(rng);
  const you = deck.splice(0, 5);
  const him = deck.splice(0, 5);
  return {
    kind: 'poker',
    over: false,
    winner: null,
    version: 0,
    deck,
    you,
    him,
    held: [false, false, false, false, false],
    stage: 'draw',
    himDrew: 0,
    folded: false,
    youHand: null,
    himHand: null,
  };
}

export function toggleHold(g: PokerState, index: number): Said {
  if (g.stage === 'draw' && index >= 0 && index < 5) g.held[index] = !g.held[index];
  return null;
}

/** Which of his cards he keeps: made hands stay, pairs and better stay, else four to a flush, else his two best. */
export function hisKeep(cards: readonly number[]): boolean[] {
  const [category] = evaluate(cards);
  if (category! >= 4) return cards.map(() => true);
  const counts = new Map<number, number>();
  for (const c of cards) counts.set(rank(c), (counts.get(rank(c)) ?? 0) + 1);
  if (category! >= 1) return cards.map((c) => counts.get(rank(c))! >= 2);
  for (let s = 0; s < 4; s++) {
    if (cards.filter((c) => suit(c) === s).length === 4) return cards.map((c) => suit(c) === s);
  }
  const best = [...cards].sort((a, b) => rank(b) - rank(a)).slice(0, 2);
  return cards.map((c) => best.includes(c));
}

export function draw(g: PokerState): Said {
  if (g.stage !== 'draw') return null;
  g.you = g.you.map((c, i) => (g.held[i] ? c : g.deck.shift()!));
  const keep = hisKeep(g.him);
  g.himDrew = keep.filter((k) => !k).length;
  g.him = g.him.map((c, i) => (keep[i] ? c : g.deck.shift()!));
  g.stage = 'show';
  return { key: g.himDrew === 0 ? 'game.poker.stand' : 'game.poker.drew', slots: { count: String(g.himDrew) } };
}

export function show(g: PokerState): Said {
  if (g.stage === 'done') return null;
  if (g.stage === 'draw') draw(g);
  const d = compareHands(g.you, g.him);
  g.youHand = HAND_NAMES[evaluate(g.you)[0]!]!;
  g.himHand = HAND_NAMES[evaluate(g.him)[0]!]!;
  g.stage = 'done';
  g.over = true;
  g.winner = d > 0 ? 'you' : d < 0 ? 'him' : 'draw';
  return { key: 'game.poker.reveal', slots: { hand: g.himHand } };
}

export function fold(g: PokerState): Said {
  if (g.stage === 'done') return null;
  g.stage = 'done';
  g.folded = true;
  g.over = true;
  g.winner = 'him';
  g.himHand = HAND_NAMES[evaluate(g.him)[0]!]!;
  return { key: 'game.poker.fold' };
}
