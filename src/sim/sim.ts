// The simulation: plain JSON-safe state advanced in fixed ticks. No DOM, no clocks, no Math.random.
import { hourWeight, inHours, type ActivityDef, type StepDef } from './activities';
import { createDog, stepDog, BOWL, type DogState } from './dog';
import { cleanName, generateIdentity, traitAffinity, type Identity } from './identity';
import { createMoveIn, DEFAULT_EMPTY_TICKS, FRONT_DOOR, movedIn, stepMoveIn, type MoveInState } from './moveIn';
import { placeAt, routeFromHere, walk, type Mover } from './movement';
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
import { createRng, nextFloat, nextInt, pick, type Rng } from './rng';
import type { World } from './world';

/** Real milliseconds per tick. Walking speed is per tick, so he walks at the same pace at any time scale. */
export const TICK_MS = 50;
export const MINUTE_MS = 60_000;
export const HOUR_MS = 60 * MINUTE_MS;
export const DAY_MS = 24 * HOUR_MS;

const WINDOW = 'study.window';
/** Activities scoring at least this fraction of the best are in the running. */
const SHORTLIST = 0.4;
/** Below this hour weight, an activity is out of its natural time. */
const OFF_HOURS = 0.5;

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

export interface PersonState extends Mover {
  identity: Identity;
  /** False while the house is empty or he is out. */
  present: boolean;
  /** Carrying his suitcase in. */
  carrying: boolean;
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
  moveIn: MoveInState;
  person: PersonState;
  dog: DogState;
  /** What he calls the player, once they have said. */
  playerName: string | null;
  /** Game time each activity last finished. */
  lastDone: Record<string, number>;
}

export type Command =
  | { type: 'goTo'; node: string }
  /** The player says who they are, and may rename him. */
  | { type: 'introduce'; playerName?: string; tenantName?: string };

export interface SimOptions {
  /** Minute of day the clock starts at. Default 08:00. */
  startMinute?: number;
  /** Game seconds per real second. Must be a positive integer. Default 1. */
  timeScale?: number;
  /** Start with an empty house and play the moving-in sequence. Default false: he already lives here. */
  startEmpty?: boolean;
  /** How long the house stays empty first, in ticks. */
  emptyTicks?: number;
  /** Use this person instead of the seeded one (the dog stays seeded). */
  identity?: Identity;
}

export function createSim(world: World, seed: number, options: SimOptions = {}): SimState {
  const { startMinute = 8 * 60, timeScale = 1, startEmpty = false, emptyTicks = DEFAULT_EMPTY_TICKS } = options;
  if (!Number.isInteger(timeScale) || timeScale < 1) throw new Error('timeScale must be a positive integer');
  const rng = createRng(seed);
  const generated = generateIdentity(seed);
  const identity = structuredClone(options.identity ?? generated.person);
  const start = startEmpty ? FRONT_DOOR : pick(rng, world.house.nodeIds);
  const jitter = () => nextInt(rng, -10, 10);
  const person: PersonState = {
    identity,
    at: start,
    x: 0,
    y: 0,
    facing: 1,
    path: [],
    present: !startEmpty,
    carrying: false,
    activity: null,
    needs: { food: 70 + jitter(), water: 70 + jitter(), energy: 80 + jitter(), hygiene: 80 + jitter(), fun: 60 + jitter() },
    mood: 60,
    health: 100,
    alive: true,
  };
  placeAt(person, world.house, start);
  const dog = createDog(generated.dog, world, startEmpty ? FRONT_DOOR : BOWL, !startEmpty);
  dog.food = 70 + jitter();
  return {
    seed,
    tick: 0,
    rng,
    clock: { ms: Math.round(startMinute) * MINUTE_MS, msPerTick: TICK_MS * timeScale },
    moveIn: startEmpty ? createMoveIn(emptyTicks) : movedIn(),
    person,
    dog,
    playerName: null,
    lastDone: {},
  };
}

export function hourOfDay(state: SimState): number {
  return Math.floor((state.clock.ms % DAY_MS) / HOUR_MS);
}

/** The hour by his body clock: an early bird's 07:00 comes before the real one. */
export function bodyHour(state: SimState): number {
  const shifted = state.clock.ms - Math.round(state.person.identity.chronotype * HOUR_MS);
  return Math.floor((((shifted % DAY_MS) + DAY_MS) % DAY_MS) / HOUR_MS);
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
  if (state.moveIn.stage !== 'done') {
    // Nothing the player does counts until he has moved in.
    stepMoveIn(state, world);
  } else {
    for (const cmd of commands) applyCommand(state, world, cmd);
    if (p.alive) {
      if (!p.activity) chooseActivity(state, world);
      advanceActivity(state, world);
      updateBody(state, world);
      checkInterrupts(state, world);
    }
  }
  stepDog(state, world);
  state.clock.ms += state.clock.msPerTick;
  state.tick++;
}

