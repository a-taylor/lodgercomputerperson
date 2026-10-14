// Letters from the typewriter. Each is assembled from authored sentences chosen by what really
// happened since the last one: how he feels, what he did, what you sent, what he wants, and how
// you're doing as a caretaker. Sentences and whole letters are both guarded against repeats.
import lettersJson from '../data/letters.json';
import { favouriteGame, GAME_NAMES, type GameKind } from './games';
import { since, type DayLog } from './memory';
import { NEED_IDS } from './needs';
import { nextFloat, pick, shuffle } from './rng';
import type { SimState } from './sim';
import { RUNNING_LOW } from './supplies';
import { DAY_MS, HOUR_MS } from './time';

const POOLS = lettersJson as Record<string, string[]>;

export interface Letter {
  id: number;
  /** Game time he finished typing it. */
  ms: number;
  text: string;
  read: boolean;
}

/** No letter may repeat one of the last this-many. */
export const UNIQUE_WITHIN = 30;
/** Sentences used in recent letters are avoided while there are alternatives. */
const RECENT_SENTENCES = 60;
const KEEP_LETTERS = 60;
/** Activities not worth writing home about. */
const DULL = new Set(['potter', 'knock', 'eat', 'drink', 'sleep', 'letter', 'game']);
const ITEM_NAMES: Record<string, string> = { food: 'food', water: 'water', dogFood: 'dog food' };

const NUMBER_WORDS = ['no times', 'once', 'twice', 'three times', 'four times', 'five times', 'six times', 'seven times', 'eight times', 'nine times'];

export function countPhrase(n: number): string {
  return n < NUMBER_WORDS.length ? NUMBER_WORDS[n]! : 'lots of times';
}

/** "half an hour", "an hour", "12 hours", "3 days and 2 hours". */
export function durationPhrase(ms: number): string {
  const minutes = Math.round(ms / 60_000);
  if (minutes < 45) return minutes <= 1 ? 'a minute' : minutes < 35 && minutes > 25 ? 'half an hour' : `${minutes} minutes`;
  const hours = Math.round(ms / HOUR_MS);
  if (hours < 24) return hours === 1 ? 'an hour' : `${hours} hours`;
  const days = Math.floor(ms / DAY_MS);
  const rest = Math.round((ms - days * DAY_MS) / HOUR_MS);
  const d = days === 1 ? 'a day' : `${days} days`;
  return rest === 0 ? d : `${d} and ${rest === 1 ? 'an hour' : `${rest} hours`}`;
}

/** A letter that covers your absence. */
export interface AwayNote {
  /** Game time you left. */
  fromMs: number;
  durationMs: number;
}

/** What the letter is about, worked out from his state and memory before any words are chosen. */
export interface LetterFacts {
  mood: 'great' | 'good' | 'ok' | 'low' | 'awful';
  need: string | null;
  poorly: boolean;
  sick: boolean;
  /** Set for a "while you were away" letter. */
  away: { duration: string; knocks: number; slept: boolean } | null;
  did: [string, number][];
  events: string[];
  games: { line: string; slots: Record<string, string> } | null;
  wants: string[];
  review: 'great' | 'good' | 'mixed' | 'poor';
  reviewExtras: string[];
  ranOut: string | null;
  genre: string;
  game: GameKind;
}

