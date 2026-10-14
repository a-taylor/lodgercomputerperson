// Time units shared across the sim. A leaf module, so anything can import it without cycles.

/** Real milliseconds per tick. Walking speed is per tick, so he walks at the same pace at any time scale. */
export const TICK_MS = 50;
export const MINUTE_MS = 60_000;
export const HOUR_MS = 60 * MINUTE_MS;
export const DAY_MS = 24 * HOUR_MS;
