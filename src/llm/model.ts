// Language features sit behind one interface, so the game never depends on a model being there.
// The template model always says "no idea"; the remote one asks our Worker; the breaker stops
// asking for a while after a failure. A null answer always means: carry on as if there were no model.
import type { LetterRequest } from '../sim/letters';
import { validateIntents, type IntentItem } from '../sim/parser';

export interface IntentContext {
  dogName: string;
}

export interface LanguageModel {
  /** What a line he couldn't follow asks for, or null if there's no answer. Never rejects. */
  intents(text: string, ctx: IntentContext): Promise<IntentItem[] | null>;
  /** His letter in his own words, from the same facts as the template, or null to keep the template. Never rejects. */
  letter(req: LetterRequest): Promise<string | null>;
}

/** No model at all: the game's own parser has already done its best, and letters stay as written. */
export const templateModel: LanguageModel = {
  intents: async () => null,
  letter: async () => null,
};

/** The remote failed (network, timeout, bad status). `status` is the HTTP status, if there was one. */
export class ModelError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
  }
}

/** A model that throws ModelError when the service fails, so a breaker can tell that from "no idea". */
export interface RemoteModel {
  intents(text: string, ctx: IntentContext): Promise<IntentItem[] | null>;
  letter(req: LetterRequest): Promise<string | null>;
}

/** Longest line sent; the Worker caps it too. */
export const MAX_TEXT = 200;

export interface RemoteOptions {
  /** The Worker's base URL, e.g. https://lcp-api.example.workers.dev */
  url: string;
  fetch?: typeof fetch;
  /** A little over the Worker's own limits for Gemini (20 and 25 seconds), so it answers first. */
  timeoutMs?: number;
  letterTimeoutMs?: number;
}

/**
 * Asks the Worker. Sends only what each question needs: the typed line and the dog's name (so
 * "feed Biscuit" makes sense), or a letter's facts. Never the save, and never a prompt: the Worker
 * owns those. Junk output comes back as null.
 */
export function remoteModel({
  url,
  fetch: doFetch = (...a) => fetch(...a),
  timeoutMs = 22_000,
  letterTimeoutMs = 28_000,
}: RemoteOptions): RemoteModel {
  const base = url.replace(/\/+$/, '');
  async function post(path: string, body: unknown, timeout: number): Promise<unknown> {
    let res: Response;
    try {
      res = await doFetch(`${base}${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeout),
      });
    } catch (e) {
      throw new ModelError(e instanceof Error ? e.message : 'request failed');
    }
    if (!res.ok) throw new ModelError(`status ${res.status}`, res.status);
    try {
      return await res.json();
    } catch {
      return null;
    }
  }
  return {
    async intents(text, ctx) {
      return validateIntents(await post('/api/intent', { text: text.slice(0, MAX_TEXT), dogName: ctx.dogName }, timeoutMs));
    },
    async letter(req) {
      const answer = await post('/api/letter', req, letterTimeoutMs);
      const text = (answer as { text?: unknown } | null)?.text;
      return typeof text === 'string' ? text : null;
    },
  };
}

export interface BreakerOptions {
  /** How long to stop asking after a failure. */
  coolMs?: number;
  /** How long after being told to slow down (429). */
  rateLimitedMs?: number;
  now?: () => number;
}

/**
 * Wraps a remote model: after a failure it stops calling for a while and answers null, as the
 * template model would. Never rejects.
 */
export function withBreaker(
  remote: RemoteModel,
  { coolMs = 2 * 60_000, rateLimitedMs = 15 * 60_000, now = Date.now }: BreakerOptions = {},
): LanguageModel & { readonly open: boolean } {
  let closedAt = 0;
  async function guarded<T>(ask: () => Promise<T | null>): Promise<T | null> {
    if (now() < closedAt) return null;
    try {
      return await ask();
    } catch (e) {
      closedAt = now() + (e instanceof ModelError && e.status === 429 ? rateLimitedMs : coolMs);
      return null;
    }
  }
  return {
    get open() {
      return now() < closedAt;
    },
    intents: (text, ctx) => guarded(() => remote.intents(text, ctx)),
    letter: (req) => guarded(() => remote.letter(req)),
  };
}
