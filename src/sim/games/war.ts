// War: each flips the top card, higher card scores. A tie is "war": the next flip is worth more.
import type { Rng } from '../rng';
import { newDeck, rank } from './cards';
import type { GameCommon, Said } from './types';

export interface WarState extends GameCommon {
  kind: 'war';
  you: number[];
  him: number[];
  scoreYou: number;
  scoreHim: number;
  /** Extra points riding on the next flip after ties. */
  pot: number;
  target: number;
  last: { you: number; him: number; taker: 'you' | 'him' | 'tie' } | null;
}

export function startWar(rng: Rng): WarState {
  const deck = newDeck(rng);
  return {
    kind: 'war',
    over: false,
    winner: null,
    version: 0,
    you: deck.slice(0, 26),
    him: deck.slice(26),
    scoreYou: 0,
    scoreHim: 0,
    pot: 0,
    target: 7,
    last: null,
  };
}

export function flip(g: WarState): Said {
  const you = g.you.pop()!;
  const him = g.him.pop()!;
  let said: Said = null;
  if (rank(you) === rank(him)) {
    g.pot++;
    g.last = { you, him, taker: 'tie' };
    said = { key: 'game.war.tie' };
  } else {
    const taker = rank(you) > rank(him) ? 'you' : 'him';
    if (taker === 'you') g.scoreYou += 1 + g.pot;
    else g.scoreHim += 1 + g.pot;
    if (g.pot > 0 && taker === 'him') said = { key: 'game.war.bigWin' };
    g.pot = 0;
    g.last = { you, him, taker };
  }
  if (g.scoreYou >= g.target || g.scoreHim >= g.target || g.you.length === 0) {
    g.over = true;
    g.winner = g.scoreYou > g.scoreHim ? 'you' : g.scoreHim > g.scoreYou ? 'him' : 'draw';
  }
  return said;
}
