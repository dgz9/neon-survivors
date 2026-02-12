// Fixed timestep accumulator
// FIXED_DT = 1.0 matches the existing normalized deltaTime unit
// so all physics code is unchanged.

export const FIXED_DT = 1.0;
export const FIXED_MS = 16.667; // real ms per tick (~60Hz)
export const MAX_ACCUMULATOR = FIXED_MS * 5; // spiral-of-death cap

export interface AccumulatorState {
  accumulator: number;
  lastTimestamp: number;
}

export function createAccumulator(timestamp: number): AccumulatorState {
  return {
    accumulator: 0,
    lastTimestamp: timestamp,
  };
}

/**
 * Advance the accumulator by real elapsed ms (scaled by slowMoFactor).
 * Returns how many fixed-rate ticks to run this frame.
 */
export function advanceAccumulator(
  acc: AccumulatorState,
  timestamp: number,
  slowMoFactor: number = 1,
): { acc: AccumulatorState; tickCount: number } {
  let elapsed = timestamp - acc.lastTimestamp;
  // Apply slow-mo: scale the *input* time, not the tick rate
  elapsed *= slowMoFactor;
  // Cap to prevent spiral of death
  if (elapsed > MAX_ACCUMULATOR) elapsed = MAX_ACCUMULATOR;

  let accumulator = acc.accumulator + elapsed;
  let tickCount = 0;

  while (accumulator >= FIXED_MS) {
    accumulator -= FIXED_MS;
    tickCount++;
  }

  return {
    acc: { accumulator, lastTimestamp: timestamp },
    tickCount,
  };
}
