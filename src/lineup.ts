// Dev page: seeded tenants side by side, to eyeball that seeds look different.
import { drawDogSprite, loadDogSheets } from './render/dogArt';
import { drawTenantSprite, loadTenantSheet } from './render/tenantArt';
import { generateIdentity } from './sim/identity';

const SCALE = 5;
const CELL = 48;
const params = new URLSearchParams(location.search);
const seeds = (params.get('seeds') ?? '1,2,3,4,5,6,7,8').split(',').map(Number).filter(Number.isFinite);

const canvas = document.querySelector<HTMLCanvasElement>('#lineup')!;
canvas.width = seeds.length * CELL;
canvas.height = 52;
canvas.style.width = `${canvas.width * SCALE}px`;
canvas.style.height = `${canvas.height * SCALE}px`;
canvas.style.maxWidth = '100%';
const ctx = canvas.getContext('2d')!;
const dogSheets = await loadDogSheets();
const tenantSheet = await loadTenantSheet();

let tick = 0;
function frame(): void {
  ctx.fillStyle = '#c9b28a';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#4a3b2f';
  ctx.fillRect(0, 40, canvas.width, 2);
  seeds.forEach((seed, i) => {
    const { person, dog } = generateIdentity(seed);
    const x = i * CELL + 14;
    drawTenantSprite(ctx, tenantSheet, person.look, {
      x,
      y: 40,
      facing: 1,
      walking: false,
      pose: 'stand',
      asleep: false,
      carrying: false,
      humming: person.quirks.includes('hummer'),
      sick: false,
      tick,
    });
    drawDogSprite(ctx, dogSheets, dog.breed, { x: x + 22, y: 40, facing: -1, walking: false, stillTicks: 0, tick });
    ctx.fillStyle = '#222';
    ctx.font = '5px monospace';
    ctx.fillText(person.name, i * CELL + 3, 48);
    ctx.fillText(`#${seed}`, i * CELL + 3, 8);
  });
  tick++;
  requestAnimationFrame(frame);
}
frame();
