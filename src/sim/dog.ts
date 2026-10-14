// The dog: wanders between its bowl, wherever he is, and anywhere else that smells interesting.
import type { DogIdentity, DogSize } from './identity';
import { placeAt, routeFromHere, walk, type Mover } from './movement';
import { nextFloat, nextInt, pick } from './rng';
import type { SimState } from './sim';
import type { World } from './world';

export interface DogState extends Mover {
  identity: DogIdentity;
  food: number;
  /** False until he brings the dog home. */
  present: boolean;
  idleTicks: number;
  /** How long it has stood still: it stands, then sits, then lies down. */
  stillTicks: number;
}

const PACE: Record<DogSize, number> = { small: 0.9, medium: 1.1, large: 1.3 };
export const BOWL = 'kitchen.bowl';

export function createDog(identity: DogIdentity, world: World, node: string, present: boolean): DogState {
  const dog: DogState = { identity, food: 70, present, idleTicks: 0, stillTicks: 0, at: node, x: 0, y: 0, facing: -1, path: [] };
  placeAt(dog, world.house, node);
  return dog;
}

export function stepDog(state: SimState, world: World): void {
  const dog = state.dog;
  if (!dog.present) return;
  if (dog.path.length > 0) {
    dog.stillTicks = 0;
    walk(dog, world.house, PACE[dog.identity.size]);
    return;
  }
  dog.stillTicks++;
  if (dog.idleTicks > 0) {
    dog.idleTicks--;
    return;
  }

  const p = state.person;
  const followChance = p.identity.quirks.includes('dogLover') ? 0.75 : 0.45;
  const bowlChance = dog.food < 40 ? 0.6 : 0.2;
  const r = nextFloat(state.rng);
  let target: string;
  if (p.present && r < followChance) target = p.path[p.path.length - 1] ?? p.at;
  else if (r < followChance + bowlChance) target = BOWL;
  else target = pick(state.rng, world.house.nodeIds);
  dog.path = routeFromHere(world.house, dog, target) ?? [];
  dog.idleTicks = nextInt(state.rng, 600, 3000);
}
