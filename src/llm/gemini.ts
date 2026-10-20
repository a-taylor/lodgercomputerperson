// Asks Gemini what a line the parser couldn't read was asking for, and writes his letters. This
// runs in the Worker (worker/index.ts), never in the browser, so the player's key stays out of the
// page. It owns the prompts; the browser only sends the typed line and the dog's name, or a
// letter's facts (src/llm/letter.ts).
import { GAME_KINDS, GAME_NAMES } from '../sim/games/types';
import { MODEL_LETTER_CHARS, type LetterRequest } from '../sim/letters';
import { MAX_INTENT_ITEMS, MODEL_INTENTS, ROOMS, validateIntents, type IntentItem, type ModelIntent } from '../sim/parser';
import { letterSystemPrompt, letterUserPrompt, validateLetterRequest } from './letter';

export const DEFAULT_MODEL = 'gemini-3.5-flash-lite';
/** Longest line and dog name accepted. */
export const MAX_TEXT = 200;
const MAX_DOG_NAME = 30;

const MEANINGS: Record<ModelIntent, string> = {
  feedDog: 'he feeds the dog',
  wake: 'he wakes up',
  howAreYou: 'asking how he is',
  game: 'he plays a game with the player',
  letter: 'he writes the player a letter',
  piano: 'he plays the piano',
  dance: 'he dances',
  music: 'he puts a record on',
  tv: 'he watches TV',
  read: 'he reads a book',
  exercise: 'he exercises',
  eat: 'he cooks and eats a meal',
  drink: 'he has a drink',
  sleep: 'he goes to bed',
  wash: 'he has a bath',
  goTo: 'he goes to a room (needs "room")',
  yes: 'the player says yes',
  no: 'the player says no',
  greet: 'the player says hello',
  thanks: 'the player says thank you',
};

const POLITENESS = { rude: -1, plain: 0, polite: 1 } as const;

export function systemPrompt(dogName: string): string {
  return [
    'You read messages a player types to a little man who lives in a dolls house computer game.',
    'Turn the message into a list of requests, in the order asked, using only these intents:',
    ...MODEL_INTENTS.map((id) => `- ${id}: ${MEANINGS[id]}`),
    `Rooms: ${ROOMS.join(', ')}. Games: ${GAME_KINDS.map((g) => `${g} (${GAME_NAMES[g]})`).join(', ')}.`,
    `His dog is called ${dogName}.`,
    `At most ${MAX_INTENT_ITEMS} items. Time phrases such as "before bed" are not requests.`,
    'Politeness: "polite" for please, would you mind and the like; "rude" for insults, orders shouted or curt; otherwise "plain".',
    'If the message is unclear, could mean more than one thing, or asks for something not on the list, return no items. Never guess.',
  ].join('\n');
}

/** The answer's shape, so Gemini can only pick from our lists. */
export const RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    items: {
      type: 'ARRAY',
      maxItems: MAX_INTENT_ITEMS,
      items: {
        type: 'OBJECT',
        properties: {
          intent: { type: 'STRING', enum: [...MODEL_INTENTS] },
          politeness: { type: 'STRING', enum: Object.keys(POLITENESS) },
          room: { type: 'STRING', enum: [...ROOMS] },
          game: { type: 'STRING', enum: [...GAME_KINDS] },
        },
        required: ['intent', 'politeness'],
      },
    },
  },
  required: ['items'],
};

export class GeminiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export interface GeminiOptions {
  apiKey: string;
  model?: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
}

interface GeminiCall {
  system: string;
  user: string;
  generationConfig: Record<string, unknown>;
}

/**
 * One call to Gemini: the model's text and why it stopped. Throws GeminiError when the call itself
 * fails (network, timeout, a bad status), so callers can tell that from a poor answer.
 */
async function callGemini({ system, user, generationConfig }: GeminiCall, opts: GeminiOptions): Promise<{ text: string; finish: string }> {
  const { apiKey, model = DEFAULT_MODEL, fetch: doFetch = (...a) => fetch(...a), timeoutMs = 8000 } = opts;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
  let res: Response;
  try {
    res = await doFetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: 'user', parts: [{ text: user }] }],
        generationConfig,
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (e) {
    throw new GeminiError(e instanceof Error ? e.message : 'request failed', 504);
  }
  if (!res.ok) throw new GeminiError(`Gemini answered ${res.status}: ${await errorMessage(res)}`, res.status);
  try {
    const body = (await res.json()) as { candidates?: { finishReason?: string; content?: { parts?: { text?: string }[] } }[] };
    const candidate = body.candidates?.[0];
    return { text: candidate?.content?.parts?.map((p) => p.text ?? '').join('') ?? '', finish: candidate?.finishReason ?? '' };
  } catch {
    return { text: '', finish: '' };
  }
}

