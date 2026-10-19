// Typed input to an intent. Normalise, fold phrases and synonyms into canonical words, forgive
// small typos, then match the first intent whose keyword groups are all present.
import lexiconJson from '../data/lexicon.json';
import { GAME_KINDS, type GameKind } from './games/types';

export type IntentId =
  | 'name'
  | 'feedDog'
  | 'wake'
  | 'howAreYou'
  | 'game'
  | 'letter'
  | 'piano'
  | 'dance'
  | 'music'
  | 'tv'
  | 'read'
  | 'exercise'
  | 'eat'
  | 'drink'
  | 'sleep'
  | 'wash'
  | 'goTo'
  | 'tvWatch'
  | 'playWhat'
  | 'yes'
  | 'no'
  | 'greet'
  | 'thanks';

/** -1 rude, 0 plain, 1 polite. */
export type Politeness = -1 | 0 | 1;

export interface Parsed {
  intent: IntentId | null;
  /** The activity this asks him to do, if any. */
  activity: string | null;
  politeness: Politeness;
  room?: string;
  name?: string;
  /** Which game, if they named one. */
  game?: GameKind;
  /** Canonical tokens, for debugging and tests. */
  tokens: string[];
}

interface IntentDef {
  id: IntentId;
  all: string[][];
  activity?: string;
}

const lexicon = lexiconJson as {
  phrases: Record<string, string>;
  synonyms: Record<string, string>;
  rooms: string[];
  intents: IntentDef[];
  polite: string[];
  rude: string[];
};

const EXTRA_SYNONYMS: Record<string, string> = {
  playing: 'play',
  played: 'play',
  watching: 'watch',
  going: 'go',
  walking: 'walk',
  heading: 'head',
  coming: 'come',
};

const SYNONYMS = { ...lexicon.synonyms, ...EXTRA_SYNONYMS };
/** Longest first, so "would you mind" wins over "would you". */
const PHRASES = Object.entries(lexicon.phrases).sort((a, b) => b[0].length - a[0].length);

/** Common short words that must never be "corrected" into keywords ("some" is not "come"). */
const STOPWORDS = new Set(
  'the a an and or but some with your you me my mine what that this have like want just then them there here when from into much more very really little bit for too also again its it is are was can could would should will shall now later soon one two'.split(' '),
);

const VOCAB: string[] = [
  ...new Set([
    ...Object.keys(SYNONYMS),
    ...Object.values(SYNONYMS),
    ...Object.values(lexicon.phrases),
    ...lexicon.rooms,
    ...lexicon.intents.flatMap((i) => i.all.flat()).filter((w) => !w.startsWith('$')),
  ]),
];
const VOCAB_SET = new Set(VOCAB);

/** One request as a language model reads it: an intent from the fixed list, never free text. */
export interface IntentItem {
  intent: IntentId;
  politeness: Politeness;
  room?: string;
  game?: GameKind;
}

/** Most items a model answer may hold, the same as the queue's length. */
export const MAX_INTENT_ITEMS = 4;
/** Intents a model may answer with: not a name (it needs the words), nor the parser's own variants. */
export const MODEL_INTENTS = ['feedDog', 'wake', 'howAreYou', 'game', 'letter', 'piano', 'dance', 'music', 'tv', 'read', 'exercise', 'eat', 'drink', 'sleep', 'wash', 'goTo', 'yes', 'no', 'greet', 'thanks'] as const satisfies readonly IntentId[];
export type ModelIntent = (typeof MODEL_INTENTS)[number];
export const ROOMS: readonly string[] = lexicon.rooms;

/**
 * Checks a model's answer, `{ items: [...] }`, against the fixed lists. Anything unknown is dropped,
 * and a room or game that isn't real is ignored. Null if it isn't that shape at all.
 */
export function validateIntents(raw: unknown): IntentItem[] | null {
  if (typeof raw !== 'object' || raw === null || !Array.isArray((raw as { items?: unknown }).items)) return null;
  const items: IntentItem[] = [];
  for (const it of (raw as { items: unknown[] }).items) {
    if (items.length >= MAX_INTENT_ITEMS) break;
    if (typeof it !== 'object' || it === null) continue;
    const { intent, politeness, room, game } = it as Record<string, unknown>;
    if (!(MODEL_INTENTS as readonly unknown[]).includes(intent)) continue;
    const item: IntentItem = { intent: intent as IntentId, politeness: politeness === 1 || politeness === -1 ? politeness : 0 };
    if (typeof room === 'string' && lexicon.rooms.includes(room)) item.room = room;
    if (GAME_KINDS.includes(game as GameKind)) item.game = game as GameKind;
    if (item.intent === 'goTo' && !item.room) continue;
    items.push(item);
  }
  return items;
}

/** A model's item as if the parser had read it. */
export function parsedFromItem(item: IntentItem): Parsed {
  const def = lexicon.intents.find((i) => i.id === item.intent)!;
  const parsed: Parsed = { intent: item.intent, activity: def.activity ?? null, politeness: item.politeness, tokens: [] };
  if (item.room) parsed.room = item.room;
  if (item.game) parsed.game = item.game;
  return parsed;
}

