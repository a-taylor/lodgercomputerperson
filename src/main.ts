import { drawFront, drawHouse, furnitureBounds, loadArt } from './render/canvas';
import { drawDogSprite, loadDogSheets } from './render/dogArt';
import { SoundDirector, type SoundSettings } from './audio/director';
import { createLighting, roomAt } from './render/lighting';
import { drawTenantSprite, loadTenantSheet, type TenantPose } from './render/tenantArt';
import { GAME_NAMES, type GameKind } from './sim/games';
import type { DeliveryItem } from './sim/interactions';
import { NEED_IDS } from './sim/needs';
import { catchUp, type AwaySummary } from './sim/away';
import { makeMemorial, type MemorialEntry } from './sim/memorial';
import { createSim, currentStep, DAY_MS, HOUR_MS, isAsleep, step, TICK_MS, timeScaleOf, type Command, type SimState } from './sim/sim';
import { defaultWorld } from './sim/world';
import { readSave, writeSave } from './storage/idb';
import { remoteModel, templateModel, withBreaker, type LanguageModel } from './llm/model';
import { makeSave, parseSave, SaveError, type SaveFile } from './storage/save';
import '@fontsource/pixelify-sans/400.css';
import '@fontsource/pixelify-sans/600.css';
import { h } from './ui/dom';
import { fillIcons, icon } from './ui/icons';
import { renderGame } from './ui/gamePanel';

const world = defaultWorld();
const { house } = world;
const params = new URLSearchParams(location.search);

// His day runs 30x faster than real time by default (a day lasts 48 minutes). The speed slider
// changes it while playing; ?speed= sets where it starts and is kept in step with the slider.
const SPEEDS = [1, 2, 5, 10, 20, 30, 60, 120, 300, 600];
const DEFAULT_SPEED = 30;
const speedParam = Math.round(Number(params.get('speed')));

function nearestSpeed(n: number): number {
  return SPEEDS.reduce((best, s) => (Math.abs(Math.log(s / n)) < Math.abs(Math.log(best / n)) ? s : best));
}

function randomSeed(): number {
  return (crypto.getRandomValues(new Uint32Array(1))[0]! % 999_999) + 1;
}

/** A brand-new home: an empty house, with a stranger due any minute. */
function newHome(seed: number, scale: number): SimState {
  const now = new Date();
  // ?hour=14 starts a new home at that time of day instead of the real time.
  const hour = Number(params.get('hour'));
  return createSim(world, seed, {
    startMinute: params.has('hour') && hour >= 0 && hour < 24 ? Math.floor(hour * 60) : now.getHours() * 60 + now.getMinutes(),
    timeScale: scale,
    startEmpty: !params.has('movedIn'),
    emptyTicks: params.has('quick') ? 60 : undefined,
  });
}

// Load the saved home if there is one (?fresh ignores it and starts again). A save that can't be
// read is left alone: this session won't autosave over it.
let saving = true;
let saveNotice = '';
let loaded: SaveFile | null = null;
if (!params.has('fresh')) {
  const raw = await readSave();
  if (raw !== null) {
    try {
      loaded = parseSave(raw, world);
    } catch (err) {
      saving = false;
      saveNotice = `Couldn't read your saved game (${err instanceof SaveError ? err.message : 'unknown error'}). Not saving, so it isn't overwritten.`;
    }
  }
}

const memorial: MemorialEntry[] = loaded?.memorial ?? [];
const sim: SimState = loaded
  ? loaded.state
  : newHome(Math.trunc(Number(params.get('seed'))) || randomSeed(), nearestSpeed(speedParam >= 1 ? speedParam : DEFAULT_SPEED));
const seed = sim.seed;
// Time passes while you're away, at his real pace. Under a minute isn't worth catching up.
const MIN_AWAY_MS = 60_000;
let away: AwaySummary | null = null;
if (loaded && Date.now() - loaded.lastSeen > MIN_AWAY_MS) away = catchUp(sim, world, Date.now() - loaded.lastSeen);
// If the tab was closed while slowed down for being idle, come back at the speed from before.
const IDLE_SPEED_KEY = 'lcp-speed-before-idle';
function speedBeforeIdle(): number | null {
  try {
    return Number(localStorage.getItem(IDLE_SPEED_KEY)) || null;
  } catch {
    return null;
  }
}
const timeScale = nearestSpeed(speedParam >= 1 ? speedParam : (speedBeforeIdle() ?? timeScaleOf(sim)));
if (timeScale !== timeScaleOf(sim)) step(sim, world, [{ type: 'setSpeed', timeScale }]);

const $ = <T extends HTMLElement>(sel: string) => document.querySelector<T>(sel)!;
const canvas = $<HTMLCanvasElement>('#house');
const stage = $<HTMLDivElement>('#stage');
const bubble = $<HTMLDivElement>('#bubble');
const dogBubble = $<HTMLDivElement>('#dog-bubble');
const caption = $<HTMLDivElement>('#caption');
const status = $<HTMLSpanElement>('#status');
// The clock sits outside the live region, so screen readers hear what he does, not every minute.
const clock = $<HTMLSpanElement>('#clock');
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
const inviteBar = $<HTMLDivElement>('#invite');
const inviteText = $<HTMLSpanElement>('#invite-text');
const gameSection = $<HTMLElement>('#game');
const gamesButton = $<HTMLButtonElement>('#games-button');
const gamePicker = $<HTMLDivElement>('#game-picker');
const lettersButton = $<HTMLButtonElement>('#letters-button');
const lettersLabel = lettersButton.querySelector<HTMLSpanElement>('.label')!;
const letterDialog = $<HTMLDialogElement>('#letter-dialog');
const letterHeading = $<HTMLHeadingElement>('#letter-heading');
const letterText = $<HTMLElement>('#letter-text');
const ctx = canvas.getContext('2d')!;
fillIcons();
const { width, height } = house.def.size;