export function run(state: SimState, world: World, ticks: number): void {
  for (let i = 0; i < ticks; i++) step(state, world);
}

function applyCommand(state: SimState, world: World, cmd: Command): void {
  switch (cmd.type) {
    case 'goTo':
      if (state.person.alive && world.house.nodes.has(cmd.node)) startActivity(state, world, 'potter', cmd.node);
      return;
    case 'introduce': {
      const player = cmd.playerName === undefined ? null : cleanName(cmd.playerName);
      const tenant = cmd.tenantName === undefined ? null : cleanName(cmd.tenantName);
      if (player) state.playerName = player;
      if (tenant) state.person.identity.name = tenant;
      return;
    }
  }
}

/** Scores every activity. Chance comes in at choice time, not here. */
export function scoreActivities(state: SimState, world: World): { id: string; score: number; offHours: boolean }[] {
  const hour = bodyHour(state);
  const { identity } = state.person;
  const snacker = identity.quirks.includes('nightSnacker');
  return world.activities.list.map((def) => {
    let score = def.base ?? 0;
    for (const [key, gain] of Object.entries(def.adverts) as [EffectKey, number][]) {
      score += (gain / 100) * urgency(effectValue(state, key));
    }
    let weight = hourWeight(def, hour);
    if (snacker && def.id === 'eat') weight = Math.max(weight, 1);
    const offHours = weight < OFF_HOURS;
    score *= weight;
    if (def.trait) score *= traitAffinity(identity.traits, def.trait);
    const last = state.lastDone[def.id];
    if (def.cooldownMinutes && last !== undefined && state.clock.ms - last < def.cooldownMinutes * MINUTE_MS) {
      score *= 0.3;
    }
    return { id: def.id, score, offHours };
  });
}

/**
 * Weighted random choice among the activities that score close to the best, so preferences
 * shift the odds rather than deciding outright. Urgent needs still win: they outscore everything.
 */
function chooseActivity(state: SimState, world: World): void {
  // A critical need narrows the choice to things that fix it, so choosing and interrupting never fight.
  const critical = mostCriticalNeed(state, world);
  const scored = scoreActivities(state, world).filter(
    ({ id }) => !critical || serves(world.activities.byId.get(id)!, critical),
  );
  const best = Math.max(...scored.map((s) => s.score));
  // Something at an odd hour (a nap at noon, piano at 3am) only happens if it is the clear winner.
  const shortlist = scored.filter(
    (s) => s.score > 0 && (s.score === best || (s.score >= best * SHORTLIST && !s.offHours)),
  );
  let total = 0;
  for (const s of shortlist) total += s.score * s.score;
  let r = nextFloat(state.rng) * total;
  let chosen = shortlist[shortlist.length - 1]?.id ?? 'potter';
  for (const s of shortlist) {
    r -= s.score * s.score;
    if (r < 0) {
      chosen = s.id;
      break;
    }
  }
  startActivity(state, world, chosen);
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
  run.node = forcedNode ?? resolveNode(state, world, stepDef.node);
  run.doing = false;
  p.path = routeFromHere(world.house, p, run.node) ?? [];
}

function resolveNode(state: SimState, world: World, node: string): string {
  if (node !== '*') return node;
  const p = state.person;
  if (p.identity.quirks.includes('windowGazer') && p.at !== WINDOW && nextFloat(state.rng) < 0.4) return WINDOW;
  return pick(state.rng, world.house.nodeIds.filter((id) => id !== p.at));
}

function advanceActivity(state: SimState, world: World): void {
  const p = state.person;
  const run = p.activity!;
  if (p.path.length > 0) {
    walk(p, world.house, p.identity.pace);
    return;
  }
  const def = world.activities.byId.get(run.id)!;
  const stepDef = def.steps[run.step]!;
  if (!run.doing) {
    run.doing = true;
    let minutes = nextInt(state.rng, stepDef.minutes[0], stepDef.minutes[1]);
    if (def.kind === 'idle' && p.identity.quirks.includes('fidget')) minutes = Math.max(1, Math.round(minutes / 2));
    run.remainingMs = minutes * MINUTE_MS;
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
    inHours(bodyHour(state), until.fromHour ?? 0, until.toHour ?? 24);
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
    let decay = asleep ? DECAY[id].asleep : DECAY[id].awake;
    if (id === 'food') decay *= p.identity.appetite;
    p.needs[id] = clampNeed(p.needs[id] - decay * hours);
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
