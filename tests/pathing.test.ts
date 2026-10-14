import { describe, expect, it } from 'vitest';
import { buildHouse, type HouseDef } from '../src/sim/house';
import { findPath, pathCost } from '../src/sim/pathing';
import { createSim, step } from '../src/sim/sim';
import { house, houseDef, world } from './helpers';

function isConnectedPath(path: string[]): boolean {
  return path.every((id, i) => i === 0 || house.adjacency.get(path[i - 1]!)!.some((n) => n.id === id));
}

describe('house data', () => {
  it('loads and validates the JSON', () => {
    expect(house.nodeIds.length).toBe(houseDef.nodes.length);
    expect(house.def.rooms.length).toBe(7);
  });

  it('gives every piece of furniture a reachable interaction node', () => {
    for (const f of houseDef.furniture) if (f.use) expect(house.nodes.has(f.use)).toBe(true);
  });

  it('rejects broken data', () => {
    const bad: HouseDef = structuredClone(houseDef);
    bad.edges.push({ a: 'living.door', b: 'nowhere' });
    expect(() => buildHouse(bad)).toThrow(/unknown node/);

    const crossing: HouseDef = structuredClone(houseDef);
    crossing.edges.push({ a: 'living.door', b: 'bedroom.bed' });
    expect(() => buildHouse(crossing)).toThrow(/crosses floors/);
  });
});

describe('findPath', () => {
  it('finds a valid path between every pair of nodes', () => {
    for (const from of house.nodeIds) {
      for (const to of house.nodeIds) {
        const path = findPath(house, from, to);
        expect(path, `${from} -> ${to}`).not.toBeNull();
        expect(path![0]).toBe(from);
        expect(path![path!.length - 1]).toBe(to);
        expect(isConnectedPath(path!)).toBe(true);
        expect(new Set(path).size).toBe(path!.length); // no revisits
      }
    }
  });

  it('returns a single node for a trip to itself', () => {
    expect(findPath(house, 'den.piano', 'den.piano')).toEqual(['den.piano']);
  });

  it('is symmetric in cost', () => {
    for (const from of house.nodeIds) {
      for (const to of house.nodeIds) {
        const there = pathCost(house, findPath(house, from, to)!);
        const back = pathCost(house, findPath(house, to, from)!);
        expect(there).toBeCloseTo(back, 9);
      }
    }
  });

  it('uses the stairs to change floors', () => {
    expect(findPath(house, 'kitchen.fridge', 'bedroom.bed')).toEqual([
      'kitchen.fridge',
      'kitchen.stove',
      'kitchen.table',
      'living.phone',
      'living.fireplace',
      'living.armchair',
      'living.stairs',
      'den.stairs',
      'den.piano',
      'study.typewriter',
      'study.games',
      'study.window',
      'study.stairs',
      'office.stairs',
      'office.computer',
      'office.bookshelf',
      'office.clock',
      'bathroom.sink',
      'bathroom.bath',
      'bedroom.closet',
      'bedroom.rug',
      'bedroom.bed',
    ]);
  });

  it('picks the shorter of two routes', () => {
    const def: HouseDef = {
      size: { width: 100, height: 100 },
      frame: { leftCol: 0, rightCol: 12, roofRow: 0, groundRow: 6 },
      floors: [{ id: 0, name: 'G', floorY: 50, ceilingY: 0 }],
      rooms: [{ id: 'r', name: 'R', floor: 0, x0: 0, x1: 100, wallpaper: 'Wallpaper1' }],
      nodes: [
        { id: 'a', room: 'r', x: 0 },
        { id: 'b', room: 'r', x: 10 },
        { id: 'c', room: 'r', x: 90 },
        { id: 'd', room: 'r', x: 20 },
      ],
      edges: [
        { a: 'a', b: 'c' },
        { a: 'c', b: 'd' },
        { a: 'a', b: 'b' },
        { a: 'b', b: 'd' },
      ],
      furniture: [],
    };
    expect(findPath(buildHouse(def), 'a', 'd')).toEqual(['a', 'b', 'd']);
  });

  it('returns null when the target is unreachable', () => {
    const def: HouseDef = structuredClone(houseDef);
    def.edges = def.edges.filter((e) => e.kind !== 'stairs');
    const cut = buildHouse(def);
    expect(findPath(cut, 'living.door', 'bedroom.bed')).toBeNull();
    expect(findPath(cut, 'living.door', 'kitchen.bowl')).not.toBeNull();
  });

  it('throws on unknown nodes', () => {
    expect(() => findPath(house, 'living.door', 'attic')).toThrow(/Unknown node/);
  });
});

describe('figure walking', () => {
  const MAX_TICKS = 2000;

  it('reaches every node when sent there from a standstill', () => {
    for (const target of house.nodeIds) {
      const sim = createSim(world, 42);
      step(sim, world, [{ type: 'goTo', node: target }]);
      let t = 0;
      while (sim.person.path.length > 0 && t++ < MAX_TICKS) step(sim, world);
      expect(sim.person.at, target).toBe(target);
      const node = house.nodes.get(target)!;
      expect([sim.person.x, sim.person.y]).toEqual([node.x, node.y]);
    }
  });

  it('reaches every node when redirected mid-walk', () => {
    for (const target of house.nodeIds) {
      const sim = createSim(world, 7);
      step(sim, world, [{ type: 'goTo', node: 'kitchen.bowl' }]);
      for (let i = 0; i < 37; i++) step(sim, world); // part-way along an edge
      step(sim, world, [{ type: 'goTo', node: target }]);
      let t = 0;
      while (sim.person.path.length > 0 && t++ < MAX_TICKS) step(sim, world);
      expect(sim.person.at, target).toBe(target);
    }
  });

  it('only ever stands on walkable lines while wandering', () => {
    const sim = createSim(world, 99);
    for (let i = 0; i < 20000; i++) {
      step(sim, world);
      const p = sim.person;
      const a = house.nodes.get(p.at)!;
      const next = p.path[0] ? house.nodes.get(p.path[0])! : a;
      // Position lies on the segment between the last node and the next one.
      const len = Math.hypot(next.x - a.x, next.y - a.y);
      const offLine =
        len === 0
          ? Math.hypot(p.x - a.x, p.y - a.y)
          : Math.abs((next.x - a.x) * (p.y - a.y) - (next.y - a.y) * (p.x - a.x)) / len;
      expect(offLine).toBeLessThan(1e-6);
    }
  });
});