let showGraph = false;
let introDismissed = false;
let scale = 1;
const pending: Command[] = [];
const art = await loadArt();
const lighting = createLighting(house, art);

// Sound: off until the player turns it on. The choice is remembered in this browser.
const SOUND_KEY = 'lcp-sound';
function loadSoundSettings(): SoundSettings {
  const settings: SoundSettings = { muted: true, volume: 0.6, captions: false };
  try {
    Object.assign(settings, JSON.parse(localStorage.getItem(SOUND_KEY) ?? '{}'));
  } catch {
    // Unreadable or blocked storage: keep the defaults.
  }
  return settings;
}
const sound = new SoundDirector(loadSoundSettings());
function saveSoundSettings(): void {
  try {
    localStorage.setItem(SOUND_KEY, JSON.stringify(sound.settings));
  } catch {
    // Not remembered; fine.
  }
}
const dogSheets = await loadDogSheets();
const tenantSheet = await loadTenantSheet();
// ?debug exposes the running game to the console, for poking at it while developing.
if (params.has('debug')) Object.assign(window, { lcp: { sim, world } });

// The house fills its area. Whole-number scales keep pixels perfectly even, so use one when it
// fills most of the space; otherwise scale in between (at 3x and up the unevenness is hard to see).
// ?zoom=4&x=120&y=80 shows a close-up of part of the house instead, for checking pixels (dev).
const zoom = Number(params.get('zoom')) || 0;
const frameBox = $<HTMLDivElement>('#frame');
function fitCanvas(): void {
  if (zoom) {
    scale = zoom;
    stage.style.overflow = 'hidden';
    stage.style.width = `${Math.min(frameBox.clientWidth, width * zoom)}px`;
    stage.style.height = `${Math.min(Math.max(frameBox.clientHeight, 300), height * zoom)}px`;
    canvas.style.marginLeft = `${-(Number(params.get('x')) || 0) * zoom}px`;
    canvas.style.marginTop = `${-(Number(params.get('y')) || 0) * zoom}px`;
  } else {
    // On a narrow screen the frame is as tall as we make it, so fit by width alone.
    const stacked = getComputedStyle(frameBox).flexGrow === '0';
    // Leave room for the wooden frame round the canvas.
    const border = stage.offsetWidth - stage.clientWidth + 4;
    const fit = Math.min((frameBox.clientWidth - border) / width, stacked ? Infinity : (frameBox.clientHeight - border) / height);
    const whole = Math.floor(fit);
    scale = Math.max(1, whole >= 1 && whole >= fit * 0.85 ? whole : fit);
  }
  canvas.style.width = `${Math.floor(width * scale)}px`;
  canvas.style.height = `${Math.floor(height * scale)}px`;
}
new ResizeObserver(fitCanvas).observe(frameBox);
fitCanvas();

const fullscreenButton = $<HTMLButtonElement>('#fullscreen');
function toggleFullscreen(): void {
  if (document.fullscreenElement) void document.exitFullscreen();
  else void document.documentElement.requestFullscreen?.();
}
fullscreenButton.addEventListener('click', toggleFullscreen);
document.addEventListener('fullscreenchange', () => {
  fullscreenButton.setAttribute('aria-label', document.fullscreenElement ? 'Leave full screen' : 'Full screen');
});

const movedIn = () => sim.moveIn.stage === 'done';

function send(cmd: Command): void {
  if (movedIn()) pending.push(cmd);
}

function commandFrom(spec: string): Command {
  const [type, item] = spec.split(':');
  if (type === 'deliver') return { type: 'deliver', item: item as DeliveryItem };
  return { type: type as 'pat' | 'phone' | 'alarm' };
}

function sendSpec(spec: string): void {
  if (spec === 'alarm' && movedIn()) sound.cue('alarm');
  send(commandFrom(spec));
}

actions.addEventListener('click', (e) => {
  const button = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-command]');
  if (button) sendSpec(button.dataset.command!);
});

const soundToggle = $<HTMLButtonElement>('#sound-toggle');
const volumeInput = $<HTMLInputElement>('#volume-input');
const captionsInput = $<HTMLInputElement>('#captions-input');

// Reduced motion follows the OS until the player chooses; the choice is remembered.
const MOTION_KEY = 'lcp-motion';
const reduceMotionInput = $<HTMLInputElement>('#reduce-motion-input');

