# Language model features (bring your own key)

The game runs fine without a language model. With one, when he can't follow something you type
("fancy a quick ivory tinkle then a boogie?"), the game asks Gemini what you meant. Gemini only
picks from the game's fixed list of requests, and he still decides for himself whether to do them.

This only works when you run the game yourself. The key lives in a small Cloudflare Worker
(`worker/index.ts`), which you run on your own machine with Wrangler, Cloudflare's command-line
tool; no Cloudflare account is needed for that. The GitHub Pages build has no Worker, so there the
feature stays hidden.

## Setup

1. Get a Gemini API key from Google AI Studio: <https://aistudio.google.com/apikey>.
2. In the project folder, create `.env.local` (it's gitignored, so it can't be committed):

   ```
   GEMINI_API_KEY=your-key-here
   # Optional: a different model (default gemini-3.5-flash-lite)
   # GEMINI_MODEL=gemini-3.1-flash-lite
   # Where the dev server sends /api requests
   LCP_WORKER_URL=http://localhost:8787
   ```

   `wrangler dev` reads the `GEMINI_*` lines as the Worker's secrets ("Using secrets defined in
   .env.local"); Vite reads `LCP_WORKER_URL`.

3. In one terminal, `npm run dev:worker` (the Worker, on port 8787).
4. In another, `npm run dev` (the game; restart it if it was already running) and open the address
   it prints.
5. Settings → tick **Understand messy requests (online)**.

## What gets sent

Only the line he couldn't read and the dog's name, from the Worker to Google using your key.
The browser never sees the key. Nothing else from your save is sent. On Gemini's free tier, Google
may keep what it receives, have people review it, and use it to improve its products; check the
current [Gemini API terms](https://ai.google.dev/gemini-api/terms) for your situation.

## When it goes wrong

He says "Hmm?" as if there were no model. The Worker's terminal shows `[intent]` with Google's
reason (for example "API key not valid"); if the Worker isn't running, Vite's terminal shows a
proxy error instead. After a failure the game stops asking for two
minutes (fifteen after a rate limit), then tries again.

## How it fits together

- `src/llm/gemini.ts`: the prompt, the response schema, and the call. Runs in the Worker only.
- `worker/index.ts` and `wrangler.jsonc`: the Worker. Answers `POST /api/intent`, turns away
  anything else, and holds the key.
- `vite.config.ts`: when `LCP_WORKER_URL` is set, proxies `/api/*` to the Worker and shows the setting.
- `src/llm/model.ts`: the game's side: asks `/api/intent`, with a timeout and a circuit breaker.
- `src/sim/parser.ts` `validateIntents`: every answer is checked against the fixed lists, twice.
