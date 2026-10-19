// Everything the player can do to him: talk, deliver things, pat him, ring, set off the alarm.
// He has a will: requests go through compliance, and a refusal always comes with a reason he says.
import identityJson from '../data/identity.json';
import type { ActivityDef } from './activities';
import { GAME_NAMES, type GameKind } from './games';
import { remember } from './memory';
import { clampNeed } from './needs';
import { parse, parsedFromItem, splitChain, validateIntents, type Parsed, type Politeness } from './parser';
import { nextFloat, pick } from './rng';
import { answerInvite, startGame } from './play';
import { say } from './speech';
import { currentStep, isAvailable, isAsleep, needPreempts, startActivity, stopActivity, type SimState } from './sim';
import { HOUR_MS, MINUTE_MS } from './time';
import { DELIVERY, hasRequirement, RUNNING_LOW, type RequirementId, type SupplyId } from './supplies';
import type { World } from './world';

export type DeliveryItem = SupplyId | 'record' | 'book';

export type Refusal =
  | 'asleep'
  | 'tired'
  | 'hungry'
  | 'thirsty'
  | 'justDid'
  | 'dislike'
  | 'rude'
  | 'mood'
  | 'whim'
  | 'noFood'
  | 'noWater'
  | 'noDogFood'
  | 'noRecords'
  | 'notTired'
  | 'full'
  | 'notThirsty'
  | 'clean'
  | 'dogFull'
  | 'already';

export type Outcome = { kind: 'comply' } | { kind: 'defer' } | { kind: 'refuse'; reason: Refusal };

export interface Assessment {
  /** Probability he says yes, 0-1. */
  chance: number;
  /** A reason that rules it out completely. */
  hard: Refusal | null;
  /** The biggest thing putting him off, if he says no. */
  soft: Refusal | null;
}

const MISSING: Record<RequirementId, Refusal> = {
  food: 'noFood',
  water: 'noWater',
  dogFood: 'noDogFood',
  records: 'noRecords',
};

const MUSIC: string[] = identityJson.music;
/** A request waiting its turn is forgotten after this long (per place in the queue). */
const DEFER_MS = 2 * HOUR_MS;
/** How many things he'll keep in mind to do next. */
export const MAX_QUEUE = 4;

/** Something you asked him to do once he's done what he's doing. */
export interface QueuedRequest {
  activity: string;
  node: string | null;
  game: GameKind | null;
  politeness: Politeness;
  untilMs: number;
  /** He already said yes (it was first in line when asked). Otherwise he decides when it comes up. */
  agreed: boolean;
}

/** An activity request, as the queue and compliance see it. */
interface Ask {
  activity: string;
  node?: string;
  game?: GameKind;
  /** Its own politeness, when a model read each part separately. */
  politeness?: Politeness;
}
const NOVELTY_MS = 8 * HOUR_MS;

/**
 * How likely he is to do something when asked. Mood sets the baseline, politeness shifts it,
 * and tiredness, hunger, having just done it, or simply not liking it each pull it down.
 */
export function assessRequest(state: SimState, world: World, activityId: string, politeness: Politeness): Assessment {
  const p = state.person;
  const def = world.activities.byId.get(activityId)!;
  const n = p.needs;

  for (const r of def.requires ?? []) {
    if (!hasRequirement(state.supplies, r)) return { chance: 0, hard: MISSING[r], soft: null };
  }
  const hardIf: [boolean, Refusal][] = [
    [p.activity?.id === activityId, 'already'],
    [activityId === 'sleep' && n.energy > 75, 'notTired'],
    [activityId === 'eat' && n.food > 90, 'full'],
    [activityId === 'drink' && n.water > 90, 'notThirsty'],
    [activityId === 'wash' && n.hygiene > 95, 'clean'],
    [activityId === 'feedDog' && state.dog.food > 90, 'dogFull'],
  ];
  for (const [when, reason] of hardIf) if (when) return { chance: 0, hard: reason, soft: null };

  let chance = Math.min(1, Math.max(0, 0.2 + (0.6 * p.mood) / 100 + 0.25 * politeness));
  const putOffs: [number, Refusal][] = [];
  const basic = activityId === 'eat' || activityId === 'drink' || activityId === 'sleep';
  if (n.energy < 25 && !basic) putOffs.push([0.3, 'tired']);
  if (n.food < 20 && activityId !== 'eat' && activityId !== 'drink') putOffs.push([0.4, 'hungry']);
  if (n.water < 20 && activityId !== 'drink') putOffs.push([0.5, 'thirsty']);
  const last = state.lastDone[activityId];
  if (def.kind === 'leisure' && last !== undefined && state.clock.ms - last < 60 * MINUTE_MS) putOffs.push([0.4, 'justDid']);
  if (def.trait) {
    const t = p.identity.traits[def.trait];
    const factor = 0.6 + 0.8 * t;
    if (t < 0.3) putOffs.push([factor, 'dislike']);
    else chance *= factor;
  }
  let soft: Refusal | null = null;
  let worst = 1;
  for (const [factor, reason] of putOffs) {
    chance *= factor;
    if (factor < worst) {
      worst = factor;
      soft = reason;
    }
  }
  return { chance: Math.min(1, chance), hard: null, soft };
}