// Understanding messy requests with a language model: opt-in, and only offered when the build
// knows where the Worker is (VITE_LCP_API_URL). Off, he's "confused" exactly as before.
const API_URL = import.meta.env.VITE_LCP_API_URL as string | undefined;
const MODEL_KEY = 'lcp-model';
const modelInput = $<HTMLInputElement>('#model-input');
let modelOn = !!API_URL && recall(MODEL_KEY) === 'on';
const remote = API_URL ? withBreaker(remoteModel({ url: API_URL })) : null;
const model = (): LanguageModel => (modelOn && remote ? remote : templateModel);
$<HTMLElement>('#model-setting').hidden = !API_URL;
modelInput.checked = modelOn;
modelInput.addEventListener('change', () => {
  modelOn = modelInput.checked;
  remember(MODEL_KEY, modelOn ? 'on' : 'off');
});
/** The `thinking` line already sent to the model, so each is asked about once. */
let askedThinking: number | null = null;
function askModelIfThinking(): void {
  const thinking = sim.thinking;
  if (!thinking || thinking.id === askedThinking) return;
  askedThinking = thinking.id;
  void model()
    .intents(thinking.text, { dogName: sim.dog.identity.name })
    .then((items) => pending.push({ type: 'understood', id: thinking.id, answer: items && { items } }));
}

// Letters in his own words: also opt-in. While this is on, the sim asks (letterAsk) when he sits
// down to write, so the words are usually ready before he's done; the template stands otherwise.
const LETTERS_KEY = 'lcp-model-letters';
const lettersInput = $<HTMLInputElement>('#model-letters-input');
let lettersOn = !!API_URL && recall(LETTERS_KEY) === 'on';
lettersInput.checked = lettersOn;
if (!!sim.modelLetters !== lettersOn) pending.push({ type: 'modelLetters', on: lettersOn });
lettersInput.addEventListener('change', () => {
  lettersOn = lettersInput.checked;
  remember(LETTERS_KEY, lettersOn ? 'on' : 'off');
  pending.push({ type: 'modelLetters', on: lettersOn });
});
/** The letter already sent to the model, so each is asked about once. */
let askedLetter: number | null = null;
function askModelForLetter(): void {
  const ask = sim.letterAsk;
  // Asked once each; one already answered (kept for the letter he's typing) needs nothing more.
  if (!ask || ask.id === askedLetter || ask.text !== undefined) return;
  askedLetter = ask.id;
  const { id, facts, who } = ask;
  const letters = lettersOn && remote ? remote : templateModel;
  void letters.letter({ facts, who }).then((text) => pending.push({ type: 'letterText', id, text }));
}

function recall(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null; // Storage blocked: the default.
  }
}
function remember(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Not remembered; fine.
  }
}
let reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
try {
  const saved = localStorage.getItem(MOTION_KEY);
  if (saved === 'reduce' || saved === 'full') reduceMotion = saved === 'reduce';
} catch {
  // Storage blocked: follow the OS.
}
function applyMotion(): void {
  document.documentElement.classList.toggle('reduce-motion', reduceMotion);
  reduceMotionInput.checked = reduceMotion;
}
applyMotion();
reduceMotionInput.addEventListener('change', () => {
  reduceMotion = reduceMotionInput.checked;
  applyMotion();
  try {
    localStorage.setItem(MOTION_KEY, reduceMotion ? 'reduce' : 'full');
  } catch {
    // Not remembered; fine.
  }
});
function showSoundControls(): void {
  const on = !sound.settings.muted;
  soundToggle.innerHTML = icon(on ? 'soundOn' : 'soundOff');
  soundToggle.setAttribute('aria-label', on ? 'Sound is on' : 'Sound is off');
  soundToggle.setAttribute('aria-pressed', String(on));
  volumeInput.hidden = !on;
  volumeInput.value = String(Math.round(sound.settings.volume * 100));
  captionsInput.checked = sound.settings.captions;
}
function toggleSound(): void {
  sound.setMuted(!sound.settings.muted);
  showSoundControls();
  saveSoundSettings();
}
showSoundControls();
soundToggle.addEventListener('click', toggleSound);
volumeInput.addEventListener('input', () => {
  sound.setVolume(Number(volumeInput.value) / 100);
  saveSoundSettings();
});
captionsInput.addEventListener('change', () => {
  sound.settings.captions = captionsInput.checked;
  saveSoundSettings();
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
    sendSpec(spec);
  } else if (e.code === 'KeyM') {
    e.preventDefault();
    toggleSound();
  } else if (e.code === 'KeyC') {
    e.preventDefault();
    toggleGamePicker();
  } else if (e.code === 'KeyL') {
    e.preventDefault();
    openLetters();
  } else if (e.code === 'Enter') {
    e.preventDefault();
    toggleFullscreen();
  } else if (e.code === 'KeyN') {
    e.preventDefault();
    debug.hidden = !debug.hidden;
  } else if (e.code === 'KeyG') {
    e.preventDefault();
    showGraph = !showGraph;
  }
});

// Games: pick one to ask him, or answer when he asks you.
function toggleGamePicker(): void {
  gamePicker.hidden = !gamePicker.hidden;
  gamesButton.setAttribute('aria-expanded', String(!gamePicker.hidden));
}
gamesButton.addEventListener('click', toggleGamePicker);
gamePicker.addEventListener('click', (e) => {
  const button = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-game]');
  if (!button) return;
  send({ type: 'invite', game: (button.dataset.game || undefined) as GameKind | undefined });
  toggleGamePicker();
});
inviteBar.addEventListener('click', (e) => {
  const button = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-answer]');
  if (button) send({ type: 'answerInvite', accept: button.dataset.answer === 'yes' });
});

let shownGame: object | null = null;
let shownVersion = -1;
let closedGame: object | null = null;

