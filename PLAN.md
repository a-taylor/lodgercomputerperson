# Lodger Computer Person: build plan

A browser tribute to Activision's 1985 Little Computer People. The title is **Lodger Computer Person** (LCP); "Little Computer People" is Activision's trademark, so do not use it in the product. All art, sound and text must be original. Do not extract or trace assets from the original disks.

## 1. Goal

A browser game, faithful in spirit to the 1985 original: one small person lives in a cutaway house inside your computer. You watch him, look after him, and talk to him by typing. There are no points, levels or enemies. Modernise the plumbing and the polish (saving, offline play, touch, crisp art, sound), not the idea. This is explicitly not The Sims: one person, one house, no building, no economy, no goals.

## 2. What the original did (research summary)

Sources agree on the broad shape; room-by-room detail varies between sources and platform versions, so treat the layout below as a design target, not a spec.

- **The house.** Side-on cutaway of a multi-storey house. Rooms reported across sources: den (TV, record player, piano), study (typewriter, games cabinet), bedroom (bed, closet, exercise rug), bathroom, office (computer, bookshelf, clock), kitchen (fridge, stove, table, water, dog bowl), living room (armchair, fireplace, phone, front door).
- **Moving in.** The house starts empty. After a couple of minutes a person arrives, explores, then returns with belongings and a dog. Keyboard input is ignored during this. Each disk generated a unique person (name from a list of 256, appearance, personality) from a serial number.
- **Autonomy.** He cooks, eats, showers, brushes his teeth, watches TV, reads the paper, plays piano, dances, exercises, programs his computer, phones, lights the fire, feeds the dog, sleeps at night. He often does things you did not ask for. He sometimes knocks on the inside of the screen to get your attention, invites you to play cards, or writes you a letter.
- **Needs and mood.** Food and water must be supplied by you; the dog needs food too. Neglect shows on his face (green when sick, a drooping mouth when sad), he stays in bed, and eventually he can die. Happy people comply with requests more often. Mood persists between sessions.
- **Your inputs.** Direct deliveries: food, water, dog food, a record, a book, a phone call, an alarm clock, a pat on the head (his favourite). Typed requests: "please play the piano", "please dance", "please type a letter", "play with me". Politeness matters. He can say no depending on mood and what he has recently done. The parser knew roughly 160 words.
- **Games together.** Poker, War, Anagrams, a word puzzle. Letting him win sometimes helps his mood; winning every time hurts it.
- **Letters.** Typed on his typewriter, they report how he feels, what he did, what he wants (books, records), and how you are doing as a caretaker.
- **Time.** Time passed while the program was off. Disk versions remembered him; the cassette version did not and was widely seen as hollow.
- **Reception.** Praised for charm, detail and the sense of a character with a will of his own. Criticised for lack of goals and thin long-term replay. The lesson: the pleasure is in noticing small things. Protect that; do not paper over it with systems.

Sources: Wikipedia, C64-Wiki, StrategyWiki, ST News review, Retro365, The Oasis BBS, Dazeland, Jason L. Blair's "Dream Project".

## 3. Design principles

1. **Watching is the game.** The default state is you looking at a room while he gets on with his day. Everything else is a small intrusion into that.
2. **He has a will.** He can ignore, refuse, or comply late. Refusals have reasons he can voice ("I'm tired", "not now, I'm reading").
3. **Small, specific, deterministic.** Hand-authored activities and a large pool of hand-written lines beat a clever generic system. No LLM in the core loop. Letters and speech come from templates keyed on real state, with enough variety that repetition is rare. (Optional LLM features for letters and free-text requests are specified in PLAN_V2.md: off by default, with these templates as the fallback.)
4. **Consequences without cruelty.** Neglect makes him sick and miserable; death is possible but slow, warned, and recoverable via a "new tenant" flow that keeps the old one in a memorial page.
5. **Respect the player's time.** It runs in a background tab, and catches up sensibly when you return.

## 4. Modernisation (what changes)

