// Turns the facts behind a letter into a prompt for Gemini, so he can write it in his own words.
// Runs in the Worker only (worker/index.ts). The browser sends the sim's LetterFacts and who's
// involved; everything is checked against the game's own lists before it reaches the prompt, and
// the prompt itself lives here, so the Worker can't be used to write about anything else.
import lettersJson from '../data/letters.json';
import { GAME_KINDS, GAME_NAMES, type GameKind } from '../sim/games/types';
import type { Quirk, Traits } from '../sim/identity';
import { countPhrase, type LetterFacts, type LetterRequest, type LetterWho } from '../sim/letters';

const KEYS = new Set(Object.keys(lettersJson));
const MOODS = ['great', 'good', 'ok', 'low', 'awful'] as const;
const NEEDS = ['energy', 'food', 'fun', 'hygiene', 'water'] as const;
const REVIEWS = ['great', 'good', 'mixed', 'poor'] as const;
const ITEMS = ['food', 'water', 'dogFood'] as const;
const QUIRKS: readonly Quirk[] = ['windowGazer', 'nightSnacker', 'fidget', 'hummer', 'dogLover'];
const TRAITS: readonly (keyof Traits)[] = ['musical', 'bookish', 'telly', 'tidy', 'sociable'];
/** Activities a letter can mention: the did.* lines, less the two that aren't activities. */
const DID = new Set([...KEYS].filter((k) => k.startsWith('did.') && k !== 'did.intro' && k !== 'did.quiet').map((k) => k.slice(4)));

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const oneOf = <T extends string>(list: readonly T[], v: unknown): T | null => (list.includes(v as T) ? (v as T) : null);
/** A short single-line string, or null. */
function text(v: unknown, max: number): string | null {
  if (typeof v !== 'string') return null;
  const clean = v.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max).trim();
  return clean.length > 0 ? clean : null;
}
const count = (v: unknown, max = 99): number | null => (Number.isInteger(v) && (v as number) >= 0 ? Math.min(v as number, max) : null);
/** Keys from letters.json with this prefix, nothing else. */
const keysOf = (v: unknown, prefix: string, max: number): string[] =>
  Array.isArray(v) ? [...new Set(v.filter((k): k is string => typeof k === 'string' && k.startsWith(prefix) && KEYS.has(k)))].slice(0, max) : [];

/** The request with everything we don't recognise dropped, or null if the core of it is missing. */
export function validateLetterRequest(raw: unknown): LetterRequest | null {
  if (!isRecord(raw) || !isRecord(raw.facts) || !isRecord(raw.who)) return null;
  const f = raw.facts;
  const w = raw.who;
  const mood = oneOf(MOODS, f.mood);
  const review = oneOf(REVIEWS, f.review);
  const name = text(w.name, 20);
  if (!mood || !review || !name) return null;

  let away: LetterFacts['away'] = null;
  if (isRecord(f.away)) {
    const duration = text(f.away.duration, 40);
    if (duration && /^[a-z0-9 ]+$/.test(duration)) away = { duration, knocks: count(f.away.knocks) ?? 0, slept: f.away.slept === true };
  }
  const did: [string, number][] = Array.isArray(f.did)
    ? f.did
        .filter((d): d is [string, number] => Array.isArray(d) && DID.has(d[0]) && count(d[1]) !== null && d[1] > 0)
        .map(([id, n]): [string, number] => [id, Math.min(n, 99)])
        .slice(0, 3)
    : [];
  let games: LetterFacts['games'] = null;
  if (isRecord(f.games) && typeof f.games.line === 'string' && f.games.line.startsWith('games.') && KEYS.has(f.games.line) && isRecord(f.games.slots)) {
    const s = f.games.slots;
    const gameName = Object.values(GAME_NAMES).find((g) => g === s.game);
    const digits = (v: unknown) => (typeof v === 'string' && /^\d{1,3}$/.test(v) ? v : null);
    const wins = digits(s.wins);
    const losses = digits(s.losses);
    const played = typeof s.count === 'string' && /^\d{1,3} games$/.test(s.count) ? s.count : null;
    if (gameName && wins && losses && played) games = { line: f.games.line, slots: { game: gameName, wins, losses, count: played } };
  }
  const traits = {} as Traits;
  for (const t of TRAITS) {
    const v = isRecord(w.traits) ? w.traits[t] : undefined;
    traits[t] = typeof v === 'number' && v >= 0 && v <= 1 ? Math.round(v * 10) / 10 : 0.5;
  }
  const who: LetterWho = {
    player: text(w.player, 20) ?? 'friend',
    name,
    dog: text(w.dog, 20) ?? 'the dog',
    food: text(w.food, 30) ?? 'toast',
    music: text(w.music, 30) ?? 'jazz',
    quirks: Array.isArray(w.quirks) ? [...new Set(w.quirks.filter((q): q is Quirk => QUIRKS.includes(q as Quirk)))] : [],
    traits,
  };
  return {
    facts: {
      mood,
      need: oneOf(NEEDS, f.need),
      poorly: f.poorly === true,
      sick: f.sick === true,
      away,
      did,
      events: keysOf(f.events, 'event.', 2),
      games,
      wants: keysOf(f.wants, 'want.', 2),
      review,
      reviewExtras: keysOf(f.reviewExtras, 'review.', 2).filter((k) => ['review.neglect', 'review.rude', 'review.polite'].includes(k)),
      ranOut: oneOf(ITEMS, f.ranOut),
      genre: text(f.genre, 30) ?? who.music,
      game: oneOf(GAME_KINDS, f.game) ?? ('war' as GameKind),
    },
    who,
  };
}

