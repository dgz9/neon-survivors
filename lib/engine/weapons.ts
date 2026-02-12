import { Player, Vector2, WEAPON_CONFIGS } from '@/types/game';
import { particlePool, projectilePool, generateId } from './context';
import { COLORS } from '../colors';

export function emitWeaponMuzzleEffect(
  weaponType: string,
  origin: Vector2,
  shotAngle: number,
  level: number
): void {
  switch (weaponType) {
    case 'blaster': {
      const sp = particlePool.acquire();
      sp.id = generateId();
      sp.position.x = origin.x + Math.cos(shotAngle) * 16;
      sp.position.y = origin.y + Math.sin(shotAngle) * 16;
      sp.velocity.x = Math.cos(shotAngle) * (5 + level * 0.6);
      sp.velocity.y = Math.sin(shotAngle) * (5 + level * 0.6);
      sp.color = COLORS.cyan;
      sp.size = 3 + level * 0.2;
      sp.life = 140;
      sp.maxLife = 140;
      sp.type = 'spark';
      break;
    }
    case 'spread': {
      for (let i = 0; i < 2; i++) {
        const a = shotAngle + (Math.random() - 0.5) * 0.5;
        const sp = particlePool.acquire();
        sp.id = generateId();
        sp.position.x = origin.x + Math.cos(a) * 14;
        sp.position.y = origin.y + Math.sin(a) * 14;
        sp.velocity.x = Math.cos(a) * (4 + Math.random() * 2);
        sp.velocity.y = Math.sin(a) * (4 + Math.random() * 2);
        sp.color = i % 2 === 0 ? COLORS.yellow : COLORS.orange;
        sp.size = 2.5 + Math.random() * 1.5;
        sp.life = 120 + Math.random() * 60;
        sp.maxLife = 180;
        sp.type = 'spark';
      }
      break;
    }
    case 'laser': {
      for (let i = 0; i < 2; i++) {
        const tl = particlePool.acquire();
        tl.id = generateId();
        tl.position.x = origin.x + Math.cos(shotAngle) * (10 + i * 8);
        tl.position.y = origin.y + Math.sin(shotAngle) * (10 + i * 8);
        tl.velocity.x = Math.cos(shotAngle) * (8 + i * 4);
        tl.velocity.y = Math.sin(shotAngle) * (8 + i * 4);
        tl.color = i === 0 ? COLORS.pink : COLORS.white;
        tl.size = 8 + level * 0.5;
        tl.life = 90 + i * 40;
        tl.maxLife = 130 + i * 40;
        tl.type = 'trail';
      }
      break;
    }
    case 'missile': {
      const ring = particlePool.acquire();
      ring.id = generateId();
      ring.position.x = origin.x + Math.cos(shotAngle) * 12;
      ring.position.y = origin.y + Math.sin(shotAngle) * 12;
      ring.velocity.x = 0;
      ring.velocity.y = 0;
      ring.color = COLORS.orange;
      ring.size = 20 + level * 2;
      ring.life = 140;
      ring.maxLife = 140;
      ring.type = 'ring';
      break;
    }
    default:
      break;
  }
}

export function emitProjectileSignatureTrail(projectile: { position: Vector2; velocity: Vector2; orbit?: unknown; weaponType?: string }): void {
  if (projectile.orbit || !projectile.weaponType) {
    if (projectile.orbit && Math.random() < 0.25) {
      const op = particlePool.acquire();
      op.id = generateId();
      op.position.x = projectile.position.x;
      op.position.y = projectile.position.y;
      op.velocity.x = (Math.random() - 0.5) * 1.2;
      op.velocity.y = (Math.random() - 0.5) * 1.2;
      op.color = COLORS.purple;
      op.size = 2 + Math.random() * 2;
      op.life = 120 + Math.random() * 80;
      op.maxLife = 200;
      op.type = 'spark';
    }
    return;
  }

  switch (projectile.weaponType) {
    case 'blaster': {
      if (Math.random() < 0.55) {
        const tp = particlePool.acquire();
        tp.id = generateId();
        tp.position.x = projectile.position.x - projectile.velocity.x * 0.18;
        tp.position.y = projectile.position.y - projectile.velocity.y * 0.18;
        tp.velocity.x = -projectile.velocity.x * 0.03 + (Math.random() - 0.5) * 1.2;
        tp.velocity.y = -projectile.velocity.y * 0.03 + (Math.random() - 0.5) * 1.2;
        tp.color = COLORS.cyan;
        tp.size = 2 + Math.random() * 1.5;
        tp.life = 120 + Math.random() * 80;
        tp.maxLife = 200;
        tp.type = 'spark';
      }
      break;
    }
    case 'spread': {
      if (Math.random() < 0.4) {
        const tp = particlePool.acquire();
        tp.id = generateId();
        tp.position.x = projectile.position.x - projectile.velocity.x * 0.16;
        tp.position.y = projectile.position.y - projectile.velocity.y * 0.16;
        tp.velocity.x = -projectile.velocity.x * 0.02 + (Math.random() - 0.5) * 1.6;
        tp.velocity.y = -projectile.velocity.y * 0.02 + (Math.random() - 0.5) * 1.6;
        tp.color = Math.random() < 0.5 ? COLORS.yellow : COLORS.orange;
        tp.size = 2 + Math.random() * 2;
        tp.life = 110 + Math.random() * 80;
        tp.maxLife = 190;
        tp.type = 'spark';
      }
      break;
    }
    case 'laser': {
      const tl = particlePool.acquire();
      tl.id = generateId();
      tl.position.x = projectile.position.x - projectile.velocity.x * 0.22;
      tl.position.y = projectile.position.y - projectile.velocity.y * 0.22;
      tl.velocity.x = -projectile.velocity.x * 0.05;
      tl.velocity.y = -projectile.velocity.y * 0.05;
      tl.color = COLORS.pink;
      tl.size = 6;
      tl.life = 90;
      tl.maxLife = 90;
      tl.type = 'trail';

      if (Math.random() < 0.2) {
        const ring = particlePool.acquire();
        ring.id = generateId();
        ring.position.x = projectile.position.x;
        ring.position.y = projectile.position.y;
        ring.velocity.x = 0;
        ring.velocity.y = 0;
        ring.color = COLORS.pink;
        ring.size = 8;
        ring.life = 70;
        ring.maxLife = 70;
        ring.type = 'ring';
      }
      break;
    }
    case 'missile': {
      const tp = particlePool.acquire();
      tp.id = generateId();
      tp.position.x = projectile.position.x - projectile.velocity.x * 0.3 + (Math.random() - 0.5) * 4;
      tp.position.y = projectile.position.y - projectile.velocity.y * 0.3 + (Math.random() - 0.5) * 4;
      tp.velocity.x = -projectile.velocity.x * 0.05 + (Math.random() - 0.5) * 1.5;
      tp.velocity.y = -projectile.velocity.y * 0.05 + (Math.random() - 0.5) * 1.5;
      tp.color = COLORS.orange;
      tp.size = 4 + Math.random() * 3;
      tp.life = 200 + Math.random() * 100;
      tp.maxLife = 300;
      tp.type = 'explosion';

      if (Math.random() < 0.5) {
        const sp = particlePool.acquire();
        sp.id = generateId();
        sp.position.x = projectile.position.x - projectile.velocity.x * 0.5 + (Math.random() - 0.5) * 6;
        sp.position.y = projectile.position.y - projectile.velocity.y * 0.5 + (Math.random() - 0.5) * 6;
        sp.velocity.x = (Math.random() - 0.5) * 0.8;
        sp.velocity.y = (Math.random() - 0.5) * 0.8 - 0.5;
        sp.color = '#888888';
        sp.size = 5 + Math.random() * 4;
        sp.life = 300 + Math.random() * 200;
        sp.maxLife = 500;
        sp.type = 'spark';
      }
      break;
    }
    default:
      break;
  }
}