export interface ParseContext {
  /** The dog's name, so "feed Biscuit" means the dog. */
  dogName?: string;
}

/** Splits "play the piano and then dance" into its parts, in order. One part if there's no "then". */
export function splitChain(raw: string): string[] {
  return raw
    .split(/(?:[,;]?\s*\band\s+then\b|[,;]?\s*\bthen\b)/i)
    .map((part) => part.trim())
    .filter((part) => /[a-z]/i.test(part));
}

export function parse(raw: string, ctx: ParseContext = {}): Parsed {
  const letters = raw.replace(/[^a-z]/gi, '');
  const shouting = letters.length >= 4 && letters === letters.toUpperCase();
  const bangs = (raw.match(/!/g) ?? []).length >= 2;

  let text = ` ${raw
    .toLowerCase()
    .replace(/[’']/g, '')
    .replace(/[^a-z\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()} `;
  if (ctx.dogName) text = text.replaceAll(` ${ctx.dogName.toLowerCase()} `, ' dog ');
  for (const [phrase, token] of PHRASES) text = text.replaceAll(` ${phrase} `, ` ${token} `);

  const tokens = text
    .trim()
    .split(' ')
    .filter(Boolean)
    .map((w) => canonical(w));

  const has = (w: string) => tokens.includes(w);
  const polite = lexicon.polite.some(has);
  const rude = lexicon.rude.some(has) || shouting || bangs;
  const politeness: Politeness = polite && !rude ? 1 : rude && !polite ? -1 : 0;

  const room = lexicon.rooms.find(has);
  for (const def of lexicon.intents) {
    const matched = def.all.every((group) => group.some((w) => (w === '$room' ? room !== undefined : has(w))));
    if (!matched) continue;
    const parsed: Parsed = { intent: def.id, activity: def.activity ?? null, politeness, tokens };
    if (def.id === 'goTo') parsed.room = room;
    if (def.id === 'game') {
      const game = whichGame(raw);
      if (game) parsed.game = game;
    }
    if (def.id === 'name') {
      const name = extractName(raw);
      if (!name) continue;
      parsed.name = name;
    }
    return parsed;
  }
  return { intent: null, activity: null, politeness, tokens };
}

function canonical(word: string): string {
  if (VOCAB_SET.has(word)) return SYNONYMS[word] ?? word;
  if (word.length < 4 || STOPWORDS.has(word)) return word;
  const fixed = closest(word);
  return fixed ? (SYNONYMS[fixed] ?? fixed) : word;
}

/** The single vocabulary word within a small edit distance, or null if none or ambiguous. */
function closest(word: string): string | null {
  const limit = word.length >= 7 ? 2 : 1;
  let best: string | null = null;
  let bestDist = limit + 1;
  let tie = false;
  for (const v of VOCAB) {
    if (Math.abs(v.length - word.length) > limit) continue;
    const d = editDistance(word, v, limit);
    if (d < bestDist) {
      best = v;
      bestDist = d;
      tie = false;
    } else if (d === bestDist) {
      tie = true;
    }
  }
  return best && !tie ? best : null;
}

/** Damerau-Levenshtein (adjacent swaps count as one, so "pinao" is one slip from "piano"). */
export function editDistance(a: string, b: string, cap = Infinity): number {
  const rows = a.length + 1;
  const cols = b.length + 1;
  const d: number[][] = Array.from({ length: rows }, (_, i) => Array.from({ length: cols }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)));
  for (let i = 1; i < rows; i++) {
    let rowMin = Infinity;
    for (let j = 1; j < cols; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(d[i - 1]![j]! + 1, d[i]![j - 1]! + 1, d[i - 1]![j - 1]! + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, d[i - 2]![j - 2]! + 1);
      d[i]![j] = v;
      rowMin = Math.min(rowMin, v);
    }
    if (rowMin > cap) return cap + 1;
  }
  return d[a.length]![b.length]!;
}

function whichGame(raw: string): GameKind | undefined {
  const t = raw.toLowerCase();
  if (/poker/.test(t)) return 'poker';
  if (/\bwar\b/.test(t)) return 'war';
  if (/anagram/.test(t)) return 'anagrams';
  if (/word game|puzzle|guess (the|my|your|a) word|hangman/.test(t)) return 'wordPuzzle';
  return undefined;
}

function extractName(raw: string): string | null {
  const m = /(?:my name is|my names|call me|i am called|i'?m called)\s+([a-z][a-z'-]*(?:\s+[a-z][a-z'-]*)?)/i.exec(raw);
  if (!m) return null;
  const words = m[1]!.split(/\s+/).filter((w) => !['please', 'thanks', 'and', 'ok', 'okay'].includes(w.toLowerCase()));
  if (words.length === 0) return null;
  return words.map((w) => w[0]!.toUpperCase() + w.slice(1)).join(' ');
}