/**
 * The requests in a typed line, checked against our lists: an empty list when Gemini found none
 * (or answered with junk). Throws GeminiError when the call itself fails.
 */
export async function askGemini(text: string, dogName: string, opts: GeminiOptions): Promise<IntentItem[]> {
  const { text: answer } = await callGemini(
    {
      system: systemPrompt(dogName.slice(0, MAX_DOG_NAME)),
      user: text.slice(0, MAX_TEXT),
      generationConfig: { responseMimeType: 'application/json', responseSchema: RESPONSE_SCHEMA, temperature: 0 },
    },
    opts,
  );
  try {
    const parsed = JSON.parse(answer) as { items?: unknown };
    const items = Array.isArray(parsed.items)
      ? parsed.items.map((it) => {
          const item = it as Record<string, unknown>;
          return { ...item, politeness: POLITENESS[item.politeness as keyof typeof POLITENESS] ?? 0 };
        })
      : [];
    return validateIntents({ items }) ?? [];
  } catch {
    return [];
  }
}

/** Letters take longer to write than a list of intents. */
export const LETTER_TIMEOUT_MS = 12_000;

/**
 * A letter in his voice from checked facts, or null when Gemini's answer is unusable (cut off,
 * blocked, too short or too long), so the game keeps its template. Throws GeminiError when the
 * call itself fails.
 */
export async function askGeminiLetter(req: LetterRequest, opts: GeminiOptions): Promise<string | null> {
  const { text, finish } = await callGemini(
    {
      system: letterSystemPrompt(req),
      user: letterUserPrompt(req),
      generationConfig: { temperature: 0.9, maxOutputTokens: 600 },
    },
    { timeoutMs: LETTER_TIMEOUT_MS, ...opts },
  );
  const letter = text.trim();
  if (finish !== 'STOP' || letter.length < MODEL_LETTER_CHARS.min || letter.length > MODEL_LETTER_CHARS.max) return null;
  return letter;
}

/** Google's one-line reason ("API key not valid..."), or the start of the body. */
async function errorMessage(res: Response): Promise<string> {
  const text = await res.text();
  try {
    return (JSON.parse(text) as { error: { message: string } }).error.message;
  } catch {
    return text.slice(0, 200);
  }
}

export interface ApiReply {
  status: number;
  body: unknown;
}

/** The dev server's /api/intent: checks the request, asks Gemini, and passes failures on as statuses. */
export async function handleIntentRequest(raw: string, opts: GeminiOptions): Promise<ApiReply> {
  let req: { text?: unknown; dogName?: unknown };
  try {
    req = JSON.parse(raw) as typeof req;
  } catch {
    return { status: 400, body: { error: 'bad json' } };
  }
  if (typeof req.text !== 'string' || !req.text.trim()) return { status: 400, body: { error: 'no text' } };
  const dogName = typeof req.dogName === 'string' ? req.dogName : 'the dog';
  try {
    return { status: 200, body: { items: await askGemini(req.text, dogName, opts) } };
  } catch (e) {
    return failure(e);
  }
}

/** The Worker's /api/letter: checks the facts, asks Gemini, and answers `{ text }` (null: keep the template). */
export async function handleLetterRequest(raw: string, opts: GeminiOptions): Promise<ApiReply> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { status: 400, body: { error: 'bad json' } };
  }
  const req = validateLetterRequest(parsed);
  if (!req) return { status: 400, body: { error: 'bad letter facts' } };
  try {
    return { status: 200, body: { text: await askGeminiLetter(req, opts) } };
  } catch (e) {
    return failure(e);
  }
}

/** 429 means slow down, so the game's breaker waits longer; anything else is just a failure. */
function failure(e: unknown): ApiReply {
  const status = e instanceof GeminiError ? e.status : 502;
  return { status: status === 429 ? 429 : 502, body: { error: e instanceof Error ? e.message : 'failed' } };
}
