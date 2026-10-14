import { drawHouse } from './render/canvas';
import { drawDog, drawFigure } from './render/sprites';
import type { DeliveryItem } from './sim/interactions';
import { NEED_IDS } from './sim/needs';
import { createSim, currentStep, DAY_MS, HOUR_MS, isAsleep, step, TICK_MS, type Command } from './sim/sim';
import { defaultWorld } from './sim/world';

const world = defaultWorld();
const { house } = world;
const params = new URLSearchParams(location.search);

// Each new home gets its own tenant. Until saving arrives (phase 6) the seed lives in the URL,
// so reloading brings back the same person rather than a stranger.
let seed = Math.trunc(Number(params.get('seed')));
if (!Number.isFinite(seed) || seed === 0) {
  seed = (crypto.getRandomValues(new Uint32Array(1))[0]! % 999_999) + 1;
  params.set('seed', String(seed));
  history.replaceState(null, '', `?${params}`);
}
// His day runs 30x faster than real time by default (a day lasts 48 minutes); ?speed=1 for real time.
const DEFAULT_SPEED = 30;
const speedParam = Math.round(Number(params.get('speed')));
const timeScale = Number.isFinite(speedParam) && speedParam >= 1 ? Math.min(speedParam, 3600) : DEFAULT_SPEED;
// The clock starts at the player's local time.
const now = new Date();
const sim = createSim(world, seed, {
  startMinute: now.getHours() * 60 + now.getMinutes(),
  timeScale,
  startEmpty: !params.has('movedIn'),
  emptyTicks: params.has('quick') ? 60 : undefined,
});

const $ = <T extends HTMLElement>(sel: string) => document.querySelector<T>(sel)!;
const canvas = $<HTMLCanvasElement>('#house');
const stage = $<HTMLDivElement>('#stage');
const bubble = $<HTMLDivElement>('#bubble');
const caption = $<HTMLDivElement>('#caption');
const status = $<HTMLParagraphElement>('#status');
const speechLog = $<HTMLDivElement>('#speech-log');
const debug = $<HTMLPreElement>('#debug');
const intro = $<HTMLFormElement>('#intro');
const introText = $<HTMLParagraphElement>('#intro-text');
const playerInput = $<HTMLInputElement>('#player-name');
const tenantInput = $<HTMLInputElement>('#tenant-name');
const talk = $<HTMLFormElement>('#talk');
const talkInput = $<HTMLInputElement>('#talk-input');
const actions = $<HTMLDivElement>('#actions');
const suppliesLine = $<HTMLParagraphElement>('#supplies');
const ctx = canvas.getContext('2d')!;
const { width, height } = house.def.size;

let showGraph = false;
let introDismissed = false;
let scale = 1;
const pending: Command[] = [];

function fitCanvas(): void {
  scale = Math.max(1, Math.floor(Math.min((innerWidth - 32) / width, (innerHeight - 260) / height)));
  canvas.style.width = `${width * scale}px`;
  canvas.style.height = `${height * scale}px`;
}
addEventListener('resize', fitCanvas);
fitCanvas();

const movedIn = () => sim.moveIn.stage === 'done';

function send(cmd: Command): void {
  if (movedIn()) pending.push(cmd);
}

function commandFrom(spec: string): Command {
  const [type, item] = spec.split(':');
  if (type === 'deliver') return { type: 'deliver', item: item as DeliveryItem };
  return { type: type as 'pat' | 'phone' | 'alarm' };
}

actions.addEventListener('click', (e) => {
  const button = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-command]');
  if (button) send(commandFrom(button.dataset.command!));
});

// Alt+letter shortcuts, by physical key so they work whatever Alt types on a Mac.
const SHORTCUTS: Record<string, string> = {
  KeyF: 'deliver:food',
  KeyW: 'deliver:water',
  KeyD: 'deliver:dogFood',
  KeyR: 'deliver:record',
  KeyB: 'deliver:book',
  KeyT: 'pat',
  KeyP: 'phone',
  KeyA: 'alarm',
};
addEventListener('keydown', (e) => {
  if (!e.altKey) return;
  const spec = SHORTCUTS[e.code];
  if (spec) {
    e.preventDefault();
    send(commandFrom(spec));
  } else if (e.code === 'KeyN') {
    e.preventDefault();
    debug.hidden = !debug.hidden;
  } else if (e.code === 'KeyG') {
    e.preventDefault();
    showGraph = !showGraph;
  }
});

