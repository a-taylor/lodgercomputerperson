// A standard 52-card deck as numbers 0-51: rank = n % 13 + 2 (2-14, ace high), suit = n / 13.
import { shuffle, type Rng } from '../rng';

export const SUITS = ['♠', '♥', '♦', '♣'] as const;
const RANK_NAMES: Record<number, string> = { 11: 'J', 12: 'Q', 13: 'K', 14: 'A' };

export function rank(card: number): number {
  return (card % 13) + 2;
}

export function suit(card: number): number {
  return Math.floor(card / 13);
}

export function cardName(card: number): string {
  const r = rank(card);
  return `${RANK_NAMES[r] ?? String(r)}${SUITS[suit(card)]}`;
}

export function isRed(card: number): boolean {
  return suit(card) === 1 || suit(card) === 2;
}

export function newDeck(rng: Rng): number[] {
  return shuffle(rng, Array.from({ length: 52 }, (_, i) => i));
}
