// Time passing while you're away. His day runs at real speed while the tab is closed, whatever
// speed you watch at, so twelve hours away is twelve hours for him. The catch-up runs the real
// sim at a coarse time step: the same rules as live play, just quicker to compute.
import { writeLetter, type Letter } from './letters';
import { say } from './speech';
import { isAsleep, step, stopActivity, TICK_MS, type SimState } from './sim';
import { DAY_MS, MINUTE_MS } from './time';
import type { World } from './world';

/** Game seconds per tick while catching up: fine enough for walks and meals, quick to run. */
export const CATCH_UP_SCALE = 60;
/** Longer absences are cut short: he can't live through more than this without you. */
export const MAX_AWAY_MS = 14 * DAY_MS;
/** Away at least this long and there's a letter waiting when you get back. */
export const AWAY_LETTER_AFTER_MS = 30 * MINUTE_MS;

export interface AwaySummary {
  /** Game time you left. */
  fromMs: number;
  /** How much of his time passed (capped). */
  passedMs: number;
  letter: Letter | null;
  /** He died while you were gone. */
  died: boolean;
}

export function catchUp(state: SimState, world: World, awayMs: number): AwaySummary {
  const fromMs = state.clock.ms;
  const passedMs = Math.min(Math.max(0, Math.round(awayMs)), MAX_AWAY_MS);
  const wasAlive = state.person.alive;

  // You can't hold a hand of cards from the other side of a closed tab.
  if (state.person.activity?.id === 'game') stopActivity(state, world, false);
  state.invitation = null;

  const watching = state.clock.msPerTick;
  const end = fromMs + passedMs;
  while (state.clock.ms < end) {
    state.clock.msPerTick = Math.min(TICK_MS * CATCH_UP_SCALE, end - state.clock.ms);
    step(state, world);
  }
  state.clock.msPerTick = watching;
  // Whatever he said to an empty room is over now.
  state.speech = null;
  state.phoneRing = null;

  const died = wasAlive && !state.person.alive;
  let letter: Letter | null = null;
  const settled = state.moveIn.stage === 'done';
  if (settled && state.person.alive && passedMs >= AWAY_LETTER_AFTER_MS) {
    letter = writeLetter(state, { fromMs, durationMs: passedMs });
  }
  if (settled && state.person.alive && passedMs >= AWAY_LETTER_AFTER_MS && !isAsleep(state, world)) {
    say(state, state.person.sick ? 'welcome.sick' : 'welcome');
  }
  return { fromMs, passedMs, letter, died };
}
