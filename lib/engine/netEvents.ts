/**
 * Cosmetic event recorder for co-op.
 *
 * Particles are far too numerous to ship over the wire, so the host instead
 * records the *causes* (a hit landed here, an enemy died there) and the guest
 * replays them through the exact same effect functions against its own
 * particle pool. Bandwidth stays tiny and both players see identical juice.
 *
 * Events are encoded as flat arrays so they serialize compactly.
 */

// A plain frozen object rather than a `const enum`: the project builds with
// isolatedModules, where const enums cannot be inlined across module boundaries.
export const NetEventKind = {
  Hit: 0,
  Kill: 1,
  PlayerHurt: 2,
  Explosion: 3,
  Powerup: 4,
  LevelUp: 5,
  Streak: 6,
} as const;

export type NetEventKind = (typeof NetEventKind)[keyof typeof NetEventKind];

/** [kind, hostTimeMs, ...payload] */
export type NetEvent = (number | string)[];

let recording = false;
let buffer: NetEvent[] = [];

/** Only the host records; guests replay. */
export function setEventRecording(on: boolean): void {
  recording = on;
  buffer = [];
}

export function isRecordingEvents(): boolean {
  return recording;
}

export function recordEvent(event: NetEvent): void {
  if (!recording) return;
  // Hard cap so a pathological frame can never balloon a snapshot.
  if (buffer.length >= 120) return;
  buffer.push(event);
}

/** Returns the pending events and clears the buffer. */
export function drainEvents(): NetEvent[] {
  if (buffer.length === 0) return [];
  const out = buffer;
  buffer = [];
  return out;
}

export function clearEvents(): void {
  buffer = [];
}
