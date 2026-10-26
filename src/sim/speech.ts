// What he says: lines picked from authored pools, with slots filled from real state and a guard
// so the same line doesn't come round again too soon.
import speechJson from '../data/speech.json';
import { pick } from './rng';
import type { SimState } from './sim';

const POOLS = speechJson as Record<string, string[]>;
/** How many recent lines he avoids repeating. */
const RECENT = 12;
const LOG_SIZE = 30;

export interface SpeechState {
  text: string;
  key: string;
  /** Increases with every line, so the UI can tell a new line from the same one. */
  seq: number;
  /** Real-time tick the bubble disappears. */
  untilTick: number;
  /** Said while asking a language model, or in answer to what it read: the bubble shows it. */
  model?: boolean;
}

export interface SpeechLogEntry {
  tick: number;
  ms: number;
  key: string;
  text: string;
}

export type Slots = Record<string, string>;

/** The pool for a key, falling back to its parent: "comply.piano" then "comply". */
export function poolFor(key: string): { key: string; lines: string[] } {
  let k = key;
  for (;;) {
    const lines = POOLS[k];
    if (lines && lines.length > 0) return { key: k, lines };
    const dot = k.lastIndexOf('.');
    if (dot < 0) throw new Error(`No speech for "${key}"`);
    k = k.slice(0, dot);
  }
}

export function hasPool(key: string): boolean {
  return (POOLS[key]?.length ?? 0) > 0;
}

export function say(state: SimState, key: string, slots: Slots = {}): string {
  const { lines } = poolFor(key);
  const fresh = lines.filter((l) => !state.recentLines.includes(l));
  const template = pick(state.rng, fresh.length > 0 ? fresh : lines);
  state.recentLines.push(template);
  if (state.recentLines.length > RECENT) state.recentLines.shift();

  const p = state.person.identity;
  const all: Slots = {
    name: p.name,
    player: state.playerName ?? 'friend',
    dog: state.dog.identity.name,
    food: p.favouriteFood,
    genre: p.favouriteMusic,
    ...slots,
  };
  const text = template.replace(/\{(\w+)\}/g, (_, slot: string) => all[slot] ?? '');
  const seq = (state.speech?.seq ?? 0) + 1;
  // Long enough to read: about five seconds plus a little per word.
  state.speech = { text, key, seq, untilTick: state.tick + 100 + text.split(' ').length * 8 };
  state.speechLog.push({ tick: state.tick, ms: state.clock.ms, key, text });
  if (state.speechLog.length > LOG_SIZE) state.speechLog.shift();
  return text;
}
