// The simulation: plain JSON-safe state advanced in fixed ticks. No DOM, no clocks, no Math.random.
import { hourWeight, inHours, type ActivityDef, type StepDef } from './activities';
import type { House } from './house';
import {
  clampNeed,
  CRITICAL,
  CRITICAL_NEEDS,
  DECAY,
  DOG_FOOD_DECAY,
  HEALTH_RECOVERY,
  NEED_IDS,
  STARVING_DAMAGE,
  urgency,
  type EffectKey,
  type NeedId,
  type Needs,
} from './needs';
import { findPath, pathCost } from './pathing';
import { createRng, nextFloat, nextInt, pick, type Rng } from './rng';
import type { World } from './world';

/** Real milliseconds per tick. Walking speed is per tick, so he walks at the same pace at any time scale. */
export const TICK_MS = 50;
export const MINUTE_MS = 60_000;
export const HOUR_MS = 60 * MINUTE_MS;
export const DAY_MS = 24 * HOUR_MS;

/** House pixels per tick while walking. Stairs are slower. */
const WALK_SPEED = 1.2;
const STAIRS_SPEED = 0.7;

export interface ActivityRun {
  id: string;
  step: number;
  /** Node for the current step. */
  node: string;
  /** False while walking there, true once doing the step. */
  doing: boolean;
  remainingMs: number;
  startedMs: number;
}

export interface PersonState {
  /** Last node reached. */
  at: string;
  x: number;
  y: number;
  facing: -1 | 1;
  /** Remaining nodes to walk through; empty when standing still. */
  path: string[];
  activity: ActivityRun | null;
  needs: Needs;
  /** 0 (miserable) to 100 (delighted). Drifts towards how well his needs are met. */
  mood: number;
  health: number;
  alive: boolean;
}

export interface SimState {
  seed: number;
  tick: number;
  rng: Rng;
  clock: {
    /** Game time since midnight of day 0. Integer, so it never drifts. */
    ms: number;
    msPerTick: number;
  };
  person: PersonState;
  dog: { food: number };
  /** Game time each activity last finished. */
  lastDone: Record<string, number>;
}

export type Command = { type: 'goTo'; node: string };

export interface SimOptions {
  /** Minute of day the clock starts at. Default 08:00. */
  startMinute?: number;
  /** Game seconds per real second. Must be a positive integer. Default 1. */
  timeScale?: number;
}

export function createSim(world: World, seed: number, options: SimOptions = {}): SimState {
  const { startMinute = 8 * 60, timeScale = 1 } = options;
  if (!Number.isInteger(timeScale) || timeScale < 1) throw new Error('timeScale must be a positive integer');
  const rng = createRng(seed);
  const start = world.house.nodes.get(pick(rng, world.house.nodeIds))!;
  const jitter = () => nextInt(rng, -10, 10);
  return {
    seed,
    tick: 0,
    rng,
    clock: { ms: Math.round(startMinute) * MINUTE_MS, msPerTick: TICK_MS * timeScale },
    person: {
      at: start.id,
      x: start.x,
      y: start.y,
      facing: 1,
      path: [],
      activity: null,
      needs: { food: 70 + jitter(), water: 70 + jitter(), energy: 80 + jitter(), hygiene: 80 + jitter(), fun: 60 + jitter() },
      mood: 60,
      health: 100,
      alive: true,
    },
    dog: { food: 70 + jitter() },
    lastDone: {},
  };
}

export function hourOfDay(state: SimState): number {
  return Math.floor((state.clock.ms % DAY_MS) / HOUR_MS);
}

export function dayNumber(state: SimState): number {
  return Math.floor(state.clock.ms / DAY_MS);
}

export function currentStep(state: SimState, world: World): StepDef | null {
  const run = state.person.activity;
  return run ? world.activities.byId.get(run.id)!.steps[run.step]! : null;
}

export function isAsleep(state: SimState, world: World): boolean {
  return !!state.person.activity?.doing && !!currentStep(state, world)?.asleep;
}

/** Advances one tick in place. Commands apply at the start of the tick. */
export function step(state: SimState, world: World, commands: readonly Command[] = []): void {
  const p = state.person;
  if (p.alive) {
    for (const cmd of commands) {
      if (cmd.type === 'goTo' && world.house.nodes.has(cmd.node)) startActivity(state, world, 'potter', cmd.node);
    }
    if (!p.activity) chooseActivity(state, world);
    advanceActivity(state, world);
    updateBody(state, world);
    checkInterrupts(state, world);
  }
  state.clock.ms += state.clock.msPerTick;
  state.tick++;
}

