# Lodger Computer Person: plan v2 (LLM features and deployment)

Status: v1 and v1.5 are done (PLAN.md section 9). Phases and acceptance criteria are in section 8. Section 7 lists what v1 already has and what was deferred to v2.

## 1. Principle

The LLM handles language only. The deterministic sim decides what he does, how he feels and whether he complies. Every LLM output has a template fallback, so the game works offline, over quota, or with the feature switched off. This keeps PLAN.md principles 2 and 3 intact ("he has a will", no LLM in the core loop).

## 2. Features

**Letters.** The sim builds a fact list from his memory (the per-day `DayLog` counters: activities, deliveries, records, pats, politeness, refusals, games, knocks, mood), plus needs, traits and wants. The model turns it into a letter in his voice. Output is length-capped and the result is stored in the save, so a letter is generated once, never regenerated on reload. On any failure, fall back to the template letter (`src/sim/letters.ts`).

**Free text to intents.** The normal parser (synonyms, fuzzy match) runs first. Only input it cannot match (today the `intent === null` branch, which makes him say "confused") goes to the model. The model returns an ordered list of intents from the fixed set in `lexicon.json`, each with a politeness flag (section 3b). The sim then decides comply, refuse or defer for each, exactly as it does today. The model never invents activities.

**Short in-character replies (optional, later).** One or two sentences, bounded by current state (he cannot claim to have eaten if he has not). Same fallback rule.

**Tenant and dog together.** "Play with the dog" and fetch are hand-authored activities with sprite frames for both actors. The LLM has no part in them. Today the dog is an independent wanderer (`src/sim/dog.ts`) and no activity involves it except feeding, so this needs two-actor activity support in the behaviour system (section 7).

## 3. Architecture

> **Changed 2026-10-19:** this is a learning project, not a published one. Each player brings their own Gemini key. The owner wants to learn Cloudflare, so `/api/intent` is a Cloudflare Worker: run locally under `wrangler dev` first, then deployed to the owner's account but only called from local dev (`docs/llm.md`). Sections 3 to 5 below describe the original public design; the per-player rate limit, daily cap in KV and the Pages CORS allowlist don't apply as written, since the Pages build never calls the Worker. GitHub Pages stays up as an LLM-free demo.

- Client has an `llm` module with one interface and a template implementation. The remote implementation sits behind it, with a circuit breaker: after a failure or a 429, stop calling for a while and use templates.
- Worker endpoints: `POST /api/letter`, `POST /api/intent`, `POST /api/reply`.
- The client sends small structured facts and the typed line, never the save file and never a prompt. The Worker owns the prompts. Otherwise anyone could use the Worker as a free general LLM proxy on our key.
- Worker checks: allowed origin, input size cap, per-player rate limit, output cap, request timeout. Gemini key lives only as a Worker secret.
- Privacy: typed text and state facts go to Google. Show a plain notice and make the feature an opt-in setting.

### 3b. Batched requests

"Why don't you play with the dog and then give him some food", "it's time to make dinner and then watch some tv before bed".

- `/api/intent` returns `{ items: [{ intent, politeness, room?, game? }] }`, ordered, capped at four. The Worker validates every intent against the whitelist and drops anything else; the client validates again.
- The plain parser handles simple chains itself by splitting on "then" and "and then", so only messy phrasing reaches the model.
- Requests go into an ordered queue. Compliance is checked when each item reaches the front, not when typed. By then he may be tired or hungry, so he can do the first, grumble at the second and still do the third. That fits "he has a will" better than all-or-nothing.
- Urgent needs can pre-empt the queue. Queue items expire when stale, as `pending` does today (`DEFER_MS`).
- Ambiguity returns "none" and he asks back, rather than guessing. "Give him some food" could mean you delivering dog food or him feeding the dog.
- Time phrases such as "before bed" are not tasks. Either end the queue at bed or ignore the phrase; decide when building.
- The queue is saved, so the save format needs a migration (`pending` becomes `queue`).

## 4. Repo and deployment

One repo (`github.com/a-taylor/lodgercomputerperson`), two deploy targets:

- Repo root: the Vite game, deployed to GitHub Pages at `https://a-taylor.github.io/lodgercomputerperson/`.
- `worker/`: Cloudflare Worker (TypeScript, wrangler), own `package.json` and `tsconfig.json`, deployed to workers.dev. The root `tsconfig.json` must not include it, and Vitest already only picks up `tests/**`.
- `docs/deploy.md`: the setup steps below, written as we do them.

