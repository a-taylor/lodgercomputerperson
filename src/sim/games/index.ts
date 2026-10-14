// The games he can play with you, behind one interface.
import { nextFloat, type Rng } from '../rng';
import { guess, pass, startAnagrams, type AnagramsState } from './anagrams';
import { draw, fold, show, startPoker, toggleHold, type PokerState } from './poker';
import type { GameKind, Said } from './types';
import { flip, startWar, type WarState } from './war';
import { giveUp, guessLetter, solve, startWordPuzzle, type WordPuzzleState } from './wordPuzzle';

export * from './types';
export type GameState = WarState | PokerState | AnagramsState | WordPuzzleState;

export type GameAction =
  | { kind: 'flip' }
  | { kind: 'hold'; index: number }
  | { kind: 'draw' }
  | { kind: 'show' }
  | { kind: 'fold' }
  | { kind: 'guess'; text: string }
  | { kind: 'pass' }
  | { kind: 'letter'; letter: string }
  | { kind: 'solve'; text: string }
  | { kind: 'giveUp' };

export function newGame(kind: GameKind, rng: Rng): GameState {
  switch (kind) {
    case 'war':
      return startWar(rng);
    case 'poker':
      return startPoker(rng);
    case 'anagrams':
      return startAnagrams(rng);
    case 'wordPuzzle':
      return startWordPuzzle(rng);
  }
}

/** Applies a move. Moves that don't fit the game are ignored. Returns anything he says about it. */
export function playMove(g: GameState, action: GameAction, rng: Rng, bookish: number): Said {
  if (g.over) return null;
  let said: Said = null;
  switch (g.kind) {
    case 'war':
      if (action.kind === 'flip') said = flip(g);
      break;
    case 'poker':
      if (action.kind === 'hold') said = toggleHold(g, action.index);
      else if (action.kind === 'draw') said = draw(g);
      else if (action.kind === 'show') said = show(g);
      else if (action.kind === 'fold') said = fold(g);
      break;
    case 'anagrams':
      if (action.kind === 'guess') said = guess(g, action.text, rng, bookish);
      else if (action.kind === 'pass') said = pass(g, rng, bookish);
      break;
    case 'wordPuzzle':
      if (action.kind === 'letter') said = guessLetter(g, action.letter);
      else if (action.kind === 'solve') said = solve(g, action.text);
      else if (action.kind === 'giveUp') said = giveUp(g);
      break;
  }
  g.version++;
  return said;
}

/** The game he'd pick: bookish people lean to word games, others to cards. */
export function favouriteGame(rng: Rng, bookish: number): GameKind {
  const words = nextFloat(rng) < 0.25 + 0.5 * bookish;
  const first = nextFloat(rng) < 0.5;
  if (words) return first ? 'anagrams' : 'wordPuzzle';
  return first ? 'war' : 'poker';
}