function updateGame(): void {
  const g = sim.game;
  const visible = g !== null && g !== closedGame;
  gameSection.hidden = !visible;
  if (!visible || (g === shownGame && g.version === shownVersion)) return;
  shownGame = g;
  shownVersion = g.version;
  renderGame(gameSection, g, {
    move: (action) => send({ type: 'game', action }),
    close: () => {
      closedGame = g;
      gameSection.hidden = true;
    },
    himName: () => sim.person.identity.name,
  });
}

// Letters: newest first when opened, with older and newer to page through.
let letterIndex = -1;

function openLetters(atId?: number): void {
  if (sim.letters.length === 0) {
    letterHeading.textContent = 'No letters yet';
    letterText.textContent = `${sim.person.identity.name} hasn't written to you yet. Give him a day or two, or ask him to write.`;
  }
  const firstUnread = sim.letters.findIndex((l) => !l.read);
  const at = atId === undefined ? -1 : sim.letters.findIndex((l) => l.id === atId);
  letterIndex = at >= 0 ? at : firstUnread >= 0 ? firstUnread : sim.letters.length - 1;
  showLetter();
  if (!letterDialog.open) letterDialog.showModal();
}

function showLetter(): void {
  const letter = sim.letters[letterIndex];
  $<HTMLButtonElement>('#letter-prev').disabled = letterIndex <= 0;
  $<HTMLButtonElement>('#letter-next').disabled = letterIndex >= sim.letters.length - 1;
  if (!letter) return;
  const day = Math.floor(letter.ms / DAY_MS) + 1;
  letterHeading.textContent = `Letter ${letterIndex + 1} of ${sim.letters.length} · day ${day}, ${clockText(letter.ms)}`;
  letterText.textContent = letter.text;
  if (!letter.read) pending.push({ type: 'readLetter', id: letter.id });
}

lettersButton.addEventListener('click', () => openLetters());
$<HTMLButtonElement>('#letter-prev').addEventListener('click', () => (letterIndex--, showLetter()));
$<HTMLButtonElement>('#letter-next').addEventListener('click', () => (letterIndex++, showLetter()));
$<HTMLButtonElement>('#letter-close').addEventListener('click', () => letterDialog.close());

// Speed slider: a log-ish ladder of speeds, so one notch is always a noticeable change.
const speedInput = $<HTMLInputElement>('#speed-input');
const speedOutput = $<HTMLOutputElement>('#speed-output');
speedInput.max = String(SPEEDS.length - 1);
speedInput.value = String(SPEEDS.indexOf(timeScale));

function dayLength(scale: number): string {
  if (scale === 1) return 'real time';
  const minutes = (24 * 60) / scale;
  if (minutes >= 60) return `a day takes ${+(minutes / 60).toFixed(1)} h`;
  if (minutes >= 1) return `a day takes ${+minutes.toFixed(1)} min`;
  return `a day takes ${Math.round(minutes * 60)} s`;
}

function showSpeed(scale: number): void {
  const note = idleFrom !== null ? ' (you were away)' : '';
  speedOutput.textContent = `${scale}× · ${dayLength(scale)}${note}`;
  speedInput.setAttribute('aria-valuetext', `${scale} times, ${dayLength(scale)}${note}`);
}

function setSpeed(scale: number): void {
  // Straight into the queue: speed works during moving in too, and isn't company for him.
  pending.push({ type: 'setSpeed', timeScale: scale });
  speedInput.value = String(SPEEDS.indexOf(scale));
  showSpeed(scale);
}

speedInput.addEventListener('input', () => {
  const scale = SPEEDS[Number(speedInput.value)]!;
  idleFrom = null;
  forgetIdleSpeed();
  setSpeed(scale);
  params.set('speed', String(scale));
  history.replaceState(null, '', `?${params}`);
});

// Left alone with the tab open (overnight, say), time drops to real time, the same pace as
// when the tab is closed, so he isn't left for days on end. Any click or key brings the speed
// back. ?idle=60 sets the wait in seconds (dev).
const IDLE_MS = (Number(params.get('idle')) || 30 * 60) * 1000;
let lastInputAt = performance.now();
/** The speed to go back to, while slowed down for being idle. */
let idleFrom: number | null = null;
function forgetIdleSpeed(): void {
  try {
    localStorage.removeItem(IDLE_SPEED_KEY);
  } catch {
    // Nothing to forget.
  }
}
function noticeInput(): void {
  lastInputAt = performance.now();
  if (idleFrom === null) return;
  const scale = idleFrom;
  idleFrom = null;
  forgetIdleSpeed();
  setSpeed(scale);
}
for (const type of ['pointerdown', 'keydown', 'wheel', 'touchstart']) addEventListener(type, noticeInput, { capture: true, passive: true });
// Coming back to the tab counts as being here.
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) lastInputAt = performance.now();
});
setInterval(() => {
  if (idleFrom !== null || document.hidden || performance.now() - lastInputAt < IDLE_MS) return;
  const scale = timeScaleOf(sim);
  if (scale <= 1) return;
  idleFrom = scale;
  try {
    localStorage.setItem(IDLE_SPEED_KEY, String(scale));
  } catch {
    // It comes back at real time instead; fine.
  }
  setSpeed(1);
}, 5000);
showSpeed(timeScale);
forgetIdleSpeed();

