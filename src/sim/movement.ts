// Walking along the floor graph, shared by the person and the dog.
import type { House } from './house';
import { findPath, pathCost } from './pathing';

/** House pixels per tick at pace 1. Stairs are slower. */
const WALK_SPEED = 2.4;
const STAIRS_SPEED = 1.4;

export interface Mover {
  /** Last node reached. */
  at: string;
  x: number;
  y: number;
  facing: -1 | 1;
  /** Remaining nodes to walk through; empty when standing still. */
  path: string[];
}

export function placeAt(m: Mover, house: House, node: string): void {
  const n = house.nodes.get(node)!;
  m.at = n.id;
  m.x = n.x;
  m.y = n.y;
  m.path = [];
}

/**
 * Plans a route from wherever the mover is right now. Mid-edge, it finishes the
 * step to the node it is heading for (or turns back), so nobody cuts through walls.
 */
export function routeFromHere(house: House, m: Mover, target: string): string[] | null {
  const heading = m.path[0];
  if (heading === undefined) return findPath(house, m.at, target)?.slice(1) ?? null;
  const viaHeading = findPath(house, heading, target);
  const viaAt = findPath(house, m.at, target);
  if (!viaHeading || !viaAt) return null;
  const h = house.nodes.get(heading)!;
  const a = house.nodes.get(m.at)!;
  const costHeading = Math.hypot(h.x - m.x, h.y - m.y) + pathCost(house, viaHeading);
  const costAt = Math.hypot(a.x - m.x, a.y - m.y) + pathCost(house, viaAt);
  return costAt < costHeading ? viaAt : viaHeading;
}

export function walk(m: Mover, house: House, pace = 1): void {
  const next = house.nodes.get(m.path[0]!)!;
  const from = house.nodes.get(m.at)!;
  const speed = (from.floor !== next.floor ? STAIRS_SPEED : WALK_SPEED) * pace;
  const dx = next.x - m.x;
  const dy = next.y - m.y;
  const dist = Math.hypot(dx, dy);
  if (dx !== 0) m.facing = dx > 0 ? 1 : -1;
  if (dist <= speed) {
    m.x = next.x;
    m.y = next.y;
    m.at = next.id;
    m.path.shift();
  } else {
    m.x += (dx / dist) * speed;
    m.y += (dy / dist) * speed;
  }
}
