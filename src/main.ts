import { drawDog, drawFigure, drawHouse } from './render/canvas';
import { createSim, currentStep, DAY_MS, HOUR_MS, isAsleep, step, TICK_MS, type Command } from './sim/sim';
import { NEED_IDS } from './sim/needs';
import { defaultWorld } from './sim/world';

const world = defaultWorld();
const { house } = world;
const params = new URLSearchParams(location.search);
const seedParam = Number(params.get('seed'));
const seed = Number.isFinite(seedParam) && seedParam !== 0 ? seedParam : 1985;
const speedParam = Math.round(Number(params.get('speed')));
const timeScale = Number.isFinite(speedParam) && speedParam >= 1 ? Math.min(speedParam, 3600) : 1;
// His day follows the player's clock. (Persistence and catch-up arrive in phase 6.)
const now = new Date();
const sim = createSim(world, seed, { startMinute: now.getHours() * 60 + now.getMinutes(), timeScale });

const canvas = document.querySelector<HTMLCanvasElement>('#house')!;
const status = document.querySelector<HTMLParagraphElement>('#status')!;
const debug = document.querySelector<HTMLPreElement>('#debug')!;
const ctx = canvas.getContext('2d')!;
const { width, height } = house.def.size;
const bowl = house.nodes.get('kitchen.bowl')!;

let showGraph = false;
const pending: Command[] = [];

function fitCanvas(): void {
  const scale = Math.max(1, Math.floor(Math.min((innerWidth - 32) / width, (innerHeight - 140) / height)));
  canvas.style.width = `${width * scale}px`;
  canvas.style.height = `${height * scale}px`;
}
addEventListener('resize', fitCanvas);
fitCanvas();

addEventListener('keydown', (e) => {
  if (e.key === 'g' || e.key === 'G') showGraph = !showGraph;
  if (e.key === 'd' || e.key === 'D') debug.hidden = !debug.hidden;
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

function clockText(ms: number): string {
  const minutes = Math.floor((ms % DAY_MS) / 60_000);
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

function describe(): string {
  const p = sim.person;
  if (!p.alive) return 'He has died.';
  const stepDef = currentStep(sim, world);
  if (p.path.length > 0) {
    const room = house.def.rooms.find((r) => r.id === house.nodes.get(p.path[p.path.length - 1]!)!.room)!;
    return `heading to the ${room.name.toLowerCase()}`;
  }
  return stepDef?.label ?? 'standing about';
}

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
    step(sim, world, pending.splice(0));
    acc -= TICK_MS;
  }
  const alpha = acc / TICK_MS;
  const p = sim.person;
  const doing = !!p.activity?.doing;

  ctx.imageSmoothingEnabled = false;
  drawHouse(ctx, house, (sim.clock.ms % DAY_MS) / HOUR_MS, showGraph);
  drawDog(ctx, bowl.x - 22, bowl.y, sim.dog.food > 50, sim.tick);
  if (p.alive) {
    drawFigure(ctx, {
      x: prevX + (p.x - prevX) * alpha,
      y: prevY + (p.y - prevY) * alpha,
      facing: p.facing,
      walking: p.path.length > 0,
      pose: doing ? (currentStep(sim, world)?.pose ?? 'stand') : 'stand',
      asleep: isAsleep(sim, world),
      tick: sim.tick,
    });
  }

  // Only touch the live region when the activity changes, not every frame.
  const text = `${clockText(sim.clock.ms)} · ${describe()}`;
  if (status.textContent !== text) status.textContent = text;

  if (!debug.hidden) {
    const bar = (v: number) => '█'.repeat(Math.round(v / 10)).padEnd(10, '·');
    debug.textContent = [
      ...NEED_IDS.map((id) => `${id.padEnd(8)}${bar(p.needs[id])} ${p.needs[id].toFixed(0)}`),
      `${'dog'.padEnd(8)}${bar(sim.dog.food)} ${sim.dog.food.toFixed(0)}`,
      `${'mood'.padEnd(8)}${bar(p.mood)} ${p.mood.toFixed(0)}`,
      `${'health'.padEnd(8)}${bar(p.health)} ${p.health.toFixed(0)}`,
      `seed ${seed} · speed ${timeScale}x · day ${Math.floor(sim.clock.ms / DAY_MS)}`,
    ].join('\n');
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
