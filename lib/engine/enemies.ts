import { Enemy, EnemyType, Player, Vector2, WaveEventType, ENEMY_CONFIGS, WEAPON_CONFIGS } from '@/types/game';
import { generateId, enemyGrid, projectilePool, xpOrbPool } from './context';
import { COLORS } from '../colors';

export function updateEnemy(
  enemy: Enemy,
  player: Player,
  deltaTime: number,
  currentTime: number,
  player2?: Player | null,
  activeEvent?: WaveEventType
): Enemy {
  // Boss enemies are handled by bossAI — skip normal movement if boss has a phase
  if (enemy.bossPhase) return enemy;

  let targetPlayer = player;
  if (player2 && player2.health > 0) {
    const dist1 = Math.hypot(player.position.x - enemy.position.x, player.position.y - enemy.position.y);
    const dist2 = Math.hypot(player2.position.x - enemy.position.x, player2.position.y - enemy.position.y);
    if (player.health <= 0 || dist2 < dist1) {
      targetPlayer = player2;
    }
  }

  const dx = targetPlayer.position.x - enemy.position.x;
  const dy = targetPlayer.position.y - enemy.position.y;
  const distance = Math.sqrt(dx * dx + dy * dy);

  if (distance <= 0) return enemy;

  let vx = (dx / distance) * enemy.speed;
  let vy = (dy / distance) * enemy.speed;
  let updatedEnemy = { ...enemy };

  // === Enhanced shooter behavior: stop at range, strafe, fire at player ===
  if (enemy.type === 'shooter') {
    const STOP_RANGE = 200;
    const FIRE_INTERVAL = 1500;

    if (distance < STOP_RANGE) {
      // Strafe perpendicular to player
      const perpX = -dy / distance;
      const perpY = dx / distance;
      const strafeDir = Math.sin(currentTime * 0.003 + enemy.spawnTime) > 0 ? 1 : -1;
      vx = perpX * enemy.speed * 0.7 * strafeDir;
      vy = perpY * enemy.speed * 0.7 * strafeDir;
    }

    // Fire at player
    const lastShot = updatedEnemy.lastShot || 0;
    if (currentTime - lastShot >= FIRE_INTERVAL) {
      updatedEnemy.lastShot = currentTime;
      const bulletSpeed = 8;
      const nx = dx / distance;
      const ny = dy / distance;

      const p = projectilePool.acquire();
      p.id = generateId();
      p.position.x = enemy.position.x + nx * (enemy.radius + 4);
      p.position.y = enemy.position.y + ny * (enemy.radius + 4);
      p.velocity.x = nx * bulletSpeed;
      p.velocity.y = ny * bulletSpeed;
      p.radius = 5;
      p.color = ENEMY_CONFIGS.shooter.color;
      p.damage = enemy.damage;
      p.isEnemy = true;
      p.piercing = 0;
      p.weaponType = undefined;
      p.lifetime = 3000;
    }
  }

  // === Enhanced bomber behavior: speed up when close, telegraph ===
  if (enemy.type === 'bomber') {
    const CHARGE_RANGE = 150;
    if (distance < CHARGE_RANGE) {
      const chargeBoost = 1 + (1 - distance / CHARGE_RANGE) * 1.5;
      vx *= chargeBoost;
      vy *= chargeBoost;
    }
  }

  // === Enhanced tank behavior: slower but tankier ===
  if (enemy.type === 'tank') {
    vx *= 0.6;
    vy *= 0.6;
  }

  if (enemy.type === 'zigzag') {
    const phase = (enemy.zigzagPhase || 0) + deltaTime * 0.15;
    const perpX = -dy / distance;
    const perpY = dx / distance;
    const zigzagAmount = Math.sin(phase) * 3;
    vx += perpX * zigzagAmount;
    vy += perpY * zigzagAmount;
    updatedEnemy.zigzagPhase = phase;
  }

  if (enemy.type === 'ghost') {
    const fadeSpeed = 0.002;
    const timeSinceSpawn = currentTime - enemy.spawnTime;
    const alpha = 0.3 + Math.sin(timeSinceSpawn * fadeSpeed) * 0.7;
    updatedEnemy.ghostAlpha = Math.max(0.1, Math.min(1, alpha));
  }

  // === Enhanced magnet behavior: pulls nearby XP orbs away from player ===
  if (enemy.type === 'magnet') {
    vx *= 0.8;
    vy *= 0.8;

    // Pull nearby XP orbs toward this enemy (away from player)
    const MAGNET_PULL_RANGE = 120;
    xpOrbPool.forEach(orb => {
      const odx = orb.position.x - enemy.position.x;
      const ody = orb.position.y - enemy.position.y;
      const orbDistSq = odx * odx + ody * ody;
      if (orbDistSq < MAGNET_PULL_RANGE * MAGNET_PULL_RANGE && orbDistSq > 1) {
        const orbDist = Math.sqrt(orbDistSq);
        const pullStrength = 2.5 * (1 - orbDist / MAGNET_PULL_RANGE);
        orb.position.x -= (odx / orbDist) * pullStrength;
        orb.position.y -= (ody / orbDist) * pullStrength;
      }
      return true; // keep
    });
  }

  if (activeEvent === 'surge') {
    vx *= 1.18;
    vy *= 1.18;
  }

  return {
    ...updatedEnemy,
    position: {
      x: enemy.position.x + vx * deltaTime,
      y: enemy.position.y + vy * deltaTime,
    },
    velocity: { x: vx, y: vy },
  };
}

