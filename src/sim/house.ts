// House definition loaded from JSON, validated, and turned into a walkable graph.

export interface FloorDef {
  id: number;
  name: string;
  floorY: number;
  ceilingY: number;
}

export interface RoomDef {
  id: string;
  name: string;
  floor: number;
  x0: number;
  x1: number;
  /** Which of the pack's wallpapers, e.g. "Wallpaper3". */
  wallpaper: string;
}

export interface NodeDef {
  id: string;
  room: string;
  x: number;
}

export interface EdgeDef {
  a: string;
  b: string;
  kind?: 'walk' | 'stairs';
}

export interface FurnitureDef {
  id: string;
  name: string;
  room: string;
  /** Left edge, in house pixels. */
  x: number;
  /** Pixels above the floor, for things on tables or walls. */
  elevation?: number;
  /** "pack:Furniture/Fridge" (a Penzilla image), "drawn:piano" (drawnSprites.ts), or "lamp" (a hanging lamp). */
  art: string;
  /** The node where he uses it. Decorations don't have one. */
  use?: string;
  /** For beds: where he lies (height off the floor, pillow end, sideways nudge). */
  lie?: { height: number; headRight?: boolean; dx?: number };
  /**
   * For things he sits inside, like the bath: how high he sits, and the image row where the front
   * begins. The front is drawn again over him so he's in it, not on it.
   */
  sitIn?: { seatHeight: number; frontFromRow: number };
  /**
   * Lamps and fires: where the light comes from (offset from the art's top-left), how far it
   * reaches, and whether it's always on (a fire) or only while he's in the room.
   */
  light?: { x: number; y: number; radius: number; always?: boolean };
}

/** The outer frame on the 8-pixel tile grid. */
export interface FrameDef {
  leftCol: number;
  rightCol: number;
  /** The beam under the roof. */
  roofRow: number;
  /** The beam he stands on downstairs. */
  groundRow: number;
}

export interface HouseDef {
  size: { width: number; height: number };
  frame: FrameDef;
  floors: FloorDef[];
  rooms: RoomDef[];
  nodes: NodeDef[];
  edges: EdgeDef[];
  furniture: FurnitureDef[];
}

export interface GraphNode {
  id: string;
  room: string;
  floor: number;
  x: number;
  y: number;
}

export interface Neighbour {
  id: string;
  cost: number;
  kind: 'walk' | 'stairs';
}

export interface House {
  def: HouseDef;
  /** Node ids in a stable, sorted order. */
  nodeIds: string[];
  nodes: Map<string, GraphNode>;
  /** Neighbours sorted by id so traversal order never depends on JSON order. */
  adjacency: Map<string, Neighbour[]>;
}

export function buildHouse(def: HouseDef): House {
  const floors = new Map(def.floors.map((f) => [f.id, f]));
  const rooms = new Map<string, RoomDef>();
  for (const room of def.rooms) {
    if (rooms.has(room.id)) throw new Error(`Duplicate room "${room.id}"`);
    if (!floors.has(room.floor)) throw new Error(`Room "${room.id}" is on unknown floor ${room.floor}`);
    rooms.set(room.id, room);
  }

  const nodes = new Map<string, GraphNode>();
  for (const n of def.nodes) {
    if (nodes.has(n.id)) throw new Error(`Duplicate node "${n.id}"`);
    const room = rooms.get(n.room);
    if (!room) throw new Error(`Node "${n.id}" is in unknown room "${n.room}"`);
    if (n.x < room.x0 || n.x > room.x1) throw new Error(`Node "${n.id}" lies outside room "${room.id}"`);
    const floor = floors.get(room.floor)!;
    nodes.set(n.id, { id: n.id, room: n.room, floor: room.floor, x: n.x, y: floor.floorY });
  }

  const adjacency = new Map<string, Neighbour[]>();
  for (const id of nodes.keys()) adjacency.set(id, []);
  for (const e of def.edges) {
    const a = nodes.get(e.a);
    const b = nodes.get(e.b);
    if (!a || !b) throw new Error(`Edge ${e.a} -> ${e.b} references an unknown node`);
    if (a.id === b.id) throw new Error(`Edge loops on "${a.id}"`);
    const kind = e.kind ?? 'walk';
    if (kind === 'walk' && a.floor !== b.floor) throw new Error(`Walk edge ${a.id} -> ${b.id} crosses floors`);
    if (kind === 'stairs' && Math.abs(a.floor - b.floor) !== 1) {
      throw new Error(`Stairs ${a.id} -> ${b.id} must join adjacent floors`);
    }
    const cost = Math.hypot(a.x - b.x, a.y - b.y);
    adjacency.get(a.id)!.push({ id: b.id, cost, kind });
    adjacency.get(b.id)!.push({ id: a.id, cost, kind });
  }
  for (const list of adjacency.values()) list.sort((p, q) => (p.id < q.id ? -1 : p.id > q.id ? 1 : 0));

  for (const f of def.furniture) {
    if (!rooms.has(f.room)) throw new Error(`Furniture "${f.id}" is in unknown room "${f.room}"`);
    if (f.use !== undefined && !nodes.has(f.use)) throw new Error(`Furniture "${f.id}" uses unknown node "${f.use}"`);
    if (!/^(pack:(House|Furniture)\/[\w']+|drawn:\w+|lamp)$/.test(f.art)) throw new Error(`Furniture "${f.id}" has bad art "${f.art}"`);
  }

  return { def, nodeIds: [...nodes.keys()].sort(), nodes, adjacency };
}
