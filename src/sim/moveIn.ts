// Moving in: the house sits empty, a stranger arrives and looks around, leaves, and comes back
// with a suitcase and a dog. Runs in real-time ticks so it reads the same at any time scale.
import { findPath } from './pathing';
import { placeAt, walk } from './movement';
import { nextInt, pick } from './rng';
import type { SimState } from './sim';
import type { World } from './world';

export type MoveInStage = 'empty' | 'exploring' | 'away' | 'unpacking' | 'done';

export interface MoveInState {
  stage: MoveInStage;
  ticksLeft: number;
  /** Nodes still to visit while exploring; the first is where he is heading. */
  tour: string[];
}

export const FRONT_DOOR = 'living.door';
export const UNPACK_AT = 'bedroom.closet';
/** Twenty seconds of an empty house before anyone turns up. */
export const DEFAULT_EMPTY_TICKS = 400;
const AWAY_TICKS = 120;
const UNPACK_TICKS = 200;

export function createMoveIn(emptyTicks: number): MoveInState {
  return { stage: 'empty', ticksLeft: emptyTicks, tour: [] };
}

export function movedIn(): MoveInState {
  return { stage: 'done', ticksLeft: 0, tour: [] };
}

export function stepMoveIn(state: SimState, world: World): void {
  const m = state.moveIn;
  const p = state.person;
  const house = world.house;

  switch (m.stage) {
    case 'empty':
      if (--m.ticksLeft > 0) return;
      placeAt(p, house, FRONT_DOOR);
      p.present = true;
      m.tour = planTour(state, world);
      m.stage = 'exploring';
      headTo(state, world, m.tour[0]!);
      return;

    case 'exploring':
      if (p.path.length > 0) return walk(p, house, p.identity.pace);
      if (--m.ticksLeft > 0) return; // having a look
      m.tour.shift();
      if (m.tour.length > 0) return headTo(state, world, m.tour[0]!);
      p.present = false;
      m.stage = 'away';
      m.ticksLeft = AWAY_TICKS;
      return;

    case 'away':
      if (--m.ticksLeft > 0) return;
      placeAt(p, house, FRONT_DOOR);
      placeAt(state.dog, house, FRONT_DOOR);
      p.present = true;
      p.carrying = true;
      state.dog.present = true;
      m.stage = 'unpacking';
      m.ticksLeft = UNPACK_TICKS;
      p.path = findPath(house, FRONT_DOOR, UNPACK_AT)!.slice(1);
      return;

    case 'unpacking':
      if (p.path.length > 0) return walk(p, house, p.identity.pace);
      if (--m.ticksLeft > 0) return;
      p.carrying = false;
      m.stage = 'done';
      return;

    case 'done':
      return;
  }
}

function headTo(state: SimState, world: World, node: string): void {
  const p = state.person;
  p.path = findPath(world.house, p.at, node)!.slice(1);
  state.moveIn.ticksLeft = node === FRONT_DOOR ? 1 : nextInt(state.rng, 20, 50);
}

/** A look round: one spot in five of the rooms, upstairs and back down, then out the front door. */
function planTour(state: SimState, world: World): string[] {
  const rooms = world.house.def.rooms.map((r) => r.id);
  const chosen: string[] = [];
  while (chosen.length < 5) {
    const room = pick(state.rng, rooms);
    if (!chosen.includes(room)) chosen.push(room);
  }
  const nodes = chosen.map((room) => pick(state.rng, world.house.nodeIds.filter((id) => world.house.nodes.get(id)!.room === room)));
  const floorOf = (id: string) => world.house.nodes.get(id)!.floor;
  nodes.sort((a, b) => floorOf(a) - floorOf(b) || (a < b ? -1 : 1));
  return [...nodes, FRONT_DOOR];
}
