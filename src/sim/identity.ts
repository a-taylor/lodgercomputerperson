// Who lives here: a seeded person and dog. A pure function of the seed, on its own random stream,
// so the same seed always gives the same tenant and his look never shifts the sim's own randomness.
import identityJson from '../data/identity.json';
import { createRng, nextFloat, nextInt, pick, type Rng } from './rng';

export type HairStyle = 'short' | 'long' | 'bald' | 'curly' | 'spiky' | 'parted';
export type FacialHair = 'none' | 'moustache' | 'beard';
export type Quirk = 'windowGazer' | 'nightSnacker' | 'fidget' | 'hummer' | 'dogLover';
export type DogSize = 'small' | 'medium' | 'large';

export interface Look {
  skin: string;
  hair: string;
  hairStyle: HairStyle;
  facialHair: FacialHair;
  glasses: boolean;
  shirt: string;
  trousers: string;
  /** Pixels added to a standard figure's height, 0-3. */
  tall: number;
}

/** Each 0-1. They scale how much he likes activities tagged with the trait. */
export interface Traits {
  musical: number;
  bookish: number;
  telly: number;
  tidy: number;
}

export interface Identity {
  name: string;
  look: Look;
  traits: Traits;
  /** Hours his body clock runs ahead (-) or behind (+) the real clock: early bird to night owl. */
  chronotype: number;
  /** Multiplies how fast he gets hungry. */
  appetite: number;
  /** Multiplies walking speed. */
  pace: number;
  quirks: Quirk[];
  favouriteMusic: string;
  favouriteFood: string;
}

export interface DogIdentity {
  name: string;
  coat: string;
  size: DogSize;
  ears: 'floppy' | 'pointy';
  spots: boolean;
}

export type TraitId = keyof Traits;
export const TRAIT_IDS: readonly TraitId[] = ['musical', 'bookish', 'telly', 'tidy'];

const data = identityJson as {
  names: string[];
  dogNames: string[];
  skin: string[];
  hair: string[];
  hairStyles: HairStyle[];
  facialHair: FacialHair[];
  shirts: string[];
  trousers: string[];
  dogCoats: string[];
  dogSizes: DogSize[];
  dogEars: ('floppy' | 'pointy')[];
  music: string[];
  foods: string[];
  quirks: Quirk[];
};

export const NAMES: readonly string[] = data.names;

/** Traits lean towards the ends so people feel distinct, not all middling. */
function trait(rng: Rng): number {
  const v = nextFloat(rng);
  return Math.round((v < 0.5 ? 2 * v * v : 1 - 2 * (1 - v) * (1 - v)) * 100) / 100;
}

function between(rng: Rng, min: number, max: number): number {
  return Math.round((min + nextFloat(rng) * (max - min)) * 100) / 100;
}

export function generateIdentity(seed: number): { person: Identity; dog: DogIdentity } {
  // A different stream from the sim's, derived from the same seed.
  const rng = createRng((seed ^ 0x5bd1e995) >>> 0);
  const quirkCount = nextInt(rng, 1, 2);
  const quirks: Quirk[] = [];
  while (quirks.length < quirkCount) {
    const q = pick(rng, data.quirks);
    if (!quirks.includes(q)) quirks.push(q);
  }
  const person: Identity = {
    name: pick(rng, data.names),
    look: {
      skin: pick(rng, data.skin),
      hair: pick(rng, data.hair),
      hairStyle: pick(rng, data.hairStyles),
      facialHair: pick(rng, data.facialHair),
      glasses: nextFloat(rng) < 0.3,
      shirt: pick(rng, data.shirts),
      trousers: pick(rng, data.trousers),
      tall: nextInt(rng, 0, 3),
    },
    traits: { musical: trait(rng), bookish: trait(rng), telly: trait(rng), tidy: trait(rng) },
    chronotype: between(rng, -1.5, 1.5),
    appetite: between(rng, 0.85, 1.2),
    pace: between(rng, 0.8, 1.25),
    quirks,
    favouriteMusic: pick(rng, data.music),
    favouriteFood: pick(rng, data.foods),
  };
  const dog: DogIdentity = {
    name: pick(rng, data.dogNames),
    coat: pick(rng, data.dogCoats),
    size: pick(rng, data.dogSizes),
    ears: pick(rng, data.dogEars),
    spots: nextFloat(rng) < 0.3,
  };
  return { person, dog };
}

/** Utility multiplier for an activity tagged with a trait: 0.5 for none of it, 1.5 for lots. */
export function traitAffinity(traits: Traits, id: TraitId): number {
  return 0.5 + traits[id];
}

/** Tidies a typed name: trimmed, collapsed spaces, at most 20 characters. Null if nothing usable. */
export function cleanName(raw: string): string | null {
  const name = raw.replace(/\s+/g, ' ').trim().slice(0, 20).trim();
  return name.length > 0 ? name : null;
}
