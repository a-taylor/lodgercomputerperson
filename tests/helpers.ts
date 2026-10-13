import houseJson from '../src/data/house.json';
import { buildHouse, type HouseDef } from '../src/sim/house';
import { defaultWorld } from '../src/sim/world';

export const houseDef = houseJson as HouseDef;
export const house = buildHouse(houseDef);
export const world = defaultWorld();
