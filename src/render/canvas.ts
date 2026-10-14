// Draws the house from its JSON: Penzilla wallpaper, beams, stairs and furniture, plus the pieces
// drawn in drawnSprites.ts. Reads sim data only; never writes to it.
import type { FurnitureDef, House } from '../sim/house';
import { bakeSprites, P, type DrawnKey } from './drawnSprites';
import { drawAt, loadPack, need, type Pack } from './pack';

const T = 8;

export interface Art {
  pack: Pack;
  drawn: Record<DrawnKey, HTMLCanvasElement[]>;
}

export async function loadArt(): Promise<Art> {
  return { pack: await loadPack(), drawn: bakeSprites() };
}

/** Sky by the hour: night, dawn and dusk, day. */
function skyColour(hour: number): string {
  if (hour < 5 || hour >= 21) return '#1c2340';
  if (hour < 7) return '#d79b7d';
  if (hour >= 19) return '#6b5a88';
  return '#9cc4dd';
}

export function drawHouse(ctx: CanvasRenderingContext2D, house: House, art: Art, hour: number, tick: number, showGraph: boolean): void {
  const { width, height } = house.def.size;
  const { leftCol, rightCol, roofRow, groundRow } = house.def.frame;
  const tile = (key: string, col: number, row: number) => drawAt(ctx, art.pack, `House/${key}`, col * T, row * T);

  // Sky, garden, roof.
  ctx.fillStyle = skyColour(hour);
  ctx.fillRect(0, 0, width, height);
  const groundY = groundRow * T + 6;
  ctx.fillStyle = '#5d8a4a';
  ctx.fillRect(0, groundY, width, height - groundY);
  ctx.fillStyle = '#4b7340';
  ctx.fillRect(0, groundY + 4, width, height - groundY - 4);
  drawRoof(ctx, leftCol * T - 6, (rightCol + 1) * T + 6, roofRow * T + 1);

  // Wallpaper, room by room, with the pack's edge pieces tucked under the outer walls.
  for (const room of house.def.rooms) {
    const floor = house.def.floors.find((f) => f.id === room.floor)!;
    const atLeft = room.x0 === (leftCol + 1) * T;
    const atRight = room.x1 === rightCol * T;
    const c0 = atLeft ? leftCol : room.x0 / T;
    const c1 = room.x1 / T;
    for (let row = floor.ceilingY / T; row < floor.floorY / T; row++) {
      for (let col = c0; col <= c1; col++) {
        const piece = atLeft && col === c0 ? 'Left' : atRight && col === c1 ? 'Right' : 'Tile';
        tile(`${room.wallpaper}_${piece}`, col, row);
      }
    }
  }

  // Things on the walls first, then stairs, then furniture standing on the floor.
  const floorOf = (f: FurnitureDef) => house.def.floors.find((fl) => fl.id === house.def.rooms.find((r) => r.id === f.room)!.floor)!;
  const onWall = (f: FurnitureDef) => (f.elevation ?? 0) >= 16;
  for (const f of house.def.furniture) if (onWall(f)) drawFurniture(ctx, art, f, floorOf(f).floorY, floorOf(f).ceilingY, tick);
  for (const flight of stairFlights(house)) {
    for (let k = 0; k < flight.steps; k++) {
      const x = flight.up === 1 ? flight.x + k * T : flight.x - (k + 2) * T;
      drawAt(ctx, art.pack, flight.up === 1 ? 'House/Stairs_Right' : 'House/Stairs_Left', x, flight.floorY - (k + 1) * T);
    }
  }
  for (const f of house.def.furniture) if (!onWall(f)) drawFurniture(ctx, art, f, floorOf(f).floorY, floorOf(f).ceilingY, tick);

  drawFrame(house, tile);
  if (showGraph) drawGraph(ctx, house);
}

function drawFurniture(ctx: CanvasRenderingContext2D, art: Art, f: FurnitureDef, floorY: number, ceilingY: number, tick: number): void {
  const bottom = floorY - (f.elevation ?? 0);
  if (f.art === 'lamp') {
    // Hangs from the ceiling beam: cord end, cord, shade.
    drawAt(ctx, art.pack, 'Furniture/CeilingLamp_Top', f.x, ceilingY);
    drawAt(ctx, art.pack, 'Furniture/CeilingLamp_Mid', f.x, ceilingY + T);
    drawAt(ctx, art.pack, 'Furniture/CeilingLamp_Bottom', f.x, ceilingY + 2 * T);
    return;
  }
  const [source, key] = f.art.split(':') as ['pack' | 'drawn', string];
  if (source === 'pack') {
    const img = need(art.pack, key);
    ctx.drawImage(img, f.x, bottom - img.height);
  } else {
    const frames = art.drawn[key as DrawnKey];
    if (!frames) throw new Error(`No drawn sprite "${key}"`);
    const img = frames[Math.floor(tick / 12) % frames.length]!;
    ctx.drawImage(img, f.x, bottom - img.height);
  }
}

