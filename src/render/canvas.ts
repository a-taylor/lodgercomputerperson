// Placeholder-art renderer. Reads sim state; never writes to it.
import type { Pose } from '../sim/activities';
import type { House } from '../sim/house';

export interface FigurePose {
  x: number;
  y: number;
  facing: -1 | 1;
  walking: boolean;
  pose: Pose;
  asleep: boolean;
  tick: number;
}

const WALL = '#4a3b2f';
const ROOF = '#7a3f2c';

/** Placeholder sky: night, dawn/dusk and day by the hour, fractional for smooth changes. */
function skyColour(hour: number): string {
  if (hour < 5 || hour >= 21) return '#1c2340';
  if (hour < 7) return '#d79b7d';
  if (hour >= 19) return '#6b5a88';
  return '#9cc4dd';
}

export function drawHouse(ctx: CanvasRenderingContext2D, house: House, hour: number, showGraph: boolean): void {
  const { width, height } = house.def.size;
  const floors = house.def.floors;
  const top = Math.min(...floors.map((f) => f.ceilingY));
  const bottom = Math.max(...floors.map((f) => f.floorY));
  const left = Math.min(...house.def.rooms.map((r) => r.x0));
  const right = Math.max(...house.def.rooms.map((r) => r.x1));

  ctx.fillStyle = skyColour(hour);
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = '#5d8a4a';
  ctx.fillRect(0, bottom, width, height - bottom);

  // Roof
  ctx.fillStyle = ROOF;
  ctx.beginPath();
  ctx.moveTo(left - 8, top);
  ctx.lineTo((left + right) / 2, 2);
  ctx.lineTo(right + 8, top);
  ctx.closePath();
  ctx.fill();

  // Rooms
  ctx.font = '6px monospace';
  ctx.textBaseline = 'top';
  for (const room of house.def.rooms) {
    const floor = floors.find((f) => f.id === room.floor)!;
    ctx.fillStyle = room.colour;
    ctx.fillRect(room.x0, floor.ceilingY, room.x1 - room.x0, floor.floorY - floor.ceilingY);
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.fillText(room.name, room.x0 + 3, floor.ceilingY + 3);
  }

  // Stairs, drawn as a diagonal band between their two nodes.
  ctx.strokeStyle = '#5a4634';
  ctx.lineWidth = 3;
  for (const id of house.nodeIds) {
    for (const n of house.adjacency.get(id)!) {
      if (n.kind !== 'stairs' || n.id < id) continue;
      const a = house.nodes.get(id)!;
      const b = house.nodes.get(n.id)!;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }
  }

  // Furniture sits on the floor of its room.
  for (const f of house.def.furniture) {
    const room = house.def.rooms.find((r) => r.id === f.room)!;
    const floor = floors.find((fl) => fl.id === room.floor)!;
    ctx.fillStyle = f.colour;
    ctx.fillRect(f.x, floor.floorY - (f.elevation ?? 0) - f.h, f.w, f.h);
  }

  // Walls, floors and outer frame
  ctx.fillStyle = WALL;
  for (const floor of floors) ctx.fillRect(left, floor.floorY, right - left, 3);
  ctx.fillRect(left, top - 3, right - left, 3);
  ctx.fillRect(left - 3, top - 3, 3, bottom - top + 6);
  ctx.fillRect(right, top - 3, 3, bottom - top + 6);
  // Partition walls stop short of the floor to leave a doorway.
  for (const room of house.def.rooms) {
    if (room.x0 === left) continue;
    const floor = floors.find((f) => f.id === room.floor)!;
    ctx.fillRect(room.x0 - 1, floor.ceilingY, 2, floor.floorY - floor.ceilingY - 30);
  }

  if (showGraph) drawGraph(ctx, house);
}

function drawGraph(ctx: CanvasRenderingContext2D, house: House): void {
  ctx.lineWidth = 1;
  ctx.strokeStyle = 'rgba(255,40,120,0.8)';
  for (const id of house.nodeIds) {
    const a = house.nodes.get(id)!;
    for (const n of house.adjacency.get(id)!) {
      if (n.id < id) continue;
      const b = house.nodes.get(n.id)!;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y - 1);
      ctx.lineTo(b.x, b.y - 1);
      ctx.stroke();
    }
  }
  ctx.fillStyle = 'rgba(255,40,120,1)';
  for (const node of house.nodes.values()) ctx.fillRect(node.x - 1, node.y - 2, 3, 3);
}

/** A 7x18 placeholder figure with feet at (x, y). Sits or lies down for activities that ask for it. */
export function drawFigure(ctx: CanvasRenderingContext2D, pose: FigurePose): void {
  const x = Math.round(pose.x);
  const y = Math.round(pose.y);

  if (pose.pose === 'lie') {
    // On the bed or in the bath: lying flat, head towards the wall.
    const top = y - 10;
    ctx.fillStyle = '#2b2b5c';
    ctx.fillRect(x, top, 7, 3);
    ctx.fillStyle = '#c0392b';
    ctx.fillRect(x - 6, top, 7, 4);
    ctx.fillStyle = '#f0c8a0';
    ctx.fillRect(x - 11, top - 1, 5, 5);
    if (pose.asleep) {
      ctx.fillStyle = '#fff';
      ctx.font = '6px monospace';
      const bob = Math.floor(pose.tick / 20) % 3;
      ctx.fillText('z', x - 12 + bob * 2, top - 8 - bob * 2);
    }
    return;
  }

  const sitting = pose.pose === 'sit';
  const lift = sitting ? 3 : 0;
  const stride = pose.walking ? Math.floor(pose.tick / 4) % 2 : 0;

  ctx.fillStyle = '#2b2b5c'; // trousers
  if (sitting) {
    ctx.fillRect(x - 3, y - 6, 7, 2);
    ctx.fillRect(pose.facing === 1 ? x + 2 : x - 3, y - 4, 2, 4);
  } else {
    ctx.fillRect(x - 3 + stride, y - 6, 2, 6);
    ctx.fillRect(x + 1 - stride, y - 6, 2, 6);
  }
  ctx.fillStyle = '#c0392b'; // shirt
  ctx.fillRect(x - 3, y - 13 + lift, 7, 7);
  ctx.fillStyle = '#f0c8a0'; // head
  ctx.fillRect(x - 2, y - 18 + lift, 5, 5);
  ctx.fillStyle = '#3b2a1a'; // hair
  ctx.fillRect(x - 2, y - 18 + lift, 5, 1);
  ctx.fillStyle = '#000'; // eye shows which way he faces
  ctx.fillRect(pose.facing === 1 ? x + 1 : x - 1, y - 16 + lift, 1, 1);
}

/** Placeholder dog, lying by its bowl. Wags when fed. */
export function drawDog(ctx: CanvasRenderingContext2D, x: number, y: number, wellFed: boolean, tick: number): void {
  ctx.fillStyle = '#a0703c';
  ctx.fillRect(x, y - 4, 9, 4); // body
  ctx.fillRect(x - 3, y - 7, 4, 4); // head
  ctx.fillStyle = '#6b4523';
  ctx.fillRect(x - 3, y - 7, 1, 2); // ear
  const wag = wellFed && Math.floor(tick / 6) % 2 === 0 ? -1 : 0;
  ctx.fillStyle = '#a0703c';
  ctx.fillRect(x + 9, y - 5 + wag, 2, 1); // tail
}