- **Persistence.** Autosave to IndexedDB; export/import save as a small JSON file. Versioned save format with migrations.
- **Away time.** On return, run a coarse deterministic catch-up from last-seen timestamp (needs drain, sleep, a few remembered events). Show "While you were away" as a letter or note, never a notification wall.
- **Real-clock rhythm.** His day follows the player's local clock (asleep at night, breakfast in the morning), with a user setting to shift or compress it.
- **Input.** Typed parser kept as the signature interaction, but with fuzzy matching and synonyms ("play some piano", "could you dance please") instead of a rigid word list. Alongside it: clickable and draggable items (food, water, record, book, dog food), tap-to-pat, and keyboard shortcuts echoing the original Ctrl keys. Touch works on phones.
- **Presentation.** Original pixel art, rendered crisp at integer scale, dark/light-aware surrounding UI, proper sound (piano, records, footsteps, phone, knock on the glass) with a mute default-on-first-load and volume control. Day/night lighting through the windows and seasonal touches from the real date.
- **PWA.** Installable, works offline.
- **Accessibility.** Full keyboard use, captions for sounds and speech, reduced-motion setting, readable text sizes, screen-reader log of what he is doing.
- **Opt-in nudges.** Optional browser notification when he writes you a letter. Off by default.
- **Variety per save.** Seeded generation of name, look, personality traits (e.g. sociable, tidy, musical), favourite music, dog, and quirks.

## 5. Architecture

- TypeScript, Vite, Canvas 2D (PixiJS only if profiling demands it). Minimal UI chrome in plain DOM. No heavy framework.
- **Simulation separate from rendering.** Fixed-timestep sim, seeded PRNG, pure-ish state so it is testable and the catch-up can reuse it.
- **House as data.** Rooms, floor graph (walkable nodes and stairs), and furniture with interaction points defined in JSON. Navigation is waypoint pathing on the floor graph; no physics.
- **Behaviour.** Utility-based selection over needs, mood, time of day and traits, choosing from a library of activities. Each activity is a small state machine (walk to node, animate, effects, duration, interrupts). Adding an activity means adding data plus one script.
- **Dialogue and letters.** Template engine with slots for state, history and traits, plus a repetition guard.
- **Parser.** Tokenise, normalise, map to intents with synonyms and a politeness flag; intent plus mood plus context yields comply, refuse or defer. Chained requests ("play the piano and then dance") split on "then" / "and then" into an ordered queue of at most four. Compliance is checked as each item reaches the front, not when typed, and urgent needs can pre-empt the queue. Input the parser cannot match goes through a single fallback hook (none by default) that PLAN_V2.md uses for an LLM.
- **Save.** `{version, seed, person, dog, needs, mood, memory, house, clock, lastSeen}`.
- **Tests.** Vitest for sim determinism, catch-up, parser and save migration; Playwright smoke test for load, move-in, save/reload.

## 6. Phases and acceptance criteria

1. **Skeleton.** Vite + TS project, canvas house with placeholder art, floor graph, a figure that walks between rooms. *Accept:* figure paths to any node; sim runs deterministically from a seed.
2. **Daily life.** Needs, mood, utility AI, 8 core activities (eat, drink, sleep, wash, TV, read, piano, feed dog). *Accept:* left alone for a simulated week with no player input, he stays alive and does a plausible, varied day without getting stuck.
3. **Moving in and identity.** Empty house, arrival sequence, seeded person and dog, name entry. *Accept:* two seeds give visibly and behaviourally different people.
4. **Player interaction.** Deliveries, patting, phone, alarm, typed parser with compliance logic, speech bubbles, knock-on-glass. *Accept:* "please play the piano" works in at least five phrasings; refusals have reasons; politeness changes odds measurably in tests.
5. **Letters and games.** Typewriter letters from state; Poker, War, Anagrams, word puzzle with mood effects. *Accept:* no repeated letter text within 30 letters; letting him win vs always winning shifts mood.
6. **Persistence and away time.** IndexedDB autosave, export/import, catch-up, "while you were away" letter, sickness and recoverable death flow. *Accept:* close tab for 12 hours (simulated clock) and he is plausibly asleep, fed or hungry, with a letter waiting.
7. **Polish.** Final pixel art and animation pass, sound, day/night, accessibility, touch. *Accept:* Lighthouse a11y check passes; playable on a phone. (PWA, letter notifications, drag-and-drop items and seasonal touches are deferred to v2; see PLAN_V2.md section 7.)
8. **Request queue (last v1 item).** Replace the single `pending` request slot with the ordered queue described in section 5 (with a save migration), and make "then" chains work through the plain parser. *Accept:* "play the piano and then dance" runs both in order; urgent needs pre-empt the queue; old saves migrate. After v1, content depth (more activities, quirks, seasonal events, rare surprises, two-actor dog activities) is ongoing; see PLAN_V2.md section 7.

