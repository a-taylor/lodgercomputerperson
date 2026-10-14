// Placeholder sprites for the person and the dog, drawn from their seeded identities.
import type { Pose } from '../sim/activities';
import type { Look } from '../sim/identity';

export interface FigurePose {
  x: number;
  y: number;
  facing: -1 | 1;
  walking: boolean;
  pose: Pose;
  asleep: boolean;
  carrying: boolean;
  humming: boolean;
  /** Green about the gills. */
  sick: boolean;
  /** In the bath: no shirt. */
  bare?: boolean;
  /** When lying down: how high off the floor, which end his head is, and a nudge sideways. */
  lie?: LieSpot;
  mood: number;
  tick: number;
}

const OUTLINE = '#340129';
let scratch: HTMLCanvasElement | null = null;

/**
 * Draws something with the art pack's one-pixel dark outline around its silhouette. The sprite is
 * drawn on a scratch canvas first; every empty pixel touching a filled one becomes outline.
 */
export function drawOutlined(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  draw: (c: CanvasRenderingContext2D, ox: number, oy: number) => void,
): void {
  const size = 48;
  const half = size / 2;
  scratch ??= Object.assign(document.createElement('canvas'), { width: size, height: size });
  const s = scratch.getContext('2d', { willReadFrequently: true })!;
  s.clearRect(0, 0, size, size);
  const ox = Math.round(x);
  const oy = Math.round(y);
  draw(s, half, size - 4);
  const img = s.getImageData(0, 0, size, size);
  const d = img.data;
  const filled = (i: number, j: number) => i >= 0 && j >= 0 && i < size && j < size && d[(j * size + i) * 4 + 3]! > 0;
  const edge: number[] = [];
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      if (!filled(i, j) && (filled(i - 1, j) || filled(i + 1, j) || filled(i, j - 1) || filled(i, j + 1))) edge.push(i, j);
    }
  }
  s.fillStyle = OUTLINE;
  for (let k = 0; k < edge.length; k += 2) s.fillRect(edge[k]!, edge[k + 1]!, 1, 1);
  ctx.drawImage(scratch, ox - half, oy - (size - 4));
}

export interface LieSpot {
  height: number;
  headRight?: boolean;
  dx?: number;
}

/** Sickly green mixed into his skin tone. */
function sickly(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  const mix = (c: number, g: number) => Math.round(c * 0.55 + g * 0.45);
  return `rgb(${mix((n >> 16) & 255, 150)},${mix((n >> 8) & 255, 190)},${mix(n & 255, 120)})`;
}