export function spawnEnemy(wave: number, width: number, height: number, playerPos: Vector2, isSplit = false): Enemy {
  let type: EnemyType = 'chaser';
  const roll = Math.random();

  if (wave >= 3 && roll < 0.25) type = 'swarm';
  if (wave >= 4 && roll >= 0.25 && roll < 0.35) type = 'zigzag';
  if (wave >= 6 && roll >= 0.35 && roll < 0.45) type = 'shooter';
  if (wave >= 7 && roll >= 0.45 && roll < 0.55) type = 'splitter';
  if (wave >= 8 && roll >= 0.55 && roll < 0.62) type = 'tank';
  if (wave >= 8 && roll >= 0.62 && roll < 0.70) type = 'ghost';
  if (wave >= 9 && roll >= 0.70 && roll < 0.78) type = 'bomber';
  if (wave >= 10 && roll >= 0.78 && roll < 0.85) type = 'magnet';

  const config = ENEMY_CONFIGS[type];
  const waveMultiplier = 1 + wave * 0.06;
  const eliteChance = isSplit ? 0 : Math.min(0.22, 0.04 + wave * 0.008);
  const isElite = wave >= 7 && Math.random() < eliteChance;
  let eliteModifier: Enemy['eliteModifier'] = undefined;
  if (isElite) {
    const mods: Array<NonNullable<Enemy['eliteModifier']>> = ['swift', 'volatile', 'shielded'];
    eliteModifier = mods[Math.floor(Math.random() * mods.length)];
  }

  let x: number, y: number;
  const side = Math.floor(Math.random() * 4);
  const marginDist = 50;

  switch (side) {
    case 0: x = -marginDist; y = Math.random() * height; break;
    case 1: x = width + marginDist; y = Math.random() * height; break;
    case 2: x = Math.random() * width; y = -marginDist; break;
    default: x = Math.random() * width; y = height + marginDist; break;
  }

  let enemy: Enemy = {
    id: generateId(),
    position: { x, y },
    velocity: { x: 0, y: 0 },
    radius: isSplit ? config.radius * 0.6 : config.radius,
    color: config.color,
    health: isSplit ? config.health * 0.3 : config.health * waveMultiplier,
    maxHealth: isSplit ? config.health * 0.3 : config.health * waveMultiplier,
    speed: config.speed * (1 + wave * 0.02),
    damage: config.damage * waveMultiplier,
    type,
    points: isSplit ? Math.floor(config.points * 0.3) : config.points,
    spawnTime: Date.now(),
    zigzagPhase: type === 'zigzag' ? Math.random() * Math.PI * 2 : undefined,
    ghostAlpha: type === 'ghost' ? 1 : undefined,
    isSplit,
    isElite,
    eliteModifier,
  };

  if (isElite && eliteModifier) {
    enemy.points = Math.floor(enemy.points * 1.45);
    enemy.color = eliteModifier === 'shielded'
      ? COLORS.cyan
      : eliteModifier === 'volatile'
        ? COLORS.orange
        : COLORS.green;

    if (eliteModifier === 'swift') {
      enemy.speed *= 1.5;
      enemy.health *= 0.85;
      enemy.maxHealth *= 0.85;
      enemy.radius *= 0.95;
    } else if (eliteModifier === 'volatile') {
      enemy.speed *= 1.12;
      enemy.health *= 0.92;
      enemy.maxHealth *= 0.92;
      enemy.radius *= 1.08;
      enemy.damage *= 1.2;
    } else if (eliteModifier === 'shielded') {
      enemy.health *= 1.7;
      enemy.maxHealth *= 1.7;
      enemy.radius *= 1.15;
      enemy.damage *= 1.1;
    }
  }

  return enemy;
}

