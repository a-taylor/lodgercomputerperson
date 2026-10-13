import houseJson from './data/house.json';
import { drawFigure, drawHouse } from './render/canvas';
import { buildHouse, type HouseDef } from './sim/house';
import { createSim, step, TICK_MS, type Command } from './sim/sim';

const house = buildHouse(houseJson as HouseDef);
const seedParam = Number(new URLSearchParams(location.search).get('seed'));
const seed = Number.isFinite(seedParam) && seedParam !== 0 ? seedParam : 1985;
const sim = createSim(house, seed);

const canvas = document.querySelector<HTMLCanvasElement>('#house')!;
const status = document.querySelector<HTMLParagraphElement>('#status')!;
const ctx = canvas.getContext('2d')!;
const { width, height } = house.def.size;

let showGraph = false;
const pending: Command[] = [];

function fitCanvas(): void {
  const scale = Math.max(1, Math.floor(Math.min((innerWidth - 32) / width, (innerHeight - 96) / height)));
  canvas.style.width = `${width * scale}px`;
  canvas.style.height = `${height * scale}px`;
}
addEventListener('resize', fitCanvas);
fitCanvas();

addEventListener('keydown', (e) => {
  if (e.key === 'g' || e.key === 'G') showGraph = !showGraph;
});

canvas.addEventListener('click', (e) => {
  const rect = canvas.getBoundingClientRect();
  const x = ((e.clientX - rect.left) / rect.width) * width;
  const y = ((e.clientY - rect.top) / rect.height) * height;
  // Pick the nearest node on the floor that was clicked.
  const floor = house.def.floors.find((f) => y <= f.floorY + 4 && y > f.ceilingY);
  if (!floor) return;
  let best: string | undefined;
  let bestDist = Infinity;
  for (const node of house.nodes.values()) {
    if (node.floor !== floor.id) continue;
    const d = Math.abs(node.x - x);
    if (d < bestDist) {
      bestDist = d;
      best = node.id;
    }
  }
  if (best) pending.push({ type: 'goTo', node: best });
});

// Fixed-timestep loop: the sim only ever advances in whole ticks; rendering interpolates.
let last = performance.now();
let acc = 0;
let prevX = sim.person.x;
let prevY = sim.person.y;

function frame(now: number): void {
  acc += Math.min(now - last, 1000);
  last = now;
  while (acc >= TICK_MS) {
    prevX = sim.person.x;
    prevY = sim.person.y;
    step(sim, house, pending.splice(0));
    acc -= TICK_MS;
  }
  const alpha = acc / TICK_MS;
  const p = sim.person;

  ctx.imageSmoothingEnabled = false;
  drawHouse(ctx, house, showGraph);
  drawFigure(ctx, {
    x: prevX + (p.x - prevX) * alpha,
    y: prevY + (p.y - prevY) * alpha,
    facing: p.facing,
    walking: p.path.length > 0,
    tick: sim.tick,
  });

  const room = house.def.rooms.find((r) => r.id === house.nodes.get(p.at)!.room)!;
  const doing = p.path.length > 0 ? `walking to ${p.path[p.path.length - 1]}` : `pausing in the ${room.name.toLowerCase()}`;
  // Only touch the live region when the activity changes, not every frame.
  const text = `Seed ${seed} · ${doing}`;
  if (status.textContent !== text) status.textContent = text;
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