/** Each fact as a plain note, in his words. {slots} are filled from the request. */
const FACT_TEXT: Record<string, string> = {
  'mood.great': 'I feel wonderful.',
  'mood.good': 'I feel good.',
  'mood.ok': "I feel all right. Nothing special.",
  'mood.low': 'I feel low.',
  'mood.awful': 'I feel miserable.',
  'need.energy': "I'm worn out.",
  'need.food': "I'm hungry.",
  'need.fun': "I'm bored.",
  'need.hygiene': 'I badly need a bath.',
  'need.water': "I'm thirsty.",
  'health.sick': "I've been ill in bed.",
  'health.poorly': "I've been feeling poorly.",
  'away.opening': '{player} was away for {duration}.',
  'away.knocked': 'While {player} was away I knocked on the glass {knocks}, but nobody answered.',
  'away.slept': 'While {player} was away I had a good long sleep.',
  'away.quiet': 'Nothing much happened while {player} was away.',
  'did.quiet': "I haven't done much.",
  'did.dance': 'I danced {count}.',
  'did.exercise': 'I did my exercises {count}.',
  'did.feedDog': 'I fed {dog} {count}.',
  'did.game': 'I played games {count}.',
  'did.music': 'I listened to my records {count}.',
  'did.phone': 'I chatted on the phone {count}.',
  'did.piano': 'I played the piano {count}.',
  'did.read': 'I sat down to read {count}.',
  'did.tv': 'I watched TV {count}.',
  'did.wash': 'I had a bath {count}.',
  'event.book': '{player} sent me a book.',
  'event.food': '{player} kept the fridge full.',
  'event.pats': '{player} gave me pats on the head, which I liked.',
  'event.record': '{player} sent me a {genre} record.',
  'event.recordFavourite': "{player} sent me a {genre} record, and it's my favourite kind of music.",
  'games.won': 'I beat {player} at {game}.',
  'games.lost': '{player} beat me at {game}.',
  'games.mixed': 'We played {count}: I won {wins} and {player} won {losses}.',
  'games.alwaysYou': '{player} won every one of our {count}, which is not much fun for me.',
  'want.food': "We're nearly out of food.",
  'want.water': "We're running low on water.",
  'want.dogFood': '{dog} needs more dog food.',
  'want.record': "I'd love a new record.",
  'want.book': "I've read all my books and would like another.",
  'want.company': "I'd like {player} to visit more often.",
  'want.game': "I'd like {player} to play a game with me soon. {favouriteGame} would be nice.",
  'review.great': '{player} has been a wonderful friend to me.',
  'review.good': '{player} has been good to me.',
  'review.mixed': '{player} has been all right, mostly.',
  'review.poor': 'I feel a bit forgotten by {player}.',
  'review.neglect': 'We ran out of {item} and nobody came.',
  'review.rude': '{player} has been rude lately. A please would not hurt.',
  'review.polite': '{player} always asks nicely, and I notice.',
};