export function spawnBoss(width: number, height: number, playerPos: Vector2): Enemy {
  const config = ENEMY_CONFIGS.boss;

  return {
    id: generateId(),
    position: { x: width / 2, y: -100 },
    velocity: { x: 0, y: 0 },
    radius: config.radius,
    color: config.color,
    health: config.health,
    maxHealth: config.health,
    speed: config.speed,
    damage: config.damage,
    type: 'boss',
    points: config.points,
    spawnTime: Date.now(),
  };
}

type FormationType = 'v_shape' | 'circle' | 'line';

/**
 * Spawn a formation of enemies instead of individual ones.
 * Returns an array of enemies arranged in the given pattern.
 */
export function spawnFormation(
  type: FormationType,
  wave: number,
  width: number,
  height: number,
  playerPos: Vector2
): Enemy[] {
  const formationId = generateId();
  const enemies: Enemy[] = [];

  // Pick spawn edge
  const side = Math.floor(Math.random() * 4);
  const marginDist = 80;
  let baseX: number, baseY: number;
  switch (side) {
    case 0: baseX = -marginDist; baseY = Math.random() * height; break;
    case 1: baseX = width + marginDist; baseY = Math.random() * height; break;
    case 2: baseX = Math.random() * width; baseY = -marginDist; break;
    default: baseX = Math.random() * width; baseY = height + marginDist; break;
  }

  const waveMultiplier = 1 + wave * 0.1;

  switch (type) {
    case 'v_shape': {
      const count = Math.min(12, 5 + Math.floor(wave / 3));
      const spacing = 30;
      for (let i = 0; i < count; i++) {
        const row = Math.floor(i / 2);
        const side = i % 2 === 0 ? -1 : 1;
        const config = ENEMY_CONFIGS.swarm;
        const enemy: Enemy = {
          id: generateId(),
          position: { x: baseX + side * row * spacing * 0.5, y: baseY + row * spacing },
          velocity: { x: 0, y: 0 },
          radius: config.radius,
          color: config.color,
          health: config.health * waveMultiplier,
          maxHealth: config.health * waveMultiplier,
          speed: config.speed * (1 + wave * 0.02) * 1.2,
          damage: config.damage * waveMultiplier,
          type: 'swarm',
          points: config.points,
          spawnTime: Date.now(),
          formationId,
          formationRole: i === 0 ? 'leader' : 'follower',
        };
        enemies.push(enemy);
      }
      break;
    }

    case 'circle': {
      const count = Math.min(16, 6 + Math.floor(wave / 4));
      const circleRadius = 60 + count * 5;
      for (let i = 0; i < count; i++) {
        const angle = (i / count) * Math.PI * 2;
        const config = ENEMY_CONFIGS.chaser;
        const enemy: Enemy = {
          id: generateId(),
          position: {
            x: baseX + Math.cos(angle) * circleRadius,
            y: baseY + Math.sin(angle) * circleRadius,
          },
          velocity: { x: 0, y: 0 },
          radius: config.radius,
          color: '#ff6688',
          health: config.health * waveMultiplier,
          maxHealth: config.health * waveMultiplier,
          speed: config.speed * (1 + wave * 0.02),
          damage: config.damage * waveMultiplier,
          type: 'chaser',
          points: config.points,
          spawnTime: Date.now(),
          formationId,
          formationRole: 'ring',
        };
        enemies.push(enemy);
      }
      break;
    }

    case 'line': {
      const count = Math.min(10, 4 + Math.floor(wave / 2));
      const spacing = 35;
      // Direction perpendicular to approach angle
      const toPlayerX = playerPos.x - baseX;
      const toPlayerY = playerPos.y - baseY;
      const dist = Math.sqrt(toPlayerX * toPlayerX + toPlayerY * toPlayerY);
      const perpX = dist > 0 ? -toPlayerY / dist : 0;
      const perpY = dist > 0 ? toPlayerX / dist : 1;

      for (let i = 0; i < count; i++) {
        const offset = (i - count / 2) * spacing;
        const config = ENEMY_CONFIGS.tank;
        const enemy: Enemy = {
          id: generateId(),
          position: {
            x: baseX + perpX * offset,
            y: baseY + perpY * offset,
          },
          velocity: { x: 0, y: 0 },
          radius: config.radius * 0.85,
          color: config.color,
          health: config.health * waveMultiplier * 0.7,
          maxHealth: config.health * waveMultiplier * 0.7,
          speed: config.speed * (1 + wave * 0.02) * 0.8,
          damage: config.damage * waveMultiplier,
          type: 'tank',
          points: config.points,
          spawnTime: Date.now(),
          formationId,
          formationRole: 'column',
        };
        enemies.push(enemy);
      }
      break;
    }
  }

  return enemies;
}

