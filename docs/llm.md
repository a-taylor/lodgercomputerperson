# Language model features (bring your own key)

The game runs fine without a language model. With one, it can do two things, each with its own
tick box in Settings:

- **Understand messy requests.** When he can't follow something you type ("fancy a quick ivory
  tinkle then a boogie?"), the game asks Gemini what you meant. Gemini only picks from the game's
  fixed list of requests, and he still decides for himself whether to do them.
- **Write his letters in his own words.** When he sits down at the typewriter, the game sends the
  facts for his letter to Gemini, which writes it in his voice. He types for 10–20 game minutes, so
  the words are nearly always back before he's done, and the letter he finishes uses them. If
  they're late, he writes his usual template letter, and the words replace it only if they arrive
  before you open it; a letter never changes once you've read it. After you've been away, the
  letter is written all at once, so it waits ("just finishing a letter…") for a few seconds while
  the words arrive.

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
   # Where the game finds the Worker
   VITE_LCP_API_URL=http://localhost:8787
   ```

   `wrangler dev` reads these as the Worker's secrets ("Using secrets defined in .env.local").
   Vite builds `VITE_LCP_API_URL` into the page (anything starting `VITE_` goes to the browser, so
   never put the key in one); it's only an address.

3. In one terminal, `npm run dev:worker` (the Worker, on port 8787).
4. In another, `npm run dev` (the game; restart it if it was already running) and open the address
   it prints. The browser calls the Worker directly.
5. Settings → tick **Understand messy requests (online)** and/or **Let him write his letters in
   his own words (online)**.

## Deploying the Worker to Cloudflare (optional)

Instead of `npm run dev:worker`, you can run the Worker on your own Cloudflare account (the free
plan is enough). The game still only calls it from `npm run dev`; the Pages build never does.

1. `npx wrangler login`, then `npm run deploy:worker`. It prints the Worker's address,
   `https://lodgercomputerperson-intent.<your-subdomain>.workers.dev`. On an account's first
   Worker, that address can take a few minutes to start resolving.
2. Give the deployed Worker its secrets. `wrangler deploy` never uploads `.env.local`, so they are
   set separately, and stored encrypted by Cloudflare:

   ```
   grep '^GEMINI_API_KEY=' .env.local | npx wrangler secret bulk
   ```

3. In `.env.local`, set `VITE_LCP_API_URL` to that address and restart `npm run dev`.

The address is public, so the Worker only answers pages served from `localhost` or `127.0.0.1`
(any port): it checks the request's `Origin` and turns anything else away (403) before doing
anything else. Browsers can't fake `Origin`, so no other website can use your Worker; a script
outside a browser can. A rate limit of about 10 requests a minute slows that down (429, after which
the game waits 15 minutes), but Cloudflare's limiter is deliberately approximate: it counts per
data centre and catches up in the background, so a burst can get well past 10 before it trips.

So there's also a hard daily cap: 300 requests per UTC day (`DAILY_LIMIT` in `wrangler.jsonc`),
after which the Worker answers 429 until midnight UTC. The count lives in a Durable Object
(`worker/counter.ts`): a single instance that handles one request at a time, so the count is exact
(Workers KV, which is eventually consistent, could lose counts). Its storage is a small SQLite
table, one row per day.

- Try it locally: `npm run dev:worker -- --var DAILY_LIMIT:3`, then send four requests; the fourth
  gets 429. Requests turned away earlier (wrong origin, too big) aren't counted.
- See the counts locally: `wrangler dev` keeps the Durable Object's database under
  `.wrangler/state/v3/do/lodgercomputerperson-intent-DailyCounter/`; open the long-named
  `.sqlite` file with `sqlite3 <file> 'select * from days'`. Delete that folder to reset.

Live logs: `npx wrangler tail`, or Workers & Pages → the Worker → Observability in the dashboard. To
take it down: `npx wrangler delete`.

## What gets sent

For a request: only the line he couldn't read and the dog's name. For a letter: your name, his and
the dog's, his favourite food and music, his character (traits and quirks), and the facts behind
the letter (his mood and health, what he did and how often, what you sent, games and who won, what
he'd like, how you've treated him, and how long you were away). The Worker checks every fact
against the game's own lists and drops anything else before it reaches the prompt. Both go from the
Worker to Google using your key.
The browser never sees the key. Nothing else from your save is sent. On Gemini's free tier, Google
may keep what it receives, have people review it, and use it to improve its products; check the
current [Gemini API terms](https://ai.google.dev/gemini-api/terms) for your situation.

## When it goes wrong

He says "Hmm?" as if there were no model. The Worker's log (its terminal, or `wrangler tail`)
shows `[intent]` with Google's reason (for example "API key not valid"). If the Worker isn't
running, or the page isn't on localhost (403), the browser console shows a failed request or a
CORS error instead. Gemini occasionally takes longer than the timeout (8 seconds for a request, 12 for a
letter), which also counts as a failure. A failed letter is just his template letter.

Separately, Settings → **Tell me when he writes a letter** shows a browser notification while the
game is open in a window you're not looking at. It doesn't need a model, so it works on Pages too. After a failure the game stops asking for two
minutes (fifteen after a rate limit), then tries again.

## How it fits together

- `src/llm/gemini.ts`: the intent prompt and response schema, and the call for both. Runs in the
  Worker only.
- `src/llm/letter.ts`: checks a letter's facts and turns them into the letter prompt. Worker only.
- `src/sim/letters.ts`: `askForLetter` takes the facts (`letterAsk`) when he sits down to write,
  while letters are on; `acceptLetterText` keeps the model's words for the letter he's typing, or
  puts them into one already written, only while it's unread.
- `worker/index.ts` and `wrangler.jsonc`: the Worker. Holds the key, checks the origin, the rate
  limit and the daily cap, answers the browser's CORS preflight, `POST /api/intent` and `POST /api/letter`, and turns
  away anything else.
- `worker/counter.ts`: the daily cap's Durable Object. `worker/cloudflare-workers.d.ts` types the
  bits of the Workers runtime it uses; `tests/stubs/` stands in for that runtime under Vitest.
- `.env.local` `VITE_LCP_API_URL`: tells the game where the Worker is, which also shows the setting.
- `src/llm/model.ts`: the game's side: asks `/api/intent`, with a timeout and a circuit breaker.
- `src/sim/parser.ts` `validateIntents`: every answer is checked against the fixed lists, twice.
