import { Enemy, Player } from '@/types/game';
import { projectilePool, enemyGrid } from './context';
import { emitWeaponImpactEffect, emitText, createBlast, emitParticle } from './effects';
import { recordEvent, NetEventKind } from './netEvents';
import { COLORS } from '../colors';

export function checkProjectileCollisions(
  enemies: Enemy[],
  currentTime: number
): {
  updatedEnemies: Enemy[];
  killedEnemies: Enemy[];
  damageDealt: number;
  missileShake: number;
} {
  const killedEnemies: Enemy[] = [];
  const killedEnemyIds = new Set<string>();
  let updatedEnemies = [...enemies];
  let damageDealt = 0;
  let missileShake = 0;

  // Build spatial grid for enemies
  enemyGrid.clear();
  for (let i = 0; i < updatedEnemies.length; i++) {
    enemyGrid.insert(i, updatedEnemies[i].position.x, updatedEnemies[i].position.y);
  }

  projectilePool.forEach(projectile => {
    if (projectile.isEnemy) return true; // keep

    // Query nearby enemies via spatial grid
    let shouldRemove = false;
    enemyGrid.query(projectile.position.x, projectile.position.y, (enemyIdx) => {
      if (shouldRemove) return;
      if (enemyIdx >= updatedEnemies.length) return;
      const enemy = updatedEnemies[enemyIdx];
      if (!enemy || killedEnemyIds.has(enemy.id)) return;
      if (projectile.hitEnemies.has(enemy.id)) return;

      const dx = enemy.position.x - projectile.position.x;
      const dy = enemy.position.y - projectile.position.y;
      const distSq = dx * dx + dy * dy;
      const radiiSum = enemy.radius + projectile.radius;

      if (distSq < radiiSum * radiiSum) {
        // Hit!
        projectile.hitEnemies.add(enemy.id);

        let actualDamage = projectile.damage;
        // Boss shield: reduce damage 90%, deplete shield HP first
        if (enemy.bossShieldHP && enemy.bossShieldHP > 0) {
          actualDamage *= 0.1;
          enemy.bossShieldHP -= projectile.damage;
        }

        enemy.health -= actualDamage;
        damageDealt += actualDamage;

        // Render-side hit feedback: a bright flash frame plus a shove along the
        // projectile's travel direction. Bosses are immovable.
        enemy.hitFlash = currentTime;
        if (enemy.type !== 'boss') {
          const pSpeed = Math.hypot(projectile.velocity.x, projectile.velocity.y) || 1;
          // Lighter enemies get shoved further.
          const punch = Math.min(7, (12 / Math.max(6, enemy.radius)) * 3.2);
          if (!enemy.knockback) enemy.knockback = { x: 0, y: 0 };
          enemy.knockback.x += (projectile.velocity.x / pSpeed) * punch;
          enemy.knockback.y += (projectile.velocity.y / pSpeed) * punch;
        }

        // Damage number — bigger and hotter for bigger hits so chip damage and
        // heavy hits are distinguishable at a glance.
        const dmgWeight = Math.min(1, actualDamage / 60);
        emitText(
          projectile.position.x + (Math.random() - 0.5) * 8,
          projectile.position.y - 5,
          Math.floor(actualDamage).toString(),
          dmgWeight > 0.66 ? COLORS.orange : dmgWeight > 0.33 ? COLORS.yellow : COLORS.white,
          15 + dmgWeight * 15,
          520 + dmgWeight * 260,
          -3.5 - dmgWeight * 1.5,
        );

        emitWeaponImpactEffect(projectile, enemy);
        recordEvent([
          NetEventKind.Hit,
          currentTime,
          Math.round(projectile.position.x),
          Math.round(projectile.position.y),
          Math.round(projectile.velocity.x * 10) / 10,
          Math.round(projectile.velocity.y * 10) / 10,
          projectile.color,
          projectile.weaponType || '',
          Math.round(actualDamage),
          enemy.color,
          enemy.id,
        ]);

        // Enemy body-chip sparks
        for (let j = 0; j < 4; j++) {
          const sparkAngle = Math.random() * Math.PI * 2;
          const sparkSpeed = 3 + Math.random() * 5;
          emitParticle(projectile.position.x, projectile.position.y, {
            vx: Math.cos(sparkAngle) * sparkSpeed,
            vy: Math.sin(sparkAngle) * sparkSpeed,
            color: enemy.color,
            size: 2.5 + Math.random() * 2.5,
            life: 150 + Math.random() * 130,
            type: 'explosion',
            drag: 0.88,
          });
        }

        // Missile explosion
        if (projectile.weaponType === 'missile' && projectile.explosionRadius) {
          const explosionRadius = projectile.explosionRadius;
          const explosionRadiusSq = explosionRadius * explosionRadius;
          missileShake += 26;

          createBlast(projectile.position, explosionRadius, COLORS.yellow, COLORS.orange);
          recordEvent([
            NetEventKind.Explosion,
            currentTime,
            Math.round(projectile.position.x),
            Math.round(projectile.position.y),
            Math.round(explosionRadius),
          ]);

          // Damage enemies in explosion radius via spatial grid
          enemyGrid.queryRadius(projectile.position.x, projectile.position.y, explosionRadius, (otherIdx) => {
            if (otherIdx >= updatedEnemies.length) return;
            const otherEnemy = updatedEnemies[otherIdx];
            if (!otherEnemy || otherEnemy.id === enemy.id || killedEnemyIds.has(otherEnemy.id)) return;

            const edx = otherEnemy.position.x - projectile.position.x;
            const edy = otherEnemy.position.y - projectile.position.y;
            const eDistSq = edx * edx + edy * edy;

            if (eDistSq < explosionRadiusSq) {
              const eDist = Math.sqrt(eDistSq);
              const falloff = 1 - (eDist / explosionRadius) * 0.5;
              const splashDamage = projectile.damage * falloff * 0.7;
              otherEnemy.health -= splashDamage;

              otherEnemy.hitFlash = currentTime;
              emitText(
                otherEnemy.position.x,
                otherEnemy.position.y,
                Math.floor(splashDamage).toString(),
                COLORS.orange,
                14,
                450,
                -3,
              );

              if (otherEnemy.health <= 0 && !killedEnemyIds.has(otherEnemy.id)) {
                killedEnemies.push(otherEnemy);
                killedEnemyIds.add(otherEnemy.id);
              }
            }
          });
        }

        if (enemy.health <= 0 && !killedEnemyIds.has(enemy.id)) {
          killedEnemies.push(enemy);
          killedEnemyIds.add(enemy.id);
        }

        if (projectile.piercing <= 0) {
          shouldRemove = true;
          return;
        }
        projectile.piercing--;
      }
    });

    if (shouldRemove) return false; // release projectile
    return true; // keep
  });

  // Remove killed enemies
  if (killedEnemyIds.size > 0) {
    updatedEnemies = updatedEnemies.filter(e => !killedEnemyIds.has(e.id));
  }

  return { updatedEnemies, killedEnemies, damageDealt, missileShake };
}

