# Lodger Computer Person: plan v2 (LLM features and deployment)

Status: draft. Finish v1 first (PLAN.md; phase 7 polish is under way). Nothing here changes the v1 acceptance criteria. Section 7 lists what v1 already has and the few changes worth making before v2.

## 1. Principle

The LLM handles language only. The deterministic sim decides what he does, how he feels and whether he complies. Every LLM output has a template fallback, so the game works offline, over quota, or with the feature switched off. This keeps PLAN.md principles 2 and 3 intact ("he has a will", no LLM in the core loop).

## 2. Features

**Letters.** The sim builds a fact list from his memory (the per-day `DayLog` counters: activities, deliveries, records, pats, politeness, refusals, games, knocks, mood), plus needs, traits and wants. The model turns it into a letter in his voice. Output is length-capped and the result is stored in the save, so a letter is generated once, never regenerated on reload. On any failure, fall back to the template letter (`src/sim/letters.ts`).

**Free text to intents.** The normal parser (synonyms, fuzzy match) runs first. Only input it cannot match (today the `intent === null` branch, which makes him say "confused") goes to the model. The model returns an ordered list of intents from the fixed set in `lexicon.json`, each with a politeness flag (section 3b). The sim then decides comply, refuse or defer for each, exactly as it does today. The model never invents activities.

**Short in-character replies (optional, later).** One or two sentences, bounded by current state (he cannot claim to have eaten if he has not). Same fallback rule.

**Tenant and dog together.** "Play with the dog" and fetch are hand-authored activities with sprite frames for both actors. The LLM has no part in them. Today the dog is an independent wanderer (`src/sim/dog.ts`) and no activity involves it except feeding, so this needs two-actor activity support in the behaviour system (section 7).

## 3. Architecture

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

## 6. Open decisions

- Gemini model and the current free-tier limits and terms; check at build time, they change often.
- Whether free-tier use of prompts for Google's product improvement is acceptable, and what the opt-in notice says.
- Rate limiting: Cloudflare's rate limiting binding versus KV, and how to identify a player anonymously (random id stored in the save).
- Hard daily cap in the Worker so a shared quota cannot be exhausted by one player.
- Whether to add a "bring your own key" setting.
- Public repo or private; trademark check before any public release (PLAN.md section 7).
- How to treat time phrases in batched requests (section 3b).

## 7. Impact on v1

Already in place:

- The intent list is data (`src/data/lexicon.json`), and `parse()` returns `intent: null` for unmatched input, which is the hook for the model.
- Memory keeps per-day counters (`DayLog`), enough for letter facts. A structured event log is only needed if letters should recall specific moments; not required for v2.

Worth doing before or alongside v2:

- Replace the single `state.pending` slot with an ordered queue, with a save migration. PLAN.md phase 8 now lists this, along with plain-parser support for "then" chains. This is part of v1.
- Make the parser's unmatched branch able to await an async fallback without blocking the sim.
- Make Vite `base` configurable.

Deferred from v1 to v2:

- Two-actor activities, so the dog can take part ("play with the dog", fetch). Nothing in the activity system supports this yet.
- PWA (manifest, service worker, offline).
- Opt-in browser notification when he writes a letter.
- Drag-and-drop items onto the house (buttons already cover deliveries).
- Seasonal touches from the real date.
