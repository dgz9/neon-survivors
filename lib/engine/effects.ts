import { Vector2, Projectile, Enemy, WeaponType } from '@/types/game';
import { particlePool, generateId } from './context';
import { COLORS } from '../colors';

export function createExplosion(position: Vector2, color: string, count: number): void {
  // Inner burst
  for (let i = 0; i < count; i++) {
    const angle = (Math.PI * 2 * i) / count + Math.random() * 0.5;
    const speed = 4 + Math.random() * 6;

    const p = particlePool.acquire();
    p.id = generateId();
    p.position.x = position.x + (Math.random() - 0.5) * 10;
    p.position.y = position.y + (Math.random() - 0.5) * 10;
    p.velocity.x = Math.cos(angle) * speed;
    p.velocity.y = Math.sin(angle) * speed;
    p.color = color;
    p.size = 3 + Math.random() * 3;
    p.life = 400 + Math.random() * 200;
    p.maxLife = 600;
    p.type = 'explosion';
  }

  // Outer ring
  const outerCount = Math.floor(count / 2);
  for (let i = 0; i < outerCount; i++) {
    const angle = (Math.PI * 2 * i) / outerCount + Math.random() * 0.3;
    const speed = 1 + Math.random() * 2;

    const p = particlePool.acquire();
    p.id = generateId();
    p.position.x = position.x;
    p.position.y = position.y;
    p.velocity.x = Math.cos(angle) * speed;
    p.velocity.y = Math.sin(angle) * speed;
    p.color = Math.random() < 0.25 ? COLORS.white : color;
    p.size = 1.5 + Math.random() * 1.5;
    p.life = 220 + Math.random() * 140;
    p.maxLife = 360;
    p.type = 'spark';
  }

  // Line trails
  for (let i = 0; i < 6; i++) {
    const angle = (Math.PI * 2 * i) / 6;
    const p = particlePool.acquire();
    p.id = generateId();
    p.position.x = position.x;
    p.position.y = position.y;
    p.velocity.x = Math.cos(angle) * 8;
    p.velocity.y = Math.sin(angle) * 8;
    p.color = color;
    p.size = 12;
    p.life = 200;
    p.maxLife = 200;
    p.type = 'trail';
  }
}

export function emitWeaponImpactEffect(projectile: Projectile, enemy: Enemy): void {
  const impactX = projectile.position.x;
  const impactY = projectile.position.y;
  const baseAngle = Math.atan2(projectile.velocity.y, projectile.velocity.x);

  switch (projectile.weaponType) {
    case 'blaster': {
      for (let j = 0; j < 7; j++) {
        const sparkAngle = baseAngle + (Math.random() - 0.5) * 1.2;
        const sparkSpeed = 2 + Math.random() * 4;
        const sp = particlePool.acquire();
        sp.id = generateId();
        sp.position.x = impactX;
        sp.position.y = impactY;
        sp.velocity.x = Math.cos(sparkAngle) * sparkSpeed;
        sp.velocity.y = Math.sin(sparkAngle) * sparkSpeed;
        sp.color = COLORS.cyan;
        sp.size = 2 + Math.random() * 2;
        sp.life = 160 + Math.random() * 100;
        sp.maxLife = 260;
        sp.type = 'spark';
      }
      break;
    }
    case 'spread': {
      for (let j = 0; j < 9; j++) {
        const shardAngle = baseAngle + (Math.random() - 0.5) * 1.8;
        const shardSpeed = 3 + Math.random() * 5;
        const sp = particlePool.acquire();
        sp.id = generateId();
        sp.position.x = impactX;
        sp.position.y = impactY;
        sp.velocity.x = Math.cos(shardAngle) * shardSpeed;
        sp.velocity.y = Math.sin(shardAngle) * shardSpeed;
        sp.color = j % 2 === 0 ? COLORS.yellow : COLORS.orange;
        sp.size = 2.5 + Math.random() * 2;
        sp.life = 140 + Math.random() * 120;
        sp.maxLife = 260;
        sp.type = 'spark';
      }
      break;
    }
    case 'laser': {
      for (let j = 0; j < 3; j++) {
        const tl = particlePool.acquire();
        tl.id = generateId();
        tl.position.x = impactX;
        tl.position.y = impactY;
        tl.velocity.x = Math.cos(baseAngle + (Math.random() - 0.5) * 0.3) * (6 + Math.random() * 4);
        tl.velocity.y = Math.sin(baseAngle + (Math.random() - 0.5) * 0.3) * (6 + Math.random() * 4);
        tl.color = j === 2 ? COLORS.white : COLORS.pink;
        tl.size = 10;
        tl.life = 120 + j * 20;
        tl.maxLife = 120 + j * 20;
        tl.type = 'trail';
      }
      break;
    }
    case 'orbit': {
      for (let j = 0; j < 10; j++) {
        const a = (j / 10) * Math.PI * 2 + Math.random() * 0.2;
        const sp = particlePool.acquire();
        sp.id = generateId();
        sp.position.x = impactX;
        sp.position.y = impactY;
        sp.velocity.x = Math.cos(a) * (2 + Math.random() * 3.5);
        sp.velocity.y = Math.sin(a) * (2 + Math.random() * 3.5);
        sp.color = COLORS.purple;
        sp.size = 2 + Math.random() * 2.5;
        sp.life = 180 + Math.random() * 140;
        sp.maxLife = 320;
        sp.type = 'spark';
      }
      break;
    }
    default: {
      for (let j = 0; j < 6; j++) {
        const sparkAngle = Math.random() * Math.PI * 2;
        const sparkSpeed = 2 + Math.random() * 4;
        const sp = particlePool.acquire();
        sp.id = generateId();
        sp.position.x = impactX;
        sp.position.y = impactY;
        sp.velocity.x = Math.cos(sparkAngle) * sparkSpeed;
        sp.velocity.y = Math.sin(sparkAngle) * sparkSpeed;
        sp.color = projectile.color;
        sp.size = 2 + Math.random() * 2;
        sp.life = 160 + Math.random() * 120;
        sp.maxLife = 280;
        sp.type = 'spark';
      }
      break;
    }
  }

  const ir = particlePool.acquire();
  ir.id = generateId();
  ir.position.x = impactX;
  ir.position.y = impactY;
  ir.velocity.x = 0;
  ir.velocity.y = 0;
  ir.color = projectile.color;
  ir.size = projectile.weaponType === 'laser' ? 26 : projectile.weaponType === 'spread' ? 18 : 14;
  ir.life = projectile.weaponType === 'laser' ? 130 : 170;
  ir.maxLife = projectile.weaponType === 'laser' ? 130 : 170;
  ir.type = 'ring';

  if (projectile.weaponType !== 'missile') {
    const sr = particlePool.acquire();
    sr.id = generateId();
    sr.position.x = impactX;
    sr.position.y = impactY;
    sr.velocity.x = 0;
    sr.velocity.y = 0;
    sr.color = enemy.color;
    sr.size = 11;
    sr.life = 120;
    sr.maxLife = 120;
    sr.type = 'ring';
  }
}