export function checkEnemyPlayerCollision(
  enemies: Enemy[],
  player: Player,
  currentTime: number
): { hit: boolean; damage: number } {
  for (const enemy of enemies) {
    const dx = player.position.x - enemy.position.x;
    const dy = player.position.y - enemy.position.y;
    const distSq = dx * dx + dy * dy;
    const radiiSum = player.radius + enemy.radius;

    if (distSq < radiiSum * radiiSum) {
      return { hit: true, damage: enemy.damage };
    }
  }
  return { hit: false, damage: 0 };
}

/**
 * Check if any enemy projectiles (isEnemy=true) hit the player.
 * Releases projectiles that hit.
 */
export function checkEnemyProjectilePlayerCollision(
  player: Player,
  currentTime: number,
): { hit: boolean; totalDamage: number } {
  let totalDamage = 0;
  let hit = false;

  projectilePool.forEach(projectile => {
    if (!projectile.isEnemy) return true; // keep — not an enemy projectile

    // Check lifetime
    if (projectile.lifetime !== undefined) {
      projectile.lifetime -= 16; // approximate frame time
      if (projectile.lifetime <= 0) return false; // release expired
    }

    const dx = player.position.x - projectile.position.x;
    const dy = player.position.y - projectile.position.y;
    const distSq = dx * dx + dy * dy;
    const radiiSum = player.radius + projectile.radius;

    if (distSq < radiiSum * radiiSum) {
      totalDamage += projectile.damage;
      hit = true;
      return false; // release — hit player
    }

    return true; // keep
  });

  return { hit, totalDamage };
}
