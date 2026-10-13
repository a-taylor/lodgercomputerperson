import houseJson from '../src/data/house.json';
import { buildHouse, type HouseDef } from '../src/sim/house';

export const houseDef = houseJson as HouseDef;
export const house = buildHouse(houseDef);