talk.addEventListener('submit', (e) => {
  e.preventDefault();
  const text = talkInput.value.trim();
  if (!text) return;
  send({ type: 'say', text });
  talkInput.value = '';
});

/** Clicking on him is a pat on the head. */
canvas.addEventListener('click', (e) => {
  const p = sim.person;
  if (!p.present) return;
  const rect = canvas.getBoundingClientRect();
  const x = ((e.clientX - rect.left) / rect.width) * width;
  const y = ((e.clientY - rect.top) / rect.height) * height;
  if (Math.abs(x - p.x) <= 7 && y <= p.y + 2 && y >= p.y - 24) send({ type: 'pat' });
});
canvas.addEventListener('mousemove', (e) => {
  const p = sim.person;
  const rect = canvas.getBoundingClientRect();
  const x = ((e.clientX - rect.left) / rect.width) * width;
  const y = ((e.clientY - rect.top) / rect.height) * height;
  canvas.style.cursor = p.present && Math.abs(x - p.x) <= 7 && y <= p.y + 2 && y >= p.y - 24 ? 'pointer' : 'default';
});

intro.addEventListener('submit', (e) => {
  e.preventDefault();
  pending.push({ type: 'introduce', playerName: playerInput.value, tenantName: tenantInput.value });
  introDismissed = true;
  intro.hidden = true;
  talkInput.focus();
});