/**
 * Handles something typed. Returns the outcome for requests, null for chat. With `askModel`, a
 * line he can't follow isn't "confused" yet: he thinks, and the game asks a language model what
 * it meant. Its answer comes back through handleUnderstood.
 */
export function handleSay(state: SimState, world: World, text: string, askModel = false): Outcome | null {
  touch(state);
  const ctx = { dogName: state.dog.identity.name };
  const parsed = parse(text, ctx);
  const p = state.person;

  // "Play the piano and then dance": two or more requests become a queue.
  const asks = splitChain(text)
    .map((part) => askOf(world, parse(part, ctx)))
    .filter((a): a is Ask => a !== null);
  if (asks.length > 1) return handleChain(state, world, parsed.politeness, asks);

  if (isAsleep(state, world)) {
    if (parsed.intent === 'wake') wakeOnRequest(state, world, parsed.politeness);
    else say(state, 'asleep');
    return parsed.activity ? { kind: 'refuse', reason: 'asleep' } : null;
  }
  if (parsed.politeness < 0) p.mood = clampNeed(p.mood - 3);
  if (parsed.politeness !== 0) remember(state, (log) => (parsed.politeness > 0 ? log.polite++ : log.rude++));

  if (parsed.intent === null && askModel) {
    state.thinking = { id: state.tick, text };
    say(state, 'thinking');
    return null;
  }
  return respond(state, world, parsed);
}

/**
 * A language model's reading of the line he was thinking about. Checked again here, since it came
 * from outside. An answer to an older line is ignored; an empty or unusable one leaves him confused.
 */
export function handleUnderstood(state: SimState, world: World, id: number, answer: unknown): void {
  if (state.thinking?.id !== id) return;
  delete state.thinking;
  // Dozed off while thinking: the moment has passed.
  if (isAsleep(state, world)) return;
  const items = (validateIntents(answer) ?? []).map(parsedFromItem);
  const asks = items.flatMap((parsed) => {
    const ask = askOf(world, parsed);
    return ask ? [{ ...ask, politeness: parsed.politeness }] : [];
  });
  if (asks.length > 1) askAll(state, world, asks, asks[0]!.politeness);
  else if (items.length > 0) respond(state, world, items.find((parsed) => askOf(world, parsed)) ?? items[0]!);
  else say(state, 'confused');
}

/** Answers one understood line: chat, or a request. */
function respond(state: SimState, world: World, parsed: Parsed): Outcome | null {
  switch (parsed.intent) {
    case null:
      say(state, 'confused');
      return null;
    case 'name':
      state.playerName = parsed.name!;
      say(state, 'name.learned');
      return null;
    case 'greet':
      say(state, 'greet');
      return null;
    case 'thanks':
      say(state, 'thanks');
      return null;
    case 'howAreYou':
      say(state, howAreYouKey(state));
      return null;
    case 'wake':
      say(state, 'alarm.awake');
      return null;
    case 'yes':
    case 'no':
      if (!answerInvite(state, world, parsed.intent === 'yes')) say(state, parsed.intent === 'yes' ? 'thanks' : 'confused');
      return null;
    case 'game':
      // Accepting his invitation by naming the game counts as a yes.
      if (state.invitation && (!parsed.game || parsed.game === state.invitation.game) && answerInvite(state, world, true)) {
        return { kind: 'comply' };
      }
      return requestOrQueue(state, world, askOf(world, parsed)!, parsed.politeness);
    case 'playWhat':
      say(state, 'playWhat');
      return null;
    default:
      return requestOrQueue(state, world, askOf(world, parsed)!, parsed.politeness);
  }
}