/**
 * Push overlapping enemies apart so they don't stack on one spot.
 * Uses the spatial grid built during collision phase.
 * Bosses are immune to push.
 */
export function applySeparationForces(enemies: Enemy[], deltaTime: number): void {
  const SEPARATION_RADIUS = 60;
  const SEPARATION_STRENGTH = 2.5;

  // Rebuild enemy spatial grid for separation queries
  enemyGrid.clear();
  for (let i = 0; i < enemies.length; i++) {
    enemyGrid.insert(i, enemies[i].position.x, enemies[i].position.y);
  }

  for (let i = 0; i < enemies.length; i++) {
    const a = enemies[i];
    if (a.type === 'boss') continue; // bosses immune

    let pushX = 0;
    let pushY = 0;

    enemyGrid.query(a.position.x, a.position.y, (j) => {
      if (j === i || j >= enemies.length) return;
      const b = enemies[j];

      const dx = a.position.x - b.position.x;
      const dy = a.position.y - b.position.y;
      const distSq = dx * dx + dy * dy;

      if (distSq < 0.01) {
        // Nearly on top of each other — random push
        pushX += (Math.random() - 0.5) * SEPARATION_STRENGTH * 2;
        pushY += (Math.random() - 0.5) * SEPARATION_STRENGTH * 2;
        return;
      }

      const dist = Math.sqrt(distSq);
      const combinedRadii = a.radius + b.radius + 8;

      if (dist < combinedRadii) {
        // Hard push — overlapping
        const overlap = combinedRadii - dist;
        const nx = dx / dist;
        const ny = dy / dist;
        pushX += nx * overlap * 0.5;
        pushY += ny * overlap * 0.5;
      } else if (dist < SEPARATION_RADIUS) {
        // Soft repulsion
        const factor = 1 - dist / SEPARATION_RADIUS;
        const nx = dx / dist;
        const ny = dy / dist;
        pushX += nx * SEPARATION_STRENGTH * factor;
        pushY += ny * SEPARATION_STRENGTH * factor;
      }
    });

    a.position.x += pushX * deltaTime;
    a.position.y += pushY * deltaTime;
  }
}
