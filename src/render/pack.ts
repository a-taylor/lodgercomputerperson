// The Penzilla house interior pack, loaded as images keyed by path, e.g. "Furniture/Fridge".
// Graphics created by Penzilla Design (see CREDITS.md).
const urls = import.meta.glob('../../assets/penzilla/{House,Furniture}/*.png', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>;

export type Pack = Map<string, HTMLImageElement>;

export async function loadPack(): Promise<Pack> {
  const pack: Pack = new Map();
  await Promise.all(
    Object.entries(urls).map(async ([path, url]) => {
      const img = new Image();
      img.src = url;
      await img.decode();
      const key = path.replace(/^.*\/penzilla\//, '').replace(/\.png$/, '');
      pack.set(key, img);
    }),
  );
  return pack;
}

/** Draws a pack image with its bottom-left corner at (x, y), so furniture sits on the floor. */
export function drawOnFloor(ctx: CanvasRenderingContext2D, pack: Pack, key: string, x: number, floorY: number): void {
  const img = need(pack, key);
  ctx.drawImage(img, Math.round(x), Math.round(floorY - img.height));
}

export function drawAt(ctx: CanvasRenderingContext2D, pack: Pack, key: string, x: number, y: number): void {
  ctx.drawImage(need(pack, key), Math.round(x), Math.round(y));
}

export function need(pack: Pack, key: string): HTMLImageElement {
  const img = pack.get(key);
  if (!img) throw new Error(`Missing pack image "${key}"`);
  return img;
}