## 7. Risks and decisions for the owner

- **IP.** Name, character designs and assets belong to Activision. Original art and a distinct title keep this clearly a tribute. Check the trademark position before any public release.
- **Replay.** The original's weak spot. Mitigation is variety of traits, rare events and a very large pool of authored lines, not goals.
- **Art.** Biggest unknown. Options: hand-made pixel art by you, a commissioned artist, or AI-assisted sprites with manual cleanup. Placeholder rectangles are fine until phase 7.
- **Time model.** Real-clock by default is charming but means he sleeps when you might be playing at night. Keep the shift setting.

## 8. First prompt for Claude Code

"Read PLAN.md. The project is called Lodger Computer Person. Implement phase 1 only. Use TypeScript and Vite, no UI framework. Put house layout and furniture in JSON. Keep the simulation deterministic and separate from rendering. Add Vitest tests for pathing and seeded determinism. Stop when the phase 1 acceptance criteria pass and summarise what you did."

## 9. Status (updated 2026-10-18)

**v1 is complete.** Phases 1 to 8 are done, including phase 7 (day/night lighting, synthesised Web Audio sound with captions, accessibility pass with Lighthouse a11y 100, phone check, Playwright smoke tests with axe) and the phase 8 request queue with "then" chains. Run `npm test` (Vitest) and `npm run test:e2e` (Playwright in the installed Chrome; the desktop smoke test takes about 2.5 minutes because moving in runs in real time).

**v1.5 (UI refresh and touches), done:**

- Retro pixel UI: Pixelify Sans (self-hosted, OFL), wood-and-cream palette taken from the house, bevelled buttons, wooden sliders, code-drawn pixel icons (`src/ui/icons.ts`). Light and dark themes.
- Layout: a top bar (clock, status, speed, sound, settings gear) over the house and a side panel of boards (Talk, Look after him, How he's doing, Larder). Options, saving, shortcuts and credits live in a settings dialog.
- Needs and mood are visible as segmented bars (the owner chose to show them rather than keep them hidden as in the original).
- He sits up on the armchair (`seat` on furniture in `house.json`) and is tucked into bed (body drawn in the blanket colour, closed eyes when asleep).
- Clicking in the house: him (pat), the dog (barks, "Woof!" bubble), fridge (food), teapot or mug (water), dog bowl, record player, bookshelves, phone, grandfather clock (alarm), games cabinet, front door (letters). Same actions as the panel buttons.
- Idle slowdown: after 30 minutes with no input, time drops to 1x (the same pace as a closed tab) and the previous speed comes back on any click or key. `?idle=60` sets the wait in seconds. Added after a tenant died when the tab was left open overnight at 30x.

**Decisions recorded:**

- Two-actor dog activities, PWA, letter notifications, drag-and-drop and seasonal touches moved to v2 (PLAN_V2.md section 7).
- Sound is original and synthesised; no sample files. Muted by default.
- The owner isn't fussed about the Lighthouse PWA check.
- Art comes from off-the-shelf packs plus code-drawn sprites; the owner doesn't draw (see CREDITS.md for licences).

**Small ideas not done (optional):**

- Other sitting spots (kitchen table, TV, piano, typewriter, games table) still have him on the floor; each needs a chair or a `seat`.
- A Food/Water choice when clicking the fridge; the teapot and mug are small targets, and the dog often stands over its bowl.
- The "Pat" hand icon is the weakest icon.

**Next:** v2, LLM features and deployment. Phases are in PLAN_V2.md section 8; 9a (making the repo safe to publish) is under way.