/** The activity a parsed line asks for, if it asks for one. */
function askOf(world: World, parsed: Parsed): Ask | null {
  if (parsed.intent === 'game') return { activity: 'game', game: parsed.game };
  if (parsed.intent === 'goTo') return { activity: 'potter', node: roomNode(world, parsed.room!) };
  return parsed.activity ? { activity: parsed.activity } : null;
}

/** With others already waiting, a new request goes to the back; otherwise he answers now. */
function requestOrQueue(state: SimState, world: World, ask: Ask, politeness: Politeness): Outcome {
  if (state.queue.length === 0) return request(state, world, ask, politeness);
  if (enqueue(state, [ask], politeness) > 0) say(state, 'queue.added');
  return { kind: 'defer' };
}

function handleChain(state: SimState, world: World, politeness: Politeness, asks: Ask[]): Outcome {
  const p = state.person;
  if (isAsleep(state, world)) {
    say(state, 'asleep');
    return { kind: 'refuse', reason: 'asleep' };
  }
  if (politeness < 0) p.mood = clampNeed(p.mood - 3);
  if (politeness !== 0) remember(state, (log) => (politeness > 0 ? log.polite++ : log.rude++));
  return askAll(state, world, asks, politeness);
}

/** The first is answered now if nothing is waiting; the rest wait their turn. */
function askAll(state: SimState, world: World, asks: Ask[], politeness: Politeness): Outcome {
  const outcome = requestOrQueue(state, world, asks[0]!, politeness);
  const rest = asks.slice(1);
  if (enqueue(state, rest, politeness) < rest.length) say(state, 'queue.full');
  return outcome;
}

/** Adds requests to the back of the queue, as many as fit. Returns how many fitted. */
function enqueue(state: SimState, asks: Ask[], politeness: Politeness, agreed = false): number {
  let added = 0;
  for (const ask of asks) {
    if (state.queue.length >= MAX_QUEUE) break;
    state.queue.push({
      activity: ask.activity,
      node: ask.node ?? null,
      game: ask.game ?? null,
      politeness: ask.politeness ?? politeness,
      untilMs: state.clock.ms + DEFER_MS * (state.queue.length + 1),
      agreed,
    });
    added++;
  }
  return added;
}

function request(state: SimState, world: World, ask: Ask, politeness: Politeness): Outcome {
  const { activity: activityId, node } = ask;
  let game = ask.game;
  const p = state.person;
  const def = world.activities.byId.get(activityId)!;
  if (activityId === 'game') game ??= state.game?.over === false ? state.game.kind : undefined;
  const a =
    activityId === 'potter'
      ? { chance: Math.min(1, 0.4 + (0.5 * p.mood) / 100 + 0.25 * politeness), hard: null, soft: null }
      : assessRequest(state, world, activityId, politeness);
  const slots: Record<string, string> = { activity: def.noun };
  if (game) slots.game = GAME_NAMES[game];

  if (a.hard) {
    say(state, `refuse.${a.hard}`, slots);
    remember(state, (log) => log.refusals++);
    return { kind: 'refuse', reason: a.hard };
  }
  if (nextFloat(state.rng) >= a.chance) {
    const reason: Refusal = a.soft ?? (politeness < 0 ? 'rude' : p.mood < 40 ? 'mood' : 'whim');
    say(state, `refuse.${reason}`, slots);
    remember(state, (log) => log.refusals++);
    return { kind: 'refuse', reason };
  }

  if (politeness > 0) p.mood = clampNeed(p.mood + 2);
  const busyWith = busy(state, world);
  if (busyWith) {
    enqueue(state, [{ activity: activityId, node, game }], politeness, true);
    say(state, 'defer', { current: busyWith });
    return { kind: 'defer' };
  }
  if (activityId === 'game') {
    const kind = game ?? undefined;
    startGame(state, world, kind);
    say(state, 'comply.game', { game: GAME_NAMES[state.game!.kind] });
    return { kind: 'comply' };
  }
  const key = politeness > 0 && nextFloat(state.rng) < 0.35 ? 'comply.polite' : `comply.${activityId === 'potter' ? 'goTo' : activityId}`;
  say(state, key, slots);
  startActivity(state, world, activityId, node);
  return { kind: 'comply' };
}

/** What he's in the middle of, if it's something worth finishing first. */
function busy(state: SimState, world: World): string | null {
  const run = state.person.activity;
  if (!run || !run.doing) return null;
  const def = world.activities.byId.get(run.id)!;
  if (def.kind === 'idle' || def.id === 'knock') return null;
  return currentStep(state, world)!.label;
}