export function gatherFacts(state: SimState, away?: AwayNote): LetterFacts {
  const p = state.person;
  const fromMs = away?.fromMs ?? Math.max(state.lastLetterMs ?? state.clock.ms - 3 * DAY_MS, state.clock.ms - 7 * DAY_MS);
  const log = since(state, fromMs);
  const s = state.supplies;
  const traits = p.identity.traits;
  const ago = (ms: number | null) => (ms === null ? Infinity : state.clock.ms - ms);

  const mood = p.mood >= 80 ? 'great' : p.mood >= 60 ? 'good' : p.mood >= 40 ? 'ok' : p.mood >= 20 ? 'low' : 'awful';
  const worst = [...NEED_IDS].sort((a, b) => p.needs[a] - p.needs[b])[0]!;
  const need = p.needs[worst] < 30 ? worst : null;

  const did = Object.entries(log.activities)
    .filter(([id, n]) => !DULL.has(id) && n > 0)
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
    .slice(0, 3);

  const events: string[] = [];
  const genre = log.records[log.records.length - 1];
  if (genre) events.push(genre === p.identity.favouriteMusic ? 'event.recordFavourite' : 'event.record');
  if ((log.deliveries.book ?? 0) > 0) events.push('event.book');
  if ((log.deliveries.food ?? 0) >= 2) events.push('event.food');
  if (log.pats >= 3) events.push('event.pats');

  const game = favouriteGame(state.rng, traits.bookish);
  const games = gamesLine(log);

  const wants: string[] = [];
  for (const item of ['food', 'water', 'dogFood'] as const) if (s[item] <= RUNNING_LOW[item] * 2) wants.push(`want.${item}`);
  if (traits.musical > 0.5 && ago(s.newRecordMs) > 3 * DAY_MS) wants.push('want.record');
  if (traits.bookish > 0.5 && ago(s.newBookMs) > 3 * DAY_MS) wants.push('want.book');
  if (ago(state.lastInteractionMs) > 12 * HOUR_MS) wants.push('want.company');
  if (traits.sociable > 0.5 && log.games.length === 0) wants.push('want.game');

  // How you're doing: deliveries, pats and manners count for you; neglect and rudeness against.
  const deliveries = Object.values(log.deliveries).reduce((a, b) => a + b, 0);
  const avgMood = log.moodSamples > 0 ? log.moodSum / log.moodSamples : p.mood;
  let score = Math.min(3, deliveries) + Math.min(3, log.pats / 2) + Math.min(2, log.polite) - 1.5 * log.rude - 2 * log.ranOut.length;
  if (avgMood < 40) score -= 2;
  if (avgMood > 70) score += 1;
  if (ago(state.lastInteractionMs) > DAY_MS) score -= 2;
  const review = score >= 4 ? 'great' : score >= 1.5 ? 'good' : score >= -1 ? 'mixed' : 'poor';
  const reviewExtras: string[] = [];
  if (log.ranOut.length > 0) reviewExtras.push('review.neglect');
  if (log.rude >= 2 && log.rude > log.polite) reviewExtras.push('review.rude');
  else if (log.polite >= 3 && log.rude === 0) reviewExtras.push('review.polite');

  return {
    mood,
    need,
    poorly: p.health < 70 && !p.sick,
    sick: p.sick,
    away: away
      ? { duration: durationPhrase(away.durationMs), knocks: log.knocks ?? 0, slept: (log.activities.sleep ?? 0) > 0 && p.needs.energy > 60 }
      : null,
    did,
    events,
    games,
    wants: wants.slice(0, 2),
    review,
    reviewExtras,
    ranOut: log.ranOut[0] ?? null,
    genre: genre ?? p.identity.favouriteMusic,
    game,
  };
}

function gamesLine(log: DayLog): LetterFacts['games'] {
  const finished = log.games.filter((g) => g.winner !== null);
  if (finished.length === 0) return null;
  const wins = finished.filter((g) => g.winner === 'him').length;
  const losses = finished.filter((g) => g.winner === 'you').length;
  const last = finished[finished.length - 1]!;
  const slots = { game: GAME_NAMES[last.kind], wins: String(wins), losses: String(losses), count: `${finished.length} games` };
  if (finished.length >= 3 && losses === finished.length) return { line: 'games.alwaysYou', slots };
  if (finished.length === 1) return { line: last.winner === 'him' ? 'games.won' : last.winner === 'you' ? 'games.lost' : 'games.mixed', slots };
  return { line: 'games.mixed', slots };
}

