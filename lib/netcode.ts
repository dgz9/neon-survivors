/**
 * Co-op netcode primitives.
 *
 * The host is authoritative and ships snapshots ~25x/sec. Naively lerping
 * toward the newest snapshot (what this used to do) makes every remote entity
 * rubber-band, because the target itself keeps jumping. Instead:
 *
 *  - Remote entities (host player, enemies, host projectiles) are rendered on a
 *    deliberately *delayed* timeline and interpolated between the two snapshots
 *    that bracket that time. Motion is then perfectly smooth regardless of
 *    packet jitter, at the cost of a fixed, tuneable amount of visual lag.
 *  - The guest's own avatar is predicted locally from its own inputs with zero
 *    latency, then reconciled against the host's authoritative result by
 *    replaying the inputs the host hasn't acknowledged yet.
 *
 * Both sides step at the same fixed rate so the replay reproduces the host's
 * math exactly.
 */

import { Vector2 } from '@/types/game';

// ---------------------------------------------------------------------------
// Input commands
// ---------------------------------------------------------------------------

export interface InputCommand {
  /** Monotonic sequence number. */
  seq: number;
  /** Analog movement, each component in [-1, 1]. */
  dx: number;
  dy: number;
  /** Aim direction in radians. */
  aim: number;
}

/** Wire form: [seq, dx, dy, aim] */
export type WireCommand = [number, number, number, number];

export function encodeCommand(c: InputCommand): WireCommand {
  return [
    c.seq,
    Math.round(c.dx * 1000) / 1000,
    Math.round(c.dy * 1000) / 1000,
    Math.round(c.aim * 1000) / 1000,
  ];
}

export function decodeCommand(w: WireCommand): InputCommand {
  return { seq: w[0], dx: w[1], dy: w[2], aim: w[3] };
}

/** How far the movement model advances for one command. Shared by both sides. */
export interface MoveBounds {
  width: number;
  height: number;
  radius: number;
}

/**
 * The one and only P2 movement model. The host runs it on received commands and
 * the guest runs it on the same commands during prediction and replay — keeping
 * it in a single function is what makes reconciliation converge instead of
 * fighting itself.
 */
export function applyMoveCommand(
  pos: Vector2,
  vel: Vector2,
  cmd: InputCommand,
  speed: number,
  bounds: MoveBounds,
  dt: number,
): void {
  let dx = cmd.dx;
  let dy = cmd.dy;
  const len = Math.hypot(dx, dy);
  if (len > 1) {
    dx /= len;
    dy /= len;
  }

  vel.x = dx * speed;
  vel.y = dy * speed;
  pos.x += vel.x * dt;
  pos.y += vel.y * dt;

  const r = bounds.radius;
  pos.x = Math.max(r, Math.min(bounds.width - r, pos.x));
  pos.y = Math.max(r, Math.min(bounds.height - r, pos.y));
}

/**
 * Guest-side ring of unacknowledged commands, replayed on top of every
 * authoritative correction.
 */
export class CommandBuffer {
  private pending: InputCommand[] = [];
  private nextSeq = 1;

  create(dx: number, dy: number, aim: number): InputCommand {
    const cmd: InputCommand = { seq: this.nextSeq++, dx, dy, aim };
    this.pending.push(cmd);
    // Guard against an unresponsive host: never let this grow without bound.
    if (this.pending.length > 240) this.pending.shift();
    return cmd;
  }

  /** Drop everything the host has already folded into its authoritative state. */
  acknowledge(seq: number): void {
    if (!seq) return;
    let drop = 0;
    while (drop < this.pending.length && this.pending[drop].seq <= seq) drop++;
    if (drop > 0) this.pending.splice(0, drop);
  }

  get unacknowledged(): readonly InputCommand[] {
    return this.pending;
  }

  /** The most recent N commands, for redundant sending. */
  recent(max: number): InputCommand[] {
    return this.pending.length <= max ? this.pending.slice() : this.pending.slice(-max);
  }

  clear(): void {
    this.pending.length = 0;
  }
}

