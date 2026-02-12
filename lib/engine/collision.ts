import { Enemy, Player } from '@/types/game';
import { particlePool, projectilePool, enemyGrid, generateId } from './context';
import { emitWeaponImpactEffect } from './effects';
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

        // Damage number particle
        const dp = particlePool.acquire();
        dp.id = generateId();
        dp.position.x = projectile.position.x + (Math.random() - 0.5) * 8;
        dp.position.y = projectile.position.y - 5;
        dp.velocity.x = (Math.random() - 0.5) * 2.5;
        dp.velocity.y = -3.5;
        dp.color = COLORS.yellow;
        dp.size = 16;
        dp.life = 550;
        dp.maxLife = 550;
        dp.type = 'text';
        dp.text = Math.floor(actualDamage).toString();

        emitWeaponImpactEffect(projectile, enemy);

        // Enemy body-chip sparks
        for (let j = 0; j < 3; j++) {
          const sparkAngle = Math.random() * Math.PI * 2;
          const sparkSpeed = 2 + Math.random() * 3;
          const ep = particlePool.acquire();
          ep.id = generateId();
          ep.position.x = projectile.position.x;
          ep.position.y = projectile.position.y;
          ep.velocity.x = Math.cos(sparkAngle) * sparkSpeed;
          ep.velocity.y = Math.sin(sparkAngle) * sparkSpeed;
          ep.color = enemy.color;
          ep.size = 2 + Math.random() * 2;
          ep.life = 120 + Math.random() * 100;
          ep.maxLife = 220;
          ep.type = 'explosion';
        }

        // Missile explosion
        if (projectile.weaponType === 'missile' && projectile.explosionRadius) {
          const explosionRadius = projectile.explosionRadius;
          const explosionRadiusSq = explosionRadius * explosionRadius;
          missileShake += 18;

          // Tinted center pulse
          const flash = particlePool.acquire();
          flash.id = generateId();
          flash.position.x = projectile.position.x;
          flash.position.y = projectile.position.y;
          flash.velocity.x = 0;
          flash.velocity.y = 0;
          flash.color = COLORS.yellow;
          flash.size = explosionRadius * 0.26;
          flash.life = 90;
          flash.maxLife = 90;
          flash.type = 'ring';

          // Inner fire burst
          for (let j = 0; j < 30; j++) {
            const expAngle = (j / 30) * Math.PI * 2 + Math.random() * 0.3;
            const expSpeed = 2 + Math.random() * 6;
            const xp = particlePool.acquire();
            xp.id = generateId();
            xp.position.x = projectile.position.x + (Math.random() - 0.5) * 12;
            xp.position.y = projectile.position.y + (Math.random() - 0.5) * 12;
            xp.velocity.x = Math.cos(expAngle) * expSpeed;
            xp.velocity.y = Math.sin(expAngle) * expSpeed;
            xp.color = j % 3 === 0 ? COLORS.yellow : COLORS.orange;
            xp.size = 5 + Math.random() * 6;
            xp.life = 350 + Math.random() * 250;
            xp.maxLife = 600;
            xp.type = 'explosion';
          }

          // Fast outward sparks
          for (let j = 0; j < 15; j++) {
            const sparkAngle = Math.random() * Math.PI * 2;
            const sparkSpeed = 8 + Math.random() * 10;
            const sk = particlePool.acquire();
            sk.id = generateId();
            sk.position.x = projectile.position.x;
            sk.position.y = projectile.position.y;
            sk.velocity.x = Math.cos(sparkAngle) * sparkSpeed;
            sk.velocity.y = Math.sin(sparkAngle) * sparkSpeed;
            sk.color = j % 2 === 0 ? COLORS.yellow : COLORS.white;
            sk.size = 2 + Math.random() * 2;
            sk.life = 200 + Math.random() * 150;
            sk.maxLife = 350;
            sk.type = 'spark';
          }

          // Debris trails
          for (let j = 0; j < 8; j++) {
            const trailAngle = (j / 8) * Math.PI * 2 + Math.random() * 0.4;
            const trailSpeed = 6 + Math.random() * 4;
            const tl = particlePool.acquire();
            tl.id = generateId();
            tl.position.x = projectile.position.x;
            tl.position.y = projectile.position.y;
            tl.velocity.x = Math.cos(trailAngle) * trailSpeed;
            tl.velocity.y = Math.sin(trailAngle) * trailSpeed;
            tl.color = COLORS.orange;
            tl.size = 14;
            tl.life = 250;
            tl.maxLife = 250;
            tl.type = 'trail';
          }

          // Explosion shockwave rings
          const er1 = particlePool.acquire();
          er1.id = generateId();
          er1.position.x = projectile.position.x;
          er1.position.y = projectile.position.y;
          er1.velocity.x = 0;
          er1.velocity.y = 0;
          er1.color = COLORS.orange;
          er1.size = explosionRadius;
          er1.life = 400;
          er1.maxLife = 400;
          er1.type = 'ring';

          const er2 = particlePool.acquire();
          er2.id = generateId();
          er2.position.x = projectile.position.x;
          er2.position.y = projectile.position.y;
          er2.velocity.x = 0;
          er2.velocity.y = 0;
          er2.color = COLORS.yellow;
          er2.size = explosionRadius * 0.65;
          er2.life = 300;
          er2.maxLife = 300;
          er2.type = 'ring';

          const er3 = particlePool.acquire();
          er3.id = generateId();
          er3.position.x = projectile.position.x;
          er3.position.y = projectile.position.y;
          er3.velocity.x = 0;
          er3.velocity.y = 0;
          er3.color = COLORS.pink;
          er3.size = explosionRadius * 1.2;
          er3.life = 200;
          er3.maxLife = 200;
          er3.type = 'ring';

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

              const sdp = particlePool.acquire();
              sdp.id = generateId();
              sdp.position.x = otherEnemy.position.x;
              sdp.position.y = otherEnemy.position.y;
              sdp.velocity.x = (Math.random() - 0.5) * 2;
              sdp.velocity.y = -3;
              sdp.color = COLORS.orange;
              sdp.size = 12;
              sdp.life = 450;
              sdp.maxLife = 450;
              sdp.type = 'text';
              sdp.text = Math.floor(splashDamage).toString();

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
