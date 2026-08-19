/**
 * Guest-side reconstruction of the host's world.
 *
 * Everything the guest does not simulate itself lives here. Entities are
 * rendered on a delayed timeline and interpolated between the two snapshots
 * that bracket it, which converts jittery 25 Hz packets into continuous motion.
 * Entity objects are recycled across frames so a busy wave does not churn the
 * GC mid-fight.
 */

import { Enemy, EnemyType, GameState, Projectile } from '@/types/game';
import { DecodedSnapshot } from './multiplayer';
import {
  SnapshotBuffer,
  ClockSync,
  blend,
  computeInterpolationDelay,
} from './netcode';
import { NetEvent } from './engine/netEvents';
import { replayNetEvent, eventTime, ReplayHooks } from './engine/netReplay';

const SNAPSHOT_INTERVAL_MS = 40;

// `damage`, `points` and `speed` stay at their defaults: the guest never runs
// collision or AI, so those fields are deliberately absent from the wire.
function makeEnemy(): Enemy {
  return {
    id: '',
    position: { x: 0, y: 0 },
    velocity: { x: 0, y: 0 },
    radius: 12,
    color: '#ffffff',
    health: 1,
    maxHealth: 1,
    speed: 0,
    damage: 0,
    type: 'chaser' as EnemyType,
    points: 0,
    spawnTime: 0,
  };
}

// Likewise `damage` and `piercing` — render-only clients do not need them.
function makeProjectile(): Projectile {
  return {
    _active: true,
    _poolIndex: 0,
    id: '',
    nid: 0,
    position: { x: 0, y: 0 },
    velocity: { x: 0, y: 0 },
    radius: 5,
    color: '#ffffff',
    damage: 0,
    isEnemy: false,
    piercing: 0,
    hitEnemies: new Set<string>(),
  };
}

export class CoopGuestWorld {
  readonly buffer = new SnapshotBuffer<DecodedSnapshot>();
  readonly clock = new ClockSync();

  private enemyCache = new Map<string, Enemy>();
  private projectileCache = new Map<number, Projectile>();
  private pendingEvents: NetEvent[] = [];
  private lastEventTime = 0;

  /** Live arrays handed to the renderers. */
  enemies: Enemy[] = [];
  projectiles: Projectile[] = [];

  /** Most recent authoritative values (not interpolated). */
  latest: DecodedSnapshot | null = null;

  ingest(snapshot: DecodedSnapshot, localNowMs: number): void {
    this.clock.sample(snapshot.hostTime, localNowMs);
    this.buffer.push(snapshot.hostTime, snapshot);
    this.latest = snapshot;

    for (const event of snapshot.events) {
      // Snapshots resend nothing, but a reordered packet could; drop anything
      // older than what we've already scheduled.
      if (eventTime(event) < this.lastEventTime - 1000) continue;
      this.pendingEvents.push(event);
    }
    if (this.pendingEvents.length > 400) {
      this.pendingEvents.splice(0, this.pendingEvents.length - 400);
    }
  }

  get interpolationDelayMs(): number {
    return computeInterpolationDelay(SNAPSHOT_INTERVAL_MS, this.clock.jitterMs);
  }

  /** The host-clock instant currently being rendered. */
  renderTime(localNowMs: number): number {
    return this.clock.toHostTime(localNowMs) - this.interpolationDelayMs;
  }

  /**
   * Fires every cosmetic event whose moment has arrived on the delayed
   * timeline, so explosions land in step with the entity that caused them
   * rather than a frame before it visually dies.
   */
  replayDueEvents(renderTime: number, hooks: ReplayHooks): void {
    if (this.pendingEvents.length === 0) return;

    let consumed = 0;
    for (let i = 0; i < this.pendingEvents.length; i++) {
      const event = this.pendingEvents[i];
      if (eventTime(event) > renderTime) break;
      replayNetEvent(event, hooks);
      this.lastEventTime = eventTime(event);
      consumed++;
    }
    if (consumed > 0) this.pendingEvents.splice(0, consumed);
  }