export function fireWeapons(player: Player, mousePos: Vector2, currentTime: number, metaDamageMultiplier: number = 1): void {
  const damageBuff = player.activeBuffs.find(b => b.type === 'damage');
  const damageMultiplier = (damageBuff ? damageBuff.multiplier : 1) * metaDamageMultiplier;

  player.weapons.forEach(weapon => {
    if (currentTime - weapon.lastFired < weapon.fireRate) return;
    weapon.lastFired = currentTime;

    const config = WEAPON_CONFIGS[weapon.type];

    if (weapon.type === 'orbit') {
      const orbitCount = Math.min(5, 2 + weapon.level);
      for (let i = 0; i < orbitCount; i++) {
        const orbitAngle = (i / orbitCount) * Math.PI * 2;
        const p = projectilePool.acquire();
        p.id = generateId();
        p.position.x = player.position.x;
        p.position.y = player.position.y;
        p.velocity.x = 0;
        p.velocity.y = 0;
        p.radius = 7 + weapon.level * 0.6;
        p.color = config.color;
        p.damage = weapon.damage * (1 + (weapon.level - 1) * 0.12) * damageMultiplier;
        p.isEnemy = false;
        p.piercing = 4 + weapon.level;
        p.orbit = {
          angle: orbitAngle,
          radius: 68 + weapon.level * 9,
          speed: 0.032 + weapon.level * 0.005,
          owner: player.position,
        };
        p.lifetime = Math.max(420, weapon.fireRate * 0.9);
        p.weaponType = 'orbit';
      }
      if (Math.random() < 0.4) {
        const pulse = particlePool.acquire();
        pulse.id = generateId();
        pulse.position.x = player.position.x;
        pulse.position.y = player.position.y;
        pulse.velocity.x = 0;
        pulse.velocity.y = 0;
        pulse.color = COLORS.purple;
        pulse.size = 26 + weapon.level * 2;
        pulse.life = 180;
        pulse.maxLife = 180;
        pulse.type = 'ring';
      }
      return;
    }

    const angle = Math.atan2(
      mousePos.y - player.position.y,
      mousePos.x - player.position.x
    );

    for (let i = 0; i < weapon.projectileCount; i++) {
      let projectileAngle = angle;

      if (weapon.projectileCount > 1) {
        const spread = weapon.type === 'spread' ? Math.PI / 3 : Math.PI / 6;
        projectileAngle = angle - spread / 2 + (spread * i / (weapon.projectileCount - 1));
      }

      const p = projectilePool.acquire();
      p.id = generateId();
      p.position.x = player.position.x;
      p.position.y = player.position.y;
      p.velocity.x = Math.cos(projectileAngle) * weapon.projectileSpeed;
      p.velocity.y = Math.sin(projectileAngle) * weapon.projectileSpeed;
      p.radius = weapon.type === 'missile' ? 10 : 6;
      p.color = config.color;
      p.damage = weapon.damage * (1 + (weapon.level - 1) * 0.2) * damageMultiplier;
      p.isEnemy = false;
      p.piercing = weapon.piercing;
      p.weaponType = weapon.type;
      p.explosionRadius = weapon.type === 'missile' ? 80 + weapon.level * 20 : undefined;
      emitWeaponMuzzleEffect(weapon.type, player.position, projectileAngle, weapon.level);
    }
  });
}