/**
 * Host-side jitter buffer. Commands are consumed one per simulation tick so the
 * guest's inputs are applied at the same rate they were produced; a small
 * backlog is drained slightly faster to stop latency from accumulating.
 */
export class CommandQueue {
  private queue: InputCommand[] = [];
  private lastAccepted = 0;
  private lastApplied: InputCommand = { seq: 0, dx: 0, dy: 0, aim: 0 };

  /** Ignores duplicates from the redundant sends. */
  push(commands: InputCommand[]): void {
    for (const cmd of commands) {
      if (cmd.seq <= this.lastAccepted) continue;
      this.lastAccepted = cmd.seq;
      this.queue.push(cmd);
    }
    // A huge backlog means the guest stalled and dumped; keep only recent input.
    if (this.queue.length > 60) this.queue.splice(0, this.queue.length - 60);
  }

  /**
   * Pops the command for this tick. Returns the last applied command when the
   * queue has run dry so movement holds rather than stuttering to a stop.
   */
  next(): InputCommand {
    // Burn down a backlog gradually rather than in one jump.
    const extra = this.queue.length > 12 ? 2 : this.queue.length > 5 ? 1 : 0;
    for (let i = 0; i < extra; i++) {
      const skipped = this.queue.shift();
      if (skipped) this.lastApplied = skipped;
    }

    const cmd = this.queue.shift();
    if (cmd) this.lastApplied = cmd;
    return this.lastApplied;
  }

  get ackSeq(): number {
    return this.lastApplied.seq;
  }

  reset(): void {
    this.queue.length = 0;
    this.lastAccepted = 0;
    this.lastApplied = { seq: 0, dx: 0, dy: 0, aim: 0 };
  }
}

// ---------------------------------------------------------------------------
// Clock sync
// ---------------------------------------------------------------------------

/**
 * Maps host timestamps into the guest's local clock.
 *
 * The offset of the *least delayed* packet is the best estimate of the true
 * clock difference, so we snap down instantly on a faster packet and drift back
 * up slowly — that way one lucky packet doesn't pin the estimate forever, but
 * ordinary jitter doesn't shift the timeline either.
 */
export class ClockSync {
  private offset: number | null = null;
  private jitter = 0;

  sample(hostTime: number, localTime: number): void {
    const sample = localTime - hostTime;
    if (this.offset === null) {
      this.offset = sample;
      return;
    }
    const error = sample - this.offset;
    this.jitter += (Math.abs(error) - this.jitter) * 0.1;
    if (error < 0) {
      this.offset = sample;
    } else {
      this.offset += error * 0.01;
    }
  }

  get ready(): boolean {
    return this.offset !== null;
  }

  /** Host time corresponding to a local timestamp. */
  toHostTime(localTime: number): number {
    return localTime - (this.offset ?? 0);
  }

  /** Smoothed absolute jitter, in ms. */
  get jitterMs(): number {
    return this.jitter;
  }
}

// ---------------------------------------------------------------------------
// Snapshot interpolation
// ---------------------------------------------------------------------------

export interface SnapshotEntity {
  position: Vector2;
  velocity?: Vector2;
}

export interface Snapshot<T> {
  /** Host clock time this snapshot represents. */
  time: number;
  data: T;
}

const MAX_SNAPSHOTS = 24;

export class SnapshotBuffer<T> {
  private snaps: Snapshot<T>[] = [];

  push(time: number, data: T): void {
    // Drop anything that arrives out of order — it is already superseded.
    const last = this.snaps[this.snaps.length - 1];
    if (last && time <= last.time) return;

    this.snaps.push({ time, data });
    if (this.snaps.length > MAX_SNAPSHOTS) this.snaps.shift();
  }

  get latest(): Snapshot<T> | null {
    return this.snaps.length ? this.snaps[this.snaps.length - 1] : null;
  }

  get length(): number {
    return this.snaps.length;
  }

  /** Newest-minus-oldest span currently buffered, in ms. */
  get spanMs(): number {
    if (this.snaps.length < 2) return 0;
    return this.snaps[this.snaps.length - 1].time - this.snaps[0].time;
  }

