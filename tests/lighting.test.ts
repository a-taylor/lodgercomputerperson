import { describe, expect, it } from 'vitest';
import { darkness, roomAt } from '../src/render/lighting';
import { house } from './helpers';

describe('day and night', () => {
  it('is light all day and dark all night', () => {
    for (const h of [8, 12, 17.9]) expect(darkness(h)).toBe(0);
    for (const h of [21, 23, 0, 3, 4.9]) expect(darkness(h)).toBeCloseTo(darkness(0));
    expect(darkness(0)).toBeGreaterThan(0.5);
  });

  it('darkens gradually through dusk and lightens through dawn', () => {
    const dusk = [18, 18.5, 19, 19.5, 20, 20.5, 21].map(darkness);
    const dawn = [5, 5.5, 6, 6.5, 7, 7.5].map(darkness);
    for (let i = 1; i < dusk.length; i++) expect(dusk[i]).toBeGreaterThan(dusk[i - 1]!);
    for (let i = 1; i < dawn.length; i++) expect(dawn[i]).toBeLessThan(dawn[i - 1]!);
  });

  it('knows which room a spot in the house is in', () => {
    for (const node of house.nodes.values()) {
      expect(roomAt(house, node.x, node.y), node.id).not.toBeNull();
    }
    expect(roomAt(house, 0, 0)).toBeNull();
  });

  it('every light belongs to a room', () => {
    const lit = house.def.furniture.filter((f) => f.light);
    expect(lit.length).toBeGreaterThanOrEqual(4);
    for (const f of lit) expect(house.def.rooms.some((r) => r.id === f.room)).toBe(true);
  });
});
