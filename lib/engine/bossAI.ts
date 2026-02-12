import { Enemy, Player, Vector2 } from '@/types/game';
import { projectilePool, particlePool, generateId } from './context';
import { COLORS } from '../colors';
import { spawnEnemy } from './enemies';

type BossPhase = NonNullable<Enemy['bossPhase']>;

const PHASE_DURATIONS: Record<BossPhase, number> = {
  enter: 2000,
  chase: 4000,
  ring_shot: 3000,
  spiral_shot: 5000,
  dash: 2000,
  summon: 3000,
  shield: 6000,
  rage: Infinity,
};

/**
 * Initialize boss state after spawning.
 * bossLevel determines attack complexity (wave / 5).
 */
export function initBossState(enemy: Enemy, bossLevel: number): Enemy {
  return {
    ...enemy,
    bossPhase: 'enter',
    bossTimer: Date.now(),
    bossPatternAngle: 0,
    bossPatternStep: 0,
    bossShieldHP: undefined,
    bossLevel: bossLevel,
    lastShot: 0,
  };
}

/**
 * Get the next phase in the boss sequence.
 * Higher boss levels unlock more phases.
 */
function getNextPhase(currentPhase: BossPhase, bossLevel: number, healthPct: number): BossPhase {
  // Rage at low health
  if (healthPct < 0.25) return 'rage';

  const baseSequence: BossPhase[] = ['chase', 'ring_shot', 'chase', 'summon'];
  const advancedPhases: BossPhase[] = [];

  if (bossLevel >= 2) advancedPhases.push('spiral_shot');
  if (bossLevel >= 3) advancedPhases.push('dash');
  if (bossLevel >= 4) advancedPhases.push('shield');

  // Build full cycle
  const cycle = [...baseSequence];
  if (advancedPhases.length > 0) {
    // Interleave advanced phases: chase -> advanced -> chase -> ring_shot -> ...
    cycle.splice(2, 0, advancedPhases[Math.floor(Math.random() * advancedPhases.length)]);
  }

  // Find current phase in cycle and advance
  const idx = cycle.indexOf(currentPhase);
  if (idx >= 0 && idx < cycle.length - 1) return cycle[idx + 1];
  return cycle[0]; // restart
}

/**
 * Main boss update — called every tick for boss-type enemies.
 * Returns the updated enemy and any newly spawned enemies (minions).
 */
