// Day and night: the house darkens after dusk, and the room he's in lights up while he's awake.
// Drawn over everything else each frame. Reads sim data only; how far each room's light has faded
// in is kept here, since it's presentation, not state.
import type { FurnitureDef, House } from '../sim/house';
import type { Art } from './canvas';
import { need } from './pack';

/** How dark the middle of the night gets (alpha of the night colour). */
const MAX_DARK = 0.62;
/** A lamp takes most of the dark out of a room; a room with no lamp only some. */
const LAMP_LIFT = 0.75;
const BARE_LIFT = 0.45;
/** Lights take about this long (ms) to come on or go off. */
const FADE_MS = 250;
const NIGHT = '8, 12, 36';
const GLOW = '255, 210, 122';

/** 0 by day, MAX_DARK at night, ramping over dusk (18:00 to 21:00) and dawn (5:00 to 7:30). */
export function darkness(hour: number): number {
  const h = ((hour % 24) + 24) % 24;
  let t: number;
  if (h >= 21 || h < 5) t = 1;
  else if (h >= 18) t = (h - 18) / 3;
  else if (h < 7.5) t = 1 - (h - 5) / 2.5;
  else t = 0;
  // Ease, so the change is slow at either end.
  return MAX_DARK * t * t * (3 - 2 * t);
}

export interface Lighting {
  /** Draws the night over the house. `occupied` is the room he's awake in, if any. */
  draw(ctx: CanvasRenderingContext2D, hour: number, occupied: string | null, dtMs: number): void;
}

export function createLighting(house: House, art: Art): Lighting {
  const { width, height } = house.def.size;
  const shade = document.createElement('canvas');
  shade.width = width;
  shade.height = height;
  const sctx = shade.getContext('2d')!;
  const level = new Map(house.def.rooms.map((r) => [r.id, 0]));
  const lights = house.def.furniture.filter((f) => f.light).map((f) => ({ f, ...lightPoint(house, art, f) }));
  const hasLamp = new Set(lights.filter((l) => !l.f.light!.always).map((l) => l.f.room));
  const rooms = house.def.rooms.map((r) => {
    const floor = house.def.floors.find((fl) => fl.id === r.floor)!;
    return { id: r.id, x: r.x0, y: floor.ceilingY, w: r.x1 - r.x0, h: floor.floorY - floor.ceilingY };
  });

  return {
    draw(ctx, hour, occupied, dtMs) {
      const k = Math.min(1, dtMs / FADE_MS);
      for (const [id, v] of level) level.set(id, v + ((id === occupied ? 1 : 0) - v) * k);
      const dark = darkness(hour);
      if (dark <= 0.001) return;

      sctx.clearRect(0, 0, width, height);
      sctx.fillStyle = `rgba(${NIGHT}, ${dark})`;
      sctx.fillRect(0, 0, width, height);
      for (const r of rooms) {
        const lit = level.get(r.id)!;
        if (lit < 0.01) continue;
        const lift = hasLamp.has(r.id) ? LAMP_LIFT : BARE_LIFT;
        sctx.clearRect(r.x, r.y, r.w, r.h);
        sctx.fillStyle = `rgba(${NIGHT}, ${dark * (1 - lift * lit)})`;
        sctx.fillRect(r.x, r.y, r.w, r.h);
      }
      ctx.drawImage(shade, 0, 0);

      // Pools of warm light in pixel steps, kept inside their room.
      const night = dark / MAX_DARK;
      for (const l of lights) {
        const on = l.f.light!.always ? 1 : level.get(l.f.room)!;
        if (on < 0.01) continue;
        const r = rooms.find((rm) => rm.id === l.f.room)!;
        ctx.save();
        ctx.beginPath();
        ctx.rect(r.x, r.y, r.w, r.h);
        ctx.clip();
        ctx.globalCompositeOperation = 'lighter';
        const radius = l.f.light!.radius;
        for (const step of [1, 0.66, 0.33]) {
          ctx.fillStyle = `rgba(${GLOW}, ${0.06 * on * night})`;
          disc(ctx, l.x, l.y, radius * step);
        }
        ctx.restore();
      }
    },
  };
}

/** Where a piece of furniture's light comes from, in house pixels. */
function lightPoint(house: House, art: Art, f: FurnitureDef): { x: number; y: number } {
  const room = house.def.rooms.find((r) => r.id === f.room)!;
  const floor = house.def.floors.find((fl) => fl.id === room.floor)!;
  let top: number;
  if (f.art === 'lamp') top = floor.ceilingY;
  else {
    const [source, key] = f.art.split(':') as ['pack' | 'drawn', string];
    const h = source === 'pack' ? need(art.pack, key).height : art.drawn[key as keyof Art['drawn']]![0]!.height;
    top = floor.floorY - (f.elevation ?? 0) - h;
  }
  return { x: f.x + f.light!.x, y: top + f.light!.y };
}

/** A filled circle made of whole-pixel rows, so it stays crisp when scaled up. */
function disc(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number): void {
  const R = Math.round(r);
  for (let dy = -R; dy <= R; dy++) {
    const half = Math.round(Math.sqrt(R * R - dy * dy));
    ctx.fillRect(Math.round(cx) - half, Math.round(cy) + dy, half * 2, 1);
  }
}

/** The room containing a point, if any (by floor band, then by x). */
export function roomAt(house: House, x: number, y: number): string | null {
  for (const r of house.def.rooms) {
    const floor = house.def.floors.find((fl) => fl.id === r.floor)!;
    if (y > floor.ceilingY && y <= floor.floorY && x >= r.x0 && x < r.x1) return r.id;
  }
  return null;
}