Notes:

- Pages and workers.dev are different origins, so the Worker needs a CORS allowlist: the Pages origin plus localhost for dev.
- A GitHub Pages project site serves from `/lodgercomputerperson/`. `vite.config.ts` has no `base` today. Set it from an env var (default `/`), set to the repo path in the Pages build, so a custom domain later is a one-line change. The PWA manifest scope and service worker paths must match.
- The Worker URL reaches the client as a build-time variable (`VITE_LCP_API_URL`). It is not a secret.

### CI (GitHub Actions)

There is no `.github/` yet, and Playwright is not in `package.json` yet.

1. `ci.yml`, on pull request and push: `npm ci`, `npm run typecheck`, `npm test`, `npm run build`; the same for `worker/`. Add the Playwright smoke test when it exists.
2. `deploy-pages.yml`, on push to main: build with the Pages `base`, publish to Pages.
3. `deploy-worker.yml`, on push to main touching `worker/**` (plus manual dispatch): `wrangler deploy`.

### Secrets

- Gemini API key: `wrangler secret put GEMINI_API_KEY`, once, from a local machine. Never in the repo or GitHub.
- GitHub repo secrets: `CLOUDFLARE_API_TOKEN` (Workers edit scope only) and `CLOUDFLARE_ACCOUNT_ID`.
- Local dev: `worker/.dev.vars` (add to `.gitignore`) and `wrangler dev`.

## 5. Setup checklist (to turn into docs/deploy.md)

1. Create a Cloudflare account; note the account ID.
2. Create a Gemini API key in Google AI Studio.
3. Scaffold `worker/` with wrangler; run locally with `wrangler dev`.
4. `wrangler secret put GEMINI_API_KEY`; first manual `wrangler deploy`.
5. Create a scoped Cloudflare API token; add it and the account ID as GitHub secrets.
6. In the repo settings, set Pages source to GitHub Actions.
7. Add the three workflows; push; verify the Pages site and Worker both update.
8. Set `VITE_LCP_API_URL` for the Pages build; test letter generation end to end, then with the Worker deliberately failing to confirm the template fallback.

## 6. Decisions

Decided (2026-10-18):

- Public repo. The Penzilla art can't be redistributed, so it lives in a private repo (`lodgercomputerperson-art`) that CI pulls in, and it is scrubbed from the public history. See `docs/art.md` and CREDITS.md.
- Time phrases in batched requests ("before bed") are ignored; they add nothing to the queue.
- Rate limiting: Cloudflare's rate limiting binding keyed on a random player id stored in the save, plus a global daily cap counted in KV (approximate is fine).
- No "bring your own key" in v2.
- Dog activities move to the optional extras (phase 13).
- Trademark: the product uses only "Lodger Computer Person"; "Little Computer People" appears only in PLAN.md as tribute context.

Still open, decide when phase 11 starts:

- Settled 2026-10-19: the owner's own Gemini key, default model `gemini-3.5-flash-lite` (override with `GEMINI_MODEL`). Each player's use is under their own key and Google's terms; the notice and `docs/llm.md` say what's sent.

## 7. Impact on v1

Already in place:

- The intent list is data (`src/data/lexicon.json`), and `parse()` returns `intent: null` for unmatched input, which is the hook for the model.
- Memory keeps per-day counters (`DayLog`), enough for letter facts. A structured event log is only needed if letters should recall specific moments; not required for v2.

Worth doing before or alongside v2:

- ~~Replace the single `state.pending` slot with an ordered queue, with a save migration, and "then" chains in the plain parser.~~ Done in v1 (`state.queue`, save version 2).
- Make the parser's unmatched branch able to await an async fallback without blocking the sim.
- Make Vite `base` configurable.

Deferred from v1 to v2:

- Two-actor activities, so the dog can take part ("play with the dog", fetch). Nothing in the activity system supports this yet.
- PWA (manifest, service worker, offline).
- Opt-in browser notification when he writes a letter.
- Drag-and-drop items onto the house (buttons already cover deliveries).
- Seasonal touches from the real date.

## 8. Phases

Each phase ends playable; the game never depends on the LLM.