  /**
   * The pair of snapshots bracketing `time`, plus the blend factor between
   * them. Falls back to the newest pair when the render clock has run past the
   * buffer (a stall), so motion extrapolates rather than freezing.
   */
  sample(time: number): { from: Snapshot<T>; to: Snapshot<T>; alpha: number } | null {
    if (this.snaps.length === 0) return null;
    if (this.snaps.length === 1) {
      const only = this.snaps[0];
      return { from: only, to: only, alpha: 0 };
    }

    for (let i = this.snaps.length - 1; i > 0; i--) {
      const to = this.snaps[i];
      const from = this.snaps[i - 1];
      if (time >= from.time && time <= to.time) {
        const span = to.time - from.time;
        return { from, to, alpha: span > 0 ? (time - from.time) / span : 0 };
      }
    }

    if (time < this.snaps[0].time) {
      // Render clock is behind everything we hold; clamp to the oldest pair.
      return { from: this.snaps[0], to: this.snaps[1], alpha: 0 };
    }

    // Render clock has outrun the newest snapshot — extrapolate off the tail,
    // capped so a long stall cannot fling entities across the arena.
    const to = this.snaps[this.snaps.length - 1];
    const from = this.snaps[this.snaps.length - 2];
    const span = to.time - from.time;
    if (span <= 0) return { from: to, to, alpha: 0 };
    const alpha = 1 + Math.min(2.5, (time - to.time) / span);
    return { from, to, alpha };
  }

  clear(): void {
    this.snaps.length = 0;
  }
}

/** Linear blend that also extrapolates for alpha > 1. */
export function blend(a: number, b: number, alpha: number): number {
  return a + (b - a) * alpha;
}

/**
 * Chooses how far behind real time to render.
 *
 * One snapshot interval is the theoretical minimum (you need the next packet
 * before you can interpolate into it); the extra headroom absorbs jitter and
 * the occasional dropped packet.
 */
export function computeInterpolationDelay(
  snapshotIntervalMs: number,
  jitterMs: number,
): number {
  const target = snapshotIntervalMs * 1.6 + jitterMs * 2.2;
  return Math.max(55, Math.min(220, target));
}

/**
 * Error smoothing for the locally predicted avatar.
 *
 * Prediction errors are absorbed into a visual offset that decays to zero over
 * a few frames instead of snapping the avatar, so a mis-prediction reads as a
 * slight drift rather than a teleport. Genuinely large divergence (a teleport,
 * a long stall) is snapped immediately — smoothing that would look worse.
 */
export class ErrorSmoother {
  private offset: Vector2 = { x: 0, y: 0 };

  /** Called when the predicted position moves due to a correction. */
  absorb(deltaX: number, deltaY: number): void {
    this.offset.x += deltaX;
    this.offset.y += deltaY;
    const mag = Math.hypot(this.offset.x, this.offset.y);
    if (mag > 90) {
      this.offset.x = 0;
      this.offset.y = 0;
    }
  }

  decay(dt: number): void {
    const k = Math.pow(0.82, dt);
    this.offset.x *= k;
    this.offset.y *= k;
    if (Math.abs(this.offset.x) < 0.05) this.offset.x = 0;
    if (Math.abs(this.offset.y) < 0.05) this.offset.y = 0;
  }

  get x(): number {
    return this.offset.x;
  }

  get y(): number {
    return this.offset.y;
  }

  reset(): void {
    this.offset.x = 0;
    this.offset.y = 0;
  }
}

/** Round-trip time estimator driven by ping/pong. */
export class LatencyTracker {
  private rtt = 100;
  private samples = 0;

  sample(rttMs: number): void {
    if (rttMs < 0 || rttMs > 4000) return;
    this.samples++;
    // Converge quickly from the initial guess, then settle.
    const weight = this.samples < 4 ? 0.5 : 0.15;
    this.rtt += (rttMs - this.rtt) * weight;
  }

  get rttMs(): number {
    return this.rtt;
  }

  get halfRttMs(): number {
    return this.rtt / 2;
  }
}
