// The tenant, drawn from Penzilla's "Free Protagonist" sheet (Graphics created by Penzilla Design).
// The free sheet is plain white; on screen he's coloured by region (skin, shirt, trousers, and
// green when sick) and mirrored to face left. These are display-time edits, listed in CREDITS.md.
import type { Pose } from '../sim/activities';

const url = Object.values(
  import.meta.glob('../../assets/penzilla-protagonist/AnimationSheet.png', { eager: true, query: '?url', import: 'default' }),
)[0] as string;

export interface TenantPose {
  x: number;
  /** Floor level: where his feet go. */
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
  /** Sitting with his back to us: the same frame with the eyes painted out (he has no hair). */
  fromBehind?: boolean;
  /** When lying down: how high off the floor, which end his head is, and a nudge sideways. */
  lie?: LieSpot;
  tick: number;
}

export interface LieSpot {
  height: number;
  headRight?: boolean;
  dx?: number;
  /** Tucked in: his body is drawn in the blanket's colour, a bump under the covers. */
  blanket?: string;
}

const SIZE = 24;
const COLS = 8;

/** Frames in reading order on the sheet. */
const ANIM = {
  idle: [0, 1],
  attack: [4, 5],
  walk: [8, 9, 10, 11],
  win: [32, 33, 34, 35],
  /** The last frame of "die" is lying flat, head to the right: used for sleeping in bed. */
  lie: [39],
  sit: [41],
} as const;

/** Which part of him each pixel is: skin, shirt or trousers. Built once per frame from its shape. */
const SKIN = 1;
const SHIRT = 2;
const LEGS = 3;

export interface TenantSheet {
  img: HTMLImageElement;
  /** RGBA of the whole sheet. */
  pixels: Uint8ClampedArray;
  /** Region of every pixel, per frame. */
  regions: Uint8Array[];
}

export async function loadTenantSheet(): Promise<TenantSheet> {
  const img = new Image();
  img.src = url;
  await img.decode();
  const c = Object.assign(document.createElement('canvas'), { width: img.width, height: img.height });
  const cx = c.getContext('2d')!;
  cx.drawImage(img, 0, 0);
  const pixels = cx.getImageData(0, 0, img.width, img.height).data;
  const frames = (img.width / SIZE) * (img.height / SIZE);
  const regions = Array.from({ length: frames }, (_, f) => regionsFor(pixels, img.width, f));
  return { img, pixels, regions };
}

/**
 * The sheet is one plain white figure. Upright, his head runs from the top down to the narrow
 * shaded chin row; the next three rows are his shirt, the rest his trousers. Lying down (the
 * last "die" frame) it's sideways: head on the right, then shirt, then legs.
 */
function regionsFor(pixels: Uint8ClampedArray, sheetW: number, frame: number): Uint8Array {
  const ox = (frame % COLS) * SIZE;
  const oy = Math.floor(frame / COLS) * SIZE;
  const opaque = (x: number, y: number) => pixels[((oy + y) * sheetW + ox + x) * 4 + 3]! > 127;
  const out = new Uint8Array(SIZE * SIZE);
  if (frame === ANIM.lie[0]) {
    for (let y = 0; y < SIZE; y++) {
      for (let x = 0; x < SIZE; x++) if (opaque(x, y)) out[y * SIZE + x] = x >= 14 ? SKIN : x >= 11 ? SHIRT : LEGS;
    }
    return out;
  }
  const width = (y: number) => {
    let n = 0;
    for (let x = 0; x < SIZE; x++) if (opaque(x, y)) n++;
    return n;
  };
  let top = 0;
  while (top < SIZE && width(top) === 0) top++;
  let chin = top + 4;
  while (chin < SIZE && width(chin) > 6) chin++;
  for (let y = 0; y < SIZE; y++) {
    const region = y <= chin ? SKIN : y <= chin + 3 ? SHIRT : LEGS;
    for (let x = 0; x < SIZE; x++) if (opaque(x, y)) out[y * SIZE + x] = region;
  }
  return out;
}

/** The eyes on the sitting frame, two pixels each. */
const SITTING_EYES: [number, number][] = [
  [10, 14],
  [10, 15],
  [14, 14],
  [14, 15],
];

/** Where his feet stick out past his body on the sitting frame: this column and right, from this row. */
const SITTING_FEET = { left: 16, top: 20 };

/** Closed eyes on the lying frame (head to the right): two short dashes. */
const SLEEPING_EYES: [number, number][] = [
  [16, 19],
  [17, 19],
  [19, 19],
  [20, 19],
];

let scratch: HTMLCanvasElement | null = null;

function rgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function mix(a: [number, number, number], b: [number, number, number], t: number): [number, number, number] {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

export interface TenantColours {
  skin: string;
  shirt: string;
  trousers: string;
}

function frameFor(pose: TenantPose): number {
  const loop = (frames: readonly number[], every: number) => frames[Math.floor(pose.tick / every) % frames.length]!;
  if (pose.walking) return loop(ANIM.walk, 5);
  switch (pose.pose) {
    case 'lie':
      return ANIM.lie[0];
    case 'sit':
      return ANIM.sit[0];
    case 'dance':
      return loop(ANIM.win, 6);
    case 'knock':
      return loop(ANIM.attack, 6);
    default:
      return loop(ANIM.idle, 30);
  }
}

export function drawTenantSprite(ctx: CanvasRenderingContext2D, sheet: TenantSheet, colours: TenantColours, pose: TenantPose): void {
  const frame = frameFor(pose);
  const lying = pose.pose === 'lie' && !pose.walking;
  const spot = lying ? (pose.lie ?? { height: 6 }) : null;

  // Colour a copy of the frame by region, keeping the sheet's light and shade: each pixel's
  // brightness times its region's colour. Skin is softened a touch so eyes stay readable.
  scratch ??= Object.assign(document.createElement('canvas'), { width: SIZE, height: SIZE });
  const s = scratch.getContext('2d')!;
  const img = s.createImageData(SIZE, SIZE);
  const sheetW = sheet.img.width;
  const ox = (frame % COLS) * SIZE;
  const oy = Math.floor(frame / COLS) * SIZE;
  let skin = mix(rgb(colours.skin), [255, 255, 255], 0.15);
  if (pose.sick) skin = mix(skin, [120, 190, 90], 0.45);
  const blanket = spot?.blanket ? rgb(spot.blanket) : null;
  const tints: Record<number, [number, number, number]> = {
    [SKIN]: skin,
    [SHIRT]: blanket ?? (pose.bare ? skin : rgb(colours.shirt)),
    [LEGS]: blanket ?? rgb(colours.trousers),
  };
  const regions = sheet.regions[frame]!;
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const i = ((oy + y) * sheetW + ox + x) * 4;
      const a = sheet.pixels[i + 3]!;
      if (a === 0) continue;
      const tint = tints[regions[y * SIZE + x]!] ?? [255, 255, 255];
      const r = sheet.pixels[i]! / 255;
      const g = sheet.pixels[i + 1]! / 255;
      const b = sheet.pixels[i + 2]! / 255;
      const o = (y * SIZE + x) * 4;
      img.data[o] = tint[0] * r;
      img.data[o + 1] = tint[1] * g;
      img.data[o + 2] = tint[2] * b;
      img.data[o + 3] = a;
    }
  }
  // The lying frame has no face; asleep, give him closed eyes so he reads as a sleeper.
  if (lying && pose.asleep) {
    for (const [ex, ey] of SLEEPING_EYES) {
      const o = (ey * SIZE + ex) * 4;
      img.data.set([52, 1, 41, 255], o);
    }
  }
  // From behind: each eye takes the colour of the face just left of it, and the feet that stick
  // out to the side go, since his legs are under the desk.
  if (pose.fromBehind && pose.pose === 'sit' && !pose.walking) {
    for (const [ex, ey] of SITTING_EYES) {
      const o = (ey * SIZE + ex) * 4;
      img.data.copyWithin(o, o - 4, o);
    }
    for (let y = SITTING_FEET.top; y < SIZE; y++) img.data.fill(0, (y * SIZE + SITTING_FEET.left) * 4, (y + 1) * SIZE * 4);
  }
  s.putImageData(img, 0, 0);

  // Feet (or, lying, his side) on the floor or the bed; frames face right.
  const x = Math.round(pose.x) + (spot?.dx ?? 0);
  const bottom = Math.round(pose.y) - (spot?.height ?? 0);
  const dx = x - SIZE / 2;
  const dy = bottom - SIZE;
  // Frames face right; the lying frame has its head on the right.
  const faceLeft = lying ? !spot!.headRight : pose.facing === -1;
  if (faceLeft) {
    ctx.save();
    ctx.translate(dx + SIZE, dy);
    ctx.scale(-1, 1);
    ctx.drawImage(scratch, 0, 0);
    ctx.restore();
  } else {
    ctx.drawImage(scratch, dx, dy);
  }

  if (pose.carrying) {
    const front = pose.facing === 1 ? 1 : -1;
    const cx = x + front * 5 - (front === 1 ? 0 : 6);
    ctx.fillStyle = '#340129';
    ctx.fillRect(cx - 1, bottom - 10, 9, 8);
    ctx.fillStyle = '#7b4a26';
    ctx.fillRect(cx, bottom - 9, 7, 6);
    ctx.fillStyle = '#340129';
    ctx.fillRect(cx + 2, bottom - 11, 3, 1);
  }
  if (lying && pose.asleep) {
    const bob = Math.floor(pose.tick / 20) % 3;
    glyph(ctx, Z, spot!.headRight ? x + 7 - bob * 2 : x - 10 + bob * 2, bottom - 13 - bob * 2);
  }
  if (pose.humming && pose.walking && Math.floor(pose.tick / 30) % 2 === 0) {
    glyph(ctx, NOTE, x + (pose.facing === 1 ? 5 : -9), bottom - 24 - (Math.floor(pose.tick / 10) % 2));
  }
}

// Tiny pixel glyphs, drawn as pixels rather than font text so they stay crisp.
const Z = ['xxx', '..x', '.x.', 'x..', 'xxx'];
const NOTE = ['..xx', '..x.', '..x.', 'xxx.', 'xx..'];

function glyph(ctx: CanvasRenderingContext2D, rows: string[], x: number, y: number): void {
  ctx.fillStyle = '#ffffff';
  rows.forEach((row, j) => [...row].forEach((ch, i) => ch === 'x' && ctx.fillRect(x + i, y + j, 1, 1)));
}
