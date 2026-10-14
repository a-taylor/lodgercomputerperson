export type GameKind = 'war' | 'poker' | 'anagrams' | 'wordPuzzle';
export const GAME_KINDS: readonly GameKind[] = ['war', 'poker', 'anagrams', 'wordPuzzle'];

/** Who won: him, you, a draw, or null if the game was abandoned. */
export type Winner = 'him' | 'you' | 'draw' | null;

export interface GameCommon {
  kind: GameKind;
  over: boolean;
  winner: Winner;
  /** Bumped on every move, so the UI knows when to redraw. */
  version: number;
}

/** Something he says in reaction to a move. */
export type Said = { key: string; slots?: Record<string, string> } | null;

/** He knows a game by these names when talking about it. */
export const GAME_NAMES: Record<GameKind, string> = {
  war: 'War',
  poker: 'poker',
  anagrams: 'Anagrams',
  wordPuzzle: 'Guess My Word',
};
