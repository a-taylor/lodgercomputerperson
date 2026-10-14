// The dog, from NVPH Studio's "Dog Animation - 4 Different Dogs" (CC BY-ND 4.0, see CREDITS.md).
// Frames are drawn exactly as they come; facing left is the same frame mirrored on screen.
import { DOG_BREEDS } from '../sim/identity';

const urls = import.meta.glob('../../assets/nvph/doggy*.png', { eager: true, query: '?url', import: 'default' }) as Record<string, string>;

const FRAME_W = 25;
const FRAME_H = 19;
const COLS = 5;

/** Frames in each sheet, in reading order. */
const ANIM = {
  sit: [0],
  idle: [1, 2, 3, 4, 5, 6, 7, 8],
  run: [9, 10, 11, 12, 13, 14, 15, 16],
  lie: [18],
  walk: [19, 20, 21, 22],
} as const;

/** Still for this many ticks and it sits; this many more and it lies down. */
const SIT_AFTER = 60;
const LIE_AFTER = 200;

export type DogSheets = HTMLImageElement[];

export async function loadDogSheets(): Promise<DogSheets> {
  const sheets: HTMLImageElement[] = [];
  for (let i = 1; i <= DOG_BREEDS; i++) {
    const url = Object.entries(urls).find(([path]) => path.endsWith(`doggy${i}.png`))?.[1];
    if (!url) throw new Error(`Missing dog sheet doggy${i}.png`);
    const img = new Image();
    img.src = url;
    await img.decode();
    sheets.push(img);
  }
  return sheets;
}

export interface DogPose {
  x: number;
  /** Floor level: where its paws go. */
  y: number;
  facing: -1 | 1;
  walking: boolean;
  /** Ticks it has been standing still. */
  stillTicks: number;
  tick: number;
}

function frameFor(pose: DogPose): number {
  if (pose.walking) return ANIM.walk[Math.floor(pose.tick / 5) % ANIM.walk.length]!;
  if (pose.stillTicks >= LIE_AFTER) return ANIM.lie[0];
  if (pose.stillTicks >= SIT_AFTER) return ANIM.sit[0];
  return ANIM.idle[Math.floor(pose.tick / 8) % ANIM.idle.length]!;
}

export function drawDogSprite(ctx: CanvasRenderingContext2D, sheets: DogSheets, breed: number | undefined, pose: DogPose): void {
  const sheet = sheets[(breed ?? 0) % sheets.length]!;
  const frame = frameFor(pose);
  const sx = (frame % COLS) * FRAME_W;
  const sy = Math.floor(frame / COLS) * FRAME_H;
  // Centred on its x, paws on the floor (the sheets leave no gap under the paws).
  const dx = Math.round(pose.x) - Math.floor(FRAME_W / 2);
  const dy = Math.round(pose.y) - FRAME_H;
  if (pose.facing === 1) {
    ctx.drawImage(sheet, sx, sy, FRAME_W, FRAME_H, dx, dy, FRAME_W, FRAME_H);
  } else {
    ctx.save();
    ctx.translate(dx + FRAME_W, dy);
    ctx.scale(-1, 1);
    ctx.drawImage(sheet, sx, sy, FRAME_W, FRAME_H, 0, 0, FRAME_W, FRAME_H);
    ctx.restore();
  }
}
