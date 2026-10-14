import wordsJson from '../../data/words.json';

export const WORDS: readonly string[] = wordsJson.words;
const WORD_SET = new Set(WORDS);

export function isWord(w: string): boolean {
  return WORD_SET.has(w);
}

export function sortedLetters(w: string): string {
  return [...w].sort().join('');
}

export function cleanGuess(text: string): string {
  return text.toLowerCase().replace(/[^a-z]/g, '');
}
