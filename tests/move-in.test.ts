import { describe, expect, it } from 'vitest';
import { FRONT_DOOR, UNPACK_AT } from '../src/sim/moveIn';
import { createSim, hashState, run, step, type SimState } from '../src/sim/sim';
import { world } from './helpers';

const EMPTY_TICKS = 100;

function newHome(seed = 1985): SimState {
  return createSim(world, seed, { startEmpty: true, emptyTicks: EMPTY_TICKS });
}

/** Steps until the move-in finishes, recording what happened along the way. */
function watchMoveIn(sim: SimState) {
  const stages: string[] = [];
  const roomsExplored = new Set<string>();
  let carriedTo: string | null = null;
  let dogArrivedWithHim = false;
  let t = 0;
  while (sim.moveIn.stage !== 'done' && t++ < 50_000) {
    step(sim, world);
    if (stages[stages.length - 1] !== sim.moveIn.stage) stages.push(sim.moveIn.stage);
    if (sim.moveIn.stage === 'exploring') roomsExplored.add(world.house.nodes.get(sim.person.at)!.room);
    if (sim.person.carrying) carriedTo = sim.person.at;
    if (sim.moveIn.stage === 'unpacking' && sim.dog.present && !dogArrivedWithHim) dogArrivedWithHim = sim.person.carrying;
  }
  return { stages, roomsExplored, carriedTo, dogArrivedWithHim, ticks: t };
}

describe('moving in', () => {
  it('starts with an empty house', () => {
    const sim = newHome();
    for (let i = 0; i < EMPTY_TICKS - 1; i++) {
      step(sim, world);
      expect(sim.person.present).toBe(false);
      expect(sim.dog.present).toBe(false);
      expect(sim.person.activity).toBeNull();
    }
  });

  it('arrives, looks round, leaves, then comes back with a suitcase and the dog', () => {
    const sim = newHome();
    const seen = watchMoveIn(sim);
    expect(seen.stages).toEqual(['empty', 'exploring', 'away', 'unpacking', 'done']);
    expect(seen.roomsExplored.size).toBeGreaterThanOrEqual(5);
    expect(seen.dogArrivedWithHim).toBe(true);
    expect(seen.carriedTo).toBe(UNPACK_AT);
    expect(sim.person.carrying).toBe(false);
    expect(sim.person.present && sim.dog.present).toBe(true);
  });

  it('comes and goes by the front door', () => {
    const sim = newHome();
    let firstSeenAt: string | null = null;
    let lastSeenBeforeAway: string | null = null;
    while (sim.moveIn.stage !== 'unpacking') {
      step(sim, world);
      if (sim.person.present && firstSeenAt === null) firstSeenAt = sim.person.at;
      if (sim.moveIn.stage === 'exploring') lastSeenBeforeAway = sim.person.at;
    }
    expect(firstSeenAt).toBe(FRONT_DOOR);
    expect(lastSeenBeforeAway).toBe(FRONT_DOOR);
  });

  it('ignores the player until he has moved in', () => {
    const sim = newHome();
    const twin = newHome();
    let ticks = 0;
    while (sim.moveIn.stage !== 'done') {
      step(sim, world, [{ type: 'goTo', node: 'kitchen.bowl' }, { type: 'introduce', playerName: 'Sam' }]);
      step(twin, world);
      ticks++;
    }
    expect(ticks).toBeGreaterThan(500);
    expect(hashState(sim)).toBe(hashState(twin));
    expect(sim.playerName).toBeNull();
  });

  it('then gets on with his life', () => {
    const sim = newHome();
    watchMoveIn(sim);
    run(sim, world, 2000);
    expect(sim.person.activity).not.toBeNull();
    run(sim, world, 2000);
    expect(sim.person.alive).toBe(true);
  });

  it('is deterministic', () => {
    const a = newHome(5);
    const b = newHome(5);
    run(a, world, 8000);
    run(b, world, 8000);
    expect(hashState(a)).toBe(hashState(b));
  });

  it('plays out differently for different seeds', () => {
    const a = newHome(5);
    const b = newHome(6);
    expect(watchMoveIn(a).roomsExplored).not.toEqual(watchMoveIn(b).roomsExplored);
  });
});

describe('introductions', () => {
  it('learns the player\'s name and can be renamed', () => {
    const sim = createSim(world, 1);
    const seeded = sim.person.identity.name;
    step(sim, world, [{ type: 'introduce', playerName: '  Ada  ' }]);
    expect(sim.playerName).toBe('Ada');
    expect(sim.person.identity.name).toBe(seeded);
    step(sim, world, [{ type: 'introduce', tenantName: 'Montgomery' }]);
    expect(sim.person.identity.name).toBe('Montgomery');
    expect(sim.playerName).toBe('Ada');
  });

  it('ignores blank names', () => {
    const sim = createSim(world, 1);
    const seeded = sim.person.identity.name;
    step(sim, world, [{ type: 'introduce', playerName: '   ', tenantName: '' }]);
    expect(sim.playerName).toBeNull();
    expect(sim.person.identity.name).toBe(seeded);
  });
});
