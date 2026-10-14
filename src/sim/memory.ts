// His memory: a rolling log of each day, so letters (and later, catch-up) can say what happened.
import type { GameKind, Winner } from './games/types';
import type { SimState } from './sim';
import { DAY_MS } from './time';

export interface DayLog {
  day: number;
  /** Finished activities by id. */
  activities: Record<string, number>;
  deliveries: Record<string, number>;
  /** Genres of records that arrived. */
  records: string[];
  pats: number;
  polite: number;
  rude: number;
  refusals: number;
  games: { kind: GameKind; winner: Winner }[];
  /** Supplies that ran out. */
  ranOut: string[];
  moodSum: number;
  moodSamples: number;
}

/** Days of history kept. */
const KEEP_DAYS = 8;

export function emptyDay(day: number): DayLog {
  return { day, activities: {}, deliveries: {}, records: [], pats: 0, polite: 0, rude: 0, refusals: 0, games: [], ranOut: [], moodSum: 0, moodSamples: 0 };
}

/** Today's log, starting a new one (and forgetting old ones) when the day turns. */
export function today(state: SimState): DayLog {
  const day = Math.floor(state.clock.ms / DAY_MS);
  const days = state.memory;
  let log = days[days.length - 1];
  if (!log || log.day !== day) {
    log = emptyDay(day);
    days.push(log);
    while (days.length > KEEP_DAYS) days.shift();
  }
  return log;
}

/** Everything since a moment, merged into one log. */
export function since(state: SimState, fromMs: number): DayLog {
  const fromDay = Math.floor(fromMs / DAY_MS);
  const total = emptyDay(fromDay);
  for (const d of state.memory) {
    if (d.day < fromDay) continue;
    for (const [k, v] of Object.entries(d.activities)) total.activities[k] = (total.activities[k] ?? 0) + v;
    for (const [k, v] of Object.entries(d.deliveries)) total.deliveries[k] = (total.deliveries[k] ?? 0) + v;
    total.records.push(...d.records);
    total.pats += d.pats;
    total.polite += d.polite;
    total.rude += d.rude;
    total.refusals += d.refusals;
    total.games.push(...d.games);
    total.ranOut.push(...d.ranOut);
    total.moodSum += d.moodSum;
    total.moodSamples += d.moodSamples;
  }
  return total;
}

export function remember(state: SimState, update: (log: DayLog) => void): void {
  update(today(state));
}
