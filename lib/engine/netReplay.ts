/**
 * Guest-side replay of the host's cosmetic events.
 *
 * Before this existed the guest received no particles at all — the wire format
 * carried none and none were generated locally — so the second player watched a
 * completely sterile version of the game. Now the host records *why* an effect
 * happened and the guest re-runs the same effect functions locally.
 */

import { Enemy, Projectile, WeaponType } from '@/types/game';
import { NetEvent, NetEventKind } from './netEvents';
import {
  createExplosion,
  createBlast,
  createPlayerHurtEffect,
  emitWeaponImpactEffect,
  emitText,
  emitParticle,
} from './effects';
import { COLORS } from '../colors';

// Scratch objects so replaying an event allocates nothing.
const scratchProjectile = {
  position: { x: 0, y: 0 },
  velocity: { x: 0, y: 0 },
  color: '#ffffff',
  weaponType: undefined as WeaponType | undefined,
} as unknown as Projectile;

const scratchEnemy = { color: '#ffffff' } as unknown as Enemy;

export interface ReplayHooks {
  /** Flash the matching enemy in the guest's local entity list. */
  onEnemyHit?: (enemyId: string) => void;
  onKill?: (x: number, y: number, radius: number, isBoss: boolean) => void;
  /** `isLocal` is true when the hurt avatar is the one this client drives. */
  onPlayerHurt?: (heavy: boolean, isLocal: boolean) => void;
  onBlast?: (x: number, y: number, radius: number) => void;
}

export function replayNetEvent(event: NetEvent, hooks: ReplayHooks = {}): void {
  const kind = event[0] as NetEventKind;

  switch (kind) {
    case NetEventKind.Hit: {
      // [kind, t, x, y, vx, vy, projColor, weaponType, damage, enemyColor, enemyId]
      const x = event[2] as number;
      const y = event[3] as number;
      scratchProjectile.position.x = x;
      scratchProjectile.position.y = y;
      scratchProjectile.velocity.x = event[4] as number;
      scratchProjectile.velocity.y = event[5] as number;
      scratchProjectile.color = event[6] as string;
      scratchProjectile.weaponType = ((event[7] as string) || undefined) as WeaponType | undefined;
      scratchEnemy.color = event[9] as string;

      emitWeaponImpactEffect(scratchProjectile, scratchEnemy);

      const damage = event[8] as number;
      const dmgWeight = Math.min(1, damage / 60);
      emitText(
        x + (Math.random() - 0.5) * 8,
        y - 5,
        Math.floor(damage).toString(),
        dmgWeight > 0.66 ? COLORS.orange : dmgWeight > 0.33 ? COLORS.yellow : COLORS.white,
        15 + dmgWeight * 15,
        520 + dmgWeight * 260,
        -3.5 - dmgWeight * 1.5,
      );

      const enemyColor = event[9] as string;
      for (let j = 0; j < 4; j++) {
        const a = Math.random() * Math.PI * 2;
        const speed = 3 + Math.random() * 5;
        emitParticle(x, y, {
          vx: Math.cos(a) * speed,
          vy: Math.sin(a) * speed,
          color: enemyColor,
          size: 2.5 + Math.random() * 2.5,
          life: 150 + Math.random() * 130,
          type: 'explosion',
          drag: 0.88,
        });
      }

      hooks.onEnemyHit?.(event[10] as string);
      break;
    }

    case NetEventKind.Kill: {
      // [kind, t, x, y, color, radius, isElite, isBoss]
      const x = event[2] as number;
      const y = event[3] as number;
      const color = event[4] as string;
      const radius = event[5] as number;
      const isElite = event[6] === 1;
      const isBoss = event[7] === 1;

      createExplosion({ x, y }, color, 25 + Math.floor(radius * 1.2));
      if (isElite) {
        emitParticle(x, y, {
          color,
          size: 32 + radius,
          life: 260,
          type: 'shockwave',
          drag: 1,
          fade: 1.5,
          glow: 1.3,
        });
      }
      hooks.onKill?.(x, y, radius, isBoss);
      break;
    }

    case NetEventKind.PlayerHurt: {
      // [kind, t, x, y, amount, heavy, owner] — owner 1 is the guest's avatar.
      const x = event[2] as number;
      const y = event[3] as number;
      const amount = event[4] as number;
      const heavy = event[5] === 1;
      const isLocal = event[6] === 1;

      createPlayerHurtEffect({ x, y }, heavy);
      emitText(x, y - 10, `-${amount}`, COLORS.pink, heavy ? 32 : 24, heavy ? 1200 : 800, -2.5);
      hooks.onPlayerHurt?.(heavy, isLocal);
      break;
    }

    case NetEventKind.Explosion: {
      // [kind, t, x, y, radius]
      const x = event[2] as number;
      const y = event[3] as number;
      const radius = event[4] as number;
      createBlast({ x, y }, radius, COLORS.yellow, COLORS.orange);
      hooks.onBlast?.(x, y, radius);
      break;
    }

    default:
      break;
  }
}

/** Host clock time an event should be played at. */
export function eventTime(event: NetEvent): number {
  return event[1] as number;
}
