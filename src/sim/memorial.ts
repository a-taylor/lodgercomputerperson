// When a tenant dies, he's remembered: who he was, how long he lived here, what he last wrote.
import type { Look } from './identity';
import type { SimState } from './sim';
import { DAY_MS } from './time';

export interface MemorialEntry {
  name: string;
  seed: number;
  dogName: string;
  look: Look;
  /** Days of his life spent in the house. */
  daysLived: number;
  letters: number;
  lastLetter: string | null;
  /** Real date (ms since epoch) he died, by the player's clock. */
  diedAt: number;
}

export function makeMemorial(state: SimState, realNow: number): MemorialEntry {
  const p = state.person;
  const lastLetter = state.letters[state.letters.length - 1];
  return {
    name: p.identity.name,
    seed: state.seed,
    dogName: state.dog.identity.name,
    look: structuredClone(p.identity.look),
    daysLived: Math.max(0, Math.floor((state.clock.ms - (state.settledMs ?? state.clock.ms)) / DAY_MS)),
    letters: state.letters.length,
    lastLetter: lastLetter?.text ?? null,
    diedAt: realNow,
  };
}