export function updateBoss(
  enemy: Enemy,
  player: Player,
  deltaTime: number,
  currentTime: number,
  width: number,
  height: number,
  player2?: Player | null,
): { enemy: Enemy; spawnedEnemies: Enemy[] } {
  const spawnedEnemies: Enemy[] = [];
  let e = { ...enemy };

  const bossLevel = e.bossLevel || 1;
  const phase = e.bossPhase || 'chase';
  const phaseStart = e.bossTimer || currentTime;
  const elapsed = currentTime - phaseStart;
  const healthPct = e.health / e.maxHealth;

  // Pick nearest player
  let target = player;
  if (player2 && player2.health > 0) {
    const d1 = Math.hypot(player.position.x - e.position.x, player.position.y - e.position.y);
    const d2 = Math.hypot(player2.position.x - e.position.x, player2.position.y - e.position.y);
    if (player.health <= 0 || d2 < d1) target = player2;
  }

  const dx = target.position.x - e.position.x;
  const dy = target.position.y - e.position.y;
  const dist = Math.sqrt(dx * dx + dy * dy);
  const nx = dist > 0 ? dx / dist : 0;
  const ny = dist > 0 ? dy / dist : 0;

  switch (phase) {
    case 'enter': {
      // Fly onto screen to y=150
      const targetY = 150;
      if (e.position.y < targetY) {
        e.position.y += 3 * deltaTime;
      }
      if (elapsed >= PHASE_DURATIONS.enter || e.position.y >= targetY) {
        e.bossPhase = 'chase';
        e.bossTimer = currentTime;
      }
      break;
    }

    case 'chase': {
      // Standard chase toward nearest player
      e.position.x += nx * e.speed * deltaTime;
      e.position.y += ny * e.speed * deltaTime;
      e.velocity = { x: nx * e.speed, y: ny * e.speed };

      if (elapsed >= PHASE_DURATIONS.chase) {
        e.bossPhase = getNextPhase(phase, bossLevel, healthPct);
        e.bossTimer = currentTime;
        e.bossPatternAngle = 0;
        e.bossPatternStep = 0;
      }
      break;
    }

    case 'ring_shot': {
      // Slow chase + fire ring of bullets
      e.position.x += nx * e.speed * 0.3 * deltaTime;
      e.position.y += ny * e.speed * 0.3 * deltaTime;

      const ringInterval = 500;
      const lastShot = e.lastShot || 0;
      if (currentTime - lastShot >= ringInterval) {
        e.lastShot = currentTime;
        const bulletCount = 8 + 4 * bossLevel;
        const bulletSpeed = 5 + bossLevel * 0.5;
        for (let i = 0; i < bulletCount; i++) {
          const angle = (i / bulletCount) * Math.PI * 2;
          const p = projectilePool.acquire();
          p.id = generateId();
          p.position.x = e.position.x + Math.cos(angle) * (e.radius + 4);
          p.position.y = e.position.y + Math.sin(angle) * (e.radius + 4);
          p.velocity.x = Math.cos(angle) * bulletSpeed;
          p.velocity.y = Math.sin(angle) * bulletSpeed;
          p.radius = 4;
          p.color = COLORS.pink;
          p.damage = Math.max(5, e.damage * 0.4);
          p.isEnemy = true;
          p.piercing = 0;
          p.lifetime = 3000;
        }
      }

      if (elapsed >= PHASE_DURATIONS.ring_shot) {
        e.bossPhase = getNextPhase(phase, bossLevel, healthPct);
        e.bossTimer = currentTime;
      }
      break;
    }

    case 'spiral_shot': {
      // Continuous dual spiral pattern
      e.position.x += nx * e.speed * 0.2 * deltaTime;
      e.position.y += ny * e.speed * 0.2 * deltaTime;

      const spiralInterval = 60;
      const lastShot = e.lastShot || 0;
      if (currentTime - lastShot >= spiralInterval) {
        e.lastShot = currentTime;
        const angle = (e.bossPatternAngle || 0);
        e.bossPatternAngle = angle + 0.3;
        const bulletSpeed = 4 + bossLevel * 0.3;

        // Dual spiral
        for (let arm = 0; arm < 2; arm++) {
          const a = angle + arm * Math.PI;
          const p = projectilePool.acquire();
          p.id = generateId();
          p.position.x = e.position.x + Math.cos(a) * (e.radius + 4);
          p.position.y = e.position.y + Math.sin(a) * (e.radius + 4);
          p.velocity.x = Math.cos(a) * bulletSpeed;
          p.velocity.y = Math.sin(a) * bulletSpeed;
          p.radius = 4;
          p.color = COLORS.purple;
          p.damage = Math.max(5, e.damage * 0.3);
          p.isEnemy = true;
          p.piercing = 0;
          p.lifetime = 3500;
        }
      }

      if (elapsed >= PHASE_DURATIONS.spiral_shot) {
        e.bossPhase = getNextPhase(phase, bossLevel, healthPct);
        e.bossTimer = currentTime;
      }
      break;
    }

    case 'dash': {
      // Charge at player at 4x speed with trail particles
      const dashSpeed = e.speed * 4;
      e.position.x += nx * dashSpeed * deltaTime;
      e.position.y += ny * dashSpeed * deltaTime;
      e.velocity = { x: nx * dashSpeed, y: ny * dashSpeed };

      // Trail particles
      if (Math.random() < 0.7) {
        const tp = particlePool.acquire();
        tp.id = generateId();
        tp.position.x = e.position.x + (Math.random() - 0.5) * e.radius;
        tp.position.y = e.position.y + (Math.random() - 0.5) * e.radius;
        tp.velocity.x = -nx * 3 + (Math.random() - 0.5) * 2;
        tp.velocity.y = -ny * 3 + (Math.random() - 0.5) * 2;
        tp.color = COLORS.pink;
        tp.size = 6 + Math.random() * 4;
        tp.life = 200;
        tp.maxLife = 200;
        tp.type = 'trail';
      }

      if (elapsed >= PHASE_DURATIONS.dash) {
        e.bossPhase = getNextPhase(phase, bossLevel, healthPct);
        e.bossTimer = currentTime;
      }
      break;
    }

    case 'summon': {
      // Spawn minions at boss position
      const step = e.bossPatternStep || 0;
      if (step === 0) {
        const minionCount = 3 + 2 * bossLevel;
        for (let i = 0; i < minionCount; i++) {
          const angle = (i / minionCount) * Math.PI * 2;
          const minion = spawnEnemy(Math.max(1, bossLevel * 2), width, height, target.position);
          minion.position.x = e.position.x + Math.cos(angle) * (e.radius + 30);
          minion.position.y = e.position.y + Math.sin(angle) * (e.radius + 30);
          minion.type = 'swarm';
          minion.health = 15 + bossLevel * 5;
          minion.maxHealth = minion.health;
          minion.speed = 3 + bossLevel * 0.3;
          spawnedEnemies.push(minion);
        }
        e.bossPatternStep = 1;

        // Summon visual effect
        const ring = particlePool.acquire();
        ring.id = generateId();
        ring.position.x = e.position.x;
        ring.position.y = e.position.y;
        ring.velocity.x = 0;
        ring.velocity.y = 0;
        ring.color = COLORS.purple;
        ring.size = 80;
        ring.life = 400;
        ring.maxLife = 400;
        ring.type = 'ring';
      }

      // Slow movement during summon
      e.position.x += nx * e.speed * 0.2 * deltaTime;
      e.position.y += ny * e.speed * 0.2 * deltaTime;

      if (elapsed >= PHASE_DURATIONS.summon) {
        e.bossPhase = getNextPhase(phase, bossLevel, healthPct);
        e.bossTimer = currentTime;
        e.bossPatternStep = 0;
      }
      break;
    }

    case 'shield': {
      // Damage reduced 90%, shield has HP
      if (!e.bossShieldHP) {
        e.bossShieldHP = 200 + bossLevel * 50;
      }

      // Slow chase
      e.position.x += nx * e.speed * 0.3 * deltaTime;
      e.position.y += ny * e.speed * 0.3 * deltaTime;

      // Shield visual
      if (Math.random() < 0.3) {
        const angle = Math.random() * Math.PI * 2;
        const sp = particlePool.acquire();
        sp.id = generateId();
        sp.position.x = e.position.x + Math.cos(angle) * (e.radius + 10);
        sp.position.y = e.position.y + Math.sin(angle) * (e.radius + 10);
        sp.velocity.x = Math.cos(angle) * 0.5;
        sp.velocity.y = Math.sin(angle) * 0.5;
        sp.color = COLORS.cyan;
        sp.size = 3;
        sp.life = 150;
        sp.maxLife = 150;
        sp.type = 'spark';
      }

      if (e.bossShieldHP <= 0 || elapsed >= PHASE_DURATIONS.shield) {
        e.bossShieldHP = undefined;
        e.bossPhase = getNextPhase(phase, bossLevel, healthPct);
        e.bossTimer = currentTime;
      }
      break;
    }

    case 'rage': {
      // Permanent 1.5x speed + frequent ring shots
      const rageSpeed = e.speed * 1.5;
      e.position.x += nx * rageSpeed * deltaTime;
      e.position.y += ny * rageSpeed * deltaTime;
      e.velocity = { x: nx * rageSpeed, y: ny * rageSpeed };

      // Frequent ring shots
      const rageInterval = 800;
      const lastShot = e.lastShot || 0;
      if (currentTime - lastShot >= rageInterval) {
        e.lastShot = currentTime;
        const bulletCount = 12 + 4 * bossLevel;
        const bulletSpeed = 6 + bossLevel * 0.5;
        for (let i = 0; i < bulletCount; i++) {
          const angle = (i / bulletCount) * Math.PI * 2 + (e.bossPatternAngle || 0);
          const p = projectilePool.acquire();
          p.id = generateId();
          p.position.x = e.position.x + Math.cos(angle) * (e.radius + 4);
          p.position.y = e.position.y + Math.sin(angle) * (e.radius + 4);
          p.velocity.x = Math.cos(angle) * bulletSpeed;
          p.velocity.y = Math.sin(angle) * bulletSpeed;
          p.radius = 4;
          p.color = COLORS.orange;
          p.damage = Math.max(5, e.damage * 0.35);
          p.isEnemy = true;
          p.piercing = 0;
          p.lifetime = 3000;
        }
        e.bossPatternAngle = (e.bossPatternAngle || 0) + 0.15;
      }

      // Rage particles
      if (Math.random() < 0.5) {
        const angle = Math.random() * Math.PI * 2;
        const rp = particlePool.acquire();
        rp.id = generateId();
        rp.position.x = e.position.x + Math.cos(angle) * e.radius;
        rp.position.y = e.position.y + Math.sin(angle) * e.radius;
        rp.velocity.x = Math.cos(angle) * 2;
        rp.velocity.y = Math.sin(angle) * 2;
        rp.color = COLORS.orange;
        rp.size = 4;
        rp.life = 120;
        rp.maxLife = 120;
        rp.type = 'spark';
      }
      break;
    }
  }

  // Keep boss on screen
  e.position.x = Math.max(e.radius, Math.min(width - e.radius, e.position.x));
  e.position.y = Math.max(e.radius, Math.min(height - e.radius, e.position.y));

  return { enemy: e, spawnedEnemies };
}