interface Flight {
  /** x of the bottom of the flight, and the floor it starts from. */
  x: number;
  floorY: number;
  /** 1 if it climbs to the right, -1 to the left. */
  up: 1 | -1;
  steps: number;
}

/** Each stairs edge becomes a flight of the pack's 45-degree stair pieces. */
function stairFlights(house: House): Flight[] {
  const flights: Flight[] = [];
  for (const id of house.nodeIds) {
    for (const n of house.adjacency.get(id)!) {
      if (n.kind !== 'stairs' || n.id < id) continue;
      const a = house.nodes.get(id)!;
      const b = house.nodes.get(n.id)!;
      const [lower, upper] = a.y > b.y ? [a, b] : [b, a];
      flights.push({ x: lower.x, floorY: lower.y, up: upper.x > lower.x ? 1 : -1, steps: Math.round((lower.y - upper.y) / T) });
    }
  }
  return flights;
}

/** Outer walls, the beams between floors (with gaps where stairs come through), and posts between rooms. */
function drawFrame(house: House, tile: (key: string, col: number, row: number) => void): void {
  const { leftCol, rightCol, roofRow, groundRow } = house.def.frame;
  const floors = house.def.floors;
  const beamRows = new Set([roofRow, ...floors.map((f) => f.floorY / T)]);

  // Posts between rooms: the column where a room starts, unless it's against the outer wall.
  const posts = house.def.rooms
    .filter((r) => r.x0 !== (leftCol + 1) * T)
    .map((r) => {
      const floor = floors.find((f) => f.id === r.floor)!;
      return { col: r.x0 / T, top: floor.ceilingY / T, bottom: floor.floorY / T };
    });
  const gaps = new Map<number, Set<number>>();
  for (const flight of stairFlights(house)) {
    const topRow = (flight.floorY - flight.steps * T) / T;
    const topX = flight.x + flight.up * flight.steps * T;
    const cols = gaps.get(topRow) ?? new Set<number>();
    for (let x = topX - T; x <= topX + T - 1; x += T) cols.add(Math.floor(x / T));
    gaps.set(topRow, cols);
  }

  for (const row of beamRows) {
    const gap = gaps.get(row) ?? new Set<number>();
    for (let col = leftCol + 1; col < rightCol; col++) {
      if (gap.has(col)) continue;
      const below = posts.some((p) => p.col === col && p.top === row);
      const above = posts.some((p) => p.col === col && p.bottom === row);
      let key = 'OuterWall_Tile13_Left';
      if (gap.has(col + 1)) key = 'OuterWall_Tile12_Right';
      else if (gap.has(col - 1)) key = 'OuterWall_Tile12_Left';
      else if (below && above) key = 'OuterWall_Tile18';
      else if (below) key = 'OuterWall_Tile16';
      else if (above) key = "OuterWall_Tile19'";
      tile(key, col, row);
    }
  }
  for (let row = roofRow; row <= groundRow; row++) {
    const kind = row === roofRow ? 'Tile9' : row === groundRow ? 'Tile11' : beamRows.has(row) ? 'Tile15' : 'Tile10';
    tile(`OuterWall_${kind}_Left`, leftCol, row);
    tile(`OuterWall_${kind}_Right`, rightCol, row);
  }
  // Posts hang from the beam and stop above head height, leaving a doorway.
  for (const p of posts) {
    tile('InnerWall_Tile4', p.col, p.top + 1);
    for (let row = p.top + 2; row < p.bottom - 3; row++) tile('InnerWall_Tile1', p.col, row);
    tile('InnerWall_Tile7_Left', p.col, p.bottom - 3);
  }
}

/** A tiled roof in the pack's reds: rows of shingles, sloping at 45 degrees, outlined. */
function drawRoof(ctx: CanvasRenderingContext2D, left: number, right: number, base: number): void {
  const top = 2;
  for (let y = top; y < base; y++) {
    const inset = base - y;
    const x0 = left + inset;
    const x1 = right - inset;
    if (x1 <= x0) continue;
    const edge = y === top;
    ctx.fillStyle = edge ? P.outline : (y - top) % 5 === 0 ? P.redDark : P.red;
    ctx.fillRect(x0, y, x1 - x0, 1);
    ctx.fillStyle = P.outline;
    ctx.fillRect(x0, y, 1, 1);
    ctx.fillRect(x1 - 1, y, 1, 1);
  }
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