export function run(state: SimState, world: World, ticks: number): void {
  for (let i = 0; i < ticks; i++) step(state, world);
}

/** Scores every activity and starts the best. Noise keeps close calls from always going the same way. */
export function scoreActivities(state: SimState, world: World): { id: string; score: number }[] {
  const hour = hourOfDay(state);
  return world.activities.list.map((def) => {
    let score = def.base ?? 0;
    for (const [key, gain] of Object.entries(def.adverts) as [EffectKey, number][]) {
      score += (gain / 100) * urgency(effectValue(state, key));
    }
    score *= hourWeight(def, hour);
    const last = state.lastDone[def.id];
    if (def.cooldownMinutes && last !== undefined && state.clock.ms - last < def.cooldownMinutes * MINUTE_MS) {
      score *= 0.3;
    }
    return { id: def.id, score };
  });
}

function chooseActivity(state: SimState, world: World): void {
  // A critical need narrows the choice to things that fix it, so choosing and interrupting never fight.
  const critical = mostCriticalNeed(state, world);
  let best = 'potter';
  let bestScore = -Infinity;
  for (const { id, score } of scoreActivities(state, world)) {
    if (critical && !serves(world.activities.byId.get(id)!, critical)) continue;
    const noisy = score * (0.85 + 0.3 * nextFloat(state.rng));
    if (noisy > bestScore) {
      bestScore = noisy;
      best = id;
    }
  }
  startActivity(state, world, best);
}

function startActivity(state: SimState, world: World, id: string, forcedNode?: string): void {
  const p = state.person;
  p.activity = { id, step: 0, node: '', doing: false, remainingMs: 0, startedMs: state.clock.ms };
  beginWalkToStep(state, world, forcedNode);
}

function beginWalkToStep(state: SimState, world: World, forcedNode?: string): void {
  const p = state.person;
  const run = p.activity!;
  const def = world.activities.byId.get(run.id)!;
  const stepDef = def.steps[run.step]!;
  run.node = forcedNode ?? resolveNode(state, world.house, stepDef.node);
  run.doing = false;
  p.path = routeFromHere(world.house, p, run.node) ?? [];
}

function resolveNode(state: SimState, house: House, node: string): string {
  if (node !== '*') return node;
  return pick(state.rng, house.nodeIds.filter((id) => id !== state.person.at));
}

function advanceActivity(state: SimState, world: World): void {
  const p = state.person;
  const run = p.activity!;
  if (p.path.length > 0) {
    walk(p, world.house);
    return;
  }
  const def = world.activities.byId.get(run.id)!;
  const stepDef = def.steps[run.step]!;
  if (!run.doing) {
    run.doing = true;
    run.remainingMs = nextInt(state.rng, stepDef.minutes[0], stepDef.minutes[1]) * MINUTE_MS;
    return;
  }

  const hours = state.clock.msPerTick / HOUR_MS;
  for (const [key, rate] of Object.entries(stepDef.rates ?? {}) as [EffectKey, number][]) {
    setEffectValue(state, key, effectValue(state, key) + rate * hours);
  }
  run.remainingMs -= state.clock.msPerTick;
  const until = stepDef.until;
  const satisfied =
    until !== undefined &&
    effectValue(state, until.key) >= until.atLeast &&
    inHours(hourOfDay(state), until.fromHour ?? 0, until.toHour ?? 24);
  if (run.remainingMs > 0 && !satisfied) return;

  if (run.step + 1 < def.steps.length) {
    run.step++;
    beginWalkToStep(state, world);
  } else {
    finishActivity(state, def);
  }
}

function finishActivity(state: SimState, def: ActivityDef): void {
  state.lastDone[def.id] = state.clock.ms;
  state.person.activity = null;
}