/**
 * Called when he's free: starts the next thing you asked for, if it's still wanted. Things he
 * hadn't agreed to yet get a yes or no now. An urgent need comes first and the queue waits.
 */
export function takeQueued(state: SimState, world: World): boolean {
  while (state.queue.length > 0) {
    const next = state.queue[0]!;
    if (next.untilMs < state.clock.ms) {
      state.queue.shift();
      continue;
    }
    const def = world.activities.byId.get(next.activity)!;
    if (needPreempts(state, world, def)) return false;
    state.queue.shift();
    const ask: Ask = { activity: next.activity, node: next.node ?? undefined, game: next.game ?? undefined };
    if (!next.agreed) return request(state, world, ask, next.politeness).kind === 'comply';
    if (!isAvailable(state, def, true)) continue;
    say(state, 'deferDone');
    if (next.activity === 'game') startGame(state, world, ask.game);
    else startActivity(state, world, next.activity, ask.node);
    return true;
  }
  return false;
}

function wakeOnRequest(state: SimState, world: World, politeness: Politeness): void {
  const p = state.person;
  const chance = Math.min(1, Math.max(0, 0.35 + 0.25 * politeness + (p.needs.energy > 70 ? 0.35 : 0)));
  if (nextFloat(state.rng) < chance) {
    wake(state, world);
    if (p.needs.energy < 50) p.mood = clampNeed(p.mood - 2);
    say(state, 'wake.yes');
  } else {
    say(state, 'wake.no');
  }
}

function wake(state: SimState, world: World): void {
  stopActivity(state, world, true);
}

function howAreYouKey(state: SimState): string {
  const p = state.person;
  const [worst, value] = Object.entries(p.needs).sort((a, b) => a[1] - b[1])[0]!;
  if (value < 30 && nextFloat(state.rng) < 0.7) return `howAreYou.need.${worst}`;
  return p.mood >= 65 ? 'howAreYou.good' : p.mood >= 40 ? 'howAreYou.ok' : 'howAreYou.bad';
}

function roomNode(world: World, room: string): string {
  return world.house.nodeIds.find((id) => world.house.nodes.get(id)!.room === room)!;
}

export function pat(state: SimState, world: World): void {
  touch(state);
  const p = state.person;
  if (isAsleep(state, world)) {
    wake(state, world);
    p.mood = clampNeed(p.mood - 4);
    say(state, 'pat.woken');
    return;
  }
  remember(state, (log) => log.pats++);
  state.pats = state.pats.filter((ms) => state.clock.ms - ms < HOUR_MS);
  const recent = state.pats.length;
  state.pats.push(state.clock.ms);
  // His favourite thing, but it wears off if you overdo it.
  p.mood = clampNeed(p.mood + 8 * 0.5 ** recent - (recent >= 4 ? 1 : 0));
  say(state, recent >= 3 ? 'pat.enough' : 'pat');
}

export function deliver(state: SimState, world: World, item: DeliveryItem): void {
  touch(state);
  const p = state.person;
  const s = state.supplies;
  const awake = !isAsleep(state, world);
  const speak = (key: string, slots?: Record<string, string>) => awake && say(state, key, slots);
  remember(state, (log) => (log.deliveries[item] = (log.deliveries[item] ?? 0) + 1));

  if (item === 'record') {
    const genre = pick(state.rng, MUSIC);
    s.records.push(genre);
    remember(state, (log) => log.records.push(genre));
    s.newRecordMs = state.clock.ms;
    const favourite = genre === p.identity.favouriteMusic;
    p.mood = clampNeed(p.mood + (favourite ? 9 : 4));
    speak(favourite ? 'deliver.recordFavourite' : 'deliver.record', { genre });
    return;
  }
  if (item === 'book') {
    s.books++;
    s.newBookMs = state.clock.ms;
    p.mood = clampNeed(p.mood + 5);
    speak('deliver.book');
    return;
  }
  const { amount, max } = DELIVERY[item];
  if (s[item] >= max) {
    speak('deliver.full');
    return;
  }
  const wasLow = s[item] <= RUNNING_LOW[item];
  s[item] = Math.min(max, s[item] + amount);
  p.mood = clampNeed(p.mood + (wasLow ? 6 : 3));
  speak(`deliver.${item}`);
}

