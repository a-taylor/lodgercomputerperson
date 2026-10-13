// Everything static the sim needs: the house and the activity library.
import activitiesJson from '../data/activities.json';
import houseJson from '../data/house.json';
import { buildActivities, type ActivityDef, type ActivityLibrary } from './activities';
import { buildHouse, type House, type HouseDef } from './house';

export interface World {
  house: House;
  activities: ActivityLibrary;
}

export function buildWorld(houseDef: HouseDef, activityDefs: ActivityDef[]): World {
  const house = buildHouse(houseDef);
  return { house, activities: buildActivities(activityDefs, house) };
}

export function defaultWorld(): World {
  return buildWorld(houseJson as HouseDef, activitiesJson.activities as ActivityDef[]);
}