/** A roughly 7-wide figure with feet at (x, y). Sits or lies down for activities that ask for it. */
export function drawFigure(ctx: CanvasRenderingContext2D, look: Look, pose: FigurePose): void {
  const x = Math.round(pose.x);
  const y = Math.round(pose.y);
  const skin = pose.sick ? sickly(look.skin) : look.skin;

  if (pose.pose === 'lie') {
    // On the bed or in the bath, lying on the surface the furniture says, head at its pillow end.
    const spot = pose.lie ?? { height: 6 };
    const cx = x + (spot.dx ?? 0);
    const top = y - spot.height - 4;
    // Offsets are written head-left; mirrored when the head goes right.
    const span = (from: number, len: number, rowY: number, h: number, colour: string) => {
      ctx.fillStyle = colour;
      ctx.fillRect(spot.headRight ? cx - (from + len - 1) : cx + from, rowY, len, h);
    };
    span(0, 7 + look.tall, top + 1, 3, look.trousers);
    span(-6, 7, top, 4, look.shirt);
    span(-11, 5, top - 1, 5, skin);
    if (look.hairStyle !== 'bald') span(-12, 2, top - 1, 5, look.hair);
    if (pose.asleep) {
      const bob = Math.floor(pose.tick / 20) % 3;
      const zx = spot.headRight ? cx + 9 - bob * 2 : cx - 12 + bob * 2;
      glyph(ctx, Z, zx, top - 8 - bob * 2);
    }
    return;
  }

  const sitting = pose.pose === 'sit';
  const dancing = pose.pose === 'dance';
  const bounce = dancing && Math.floor(pose.tick / 5) % 2 === 0 ? 1 : 0;
  const legs = sitting ? 0 : 6 + Math.min(look.tall, 2);
  const torsoTop = y - legs - 7 - (look.tall > 2 ? 1 : 0) - (sitting ? 3 : 0) - bounce;
  const headTop = torsoTop - 5;
  const stride = pose.walking || dancing ? Math.floor(pose.tick / (dancing ? 5 : 4)) % 2 : 0;
  const front = pose.facing === 1 ? 1 : -1;

  ctx.fillStyle = look.trousers;
  if (sitting) {
    ctx.fillRect(x - 3, y - 6, 7, 2);
    ctx.fillRect(front === 1 ? x + 2 : x - 3, y - 4, 2, 4);
  } else {
    ctx.fillRect(x - 3 + stride, y - legs, 2, legs);
    ctx.fillRect(x + 1 - stride, y - legs, 2, legs);
  }
  ctx.fillStyle = pose.bare ? skin : look.shirt;
  ctx.fillRect(x - 3, torsoTop, 7, y - torsoTop - (sitting ? 6 : legs));
  if (dancing) {
    // Arms up, waving in time.
    ctx.fillRect(stride ? x - 5 : x - 4, torsoTop - 3, 1, 4);
    ctx.fillRect(stride ? x + 4 : x + 5, torsoTop - 3, 1, 4);
  } else if (pose.pose === 'knock') {
    // Fist raised to the glass, knuckles towards you.
    ctx.fillRect(x + front * 4, torsoTop - 2, 1, 4);
    ctx.fillStyle = skin;
    ctx.fillRect(x + front * 4 - (front === 1 ? 0 : 1), torsoTop - 4, 2, 2);
  }

  ctx.fillStyle = skin;
  ctx.fillRect(x - 2, headTop, 5, 5);
  drawHair(ctx, look, x, headTop, front);
  ctx.fillStyle = '#000'; // eye shows which way he faces
  ctx.fillRect(x + front, headTop + 2, 1, 1);
  if (look.glasses) {
    ctx.fillStyle = '#222';
    ctx.fillRect(front === 1 ? x : x - 2, headTop + 2, 3, 1);
  }
  // His mouth shows how he feels: a smile when happy, a droop when low.
  if (look.facialHair !== 'beard') {
    ctx.fillStyle = '#5a2a1a';
    const mx = front === 1 ? x + 1 : x - 1;
    if (pose.mood < 35) {
      ctx.fillRect(mx, headTop + 4, 2, 1);
      ctx.fillRect(front === 1 ? mx + 2 : mx - 1, headTop + 5, 1, 1);
    } else if (pose.mood >= 70) {
      ctx.fillRect(mx, headTop + 4, 1, 1);
      ctx.fillRect(front === 1 ? mx + 1 : mx - 1, headTop + 3, 1, 1);
    }
  }
  if (look.facialHair === 'moustache') {
    ctx.fillStyle = look.hair;
    ctx.fillRect(front === 1 ? x + 1 : x - 1, headTop + 3, 2, 1);
  } else if (look.facialHair === 'beard') {
    ctx.fillStyle = look.hair;
    ctx.fillRect(x - 2, headTop + 3, 5, 2);
    ctx.fillStyle = skin;
    ctx.fillRect(x + front, headTop + 3, 1, 1);
  }

  if (pose.carrying) {
    ctx.fillStyle = '#7b4a26';
    ctx.fillRect(x + front * 4 - (front === 1 ? 0 : 6), y - 9, 7, 6);
    ctx.fillStyle = '#3d2412';
    ctx.fillRect(x + front * 4 - (front === 1 ? 0 : 6) + 2, y - 10, 3, 1);
  }
  if (pose.humming && pose.walking && Math.floor(pose.tick / 30) % 2 === 0) {
    glyph(ctx, NOTE, x + front * 5 - 1, headTop - 8 - (Math.floor(pose.tick / 10) % 2));
  }
}

// Tiny pixel glyphs, drawn as pixels rather than font text so they stay crisp (and outline cleanly).
export const Z = ['xxx', '..x', '.x.', 'x..', 'xxx'];
export const NOTE = ['..xx', '..x.', '..x.', 'xxx.', 'xx..'];

export function glyph(ctx: CanvasRenderingContext2D, rows: string[], x: number, y: number): void {
  ctx.fillStyle = '#ffffff';
  rows.forEach((row, j) => [...row].forEach((ch, i) => ch === 'x' && ctx.fillRect(x + i, y + j, 1, 1)));
}

function drawHair(ctx: CanvasRenderingContext2D, look: Look, x: number, top: number, front: number): void {
  ctx.fillStyle = look.hair;
  switch (look.hairStyle) {
    case 'bald':
      return;
    case 'short':
      ctx.fillRect(x - 2, top, 5, 1);
      return;
    case 'parted':
      ctx.fillRect(x - 2, top, 5, 1);
      ctx.fillRect(front === 1 ? x - 2 : x + 2, top + 1, 1, 2);
      return;
    case 'long':
      ctx.fillRect(x - 2, top, 5, 1);
      ctx.fillRect(front === 1 ? x - 3 : x + 3, top, 1, 6);
      ctx.fillRect(front === 1 ? x - 2 : x + 2, top + 1, 1, 3);
      return;
    case 'curly':
      ctx.fillRect(x - 3, top - 1, 7, 2);
      ctx.fillRect(front === 1 ? x - 3 : x + 3, top + 1, 1, 2);
      return;
    case 'spiky':
      ctx.fillRect(x - 2, top, 5, 1);
      for (let i = -2; i <= 2; i += 2) ctx.fillRect(x + i, top - 1, 1, 1);
      return;
  }
}