function clockText(ms: number): string {
  const minutes = Math.floor((ms % DAY_MS) / 60_000);
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

function describe(): string {
  const p = sim.person;
  const name = p.identity.name;
  switch (sim.moveIn.stage) {
    case 'empty':
      return 'The house is empty.';
    case 'exploring':
      return 'Someone is looking round the house.';
    case 'away':
      return 'He has gone. Will he be back?';
    case 'unpacking':
      return p.path.length > 0 ? `${name} is back, with a suitcase and a dog.` : `${name} is unpacking.`;
    case 'done':
      break;
  }
  if (!p.alive) return `${name} has died.`;
  if (p.path.length > 0) {
    const room = house.def.rooms.find((r) => r.id === house.nodes.get(p.path[p.path.length - 1]!)!.room)!;
    return `${name} is heading to the ${room.name.toLowerCase()}`;
  }
  const label = currentStep(sim, world)?.label;
  return label ? `${name} is ${label}` : `${name} is standing about`;
}

function showIntro(): void {
  const { person, dog } = sim;
  introText.textContent = `Your new lodger has moved in, with ${dog.identity.name} the dog. He says his name is ${person.identity.name}.`;
  tenantInput.placeholder = person.identity.name;
  intro.hidden = false;
  playerInput.focus();
}

let lastSpeechSeq = 0;
let lastKnockSeq = 0;
let captionUntil = 0;

function updateOverlays(px: number, py: number): void {
  const speech = sim.speech;
  if (speech && speech.seq !== lastSpeechSeq) {
    lastSpeechSeq = speech.seq;
    bubble.textContent = speech.text;
    const line = document.createElement('p');
    line.textContent = `${sim.person.identity.name}: ${speech.text}`;
    speechLog.append(line);
    while (speechLog.childElementCount > 5) speechLog.firstElementChild!.remove();
  }
  const talking = speech !== null && sim.tick < speech.untilTick && sim.person.present;
  bubble.hidden = !talking;
  if (talking) {
    bubble.style.left = `${px * scale}px`;
    bubble.style.top = `${(py - 26) * scale}px`;
  }

  const knock = sim.knock;
  if (knock && knock.seq !== lastKnockSeq) {
    lastKnockSeq = knock.seq;
    stage.classList.remove('knocking');
    void stage.offsetWidth; // restart the animation
    stage.classList.add('knocking');
    caption.textContent = '*knock knock*';
    captionUntil = sim.tick + 60;
  }
  if (sim.phoneRing && sim.tick < sim.phoneRing.untilTick) {
    caption.textContent = '*ring ring*';
    captionUntil = Math.max(captionUntil, sim.tick + 2);
  }
  caption.hidden = sim.tick >= captionUntil;
}

function updateControls(): void {
  const ready = movedIn() && sim.person.alive;
  for (const el of [...actions.querySelectorAll('button'), talkInput, talk.querySelector('button')!]) {
    (el as HTMLButtonElement | HTMLInputElement).disabled = !ready;
  }
  const s = sim.supplies;
  const text = `Fridge: ${s.food} meals, ${s.water} water · Dog food: ${s.dogFood} · ${s.records.length} record${s.records.length === 1 ? '' : 's'} · ${s.books} book${s.books === 1 ? '' : 's'}`;
  if (suppliesLine.textContent !== text) suppliesLine.textContent = text;
}

// Fixed-timestep loop: the sim only ever advances in whole ticks; rendering interpolates.
let last = performance.now();
let acc = 0;
const prev = { x: sim.person.x, y: sim.person.y, dx: sim.dog.x, dy: sim.dog.y };

function frame(now: number): void {
  acc += Math.min(now - last, 1000);
  last = now;
  while (acc >= TICK_MS) {
    prev.x = sim.person.x;
    prev.y = sim.person.y;
    prev.dx = sim.dog.x;
    prev.dy = sim.dog.y;
    step(sim, world, pending.splice(0));
    acc -= TICK_MS;
  }
  const alpha = acc / TICK_MS;
  const lerp = (a: number, b: number) => a + (b - a) * alpha;
  const { person: p, dog } = sim;
  const px = lerp(prev.x, p.x);
  const py = lerp(prev.y, p.y);

  ctx.imageSmoothingEnabled = false;
  drawHouse(ctx, house, (sim.clock.ms % DAY_MS) / HOUR_MS, showGraph);
  if (dog.present) {
    drawDog(ctx, dog.identity, lerp(prev.dx, dog.x), lerp(prev.dy, dog.y), dog.facing, dog.path.length > 0, dog.food > 50, sim.tick);
  }
  if (p.present && p.alive) {
    drawFigure(ctx, p.identity.look, {
      x: px,
      y: py,
      facing: p.facing,
      walking: p.path.length > 0,
      pose: p.activity?.doing ? (currentStep(sim, world)?.pose ?? 'stand') : 'stand',
      asleep: isAsleep(sim, world),
      carrying: p.carrying,
      humming: p.identity.quirks.includes('hummer'),
      tick: sim.tick,
    });
  }
  updateOverlays(px, py);
  updateControls();

  if (sim.playerName !== null && !intro.hidden) intro.hidden = true;
  if (movedIn() && sim.playerName === null && !introDismissed && intro.hidden && sim.knock) showIntro();

  // Only touch the live region when the text changes, not every frame.
  const text = `${clockText(sim.clock.ms)} · ${describe()}`;
  if (status.textContent !== text) status.textContent = text;

  if (!debug.hidden) {
    const id = p.identity;
    const bar = (v: number) => '█'.repeat(Math.round(v / 10)).padEnd(10, '·');
    debug.textContent = [
      ...NEED_IDS.map((n) => `${n.padEnd(8)}${bar(p.needs[n])} ${p.needs[n].toFixed(0)}`),
      `${'dog'.padEnd(8)}${bar(dog.food)} ${dog.food.toFixed(0)}`,
      `${'mood'.padEnd(8)}${bar(p.mood)} ${p.mood.toFixed(0)}`,
      `${'health'.padEnd(8)}${bar(p.health)} ${p.health.toFixed(0)}`,
      '',
      `${id.name}: ${Object.entries(id.traits).map(([k, v]) => `${k} ${v.toFixed(2)}`).join(', ')}`,
      `body clock ${id.chronotype > 0 ? '+' : ''}${id.chronotype.toFixed(1)}h, pace ${id.pace}, appetite ${id.appetite}`,
      `quirks: ${id.quirks.join(', ')} · likes ${id.favouriteMusic} and ${id.favouriteFood}`,
      `dog: ${dog.identity.name}, ${dog.identity.size} · records: ${sim.supplies.records.join(', ')}`,
      `player: ${sim.playerName ?? '?'} · seed ${seed} · speed ${timeScale}x · day ${Math.floor(sim.clock.ms / DAY_MS)}`,
    ].join('\n');
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
