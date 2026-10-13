// The simulation: plain JSON-safe state advanced in fixed ticks. No DOM, no clocks, no Math.random.
import type { House } from './house';
import { findPath, pathCost } from './pathing';
import { createRng, nextInt, pick, type Rng } from './rng';

export const TICK_MS = 50;
/** House pixels per tick while walking. Stairs are slower. */
const WALK_SPEED = 1.2;
const STAIRS_SPEED = 0.7;
const IDLE_MIN_TICKS = 20;
const IDLE_MAX_TICKS = 100;

export interface PersonState {
  /** Last node reached. */
  at: string;
  x: number;
  y: number;
  facing: -1 | 1;
  /** Remaining nodes to walk through; empty when standing still. */
  path: string[];
  /** Ticks left to linger before choosing somewhere new. */
  idleTicks: number;
}

export interface SimState {
  seed: number;
  tick: number;
  rng: Rng;
  person: PersonState;
}

export type Command = { type: 'goTo'; node: string };

export function createSim(house: House, seed: number): SimState {
  const rng = createRng(seed);
  const start = house.nodes.get(pick(rng, house.nodeIds))!;
  return {
    seed,
    tick: 0,
    rng,
    person: {
      at: start.id,
      x: start.x,
      y: start.y,
      facing: 1,
      path: [],
      idleTicks: nextInt(rng, IDLE_MIN_TICKS, IDLE_MAX_TICKS),
    },
  };
}

/** Advances one tick in place. Commands apply at the start of the tick. */
export function step(state: SimState, house: House, commands: readonly Command[] = []): void {
  const p = state.person;

  for (const cmd of commands) {
    if (cmd.type === 'goTo' && house.nodes.has(cmd.node)) {
      const path = routeFromHere(house, p, cmd.node);
      if (path) {
        p.path = path;
        // Already there: linger rather than wander off on the same tick.
        p.idleTicks = path.length === 0 ? IDLE_MAX_TICKS : 0;
      }
    }
  }

  if (p.path.length === 0) {
    if (p.idleTicks > 0) {
      p.idleTicks--;
    } else {
      const choices = house.nodeIds.filter((id) => id !== p.at);
      const target = pick(state.rng, choices);
      p.path = findPath(house, p.at, target)!.slice(1);
    }
  } else {
    walk(p, house);
    if (p.path.length === 0) p.idleTicks = nextInt(state.rng, IDLE_MIN_TICKS, IDLE_MAX_TICKS);
  }

  state.tick++;
}

export function run(state: SimState, house: House, ticks: number): void {
  for (let i = 0; i < ticks; i++) step(state, house);
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