/** Writes a letter from the current state, files it, and returns it. */
export function writeLetter(state: SimState, away?: AwayNote): Letter {
  const facts = gatherFacts(state, away);
  const recentTexts = new Set(state.letters.slice(-UNIQUE_WITHIN).map((l) => l.text));
  let text = '';
  let used: string[] = [];
  for (let attempt = 0; attempt < 25; attempt++) {
    used = [];
    text = compose(state, facts, used, attempt > 10);
    if (!recentTexts.has(text)) break;
  }
  state.letterRecent.push(...used);
  while (state.letterRecent.length > RECENT_SENTENCES) state.letterRecent.shift();
  const letter: Letter = { id: (state.letters[state.letters.length - 1]?.id ?? 0) + 1, ms: state.clock.ms, text, read: false };
  state.letters.push(letter);
  while (state.letters.length > KEEP_LETTERS) state.letters.shift();
  state.lastLetterMs = state.clock.ms;
  return letter;
}

function compose(state: SimState, facts: LetterFacts, used: string[], ignoreRecent: boolean): string {
  const p = state.person;
  const base: Record<string, string> = {
    player: state.playerName ?? 'friend',
    name: p.identity.name,
    dog: state.dog.identity.name,
    food: p.identity.favouriteFood,
    genre: facts.genre,
    game: GAME_NAMES[facts.game],
    item: facts.ranOut ? ITEM_NAMES[facts.ranOut]! : 'food',
  };
  const line = (key: string, slots: Record<string, string> = {}): string => {
    const lines = POOLS[key];
    if (!lines || lines.length === 0) throw new Error(`No letter lines for "${key}"`);
    const avoid = new Set([...(ignoreRecent ? [] : state.letterRecent), ...used]);
    const fresh = lines.filter((l) => !avoid.has(l));
    const template = pick(state.rng, fresh.length > 0 ? fresh : lines);
    used.push(template);
    const all = { ...base, ...slots };
    return template.replace(/\{(\w+)\}/g, (_, k: string) => all[k] ?? '');
  };
  const maybe = (chance: number) => nextFloat(state.rng) < chance;

  const paragraphs: string[] = [line('greeting')];

  const feeling: string[] = [];
  if (facts.away) {
    feeling.push(line('away.opening', { duration: facts.away.duration }));
    if (facts.away.slept) feeling.push(line('away.slept'));
  } else if (maybe(0.5)) {
    feeling.push(line('opening'));
  }
  feeling.push(line(`feeling.${facts.mood}`));
  if (facts.need) feeling.push(line(`need.${facts.need}`));
  if (facts.sick) feeling.push(line('health.sick'));
  else if (facts.poorly) feeling.push(line('health.poorly'));
  paragraphs.push(feeling.join(' '));

  const news: string[] = [];
  if (facts.away && facts.away.knocks > 0) news.push(line('away.knocked', { count: countPhrase(facts.away.knocks) }));
  if (facts.did.length === 0 && facts.events.length === 0 && !facts.games) {
    news.push(line(facts.away ? 'away.quiet' : 'did.quiet'));
  } else {
    if (facts.did.length > 0 && maybe(0.4)) news.push(line('did.intro'));
    for (const [id, n] of facts.did) news.push(line(`did.${id}`, { count: countPhrase(n) }));
    for (const key of shuffle(state.rng, facts.events).slice(0, 2)) news.push(line(key));
    if (facts.games) news.push(line(facts.games.line, facts.games.slots));
  }
  paragraphs.push(news.join(' '));

  if (facts.wants.length > 0) paragraphs.push(facts.wants.map((w) => line(w)).join(' '));

  const review = [line(`review.${facts.review}`), ...facts.reviewExtras.map((k) => line(k))];
  paragraphs.push(review.join(' '));

  paragraphs.push(line('signoff'));

  if (maybe(0.6)) {
    const quirk = p.identity.quirks.length > 0 ? pick(state.rng, p.identity.quirks) : null;
    const options = ['ps.dog', 'ps.food', 'ps.music', 'ps.typo', ...(quirk ? [`ps.quirk.${quirk}`] : [])];
    paragraphs.push(line(pick(state.rng, options)));
  }
  return paragraphs.join('\n\n');
}