  /**
   * Writes interpolated entity state into `state` for rendering.
   * Returns false when there is nothing buffered yet.
   */
  sample(renderTime: number, state: GameState): boolean {
    const window = this.buffer.sample(renderTime);
    if (!window) return false;

    const { from, to, alpha } = window;
    const a = Math.max(0, Math.min(1, alpha));
    // Extrapolation past the newest snapshot is allowed but capped, so a brief
    // stall coasts instead of freezing.
    const ex = alpha;

    // --- Host player ---------------------------------------------------------
    const p = state.player;
    p.position.x = blend(from.data.player.position.x, to.data.player.position.x, ex);
    p.position.y = blend(from.data.player.position.y, to.data.player.position.y, ex);
    p.velocity.x = to.data.player.velocity.x;
    p.velocity.y = to.data.player.velocity.y;
    p.health = to.data.player.health;
    p.maxHealth = to.data.player.maxHealth;
    p.radius = to.data.player.radius;
    p.invulnerableUntil = to.data.player.invulnerableUntil;
    p.level = to.data.player.level;
    p.experience = to.data.player.experience;
    p.kills = to.data.player.kills;
    p.weapons = to.data.player.weapons as typeof p.weapons;

    // --- Enemies -------------------------------------------------------------
    this.enemies.length = 0;
    const fromEnemies = new Map<string, DecodedSnapshot['enemies'][number]>();
    for (const e of from.data.enemies) fromEnemies.set(e.id, e);

    for (const next of to.data.enemies) {
      let enemy = this.enemyCache.get(next.id);
      if (!enemy) {
        enemy = makeEnemy();
        enemy.id = next.id;
        this.enemyCache.set(next.id, enemy);
      }

      const prev = fromEnemies.get(next.id);
      if (prev) {
        enemy.position.x = blend(prev.position.x, next.position.x, ex);
        enemy.position.y = blend(prev.position.y, next.position.y, ex);
      } else {
        // Spawned between the two snapshots — walk it back from its velocity so
        // it eases in rather than popping at full size mid-arena.
        const dt = (to.time - renderTime) / 16.667;
        enemy.position.x = next.position.x - next.velocity.x * Math.max(0, dt);
        enemy.position.y = next.position.y - next.velocity.y * Math.max(0, dt);
      }

      enemy.velocity.x = next.velocity.x;
      enemy.velocity.y = next.velocity.y;
      enemy.health = next.health;
      enemy.maxHealth = next.maxHealth;
      enemy.type = next.type as EnemyType;
      enemy.radius = next.radius;
      enemy.color = next.color;
      enemy.ghostAlpha = next.ghostAlpha;
      enemy.spawnTime = next.spawnTime;
      enemy.isElite = next.isElite;
      this.enemies.push(enemy);
    }

    // Retire cache entries for enemies that are gone.
    if (this.enemyCache.size > this.enemies.length * 2 + 32) {
      const live = new Set(this.enemies.map(e => e.id));
      for (const id of Array.from(this.enemyCache.keys())) {
        if (!live.has(id)) this.enemyCache.delete(id);
      }
    }

    // --- Projectiles ---------------------------------------------------------
    this.projectiles.length = 0;
    const fromProjectiles = new Map<number, DecodedSnapshot['projectiles'][number]>();
    for (const pr of from.data.projectiles) fromProjectiles.set(pr.nid, pr);

    for (const next of to.data.projectiles) {
      let proj = this.projectileCache.get(next.nid);
      if (!proj) {
        proj = makeProjectile();
        proj.nid = next.nid;
        proj.id = `n${next.nid}`;
        this.projectileCache.set(next.nid, proj);
      }

      const prev = fromProjectiles.get(next.nid);
      if (prev) {
        proj.position.x = blend(prev.position.x, next.position.x, ex);
        proj.position.y = blend(prev.position.y, next.position.y, ex);
      } else {
        // Fired between snapshots: dead-reckon backwards along its own
        // velocity, which is exact for linear projectiles.
        const dt = (to.time - renderTime) / 16.667;
        proj.position.x = next.position.x - next.velocity.x * Math.max(0, dt);
        proj.position.y = next.position.y - next.velocity.y * Math.max(0, dt);
      }

      proj.velocity.x = next.velocity.x;
      proj.velocity.y = next.velocity.y;
      proj.radius = next.radius;
      proj.color = next.color;
      proj.isEnemy = next.isEnemy;
      this.projectiles.push(proj);
    }

    if (this.projectileCache.size > this.projectiles.length * 2 + 64) {
      const live = new Set(this.projectiles.map(pr => pr.nid));
      for (const nid of Array.from(this.projectileCache.keys())) {
        if (!live.has(nid)) this.projectileCache.delete(nid);
      }
    }

    // --- Everything else is either static or too slow to need interpolation ---
    state.enemies = this.enemies;
    state.projectiles = this.projectiles;
    state.projectileCount = this.projectiles.length;
    state.powerups = to.data.powerups as typeof state.powerups;
    state.experienceOrbs = to.data.experienceOrbs as typeof state.experienceOrbs;
    state.experienceOrbCount = to.data.experienceOrbs.length;

    state.score = to.data.score;
    state.wave = to.data.wave;
    state.multiplier = to.data.multiplier;
    state.killStreak = to.data.killStreak;
    state.nearMissCount = to.data.nearMissCount;
    state.gameTime = to.data.gameTime;
    state.screenShake = blend(from.data.screenShake, to.data.screenShake, a);
    state.isGameOver = to.data.isGameOver;
    state.isRunning = to.data.isRunning;
    state.activeEvent = to.data.activeEvent as GameState['activeEvent'];
    state.eventAnnounceTime = to.data.eventAnnounceTime;
    state.waveAnnounceTime = to.data.waveAnnounceTime;

    return true;
  }

  /** Marks an enemy as freshly hit so the renderer flashes it. */
  flashEnemy(id: string, at: number): void {
    const enemy = this.enemyCache.get(id);
    if (enemy) enemy.hitFlash = at;
  }

  reset(): void {
    this.buffer.clear();
    this.enemyCache.clear();
    this.projectileCache.clear();
    this.pendingEvents.length = 0;
    this.enemies.length = 0;
    this.projectiles.length = 0;
    this.latest = null;
  }
}