**9a. Safe to publish.** Penzilla art gitignored and moved to the private art repo; the build fails with a clear message when it's missing; CREDITS.md, in-game credits, `docs/art.md` and an MIT `LICENSE` (code only). History scrubbed with `git filter-repo` into a new public repo; the old private repo kept as `lodgercomputerperson-archive`.
*Done when:* the public repo's history contains no Penzilla files (`git rev-list --objects --all`), and a clean checkout without the art gives the "art missing" error.

**9b. Live on Pages.** Vite `base` from `VITE_BASE`; `ci.yml` (typecheck, unit tests, build) and `deploy-pages.yml`, both checking out the art with a read-only deploy key; `docs/deploy.md` started. Link emailed to Penzilla (done 2026-10-18).
*Done when:* CI is green, the Pages URL loads with all art, saves survive a reload, and the credits dialog shows every credit.

**10. Client LLM interface, templates only.** `src/llm/` with one interface, the template implementation (wrapping `gatherFacts`/`writeLetter`), a circuit breaker, and an opt-in setting with the privacy notice. The parser's unmatched branch becomes async: he shows a thinking bubble and the result arrives as an ordinary player input on the tick it lands, so the sim stays deterministic.
*Done when:* tests with a fake remote cover success, timeout, 429 (breaker opens) and junk output (dropped). **Done 2026-10-18.** The letter method joins the interface in phase 12, where it's first used. The setting appears only when `VITE_LCP_API_URL` is set.

**11. `/api/intent` with your own key.** A Cloudflare Worker (`worker/index.ts`, `wrangler.jsonc`) answers `POST /api/intent`; `src/llm/gemini.ts` owns the prompt and a response schema limited to the fixed intents. Step 1, local: `npm run dev:worker` runs it under `wrangler dev` with the key from `.env.local`. Setup in `docs/llm.md`. **Done 2026-10-19:** real-key run reads slang, order and politeness, and returns nothing for nonsense or off-list asks. Step 2: the browser calls the Worker directly (`VITE_LCP_API_URL`); the Worker answers CORS only for `localhost`/`127.0.0.1` origins and has a 10-a-minute rate limit binding. Chosen over a Vite proxy with a shared token, to learn CORS; weaker against scripts, which the rate limit covers. Works locally, browser-checked (preflight 204, then POST 200). Deployed with `npm run deploy:worker` (key via `wrangler secret bulk`). The first account subdomain (`andrew-c06`) answered Cloudflare error 1042 for every Worker, even a hello-world; the owner fixed it on 2026-10-20 by renaming the account subdomain to `actaylor` in the dashboard and redeploying. **Done 2026-10-20:** live at `https://lodgercomputerperson-intent.actaylor.workers.dev`, browser-checked from the local game (preflight, POST, real Gemini answer), other origins get 403. The rate limit binding is attached but, as Cloudflare documents, approximate: 54 quick requests weren't limited. A stricter cap (a daily count in KV or a Durable Object) is an optional extra.
*Done when:* "why don't you make dinner and then watch tv" queues two items with a real key, and with the key wrong or the network off he falls back to "confused".

**12. LLM letters and `/api/letter`** (also served by the Worker). The template letter is written at once; the model's text replaces it if it arrives before the letter is opened, and never after. Opt-in browser notification for new letters.
*Done when:* a letter survives reload unchanged, and fallback works with the Worker down. **Done 2026-10-20.** While "Let him write his letters" is on, the sim takes the facts and who's involved into `state.letterAsk` when he sits down to write (left out when off, so hashes and old saves are unchanged), and the letter he finishes uses the words if they're back, which they nearly always are; otherwise the template is written and late words replace it while unread. Asking at the end instead, as first built, left a gap where opening the letter locked in the template. Away letters ask when written; the game posts them to `/api/letter`; `src/llm/letter.ts` checks every fact against `letters.json` keys and builds the prompt; the answer comes back as a `letterText` command and replaces only an unread letter (`by: 'model'`). Away letters wait ("just finishing a letter…") until the words land or time out. The notification fires when the window isn't focused (hidden tabs don't run the game; away letters appear on return), after the model's words are in. Browser-checked against the deployed Worker: model letter, identical after reload, template when `/api/letter` is blocked, the away wait, the notification. Real-key letters stick to the facts; the prompt asks it to retell them in its own words.

**13. Extras (optional, explore later).** Two-actor dog activities (play with the dog, fetch; needs two-actor support in the behaviour system), PWA, seasonal touches, drag-and-drop, short in-character replies.

