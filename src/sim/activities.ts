// Activity library loaded from JSON. Each activity is a list of steps: walk to a node, then
// spend some minutes there with per-hour effects on needs.
import type { House } from './house';
import { EFFECT_KEYS, type EffectKey } from './needs';

export type Pose = 'stand' | 'sit' | 'lie';
export type Effects = Partial<Record<EffectKey, number>>;

export interface StepDef {
  /** Node to do this step at, or "*" for anywhere. */
  node: string;
  minutes: [number, number];
  label: string;
  pose?: Pose;
  asleep?: boolean;
  /** Per game hour while doing the step. */
  rates?: Effects;
  /** End the step early once this is reached, optionally only between these hours. */
  until?: { key: EffectKey; atLeast: number; fromHour?: number; toHour?: number };
}

export interface ActivityDef {
  id: string;
  label: string;
  kind?: 'need' | 'leisure' | 'idle';
  /** Flat appeal regardless of needs. */
  base?: number;
  /** How much each need expects to gain, 0-100. Drives utility. */
  adverts: Effects;
  /** [fromHour, toHour, weight]; wraps past midnight when from > to. First match wins. */
  hours?: [number, number, number][];
  /** Appeal drops if done this recently. */
  cooldownMinutes?: number;
  steps: StepDef[];
}

export interface ActivityLibrary {
  list: ActivityDef[];
  byId: Map<string, ActivityDef>;
}

export function buildActivities(defs: ActivityDef[], house: House): ActivityLibrary {
  const byId = new Map<string, ActivityDef>();
  for (const a of defs) {
    if (byId.has(a.id)) throw new Error(`Duplicate activity "${a.id}"`);
    if (a.steps.length === 0) throw new Error(`Activity "${a.id}" has no steps`);
    for (const key of Object.keys(a.adverts)) checkKey(a.id, key);
    for (const [from, to] of a.hours ?? []) {
      if (from < 0 || from > 23 || to < 0 || to > 24) throw new Error(`Activity "${a.id}" has bad hours`);
    }
    for (const s of a.steps) {
      if (s.node !== '*' && !house.nodes.has(s.node)) throw new Error(`Activity "${a.id}" uses unknown node "${s.node}"`);
      if (s.minutes[0] <= 0 || s.minutes[1] < s.minutes[0]) throw new Error(`Activity "${a.id}" has bad minutes`);
      for (const key of Object.keys(s.rates ?? {})) checkKey(a.id, key);
      if (s.until) checkKey(a.id, s.until.key);
    }
    byId.set(a.id, a);
  }
  if (!byId.has('potter')) throw new Error('Activity library needs a "potter" fallback');
  return { list: defs, byId };
}

function checkKey(activity: string, key: string): void {
  if (!(EFFECT_KEYS as readonly string[]).includes(key)) throw new Error(`Activity "${activity}" uses unknown need "${key}"`);
}

/** True if hour is in [from, to), wrapping past midnight when from > to. */
export function inHours(hour: number, from: number, to: number): boolean {
  return from <= to ? hour >= from && hour < to : hour >= from || hour < to;
}

export function hourWeight(def: ActivityDef, hour: number): number {
  for (const [from, to, weight] of def.hours ?? []) {
    if (inHours(hour, from, to)) return weight;
  }
  return 1;
}
