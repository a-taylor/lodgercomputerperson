// Placeholder sprites for the person and the dog, drawn from their seeded identities.
import type { Pose } from '../sim/activities';
import type { DogIdentity, Look } from '../sim/identity';

export interface FigurePose {
  x: number;
  y: number;
  facing: -1 | 1;
  walking: boolean;
  pose: Pose;
  asleep: boolean;
  carrying: boolean;
  humming: boolean;
  tick: number;
}

/** A roughly 7-wide figure with feet at (x, y). Sits or lies down for activities that ask for it. */
export function drawFigure(ctx: CanvasRenderingContext2D, look: Look, pose: FigurePose): void {
  const x = Math.round(pose.x);
  const y = Math.round(pose.y);

  if (pose.pose === 'lie') {
    // On the bed or in the bath: lying flat, head towards the wall.
    const top = y - 10;
    ctx.fillStyle = look.trousers;
    ctx.fillRect(x, top, 7 + look.tall, 3);
    ctx.fillStyle = look.shirt;
    ctx.fillRect(x - 6, top, 7, 4);
    ctx.fillStyle = look.skin;
    ctx.fillRect(x - 11, top - 1, 5, 5);
    if (look.hairStyle !== 'bald') {
      ctx.fillStyle = look.hair;
      ctx.fillRect(x - 12, top - 1, 2, 5);
    }
    if (pose.asleep) {
      ctx.fillStyle = '#fff';
      ctx.font = '6px monospace';
      const bob = Math.floor(pose.tick / 20) % 3;
      ctx.fillText('z', x - 12 + bob * 2, top - 8 - bob * 2);
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
  ctx.fillStyle = look.shirt;
  ctx.fillRect(x - 3, torsoTop, 7, y - torsoTop - (sitting ? 6 : legs));
  if (dancing) {
    // Arms up, waving in time.
    ctx.fillRect(stride ? x - 5 : x - 4, torsoTop - 3, 1, 4);
    ctx.fillRect(stride ? x + 4 : x + 5, torsoTop - 3, 1, 4);
  } else if (pose.pose === 'knock') {
    // Fist raised to the glass, knuckles towards you.
    ctx.fillRect(x + front * 4, torsoTop - 2, 1, 4);
    ctx.fillStyle = look.skin;
    ctx.fillRect(x + front * 4 - (front === 1 ? 0 : 1), torsoTop - 4, 2, 2);
  }

  ctx.fillStyle = look.skin;
  ctx.fillRect(x - 2, headTop, 5, 5);
  drawHair(ctx, look, x, headTop, front);
  ctx.fillStyle = '#000'; // eye shows which way he faces
  ctx.fillRect(x + front, headTop + 2, 1, 1);
  if (look.glasses) {
    ctx.fillStyle = '#222';
    ctx.fillRect(front === 1 ? x : x - 2, headTop + 2, 3, 1);
  }
  if (look.facialHair === 'moustache') {
    ctx.fillStyle = look.hair;
    ctx.fillRect(front === 1 ? x + 1 : x - 1, headTop + 3, 2, 1);
  } else if (look.facialHair === 'beard') {
    ctx.fillStyle = look.hair;
    ctx.fillRect(x - 2, headTop + 3, 5, 2);
    ctx.fillStyle = look.skin;
    ctx.fillRect(x + front, headTop + 3, 1, 1);
  }

  if (pose.carrying) {
    ctx.fillStyle = '#7b4a26';
    ctx.fillRect(x + front * 4 - (front === 1 ? 0 : 6), y - 9, 7, 6);
    ctx.fillStyle = '#3d2412';
    ctx.fillRect(x + front * 4 - (front === 1 ? 0 : 6) + 2, y - 10, 3, 1);
  }
  if (pose.humming && pose.walking && Math.floor(pose.tick / 30) % 2 === 0) {
    ctx.fillStyle = '#fff';
    ctx.font = '6px monospace';
    ctx.fillText('♪', x + front * 5, headTop - 4 - (Math.floor(pose.tick / 10) % 2));
  }
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

const DOG_SIZE = { small: { w: 7, h: 3, head: 3 }, medium: { w: 9, h: 4, head: 4 }, large: { w: 12, h: 5, head: 5 } };

/** Dog with paws at (x, y). Lies down when still, wags when fed. */
export function drawDog(
  ctx: CanvasRenderingContext2D,
  dog: DogIdentity,
  x: number,
  y: number,
  facing: -1 | 1,
  walking: boolean,
  wellFed: boolean,
  tick: number,
): void {
  const s = DOG_SIZE[dog.size];
  const left = Math.round(x - s.w / 2);
  const legs = walking ? 2 : 0;
  const bodyTop = Math.round(y) - legs - s.h;
  const headX = facing === 1 ? left + s.w - 1 : left - s.head + 1;

  ctx.fillStyle = dog.coat;
  ctx.fillRect(left, bodyTop, s.w, s.h);
  if (walking) {
    const step = Math.floor(tick / 3) % 2;
    ctx.fillRect(left + step, bodyTop + s.h, 1, legs);
    ctx.fillRect(left + s.w - 2 + step, bodyTop + s.h, 1, legs);
  }
  ctx.fillRect(headX, bodyTop - s.head + 2, s.head, s.head);
  if (dog.spots) {
    ctx.fillStyle = dog.coat === '#2a2420' ? '#e8dcc4' : '#2a2420';
    ctx.fillRect(left + 2, bodyTop + 1, 2, 1);
    ctx.fillRect(left + s.w - 4, bodyTop, 1, 2);
  }
  ctx.fillStyle = shade(dog.coat);
  const earX = facing === 1 ? headX : headX + s.head - 1;
  if (dog.ears === 'pointy') ctx.fillRect(earX, bodyTop - s.head + 1, 1, 2);
  else ctx.fillRect(earX, bodyTop - s.head + 2, 1, 3);
  ctx.fillStyle = '#000';
  ctx.fillRect(facing === 1 ? headX + s.head - 2 : headX + 1, bodyTop - s.head + 3, 1, 1);

  const wag = wellFed && Math.floor(tick / 6) % 2 === 0 ? -1 : 0;
  ctx.fillStyle = dog.coat;
  ctx.fillRect(facing === 1 ? left - 2 : left + s.w, bodyTop + wag, 2, 1);
}

function shade(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.round(((n >> 16) & 255) * 0.65);
  const g = Math.round(((n >> 8) & 255) * 0.65);
  const b = Math.round((n & 255) * 0.65);
  return `rgb(${r},${g},${b})`;
}
