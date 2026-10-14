// What's in the house: food, water and dog food you deliver, and records and books he collects.

export type SupplyId = 'food' | 'water' | 'dogFood';
export const SUPPLY_IDS: readonly SupplyId[] = ['food', 'water', 'dogFood'];
export type RequirementId = SupplyId | 'records';
export const REQUIREMENT_IDS: readonly RequirementId[] = [...SUPPLY_IDS, 'records'];

export interface Supplies {
  /** Servings: meals, glasses, bowlfuls. */
  food: number;
  water: number;
  dogFood: number;
  /** Genre of each record he owns, oldest first. */
  records: string[];
  books: number;
  /** Game time the newest record and book arrived, for the novelty of something new. */
  newRecordMs: number | null;
  newBookMs: number | null;
}

/** How much one delivery adds, and how much fits in the cupboards. */
export const DELIVERY: Record<SupplyId, { amount: number; max: number }> = {
  food: { amount: 6, max: 30 },
  water: { amount: 10, max: 40 },
  dogFood: { amount: 6, max: 20 },
};

/** He moves in with about a week's shopping, so deliveries matter from the second week. */
export function startingSupplies(favouriteMusic: string): Supplies {
  return { food: 28, water: 40, dogFood: 20, records: [favouriteMusic], books: 3, newRecordMs: null, newBookMs: null };
}

/** At or below this he starts worrying about it. */
export const RUNNING_LOW: Record<SupplyId, number> = { food: 3, water: 4, dogFood: 2 };

export function hasRequirement(s: Supplies, r: RequirementId): boolean {
  return r === 'records' ? s.records.length > 0 : s[r] > 0;
}