talk.addEventListener('submit', (e) => {
  e.preventDefault();
  const text = talkInput.value.trim();
  if (!text) return;
  send({ type: 'say', text, askModel: modelOn });
  talkInput.value = '';
});

// Clicking in the house: pat him, make the dog bark, or use a piece of furniture (the same as
// the buttons in the panel).
interface Hotspot {
  label: string;
  act: () => void;
}
const FURNITURE_ACTIONS: Record<string, Hotspot> = {
  fridge: { label: 'Fridge: deliver food', act: () => sendSpec('deliver:food') },
  teapot: { label: 'Teapot: deliver water', act: () => sendSpec('deliver:water') },
  mug: { label: 'Mug: deliver water', act: () => sendSpec('deliver:water') },
  'dog-bowl': { label: 'Dog bowl: deliver dog food', act: () => sendSpec('deliver:dogFood') },
  'record-player': { label: 'Record player: deliver a record', act: () => sendSpec('deliver:record') },
  bookshelf: { label: 'Bookshelf: deliver a book', act: () => sendSpec('deliver:book') },
  'bookshelf-study': { label: 'Bookshelf: deliver a book', act: () => sendSpec('deliver:book') },
  phone: { label: 'Phone: ring him', act: () => sendSpec('phone') },
  clock: { label: 'Clock: set off the alarm', act: () => sendSpec('alarm') },
  'games-cabinet': { label: 'Games cabinet: ask him to play', act: () => toggleGamePicker() },
  'front-door': { label: 'Front door: read his letters', act: () => openLetters() },
};
const furnitureSpots = house.def.furniture.flatMap((f) => {
  const spot = FURNITURE_ACTIONS[f.id];
  const box = spot && furnitureBounds(house, art, f);
  return box ? [{ ...spot, box }] : [];
});
let woofUntil = 0;

function hotspotAt(e: MouseEvent): Hotspot | null {
  const rect = canvas.getBoundingClientRect();
  const x = ((e.clientX - rect.left) / rect.width) * width;
  const y = ((e.clientY - rect.top) / rect.height) * height;
  const { person: p, dog } = sim;
  if (p.present && Math.abs(x - p.x) <= 7 && y <= p.y + 2 && y >= p.y - 24) return { label: `Pat ${p.identity.name}`, act: () => send({ type: 'pat' }) };
  if (dog.present && Math.abs(x - dog.x) <= 10 && y <= dog.y + 1 && y >= dog.y - 14) {
    return { label: `${dog.identity.name}`, act: woof };
  }
  if (!movedIn() || !p.alive) return null;
  return furnitureSpots.find(({ box: b }) => x >= b.x && x < b.x + b.w && y >= b.y && y < b.y + b.h) ?? null;
}

function woof(): void {
  sound.woof(sim.dog.identity.size);
  woofUntil = performance.now() + 1200;
  logLine(`${sim.dog.identity.name} barks: Woof!`);
}