const ITEM_NAMES: Record<string, string> = { food: 'food', water: 'water', dogFood: 'dog food' };
const QUIRK_TEXT: Record<Quirk, string> = {
  windowGazer: 'likes gazing out of the window',
  nightSnacker: 'raids the fridge at night',
  fidget: "can't sit still",
  hummer: 'hums to himself',
  dogLover: 'adores the dog',
};

/** The facts as a list of notes, in the order a letter would take them. Only these may be mentioned. */
export function factNotes({ facts, who }: LetterRequest): string[] {
  const slots: Record<string, string> = {
    player: who.player,
    dog: who.dog,
    genre: facts.genre,
    item: ITEM_NAMES[facts.ranOut ?? 'food']!,
    favouriteGame: GAME_NAMES[facts.game],
    duration: facts.away?.duration ?? '',
    knocks: countPhrase(facts.away?.knocks ?? 0),
  };
  const note = (key: string, extra: Record<string, string> = {}) => {
    const all = { ...slots, ...extra };
    return FACT_TEXT[key]!.replace(/\{(\w+)\}/g, (_, k: string) => all[k] ?? '');
  };
  const notes: string[] = [];
  if (facts.away) {
    notes.push(note('away.opening'));
    if (facts.away.slept) notes.push(note('away.slept'));
    if (facts.away.knocks > 0) notes.push(note('away.knocked'));
  }
  notes.push(note(`mood.${facts.mood}`));
  if (facts.need) notes.push(note(`need.${facts.need}`));
  if (facts.sick) notes.push(note('health.sick'));
  else if (facts.poorly) notes.push(note('health.poorly'));
  if (facts.did.length === 0 && facts.events.length === 0 && !facts.games) notes.push(note(facts.away ? 'away.quiet' : 'did.quiet'));
  for (const [id, n] of facts.did) notes.push(note(`did.${id}`, { count: countPhrase(n) }));
  for (const key of facts.events) notes.push(note(key));
  if (facts.games) notes.push(note(facts.games.line, facts.games.slots));
  for (const key of facts.wants) notes.push(note(key));
  notes.push(note(`review.${facts.review}`));
  for (const key of facts.reviewExtras) notes.push(note(key));
  return notes;
}

const traitWord = (v: number, high: string, low: string | null = null) => (v >= 0.7 ? high : v <= 0.3 ? low : null);

export function letterSystemPrompt({ who }: LetterRequest): string {
  const t = who.traits;
  const character = [
    traitWord(t.sociable, 'chatty and warm', 'shy and a bit reserved'),
    traitWord(t.musical, 'musical'),
    traitWord(t.bookish, 'bookish'),
    traitWord(t.telly, 'fond of the telly'),
    traitWord(t.tidy, 'tidy', 'messy'),
    ...who.quirks.map((q) => QUIRK_TEXT[q]),
  ].filter(Boolean);
  return [
    `You are ${who.name}, a little man who lives in a dolls' house inside a computer game, with a dog called ${who.dog}.`,
    `You are typing a letter on your typewriter to ${who.player}, the player who looks after you.`,
    character.length > 0 ? `Your character: ${character.join(', ')}.` : '',
    `You love ${who.food} and ${who.music} music.`,
    'Write the letter from the notes the user gives you. They are true, and they are everything that happened.',
    "Retell them in your own words and your own order, the way you'd tell a friend, with a feeling or a small reaction here and there. Don't copy the notes' wording.",
    'Mention only what is in the notes. Never invent events, visitors, places or objects; small feelings and asides about them are fine.',
    `Start with "Dear ${who.player}," and end with a short sign-off and your name on its own line. After your name you may add one short P.S. about ${who.dog}, ${who.food}, ${who.music} or one of your habits.`,
    'Plain British English, warm and a little dry. 80 to 160 words in a few short paragraphs. Plain text only: no markdown, no emoji, no headings.',
  ]
    .filter(Boolean)
    .join('\n');
}

/** The user turn: the notes, one per line. */
export function letterUserPrompt(req: LetterRequest): string {
  return ['Notes for the letter:', ...factNotes(req).map((n) => `- ${n}`)].join('\n');
}
