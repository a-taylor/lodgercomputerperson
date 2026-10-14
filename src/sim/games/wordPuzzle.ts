// Guess my word: he thinks of a word, you guess letters. Seven wrong guesses and he wins.
import { pick, type Rng } from '../rng';
import type { GameCommon, Said } from './types';
import { cleanGuess, WORDS } from './words';

export interface WordPuzzleState extends GameCommon {
  kind: 'wordPuzzle';
  word: string;
  guessed: string[];
  misses: number;
  maxMisses: number;
}

export function startWordPuzzle(rng: Rng): WordPuzzleState {
  return {
    kind: 'wordPuzzle',
    over: false,
    winner: null,
    version: 0,
    word: pick(rng, WORDS.filter((w) => w.length >= 6)),
    guessed: [],
    misses: 0,
    maxMisses: 7,
  };
}

/** The word with unguessed letters hidden. */
export function revealed(g: WordPuzzleState): string {
  return [...g.word].map((c) => (g.guessed.includes(c) ? c : '_')).join('');
}

export function guessLetter(g: WordPuzzleState, raw: string): Said {
  const letter = cleanGuess(raw).slice(0, 1);
  if (g.over || !letter || g.guessed.includes(letter)) return null;
  g.guessed.push(letter);
  if (!g.word.includes(letter)) g.misses++;
  return settle(g);
}

export function solve(g: WordPuzzleState, text: string): Said {
  if (g.over) return null;
  if (cleanGuess(text) === g.word) {
    for (const c of g.word) if (!g.guessed.includes(c)) g.guessed.push(c);
  } else {
    g.misses += 2;
  }
  return settle(g);
}

export function giveUp(g: WordPuzzleState): Said {
  if (g.over) return null;
  g.misses = g.maxMisses;
  return settle(g);
}

function settle(g: WordPuzzleState): Said {
  if (!revealed(g).includes('_')) {
    g.over = true;
    g.winner = 'you';
    return { key: 'game.puzzle.youGot', slots: { word: g.word } };
  }
  if (g.misses >= g.maxMisses) {
    g.over = true;
    g.winner = 'him';
    return { key: 'game.puzzle.reveal', slots: { word: g.word } };
  }
  return null;
}