function updateBody(state: SimState, world: World): void {
  const p = state.person;
  const hours = state.clock.msPerTick / HOUR_MS;
  const asleep = isAsleep(state, world);
  for (const id of NEED_IDS) {
    p.needs[id] = clampNeed(p.needs[id] - (asleep ? DECAY[id].asleep : DECAY[id].awake) * hours);
  }
  state.dog.food = clampNeed(state.dog.food - DOG_FOOD_DECAY * hours);

  const starving = (p.needs.food <= 0 ? 1 : 0) + (p.needs.water <= 0 ? 1 : 0);
  if (starving > 0) p.health -= STARVING_DAMAGE * starving * hours;
  else if (p.needs.food > 30 && p.needs.water > 30) p.health += HEALTH_RECOVERY * hours;
  p.health = clampNeed(p.health);
  if (p.health <= 0) {
    p.alive = false;
    p.activity = null;
    p.path = [];
  }

  // Mood leans on the worst-met need, so one neglected thing sours an otherwise good day.
  let sum = 0;
  let min = 100;
  for (const id of NEED_IDS) {
    sum += p.needs[id];
    min = Math.min(min, p.needs[id]);
  }
  let target = 0.6 * (sum / NEED_IDS.length) + 0.4 * min;
  if (state.dog.food < 20) target -= 15;
  target *= p.health / 100;
  p.mood = clampNeed(p.mood + (target - p.mood) * Math.min(1, hours * 0.5));
}

/** A critical need drags him away from anything that doesn't address one. */
function checkInterrupts(state: SimState, world: World): void {
  const p = state.person;
  const run = p.activity;
  if (!run || !p.alive) return;
  const def = world.activities.byId.get(run.id)!;
  if (!mostCriticalNeed(state, world)) return;
  if (CRITICAL_NEEDS.some((id) => p.needs[id] < CRITICAL && serves(def, id))) return;
  p.activity = null;
}

/** The emptiest critical need that some activity can do something about, if any. */
function mostCriticalNeed(state: SimState, world: World): NeedId | null {
  let worst: NeedId | null = null;
  for (const id of CRITICAL_NEEDS) {
    const v = state.person.needs[id];
    if (v >= CRITICAL || (worst && v >= state.person.needs[worst])) continue;
    if (world.activities.list.some((a) => serves(a, id))) worst = id;
  }
  return worst;
}

function serves(def: ActivityDef, key: EffectKey): boolean {
  return (def.adverts[key] ?? 0) > 0;
}

function effectValue(state: SimState, key: EffectKey): number {
  return key === 'dog' ? state.dog.food : state.person.needs[key];
}

function setEffectValue(state: SimState, key: EffectKey, value: number): void {
  if (key === 'dog') state.dog.food = clampNeed(value);
  else state.person.needs[key] = clampNeed(value);
}

/**
 * Plans a route from wherever the person is right now. Mid-edge, he finishes the
 * step to the node he is heading for, then continues, so he never cuts through walls.
 */
function routeFromHere(house: House, p: PersonState, target: string): string[] | null {
  const heading = p.path[0];
  if (heading === undefined) return findPath(house, p.at, target)?.slice(1) ?? null;
  // Turning back is allowed: he can return to the node he just left.
  const viaHeading = findPath(house, heading, target);
  const viaAt = findPath(house, p.at, target);
  if (!viaHeading || !viaAt) return null;
  const h = house.nodes.get(heading)!;
  const a = house.nodes.get(p.at)!;
  const toHeading = Math.hypot(h.x - p.x, h.y - p.y);
  const toAt = Math.hypot(a.x - p.x, a.y - p.y);
  const costHeading = toHeading + pathCost(house, viaHeading);
  const costAt = toAt + pathCost(house, viaAt);
  return costAt < costHeading ? viaAt : viaHeading;
}

function walk(p: PersonState, house: House): void {
  const next = house.nodes.get(p.path[0]!)!;
  const from = house.nodes.get(p.at)!;
  const speed = from.floor !== next.floor ? STAIRS_SPEED : WALK_SPEED;
  const dx = next.x - p.x;
  const dy = next.y - p.y;
  const dist = Math.hypot(dx, dy);
  if (dx !== 0) p.facing = dx > 0 ? 1 : -1;
  if (dist <= speed) {
    p.x = next.x;
    p.y = next.y;
    p.at = next.id;
    p.path.shift();
  } else {
    p.x += (dx / dist) * speed;
    p.y += (dy / dist) * speed;
  }
}

/** FNV-1a over the canonical JSON of the state, for cheap determinism checks. */
export function hashState(state: SimState): string {
  const text = JSON.stringify(state);
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}
