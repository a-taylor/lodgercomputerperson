// Anagrams: unscramble the word. Three tries, or pass and let him have a go.
import { nextFloat, shuffle, type Rng } from '../rng';
import type { GameCommon, Said } from './types';
import { cleanGuess, isWord, sortedLetters, WORDS } from './words';

export interface AnagramsState extends GameCommon {
  kind: 'anagrams';
  words: string[];
  round: number;
  rounds: number;
  scrambled: string;
  tries: number;
  scoreYou: number;
  scoreHim: number;
  last: { word: string; solvedBy: 'you' | 'him' | 'nobody' } | null;
}

const TRIES = 3;

export function startAnagrams(rng: Rng): AnagramsState {
  const words = shuffle(
    rng,
    WORDS.filter((w) => w.length >= 5 && w.length <= 7),
  ).slice(0, 5);
  const g: AnagramsState = {
    kind: 'anagrams',
    over: false,
    winner: null,
    version: 0,
    words,
    round: 0,
    rounds: words.length,
    scrambled: '',
    tries: TRIES,
    scoreYou: 0,
    scoreHim: 0,
    last: null,
  };
  g.scrambled = scramble(rng, words[0]!);
  return g;
}

/** Shuffles letters until they don't spell the word (or another real word). */
export function scramble(rng: Rng, word: string): string {
  let s = word;
  for (let i = 0; i < 30 && (s === word || isWord(s)); i++) s = shuffle(rng, [...word]).join('');
  return s;
}

export function isAnswer(guess: string, word: string): boolean {
  const g = cleanGuess(guess);
  return g === word || (isWord(g) && sortedLetters(g) === sortedLetters(word));
}

export function guess(g: AnagramsState, text: string, rng: Rng, bookish = 0.5): Said {
  if (g.over) return null;
  const word = g.words[g.round]!;
  if (isAnswer(text, word)) {
    g.scoreYou++;
    g.last = { word, solvedBy: 'you' };
    nextRound(g, rng);
    return { key: 'game.anagrams.youGot', slots: { word } };
  }
  g.tries--;
  if (g.tries > 0) return { key: 'game.anagrams.wrong' };
  return hisTurn(g, rng, bookish);
}

export function pass(g: AnagramsState, rng: Rng, bookish = 0.5): Said {
  if (g.over) return null;
  return hisTurn(g, rng, bookish);
}

/** He has a go. Bookish people are better at this. */
function hisTurn(g: AnagramsState, rng: Rng, bookish: number): Said {
  const word = g.words[g.round]!;
  const solved = nextFloat(rng) < 0.45 + 0.45 * bookish;
  if (solved) g.scoreHim++;
  g.last = { word, solvedBy: solved ? 'him' : 'nobody' };
  nextRound(g, rng);
  return { key: solved ? 'game.anagrams.heGot' : 'game.anagrams.stumped', slots: { word } };
}

function nextRound(g: AnagramsState, rng: Rng): void {
  g.round++;
  g.tries = TRIES;
  if (g.round >= g.rounds) {
    g.over = true;
    g.winner = g.scoreYou > g.scoreHim ? 'you' : g.scoreHim > g.scoreYou ? 'him' : 'draw';
    return;
  }
  g.scrambled = scramble(rng, g.words[g.round]!);
}
