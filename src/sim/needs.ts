// Needs run 0 (desperate) to 100 (fully satisfied). Rates are per game hour.

export const NEED_IDS = ['food', 'water', 'energy', 'hygiene', 'fun'] as const;
export type NeedId = (typeof NEED_IDS)[number];
export type Needs = Record<NeedId, number>;

/** Anything an activity can change: his needs, or the dog's food. */
export type EffectKey = NeedId | 'dog';
export const EFFECT_KEYS: readonly EffectKey[] = [...NEED_IDS, 'dog'];

export const DECAY: Record<NeedId, { awake: number; asleep: number }> = {
  food: { awake: 5, asleep: 2 },
  water: { awake: 8, asleep: 3 },
  energy: { awake: 3.6, asleep: 0 },
  hygiene: { awake: 3, asleep: 1 },
  fun: { awake: 6, asleep: 0 },
};
export const DOG_FOOD_DECAY = 3;

/** Below this, food, water or sleep pull him out of whatever he is doing. */
export const CRITICAL = 8;
export const CRITICAL_NEEDS: readonly NeedId[] = ['food', 'water', 'energy'];

/** Health falls this much per hour for each of food and water that is empty. */
export const STARVING_DAMAGE = 1.5;
export const HEALTH_RECOVERY = 2;

export function clampNeed(v: number): number {
  return v < 0 ? 0 : v > 100 ? 100 : v;
}

/** How much a need wants attention: rises steeply as it empties, with a kick near zero. */
export function urgency(value: number): number {
  const deficit = 1 - value / 100;
  return deficit * deficit + (value < 15 ? (15 - value) / 15 : 0);
}