canvas.addEventListener('click', (e) => hotspotAt(e)?.act());
canvas.addEventListener('mousemove', (e) => {
  const spot = hotspotAt(e);
  canvas.style.cursor = spot ? 'pointer' : 'default';
  canvas.title = spot?.label ?? '';
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
  const label = currentStep(sim, world)?.label;
  let now = label ? `${name} is ${label}` : `${name} is standing about`;
  if (p.path.length > 0) {
    const room = house.def.rooms.find((r) => r.id === house.nodes.get(p.path[p.path.length - 1]!)!.room)!;
    now = `${name} is heading to the ${room.name.toLowerCase()}`;
  }
  return sim.queue.length > 0 ? `${now} · Next: ${sim.queue.map(queuedNoun).join(', then ')}` : now;
}

function queuedNoun(q: SimState['queue'][number]): string {
  return q.game ? GAME_NAMES[q.game] : world.activities.byId.get(q.activity)!.noun;
}

function showIntro(): void {
  const { person, dog } = sim;
  introText.textContent = `Your new lodger has moved in, with ${dog.identity.name} the dog. He says his name is ${person.identity.name}.`;
  tenantInput.placeholder = person.identity.name;
  intro.hidden = false;
  playerInput.focus();
}

// Start from what was saved, so a loaded game doesn't replay an old knock or line.
let lastSpeechSeq = sim.speech?.seq ?? 0;
let lastKnockSeq = sim.knock?.seq ?? 0;
let captionUntil = 0;
let soundCaption: string | null = null;
let wasRinging = false;

/** Adds a line to the hidden log that screen readers announce. */
function logLine(text: string): void {
  const line = document.createElement('p');
  line.textContent = text;
  speechLog.append(line);
  while (speechLog.childElementCount > 5) speechLog.firstElementChild!.remove();
}

function updateOverlays(px: number, py: number, dx: number, dy: number): void {
  const barking = sim.dog.present && performance.now() < woofUntil;
  dogBubble.hidden = !barking;
  if (barking) {
    dogBubble.style.left = `${dx * scale}px`;
    dogBubble.style.top = `${(dy - 18) * scale}px`;
  }

  const speech = sim.speech;
  if (speech && speech.seq !== lastSpeechSeq) {
    lastSpeechSeq = speech.seq;
    bubble.textContent = speech.text;
    logLine(`${sim.person.identity.name}: ${speech.text}`);
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
    logLine(`${sim.person.identity.name} knocks on the glass.`);
  }
  const ringing = sim.phoneRing !== null && sim.tick < sim.phoneRing.untilTick;
  if (ringing && !wasRinging) logLine('The phone is ringing.');
  wasRinging = ringing;
  if (ringing) {
    caption.textContent = '*ring ring*';
    captionUntil = Math.max(captionUntil, sim.tick + 2);
  }
  if (sim.tick < captionUntil) caption.hidden = false;
  else if (soundCaption) {
    if (caption.textContent !== soundCaption) caption.textContent = soundCaption;
    caption.hidden = false;
  } else caption.hidden = true;
}

function updateControls(): void {
  const ready = movedIn() && sim.person.alive;
  for (const el of [...actions.querySelectorAll('button'), talkInput, talk.querySelector('button')!]) {
    (el as HTMLButtonElement | HTMLInputElement).disabled = !ready;
  }
  gamesButton.disabled = !ready;
  lettersButton.disabled = false;
  const unread = sim.letters.filter((l) => !l.read).length;
  const label = unread > 0 ? `Letters (${unread})` : 'Letters';
  if (lettersLabel.textContent !== label) lettersLabel.textContent = label;
  lettersButton.classList.toggle('unread', unread > 0);

  const inv = sim.invitation;
  const inviting = ready && inv !== null && inv.untilMs > sim.clock.ms && !isAsleep(sim, world);
  inviteBar.hidden = !inviting;
  if (inviting) {
    const text = `${sim.person.identity.name} wants to play ${GAME_NAMES[inv.game]}.`;
    if (inviteText.textContent !== text) inviteText.textContent = text;
  }

  const s = sim.supplies;
  const text = `Fridge: ${s.food} meals, ${s.water} water · Dog food: ${s.dogFood} · ${s.records.length} record${s.records.length === 1 ? '' : 's'} · ${s.books} book${s.books === 1 ? '' : 's'}`;
  if (suppliesLine.textContent !== text) suppliesLine.textContent = text;
  updateNeeds();
}

// How he's doing: a bar for each need, and mood. Only touched when a bar changes.
const NEED_LABELS: Record<(typeof NEED_IDS)[number] | 'mood', string> = {
  food: 'Food',
  water: 'Water',
  energy: 'Energy',
  hygiene: 'Clean',
  fun: 'Fun',
  mood: 'Mood',
};
const needsBox = $<HTMLDivElement>('#needs');
const needBars = ([...NEED_IDS, 'mood'] as const).map((id) => {
  const segments = Array.from({ length: 10 }, () => h('span'));
  const labelId = `need-${id}`;
  const bar = h('div', { class: 'bar', role: 'meter', 'aria-labelledby': labelId, 'aria-valuemin': '0', 'aria-valuemax': '100' }, ...segments);
  needsBox.append(h('span', { id: labelId }, NEED_LABELS[id]), bar);
  return { id, bar, segments, shown: -1 };
});
function updateNeeds(): void {
  const p = sim.person;
  needsBox.classList.toggle('away', !(p.present && p.alive));
  for (const n of needBars) {
    const value = Math.round(n.id === 'mood' ? p.mood : p.needs[n.id]);
    if (value === n.shown) continue;
    n.shown = value;
    const lit = Math.ceil(value / 10);
    n.segments.forEach((s, i) => s.classList.toggle('on', i < lit));
    n.bar.dataset.level = value >= 50 ? 'good' : value >= 25 ? 'ok' : 'bad';
    n.bar.setAttribute('aria-valuenow', String(value));
  }
}

// Saving: autosave every few seconds and whenever the tab is hidden. Hidden counts as away:
// coming back catches up, just like reopening the tab.
const saveStatus = $<HTMLParagraphElement>('#save-status');
const farewell = $<HTMLElement>('#farewell');
const farewellText = $<HTMLParagraphElement>('#farewell-text');
const memorialDialog = $<HTMLDialogElement>('#memorial-dialog');
const memorialList = $<HTMLDivElement>('#memorial-list');
const importFile = $<HTMLInputElement>('#import-file');
const settingsDialog = $<HTMLDialogElement>('#settings-dialog');
$<HTMLButtonElement>('#settings-button').addEventListener('click', () => settingsDialog.showModal());
$<HTMLButtonElement>('#settings-close').addEventListener('click', () => settingsDialog.close());

function showSaveStatus(): void {
  saveStatus.textContent =
    saveNotice || (saving ? 'Saved automatically in this browser. Time passes for him while you are away.' : 'Saving is off in this browser.');
}
showSaveStatus();

async function save(): Promise<void> {
  if (!saving) return;
  if (!(await writeSave(makeSave(sim, memorial, Date.now())))) {
    saving = false;
    saveNotice = "This browser won't let the game save (private window?). He'll be forgotten when you close the tab.";
    showSaveStatus();
  }
}
setInterval(save, 15_000);
addEventListener('pagehide', () => void save());

let hiddenAt: number | null = null;
document.addEventListener('visibilitychange', () => {
  sound.setHidden(document.hidden);
  if (document.hidden) {
    hiddenAt = Date.now();
    void save();
    return;
  }
  if (hiddenAt !== null && Date.now() - hiddenAt > MIN_AWAY_MS) welcomeBack(catchUp(sim, world, Date.now() - hiddenAt));
  hiddenAt = null;
  last = performance.now();
  acc = 0;
});

/** After an absence: no replaying knocks that happened to an empty room, and the letter is waiting. */
function welcomeBack(summary: AwaySummary): void {
  lastKnockSeq = sim.knock?.seq ?? 0;
  prev.x = sim.person.x;
  prev.y = sim.person.y;
  prev.dx = sim.dog.x;
  prev.dy = sim.dog.y;
  if (summary.letter) {
    // A letter the model is still rewording: say so, and open it when the words land (or don't).
    if (sim.letterAsk?.letter === summary.letter.id) waitForLetter(summary.letter.id);
    else openLetters(summary.letter.id);
  }
  void save();
}

/** The away letter waiting on the model, shown as "finishing" until its words arrive. */
let awayLetterId: number | null = null;
function waitForLetter(id: number): void {
  awayLetterId = id;
  letterHeading.textContent = `${sim.person.identity.name} is just finishing a letter…`;
  letterText.textContent = '';
  $<HTMLButtonElement>('#letter-prev').disabled = true;
  $<HTMLButtonElement>('#letter-next').disabled = true;
  if (!letterDialog.open) letterDialog.showModal();
}
function showAwayLetterWhenReady(): void {
  if (awayLetterId === null || sim.letterAsk?.letter === awayLetterId) return;
  const id = awayLetterId;
  awayLetterId = null;
  if (letterDialog.open) openLetters(id);
}
letterDialog.addEventListener('close', () => (awayLetterId = null));

// "He's written to you": a browser notification, if you asked for one, while the game is running
// in a window you're not looking at. It waits for the model's words, so the letter is final.
const NOTIFY_KEY = 'lcp-notify';
const notifyInput = $<HTMLInputElement>('#notify-input');
const notifyNote = $<HTMLElement>('#notify-note');
const canNotify = 'Notification' in window;
$<HTMLElement>('#notify-setting').hidden = !canNotify;
let notifyOn = canNotify && recall(NOTIFY_KEY) === 'on' && Notification.permission === 'granted';
notifyInput.checked = notifyOn;
notifyInput.addEventListener('change', async () => {
  notifyOn = notifyInput.checked;
  notifyNote.textContent = '';
  if (notifyOn && Notification.permission !== 'granted') {
    const answer = await Notification.requestPermission();
    if (answer !== 'granted') {
      notifyOn = notifyInput.checked = false;
      notifyNote.textContent = 'Your browser said no. You can allow notifications for this page in its site settings.';
    }
  }
  remember(NOTIFY_KEY, notifyOn ? 'on' : 'off');
});
/** Newest letter already told about (or there when the game started). */
let notifiedLetter = sim.letters[sim.letters.length - 1]?.id ?? 0;
function notifyNewLetter(): void {
  const newest = sim.letters[sim.letters.length - 1];
  if (!newest || newest.id <= notifiedLetter || sim.letterAsk?.letter === newest.id) return;
  notifiedLetter = newest.id;
  if (!notifyOn || newest.read || (document.hasFocus() && !document.hidden)) return;
  const note = new Notification(`${sim.person.identity.name} has written you a letter`, { body: 'Open the game to read it.', tag: 'lcp-letter' });
  note.addEventListener('click', () => {
    window.focus();
    openLetters(newest.id);
    note.close();
  });
}

function daysPhrase(days: number): string {
  return days < 1 ? 'less than a day' : days === 1 ? 'a day' : `${days} days`;
}

// When he dies: a farewell, a place in the memorial, and a new tenant if you want one.
function updateFarewell(): void {
  const dead = !sim.person.alive;
  farewell.hidden = !dead;
  if (!dead) return;
  const days = Math.max(0, Math.floor((sim.clock.ms - (sim.settledMs ?? sim.clock.ms)) / DAY_MS));
  const text = `${sim.person.identity.name} has died. He lived here for ${daysPhrase(days)}, with ${sim.dog.identity.name}.`;
  if (farewellText.textContent !== text) farewellText.textContent = text;
}

$<HTMLButtonElement>('#new-tenant').addEventListener('click', async () => {
  memorial.push(makeMemorial(sim, Date.now()));
  const next = newHome(randomSeed(), timeScaleOf(sim));
  saving = false; // stop the old tenant being written back over the new one
  await writeSave(makeSave(next, memorial, Date.now()));
  location.href = location.pathname;
});

function openMemorial(): void {
  // The current tenant, if he has died, is remembered here too before you move someone new in.
  const entries = sim.person.alive ? memorial : [...memorial, makeMemorial(sim, Date.now())];
  memorialList.replaceChildren(
    ...(entries.length === 0
      ? [h('p', {}, 'Nobody has died here. Long may it last.')]
      : [...entries].reverse().map((e) =>
          h(
            'article',
            {},
            h('h3', {}, `${e.name} and ${e.dogName}`),
            h(
              'p',
              {},
              `Lived here ${daysPhrase(e.daysLived)} · ${e.letters} letter${e.letters === 1 ? '' : 's'} · died ${new Date(e.diedAt).toLocaleDateString()}`,
            ),
            e.lastLetter ? h('details', {}, h('summary', {}, 'His last letter'), h('pre', {}, e.lastLetter)) : null,
          ),
        )),
  );
  memorialDialog.showModal();
}
for (const button of document.querySelectorAll<HTMLButtonElement>('.open-memorial')) button.addEventListener('click', openMemorial);
$<HTMLButtonElement>('#memorial-close').addEventListener('click', () => memorialDialog.close());

// Export and import: the save as a small JSON file.
$<HTMLButtonElement>('#export-save').addEventListener('click', () => {
  const file = makeSave(sim, memorial, Date.now());
  const blob = new Blob([JSON.stringify(file, null, 1)], { type: 'application/json' });
  const a = h('a', { href: URL.createObjectURL(blob), download: `lodger-${sim.person.identity.name.toLowerCase()}-${new Date().toISOString().slice(0, 10)}.json` });
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
});
$<HTMLButtonElement>('#import-save').addEventListener('click', () => importFile.click());
importFile.addEventListener('change', async () => {
  const chosen = importFile.files?.[0];
  importFile.value = '';
  if (!chosen) return;
  try {
    const file = parseSave(await chosen.text(), world);
    const who = file.state.person.identity.name;
    if (!confirm(`Replace ${sim.person.identity.name} with ${who} from this file? ${sim.person.identity.name} will be gone unless you've exported him.`)) return;
    saving = false;
    await writeSave(file);
    location.href = location.pathname;
  } catch (err) {
    alert(err instanceof SaveError ? err.message : "Couldn't read that file.");
  }
});

// Fixed-timestep loop: the sim only ever advances in whole ticks; rendering interpolates.
let last = performance.now();
let acc = 0;
const prev = { x: sim.person.x, y: sim.person.y, dx: sim.dog.x, dy: sim.dog.y };
if (away) welcomeBack(away);

function frame(now: number): void {
  const dt = Math.min(now - last, 1000);
  acc += dt;
  last = now;
  while (acc >= TICK_MS) {
    prev.x = sim.person.x;
    prev.y = sim.person.y;
    prev.dx = sim.dog.x;
    prev.dy = sim.dog.y;
    step(sim, world, pending.splice(0));
    acc -= TICK_MS;
  }
  askModelIfThinking();
  askModelForLetter();
  showAwayLetterWhenReady();
  notifyNewLetter();
  const alpha = acc / TICK_MS;
  const lerp = (a: number, b: number) => a + (b - a) * alpha;
  const { person: p, dog } = sim;
  const px = lerp(prev.x, p.x);
  const py = lerp(prev.y, p.y);

  ctx.imageSmoothingEnabled = false;
  const hour = (sim.clock.ms % DAY_MS) / HOUR_MS;
  // Reduced motion: furniture holds still (no fire flicker).
  drawHouse(ctx, house, art, hour, reduceMotion ? 0 : sim.tick, showGraph);
  // The dog comes already outlined from its pack; the tenant gets the outline added.
  if (dog.present) {
    drawDogSprite(ctx, dogSheets, dog.identity.breed, {
      x: lerp(prev.dx, dog.x),
      y: lerp(prev.dy, dog.y),
      facing: dog.facing,
      walking: dog.path.length > 0,
      stillTicks: dog.stillTicks,
      tick: sim.tick,
    });
  }
  if (p.present && p.alive) {
    const pose = p.activity?.doing ? (currentStep(sim, world)?.pose ?? 'stand') : 'stand';
    const using = house.def.furniture.find((f) => f.use === p.at);
    // Sitting in the bath: lower him in, then draw the tub's front over him.
    const inside = pose === 'sit' && p.path.length === 0 && using?.sitIn ? using : null;
    // Sitting in a chair: up on the seat, facing out.
    const seat = pose === 'sit' && p.path.length === 0 ? using?.seat : undefined;
    const figure: TenantPose = {
      x: px + (seat?.dx ?? 0),
      y: py - (inside?.sitIn!.seatHeight ?? seat?.height ?? 0),
      facing: seat?.facing ?? p.facing,
      walking: p.path.length > 0,
      pose,
      lie: using?.lie,
      bare: inside !== null,
      asleep: isAsleep(sim, world),
      carrying: p.carrying,
      humming: p.identity.quirks.includes('hummer'),
      sick: p.sick,
      tick: sim.tick,
    };
    drawTenantSprite(ctx, tenantSheet, p.identity.look, figure);
    if (inside) drawFront(ctx, house, art, inside);
  }
  // He switches the light on in whatever room he's awake in.
  const awake = p.present && p.alive && !isAsleep(sim, world);
  // Reduced motion: lights switch rather than fade.
  lighting.draw(ctx, hour, awake ? roomAt(house, px, py) : null, reduceMotion ? Infinity : dt);
  soundCaption = sound.update(sim, world, px, py);
  updateOverlays(px, py, lerp(prev.dx, dog.x), lerp(prev.dy, dog.y));
  updateControls();
  updateGame();
  updateFarewell();

  if (sim.playerName !== null && !intro.hidden) intro.hidden = true;
  if (movedIn() && sim.playerName === null && !introDismissed && intro.hidden && sim.knock) showIntro();

  // Only touch the live region when the text changes, not every frame.
  const time = clockText(sim.clock.ms);
  if (clock.textContent !== time) clock.textContent = time;
  const text = describe();
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
      `player: ${sim.playerName ?? '?'} · seed ${seed} · speed ${timeScaleOf(sim)}x · day ${Math.floor(sim.clock.ms / DAY_MS)}`,
    ].join('\n');
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
