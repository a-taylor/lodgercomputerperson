// Games with you and letters to you: starting and ending them, and how they feel to him.
// Nothing here runs at module load, so the import cycle with sim.ts is harmless.
import { favouriteGame, GAME_NAMES, newGame, playMove, type GameAction, type GameKind, type Winner } from './games';
import { writeLetter } from './letters';
import { remember } from './memory';
import { clampNeed } from './needs';
import { say } from './speech';
import { startActivity, type SimState } from './sim';
import { HOUR_MS } from './time';
import type { World } from './world';

/** How long he waits for an answer after inviting you to play. */
const INVITE_MS = HOUR_MS;
const KEEP_RESULTS = 10;

export function startGame(state: SimState, world: World, kind?: GameKind): void {
  const game = kind ?? favouriteGame(state.rng, state.person.identity.traits.bookish);
  state.invitation = null;
  state.game = newGame(game, state.rng);
  startActivity(state, world, 'game');
}

export function gameMove(state: SimState, action: GameAction): void {
  const g = state.game;
  if (!g || g.over) return;
  const said = playMove(g, action, state.rng, state.person.identity.traits.bookish);
  if (said) say(state, said.key, said.slots);
  if (g.over) gameOver(state, g.kind, g.winner);
}

/**
 * Letting him win now and then cheers him up. Winning yourself is fine once or twice, but a run
 * of wins against him gets more deflating each time.
 */
export function gameOver(state: SimState, kind: GameKind, winner: Winner): void {
  const p = state.person;
  remember(state, (log) => log.games.push({ kind, winner }));
  if (winner === null) return;
  state.gameResults.push(winner);
  while (state.gameResults.length > KEEP_RESULTS) state.gameResults.shift();

  if (winner === 'him') {
    p.mood = clampNeed(p.mood + 6);
    say(state, 'game.heWon');
  } else if (winner === 'draw') {
    p.mood = clampNeed(p.mood + 2);
    say(state, 'game.draw');
  } else {
    const streak = youStreak(state.gameResults);
    if (streak >= 3) {
      p.mood = clampNeed(p.mood - Math.min(10, 3 + 2 * (streak - 3)));
      say(state, 'game.youAlwaysWin');
    } else {
      p.mood = clampNeed(p.mood + 1);
      say(state, 'game.youWon');
    }
  }
}

/** How many games in a row you've won, counting back from the latest. */
export function youStreak(results: readonly Winner[]): number {
  let n = 0;
  for (let i = results.length - 1; i >= 0 && results[i] === 'you'; i--) n++;
  return n;
}

/** Ends an unfinished game without a result, e.g. when hunger pulls him away. */
export function abandonGame(state: SimState): void {
  const g = state.game;
  if (!g || g.over) return;
  g.over = true;
  g.winner = null;
  g.version++;
  remember(state, (log) => log.games.push({ kind: g.kind, winner: null }));
  say(state, 'game.abandon');
}

export function invite(state: SimState): GameKind {
  const game = favouriteGame(state.rng, state.person.identity.traits.bookish);
  state.invitation = { game, untilMs: state.clock.ms + INVITE_MS };
  return game;
}

export function answerInvite(state: SimState, world: World, accept: boolean): boolean {
  const inv = state.invitation;
  state.invitation = null;
  if (!inv || inv.untilMs < state.clock.ms) return false;
  if (accept) {
    say(state, 'comply.game', { game: GAME_NAMES[inv.game] });
    startGame(state, world, inv.game);
  } else {
    state.person.mood = clampNeed(state.person.mood - 2);
    say(state, 'invite.no');
  }
  return true;
}

/** How much he wants to sit down and write to you. Sociable people write more often. */
export function letterWant(state: SimState): number {
  if (state.settledMs === null) return 0;
  const interval = (30 + 24 * (1 - state.person.identity.traits.sociable)) * HOUR_MS;
  const since = state.clock.ms - (state.lastLetterMs ?? state.settledMs - interval / 2);
  if (since < interval) return 0;
  return Math.min(0.5, 0.2 + (0.1 * (since - interval)) / HOUR_MS / 12);
}

export function finishLetter(state: SimState): void {
  writeLetter(state);
  say(state, 'letter.done');
}
