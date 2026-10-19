// Asks Gemini what a line the parser couldn't read was asking for. This runs in the Worker
// (worker/index.ts), never in the browser, so the player's key stays on their machine. It
// owns the prompt; the browser only sends the typed line and the dog's name.
import { GAME_KINDS, GAME_NAMES } from '../sim/games/types';
import { MAX_INTENT_ITEMS, MODEL_INTENTS, ROOMS, validateIntents, type IntentItem, type ModelIntent } from '../sim/parser';

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

/**
 * The requests in a typed line, checked against our lists: an empty list when Gemini found none
 * (or answered with junk). Throws GeminiError when the call itself fails.
 */
export async function askGemini(text: string, dogName: string, opts: GeminiOptions): Promise<IntentItem[]> {
  const { apiKey, model = DEFAULT_MODEL, fetch: doFetch = (...a) => fetch(...a), timeoutMs = 8000 } = opts;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
  let res: Response;
  try {
    res = await doFetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemPrompt(dogName.slice(0, MAX_DOG_NAME)) }] },
        contents: [{ role: 'user', parts: [{ text: text.slice(0, MAX_TEXT) }] }],
        generationConfig: { responseMimeType: 'application/json', responseSchema: RESPONSE_SCHEMA, temperature: 0 },
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (e) {
    throw new GeminiError(e instanceof Error ? e.message : 'request failed', 504);
  }
  if (!res.ok) throw new GeminiError(`Gemini answered ${res.status}: ${await errorMessage(res)}`, res.status);
  try {
    const body = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
    const answer = JSON.parse(body.candidates?.[0]?.content?.parts?.[0]?.text ?? '') as { items?: unknown };
    const items = Array.isArray(answer.items)
      ? answer.items.map((it) => {
          const item = it as Record<string, unknown>;
          return { ...item, politeness: POLITENESS[item.politeness as keyof typeof POLITENESS] ?? 0 };
        })
      : [];
    return validateIntents({ items }) ?? [];
  } catch {
    return [];
  }
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
    const status = e instanceof GeminiError ? e.status : 502;
    // 429 means slow down, so the game's breaker waits longer; anything else is just a failure.
    return { status: status === 429 ? 429 : 502, body: { error: e instanceof Error ? e.message : 'failed' } };
  }
}
