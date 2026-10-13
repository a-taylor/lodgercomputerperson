// Placeholder-art renderer. Reads sim state; never writes to it.
import type { House } from '../sim/house';

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
