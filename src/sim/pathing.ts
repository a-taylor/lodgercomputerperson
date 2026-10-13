import type { House } from './house';

/**
 * Shortest path on the floor graph (Dijkstra). Returns node ids from `from` to `to`
 * inclusive, or null if unreachable. Ties break on node id, so the result is stable.
 */
export function findPath(house: House, from: string, to: string): string[] | null {
  if (!house.nodes.has(from)) throw new Error(`Unknown node "${from}"`);
  if (!house.nodes.has(to)) throw new Error(`Unknown node "${to}"`);
  if (from === to) return [from];

  const dist = new Map<string, number>([[from, 0]]);
  const prev = new Map<string, string>();
  const done = new Set<string>();

  // The graph is small (tens of nodes), so a linear scan beats a heap for clarity.
  for (;;) {
    let current: string | undefined;
    let best = Infinity;
    for (const [id, d] of dist) {
      if (done.has(id)) continue;
      if (d < best || (d === best && current !== undefined && id < current)) {
        best = d;
        current = id;
      }
    }
    if (current === undefined) return null;
    if (current === to) break;
    done.add(current);

    for (const n of house.adjacency.get(current)!) {
      if (done.has(n.id)) continue;
      const nd = best + n.cost;
      const old = dist.get(n.id);
      if (old === undefined || nd < old) {
        dist.set(n.id, nd);
        prev.set(n.id, current);
      }
    }
  }

  const path = [to];
  let at = to;
  while (at !== from) {
    at = prev.get(at)!;
    path.push(at);
  }
  return path.reverse();
}

export function pathCost(house: House, path: readonly string[]): number {
  let total = 0;
  for (let i = 1; i < path.length; i++) {
    const edge = house.adjacency.get(path[i - 1]!)?.find((n) => n.id === path[i]);
    if (!edge) throw new Error(`No edge ${path[i - 1]} -> ${path[i]}`);
    total += edge.cost;
  }
  return total;
}
