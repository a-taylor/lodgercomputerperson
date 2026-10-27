# Little Computer People vs ours: what's missing

## Context
Three agents ran: two researched the 1985 original (mechanics; presentation and feel), and one listed what our game does now. Main sources: the Spectrum manual text (worldofspectrum.org), C64-Wiki, Wikipedia, ST News, magazine reviews. MobyGames, StrategyWiki and Hardcore Gaming 101 blocked the agents, so some details are single-source. This is a report, not a change: nothing gets built until you pick items.

## We already match the original
- Moving in: an empty house, a tour, then he fetches his suitcase and dog.
- Unique tenants from a seed: 256 names, looks, traits.
- Food, water and the dog's food; sickness (green, in bed); death.
- Deliveries at the front door: food, water, dog food, records, books. Also phone, alarm and pat.
- The typed parser, where please and rudeness matter and he refuses when in a mood.
- Knocking on the glass for attention and to offer games.
- Games: War, Poker, Anagrams, plus a word puzzle (the ST version had one too).
- Letters about his life; typed letters on request.
- Piano, records, dancing, exercise, TV, reading in the armchair, phoning, feeding the dog.
- Time passes while you're away.

## Missing: furniture is already there but has no activity (cheapest wins)
Nodes and furniture exist in `src/data/house.json`, but no activity in `src/data/activities.json` uses them. At the moment only "potter" ever takes him there.
1. **Fireplace** (`living.fireplace`). In the original he builds a fire when asked ("please build a fire"). New activity `fire` plus a lexicon intent; the fire light could switch on while it burns.
2. **Home computer** (`office.computer`). The original tenant uses his computer. New activity `computer`: sitting, fun, suits a bookish tenant.
3. **Toilet** (`toilet` furniture). The original has him go behind the bathroom door, wash his hands, and brush his teeth after meals. New activity `toilet` (he goes out of sight, or the door shuts), plus perhaps a sink step after eating.
4. **Wardrobe** (`bedroom.closet`). The original has him change clothes late at night before bed. Add a closet step to `sleep`, and perhaps a different shirt colour at night (pyjamas).

## Missing: behaviour and personality
5. **Mood on his face**: happy, content, sad or sick. Ours only shows sick (green); otherwise mood is a bar. A sad mouth on the sprite would be a display edit to the Penzilla frame, so it needs a CREDITS.md entry.
6. **Too many phone calls irritate him.** Ours has no penalty for pestering.
7. **He teaches the dog tricks.** A short joint activity, with the dog doing its sit and lie frames on cue.
8. **The alarm at night**: he gets up, switches it off grumpily and goes back to bed (ours just wakes him).
9. **Pat in the armchair.** In the original you can only pat him there, and pressing Pat calls him to the chair. Ours lets you pat him anywhere, which is arguably better. Optional.

## Missing: the games
10. **Anagram hints**: one letter placed per hint, and no two hints in a row. Ours has tries and a pass button, but no hints.
11. **Poker chips**: 200 chips each, bets capped at 20. Ours is just hold, draw, then show or fold. Optional, since it adds UI.
12. **He "cheats" and insists on dealing.** A flavour line or two in `speech.json`.

## Missing: presentation and sound
13. **More music.** The original has 17 pieces, piano "from Bach to Boogie Woogie", and seasonal tunes such as Jingle Bells at Christmas. We have 2 record tunes, and the piano plays a generic ambient sound.
14. **Footsteps sound different on carpet and on linoleum** (kitchen and bathroom).
15. **The turntable visibly spins** while a record plays. Ours is a static sprite.
16. **The framing.** The "Little Computer People Research Project", where you're a researcher, the "House-on-a-Disk", a deed to the house. An optional intro or "field notes" page in the same earnest, mock-scientific tone.

## Deliberately different (leave as they are)
- Visible need bars. The original showed only the face.
- Shorter games: War first to 7, not the whole deck.
- The speed slider. A 6-hour day was something David Crane later regretted.
- Our extras: LLM talk, quirks, the memorial, the welcome-back letter.

## Suggested order
- **1–4 first**: data plus small sim changes, reusing the existing patterns (seat/`fromBehind`, multi-step activities like eat and game).
- Then 5–6 (character).
- Then 10, 13 and 15 (polish).

Each item needs a test in `tests/` where there's sim logic. Run `npx vitest run`, update the determinism fingerprint deliberately, and take a screenshot with the Playwright probe.

## Verification
For each item built, check by hand:
- he does it on his own in debug at high speed;
- the typed request works;
- a screenshot looks right;
- `npx vitest run` passes.
