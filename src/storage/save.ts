// The save file: the whole sim state plus a little bookkeeping, versioned so old saves keep
// loading as the game grows. Pure functions only; where it's stored lives in idb.ts.
import type { MemorialEntry } from '../sim/memorial';
import { createSim, type SimState } from '../sim/sim';
import type { World } from '../sim/world';

export const SAVE_FORMAT = 'lodger-computer-person';
export const SAVE_VERSION = 2;

export interface SaveFile {
  format: typeof SAVE_FORMAT;
  version: number;
  /** Real time (ms since epoch) this was written. */
  savedAt: number;
  /** Real time the player was last watching. Away time is measured from here. */
  lastSeen: number;
  state: SimState;
  /** Tenants who lived here before. */
  memorial: MemorialEntry[];
}

export class SaveError extends Error {}

/** Upgrades a raw save from version n to n + 1. Keyed by n. */
export type Migration = (raw: Record<string, unknown>) => Record<string, unknown>;
export const MIGRATIONS: Record<number, Migration> = {
  // v1 kept one put-off request in `pending`; v2 has a queue. An old pending one was agreed to.
  1: (raw) => {
    const state = raw.state;
    if (isRecord(state)) {
      const pending = state.pending;
      state.queue = isRecord(pending) ? [{ ...pending, politeness: 0, agreed: true }] : [];
      delete state.pending;
    }
    return raw;
  },
};

export function makeSave(state: SimState, memorial: MemorialEntry[], now: number): SaveFile {
  return { format: SAVE_FORMAT, version: SAVE_VERSION, savedAt: now, lastSeen: now, state, memorial };
}

export function parseSave(
  raw: unknown,
  world: World,
  migrations: Record<number, Migration> = MIGRATIONS,
  current = SAVE_VERSION,
): SaveFile {
  if (typeof raw === 'string') {
    try {
      raw = JSON.parse(raw);
    } catch {
      throw new SaveError("That file isn't a save: it isn't valid JSON.");
    }
  }
  if (!isRecord(raw) || raw.format !== SAVE_FORMAT) throw new SaveError("That file isn't a Lodger Computer Person save.");
  let data: Record<string, unknown> = structuredClone(raw);
  let version = data.version;
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 0) throw new SaveError('The save has no valid version.');
  if (version > current) throw new SaveError(`The save is from a newer version (${version}) of the game.`);
  while (version < current) {
    const migrate = migrations[version];
    if (!migrate) throw new SaveError(`Can't upgrade a version ${version} save.`);
    data = migrate(data);
    version++;
    data.version = version;
  }

  const state = data.state;
  if (!isRecord(state) || typeof state.seed !== 'number' || !isRecord(state.clock) || !isRecord(state.person)) {
    throw new SaveError('The save is missing his state.');
  }
  return {
    format: SAVE_FORMAT,
    version,
    savedAt: numberOr(data.savedAt, Date.now()),
    lastSeen: numberOr(data.lastSeen, numberOr(data.savedAt, Date.now())),
    state: fillDefaults(state, world),
    memorial: Array.isArray(data.memorial) ? (data.memorial as MemorialEntry[]) : [],
  };
}

/**
 * Anything the save lacks (a field added after it was written) is taken from a fresh sim with
 * the same seed, so new features start from sensible values instead of crashing on undefined.
 */
function fillDefaults(state: Record<string, unknown>, world: World): SimState {
  const fresh = createSim(world, state.seed as number) as unknown as Record<string, unknown>;
  fill(state, fresh, ['person', 'dog', 'supplies', 'clock', 'moveIn']);
  return state as unknown as SimState;
}

function fill(target: Record<string, unknown>, defaults: Record<string, unknown>, nested: string[]): void {
  for (const [key, value] of Object.entries(defaults)) {
    if (!(key in target)) target[key] = structuredClone(value);
    else if (nested.includes(key) && isRecord(target[key]) && isRecord(value)) fill(target[key] as Record<string, unknown>, value, []);
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function numberOr(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}