export function ringPhone(state: SimState, world: World): boolean {
  touch(state);
  const p = state.person;
  state.phoneRing = { untilTick: state.tick + 120 };
  if (isAsleep(state, world)) {
    if (nextFloat(state.rng) >= 0.3) return false;
    wake(state, world);
    p.mood = clampNeed(p.mood - 3);
    say(state, 'phone.woken');
  } else {
    const run = p.activity;
    const def = run ? world.activities.byId.get(run.id)! : null;
    let chance = 0.35 + 0.5 * p.identity.traits.sociable + (0.2 * (p.mood - 50)) / 50;
    if (def?.kind === 'need') chance *= 0.6;
    if (nextFloat(state.rng) >= chance) {
      say(state, 'phone.ignore');
      return false;
    }
    say(state, 'phone.answer');
  }
  state.phoneRing = null;
  startActivity(state, world, 'phone');
  return true;
}

export function soundAlarm(state: SimState, world: World): void {
  touch(state);
  const p = state.person;
  if (!isAsleep(state, world)) {
    say(state, 'alarm.awake');
    return;
  }
  wake(state, world);
  if (p.needs.energy < 60) {
    p.mood = clampNeed(p.mood - 3);
    say(state, 'alarm.grumpy');
  } else {
    say(state, 'alarm.woken');
  }
}

function touch(state: SimState): void {
  state.lastInteractionMs = state.clock.ms;
}

export type KnockReason = 'hello' | 'food' | 'water' | 'dogFood' | 'record' | 'lonely' | 'game' | 'sick' | 'dying';

/** Why he might knock on the glass right now, and how badly he wants to. */
export function wantsAttention(state: SimState): { reason: KnockReason; score: number } | null {
  const p = state.person;
  const s = state.supplies;
  const since = (ms: number | null) => (ms === null ? Infinity : state.clock.ms - ms);
  // Having just moved in, the first thing he does is say hello through the glass.
  if (state.moveIn.played && state.playerName === null && state.lastKnockMs === null) return { reason: 'hello', score: 1 };
  // Warnings come first and come more often: he's ill and wants you to know.
  if (p.health < 25 && since(state.lastKnockMs) > HOUR_MS) return { reason: 'dying', score: 1 };
  if (p.sick && since(state.lastKnockMs) > 3 * HOUR_MS) return { reason: 'sick', score: 0.8 };
  if (since(state.lastKnockMs) < 3 * HOUR_MS) return null;

  const wants: [KnockReason, number][] = [];
  if (s.food <= RUNNING_LOW.food) wants.push(['food', 0.6]);
  if (s.water <= RUNNING_LOW.water) wants.push(['water', 0.6]);
  if (s.dogFood <= RUNNING_LOW.dogFood) wants.push(['dogFood', 0.45]);
  const lonelyAfter = 8 * HOUR_MS;
  if (since(state.lastInteractionMs) > lonelyAfter && since(state.lastKnockMs) > lonelyAfter) {
    wants.push(['lonely', 0.1 + 0.2 * p.identity.traits.sociable]);
  }
  // The rest can wait: no point knocking for company while you're already here.
  const together = since(state.lastInteractionMs) < HOUR_MS;
  const sinceNewRecord = since(s.newRecordMs ?? state.settledMs);
  if (!together && p.identity.traits.musical > 0.6 && sinceNewRecord > 3 * 24 * HOUR_MS && since(state.lastKnockMs) > 24 * HOUR_MS) {
    wants.push(['record', 0.12]);
  }
  const lastGame = state.lastDone.game;
  if (
    !together &&
    p.identity.traits.sociable >= 0.4 &&
    p.needs.fun < 60 &&
    state.invitation === null &&
    (lastGame === undefined || state.clock.ms - lastGame > 24 * HOUR_MS) &&
    since(state.lastKnockMs) > 6 * HOUR_MS
  ) {
    wants.push(['game', 0.12 + 0.2 * p.identity.traits.sociable]);
  }
  if (wants.length === 0) return null;
  wants.sort((a, b) => b[1] - a[1]);
  return { reason: wants[0]![0], score: wants[0]![1] };
}

/** Novelty: a new record or book makes the related pastimes much more tempting for a while. */
export function noveltyBoost(state: SimState, def: ActivityDef): number {
  const s = state.supplies;
  const fresh = (ms: number | null) => ms !== null && state.clock.ms - ms < NOVELTY_MS;
  if ((def.id === 'music' || def.id === 'dance') && fresh(s.newRecordMs)) return 2.5;
  if (def.id === 'read' && fresh(s.newBookMs)) return 2.5;
  return 1;
}
