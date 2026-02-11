import {
  GameState,
  GameConfig,
  Player,
  Enemy,
  Projectile,
  PowerUp,
  ExperienceOrb,
  Particle,
  Vector2,
  Upgrade,
  ArenaType,
  DEFAULT_CONFIG,
  ENEMY_CONFIGS,
  WEAPON_CONFIGS,
  POWERUP_CONFIGS,
  EnemyType,
  WeaponType,
  PowerUpType,
  WaveEventType,
} from '@/types/game';
import { createParticlePool, createProjectilePool, createXPOrbPool } from './objectPool';
import { SpatialGrid } from './spatialGrid';
import { COLORS } from './colors';

// Pool singletons
const particlePool = createParticlePool(1200);
const projectilePool = createProjectilePool(200);
const xpOrbPool = createXPOrbPool(150);

// Spatial grid singleton
let enemyGrid = new SpatialGrid(1920, 1080, 128);

// Export pool helpers for CoopGame P2 projectile/orb management
export function acquireProjectile(): Projectile {
  return projectilePool.acquire();
}
export function getProjectileCount(): number {
  return projectilePool.activeCount;
}
export function releaseXPOrb(orb: ExperienceOrb): void {
  xpOrbPool.release(orb);
}
export function getXPOrbCount(): number {
  return xpOrbPool.activeCount;
}

let nextId = 0;
const generateId = () => `id-${nextId++}-${Math.random().toString(36).substr(2, 9)}`;

export function createInitialGameState(
  playerImageUrl: string,
  width: number,
  height: number,
  config: GameConfig = DEFAULT_CONFIG
): GameState {
  // Clear all pools
  particlePool.clear();
  projectilePool.clear();
  xpOrbPool.clear();

  // Resize spatial grid if needed
  enemyGrid.resize(width, height);

  const player: Player = {
    position: { x: width / 2, y: height / 2 },
    velocity: { x: 0, y: 0 },
    radius: config.playerRadius,
    color: COLORS.cyan,
    health: config.playerMaxHealth,
    maxHealth: config.playerMaxHealth,
    baseSpeed: config.playerSpeed,
    speed: config.playerSpeed,
    image: null,
    imageUrl: playerImageUrl,
    invulnerableUntil: 0,
    weapons: [{
      type: 'blaster',
      level: 1,
      lastFired: 0,
      ...WEAPON_CONFIGS.blaster,
    }],
    experience: 0,
    level: 1,
    kills: 0,
    magnetMultiplier: 1,
    activeBuffs: [],
    speedBonus: 0,
    magnetBonus: 0,
  };

  return {
    player,
    enemies: [],
    projectiles: projectilePool.items,
    projectileCount: 0,
    powerups: [],
    experienceOrbs: xpOrbPool.items,
    experienceOrbCount: 0,
    particles: particlePool.items,
    particleCount: 0,
    wave: 1,
    score: 0,
    multiplier: 1,
    multiplierTimer: 0,
    gameTime: 0,
    isRunning: false,
    isPaused: false,
    isGameOver: false,
    lastEnemySpawn: 0,
    enemiesKilledThisWave: 0,
    enemiesRequiredForWave: 10,
    screenShake: 0,
    killStreak: 0,
    killStreakTimer: 0,
    nearMissCount: 0,
    pendingLevelUps: 0,
    availableUpgrades: [],
    totalDamageDealt: 0,
    totalDamageTaken: 0,
    startTime: Date.now(),
    peakMultiplier: 1,
    arena: 'grid',
  };
}

export async function loadPlayerImage(state: GameState): Promise<GameState> {
  if (!state.player.imageUrl) return state;

  const image = new Image();
  image.crossOrigin = 'anonymous';

  await new Promise<void>((resolve) => {
    image.onload = () => resolve();
    image.onerror = () => resolve();
    image.src = state.player.imageUrl;
  });

  return {
    ...state,
    player: {
      ...state.player,
      image: image.complete && image.naturalWidth > 0 ? image : null,
    },
  };
}

export function startGame(state: GameState): GameState {
  return {
    ...state,
    isRunning: true,
    isPaused: false,
    gameTime: Date.now(),
    lastEnemySpawn: Date.now(),
  };
}

export function updateGameState(
  state: GameState,
  deltaTime: number,
  width: number,
  height: number,
  input: { keys: Set<string>; mousePos: Vector2; mouseDown: boolean },
  config: GameConfig = DEFAULT_CONFIG,
  player2?: Player | null
): GameState {
  if (!state.isRunning || state.isPaused || state.isGameOver) {
    return state;
  }

  const currentTime = Date.now();

  // Resize spatial grid if dimensions changed
  enemyGrid.resize(width, height);

  // Apply slow-mo effect
  let effectiveDelta = deltaTime;
  if (state.slowMoUntil && currentTime < state.slowMoUntil) {
    effectiveDelta *= state.slowMoFactor || 0.3;
  }
  let {
    player,
    enemies,
    powerups,
    score,
    multiplier,
    multiplierTimer,
    screenShake,
    totalDamageDealt,
    killStreak,
    killStreakTimer,
    nearMissCount,
  } = state;

  const eventActive = !!(state.activeEvent && state.eventUntil && currentTime < state.eventUntil);

  // Update player position based on input
  const oldPos = { ...player.position };
  player = updatePlayer(player, input, width, height, config, effectiveDelta);

  // Player movement trail particles
  const moveSpeed = Math.sqrt(player.velocity.x ** 2 + player.velocity.y ** 2);
  if (moveSpeed > 2) {
    const p = particlePool.acquire();
    p.id = generateId();
    p.position.x = oldPos.x;
    p.position.y = oldPos.y;
    p.velocity.x = -player.velocity.x * 0.1 + (Math.random() - 0.5) * 0.5;
    p.velocity.y = -player.velocity.y * 0.1 + (Math.random() - 0.5) * 0.5;
    p.color = COLORS.cyan;
    p.size = 3 + Math.random() * 2;
    p.life = 150 + Math.random() * 100;
    p.maxLife = 250;
    p.type = 'spark';
  }

  // Fire weapons (acquires from projectile pool directly)
  fireWeapons(player, input.mousePos, currentTime);

  // Update projectiles in-place and remove dead ones
  projectilePool.forEach(proj => {
    updateProjectileInPlace(proj, effectiveDelta, player.position);
    if (!isProjectileAlive(proj, width, height)) return false; // release

    emitProjectileSignatureTrail(proj);

    return true; // keep
  });

  // Check projectile-enemy collisions (uses spatial grid)
  const { updatedEnemies, killedEnemies, damageDealt, missileShake: mShake } =
    checkProjectileCollisions(enemies, currentTime);
  enemies = updatedEnemies;
  totalDamageDealt += damageDealt;
  screenShake = Math.max(screenShake, mShake);

  // Process killed enemies
  killedEnemies.forEach(enemy => {
    score += enemy.points * multiplier;
    player.kills++;
    multiplier = Math.min(multiplier + 0.1, 10);
    multiplierTimer = currentTime + 3000;
    killStreak = currentTime <= killStreakTimer ? killStreak + 1 : 1;
    killStreakTimer = currentTime + 2200;

    if (killStreak === 5 || killStreak === 10 || killStreak === 20) {
      const kp = particlePool.acquire();
      kp.id = generateId();
      kp.position.x = player.position.x;
      kp.position.y = player.position.y - 30;
      kp.velocity.x = 0;
      kp.velocity.y = -2.2;
      kp.color = killStreak >= 10 ? COLORS.pink : COLORS.yellow;
      kp.size = killStreak >= 10 ? 26 : 20;
      kp.life = 900;
      kp.maxLife = 900;
      kp.type = 'text';
      kp.text = `${killStreak} STREAK`;

      const kr = particlePool.acquire();
      kr.id = generateId();
      kr.position.x = player.position.x;
      kr.position.y = player.position.y;
      kr.velocity.x = 0;
      kr.velocity.y = 0;
      kr.color = killStreak >= 10 ? COLORS.pink : COLORS.yellow;
      kr.size = 70;
      kr.life = 220;
      kr.maxLife = 220;
      kr.type = 'ring';
    }

    // Spawn experience orb
    const orb = xpOrbPool.acquire();
    orb.id = generateId();
    orb.position.x = enemy.position.x;
    orb.position.y = enemy.position.y;
    orb.value = Math.floor(enemy.points / 2);
    orb.createdAt = currentTime;

    // Chance to spawn powerup
    if (Math.random() < config.powerupSpawnChance) {
      powerups.push(createPowerup(enemy.position));
    }

    // Splitter spawns smaller enemies on death
    if (enemy.type === 'splitter' && !enemy.isSplit) {
      const splitCount = 2 + Math.floor(Math.random() * 2);
      for (let i = 0; i < splitCount; i++) {
        const angle = (i / splitCount) * Math.PI * 2;
        const splitEnemy: Enemy = {
          id: generateId(),
          position: {
            x: enemy.position.x + Math.cos(angle) * 20,
            y: enemy.position.y + Math.sin(angle) * 20,
          },
          velocity: { x: 0, y: 0 },
          radius: 10,
          color: '#ff88ff',
          health: 15,
          maxHealth: 15,
          speed: 4,
          damage: 5,
          type: 'swarm',
          points: 5,
          spawnTime: currentTime,
          isSplit: true,
        };
        enemies.push(splitEnemy);
      }
    }

    // Death particles - scaled by enemy size
    createExplosion(enemy.position, enemy.color, 25 + Math.floor(enemy.radius * 1.2));

    if (enemy.isElite) {
      const eliteRing = particlePool.acquire();
      eliteRing.id = generateId();
      eliteRing.position.x = enemy.position.x;
      eliteRing.position.y = enemy.position.y;
      eliteRing.velocity.x = 0;
      eliteRing.velocity.y = 0;
      eliteRing.color = enemy.color;
      eliteRing.size = 32 + enemy.radius;
      eliteRing.life = 260;
      eliteRing.maxLife = 260;
      eliteRing.type = 'ring';

      if (enemy.eliteModifier === 'volatile') {
        screenShake = Math.max(screenShake, 18);
        state = {
          ...state,
          screenFlash: currentTime,
          screenFlashColor: '255, 107, 26',
        };
        for (let i = 0; i < 16; i++) {
          const a = (i / 16) * Math.PI * 2;
          const vp = particlePool.acquire();
          vp.id = generateId();
          vp.position.x = enemy.position.x;
          vp.position.y = enemy.position.y;
          vp.velocity.x = Math.cos(a) * (7 + Math.random() * 4);
          vp.velocity.y = Math.sin(a) * (7 + Math.random() * 4);
          vp.color = COLORS.orange;
          vp.size = 6 + Math.random() * 3;
          vp.life = 240 + Math.random() * 120;
          vp.maxLife = 360;
          vp.type = 'explosion';
        }
      }
    }

    // Expanding death ring for all enemies
    const deathRp = particlePool.acquire();
    deathRp.id = generateId();
    deathRp.position.x = enemy.position.x;
    deathRp.position.y = enemy.position.y;
    deathRp.velocity.x = 0;
    deathRp.velocity.y = 0;
    deathRp.color = enemy.color;
    deathRp.size = 15 + enemy.radius;
    deathRp.life = 200;
    deathRp.maxLife = 200;
    deathRp.type = 'ring';

    // Directional debris for all enemies (8 trails)
    for (let i = 0; i < 8; i++) {
      const angle = (i / 8) * Math.PI * 2 + Math.random() * 0.3;
      const speed = 4 + Math.random() * 6;
      const tp = particlePool.acquire();
      tp.id = generateId();
      tp.position.x = enemy.position.x;
      tp.position.y = enemy.position.y;
      tp.velocity.x = Math.cos(angle) * speed;
      tp.velocity.y = Math.sin(angle) * speed;
      tp.color = enemy.color;
      tp.size = 8 + Math.random() * 4;
      tp.life = 150 + Math.random() * 100;
      tp.maxLife = 250;
      tp.type = 'trail';
    }

    // Extra death effects for bigger enemies / bosses
    if (enemy.radius > 20 || enemy.type === 'boss') {
      // Brief hit-stop to make elite/boss kills land.
      state = {
        ...state,
        slowMoUntil: currentTime + 80,
        slowMoFactor: 0.18,
      };

      for (let i = 0; i < 3; i++) {
        const rp = particlePool.acquire();
        rp.id = generateId();
        rp.position.x = enemy.position.x;
        rp.position.y = enemy.position.y;
        rp.velocity.x = 0;
        rp.velocity.y = 0;
        rp.color = enemy.color;
        rp.size = 30 + i * 25;
        rp.life = 300 + i * 60;
        rp.maxLife = 360 + i * 60;
        rp.type = 'ring';
      }

      for (let i = 0; i < 16; i++) {
        const angle = (i / 16) * Math.PI * 2;
        const tp = particlePool.acquire();
        tp.id = generateId();
        tp.position.x = enemy.position.x;
        tp.position.y = enemy.position.y;
        tp.velocity.x = Math.cos(angle) * 12;
        tp.velocity.y = Math.sin(angle) * 12;
        tp.color = enemy.color;
        tp.size = 15;
        tp.life = 200;
        tp.maxLife = 200;
        tp.type = 'trail';
      }

      // White flash for big kills
      for (let i = 0; i < 6; i++) {
        const angle = Math.random() * Math.PI * 2;
        const sp = particlePool.acquire();
        sp.id = generateId();
        sp.position.x = enemy.position.x;
        sp.position.y = enemy.position.y;
        sp.velocity.x = Math.cos(angle) * (8 + Math.random() * 4);
        sp.velocity.y = Math.sin(angle) * (8 + Math.random() * 4);
        sp.color = COLORS.white;
        sp.size = 4 + Math.random() * 3;
        sp.life = 150;
        sp.maxLife = 150;
        sp.type = 'spark';
      }
    }
  });

  state = { ...state, enemiesKilledThisWave: state.enemiesKilledThisWave + killedEnemies.length };

  // Check if multiplier should decay
  if (currentTime > multiplierTimer) {
    multiplier = Math.max(1, multiplier - 0.01 * deltaTime);
  }
  if (currentTime > killStreakTimer) {
    killStreak = 0;
  }

  // Update enemies
  enemies = enemies.map(e => updateEnemy(e, player, effectiveDelta, currentTime, player2, eventActive ? state.activeEvent : undefined));

  // Near-miss reward: enemy grazes the player but does not hit.
  const nearMissCooldown = 650;
  if (!state.lastNearMissTime || currentTime - state.lastNearMissTime > nearMissCooldown) {
    let nearMissDetected = false;
    for (let i = 0; i < enemies.length; i++) {
      const e = enemies[i];
      const dx = player.position.x - e.position.x;
      const dy = player.position.y - e.position.y;
      const d = Math.sqrt(dx * dx + dy * dy);
      const hitDist = player.radius + e.radius;
      if (d > hitDist + 8 && d < hitDist + 26) {
        nearMissDetected = true;
        break;
      }
    }

    if (nearMissDetected) {
      nearMissCount += 1;
      multiplier = Math.min(10, multiplier + 0.03);
      multiplierTimer = Math.max(multiplierTimer, currentTime + 1200);
      screenShake = Math.max(screenShake, 6);
      state = {
        ...state,
        lastNearMissTime: currentTime,
      };

      if (nearMissCount % 4 === 0) {
        const nm = particlePool.acquire();
        nm.id = generateId();
        nm.position.x = player.position.x;
        nm.position.y = player.position.y - 26;
        nm.velocity.x = 0;
        nm.velocity.y = -1.9;
        nm.color = COLORS.cyan;
        nm.size = 18;
        nm.life = 650;
        nm.maxLife = 650;
        nm.type = 'text';
        nm.text = 'NEAR MISS';
      }
    }
  }

  // Check enemy-player collision
  const collision = checkEnemyPlayerCollision(enemies, player, currentTime);
  if (collision.hit && currentTime > player.invulnerableUntil) {
    player = {
      ...player,
      health: player.health - collision.damage,
      invulnerableUntil: currentTime + 1000,
    };
    screenShake = 20;
    state = {
      ...state,
      screenFlash: currentTime,
      screenFlashColor: '255, 45, 106',
      totalDamageTaken: state.totalDamageTaken + collision.damage,
      slowMoUntil: currentTime + 70,
      slowMoFactor: 0.22,
    };

    // Floating damage number - large and prominent
    const dp = particlePool.acquire();
    dp.id = generateId();
    dp.position.x = player.position.x;
    dp.position.y = player.position.y - 10;
    dp.velocity.x = (Math.random() - 0.5) * 0.5;
    dp.velocity.y = -2.5;
    dp.color = COLORS.pink;
    dp.size = 32;
    dp.life = 1200;
    dp.maxLife = 1200;
    dp.type = 'text';
    dp.text = `-${collision.damage} HP`;

    // Secondary smaller damage echo for emphasis
    const dp2 = particlePool.acquire();
    dp2.id = generateId();
    dp2.position.x = player.position.x + (Math.random() - 0.5) * 20;
    dp2.position.y = player.position.y + 5;
    dp2.velocity.x = (Math.random() - 0.5) * 3;
    dp2.velocity.y = -2.5;
    dp2.color = COLORS.orange;
    dp2.size = 20;
    dp2.life = 900;
    dp2.maxLife = 900;
    dp2.type = 'text';
    dp2.text = `${Math.ceil(player.health - collision.damage)}`;  // Show remaining HP

    // Crash/damage particles
    createExplosion(player.position, COLORS.pink, 35);

    // Radial crash lines
    for (let i = 0; i < 12; i++) {
      const angle = (i / 12) * Math.PI * 2;
      const tp = particlePool.acquire();
      tp.id = generateId();
      tp.position.x = player.position.x;
      tp.position.y = player.position.y;
      tp.velocity.x = Math.cos(angle) * 10;
      tp.velocity.y = Math.sin(angle) * 10;
      tp.color = COLORS.pink;
      tp.size = 20;
      tp.life = 200;
      tp.maxLife = 200;
      tp.type = 'trail';
    }

    // Expanding damage ring
    const rp = particlePool.acquire();
    rp.id = generateId();
    rp.position.x = player.position.x;
    rp.position.y = player.position.y;
    rp.velocity.x = 0;
    rp.velocity.y = 0;
    rp.color = COLORS.pink;
    rp.size = 50;
    rp.life = 300;
    rp.maxLife = 300;
    rp.type = 'ring';

    // White flash particles
    for (let i = 0; i < 8; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 5 + Math.random() * 5;
      const sp = particlePool.acquire();
      sp.id = generateId();
      sp.position.x = player.position.x;
      sp.position.y = player.position.y;
      sp.velocity.x = Math.cos(angle) * speed;
      sp.velocity.y = Math.sin(angle) * speed;
      sp.color = COLORS.white;
      sp.size = 6;
      sp.life = 200;
      sp.maxLife = 200;
      sp.type = 'spark';
    }
  }

  // Check if player is dead
  if (player.health <= 0) {
    return {
      ...state,
      player,
      isGameOver: true,
      isRunning: false,
      particleCount: particlePool.activeCount,
      projectileCount: projectilePool.activeCount,
      experienceOrbCount: xpOrbPool.activeCount,
    };
  }

  // Collect experience orbs
  const collectedXP = collectExperienceOrbs(player, config);

  if (collectedXP > 0) {
    const xpResult = addExperience(player, collectedXP, config);
    player = xpResult.player;
    if (xpResult.leveledUp) {
      state = {
        ...state,
        pendingLevelUps: state.pendingLevelUps + 1,
        availableUpgrades: state.availableUpgrades.length === 0 ? generateUpgrades(player) : state.availableUpgrades,
        slowMoUntil: currentTime + 500,
        slowMoFactor: 0.3,
      };
    }
  }

  // Track peak multiplier
  if (multiplier > state.peakMultiplier) {
    state = { ...state, peakMultiplier: multiplier };
  }

  // Collect powerups
  const { collectedPowerups, remainingPowerups } =
    collectPowerups(player, powerups, currentTime);
  powerups = remainingPowerups;

  const levelBeforePowerups = player.level;
  collectedPowerups.forEach(powerup => {
    if (powerup.type === 'health') {
      // Big healing text
      const hp = particlePool.acquire();
      hp.id = generateId();
      hp.position.x = player.position.x;
      hp.position.y = player.position.y - 10;
      hp.velocity.x = (Math.random() - 0.5) * 0.5;
      hp.velocity.y = -2.5;
      hp.color = COLORS.green;
      hp.size = 30;
      hp.life = 1200;
      hp.maxLife = 1200;
      hp.type = 'text';
      hp.text = '+25 HP';

      // Green healing sparkles
      for (let si = 0; si < 8; si++) {
        const sparkAngle = (si / 8) * Math.PI * 2;
        const sparkSpeed = 2 + Math.random() * 3;
        const gp = particlePool.acquire();
        gp.id = generateId();
        gp.position.x = player.position.x + Math.cos(sparkAngle) * 15;
        gp.position.y = player.position.y + Math.sin(sparkAngle) * 15;
        gp.velocity.x = Math.cos(sparkAngle) * sparkSpeed;
        gp.velocity.y = Math.sin(sparkAngle) * sparkSpeed - 2;
        gp.color = COLORS.green;
        gp.size = 3 + Math.random() * 2;
        gp.life = 300 + Math.random() * 200;
        gp.maxLife = 500;
        gp.type = 'spark';
      }

      // Healing ring
      const hr = particlePool.acquire();
      hr.id = generateId();
      hr.position.x = player.position.x;
      hr.position.y = player.position.y;
      hr.velocity.x = 0;
      hr.velocity.y = 0;
      hr.color = COLORS.green;
      hr.size = 35;
      hr.life = 250;
      hr.maxLife = 250;
      hr.type = 'ring';
    }

    // Floating text for other powerups too
    if (powerup.type === 'speed' || powerup.type === 'damage' || powerup.type === 'magnet') {
      const labels: Record<string, string> = { speed: 'SPEED UP', damage: 'DMG UP', magnet: 'MAGNET' };
      const colors: Record<string, string> = { speed: COLORS.yellow, damage: COLORS.pink, magnet: COLORS.purple };
      const bp = particlePool.acquire();
      bp.id = generateId();
      bp.position.x = player.position.x;
      bp.position.y = player.position.y - 15;
      bp.velocity.x = 0;
      bp.velocity.y = -3.5;
      bp.color = colors[powerup.type] || COLORS.white;
      bp.size = 18;
      bp.life = 800;
      bp.maxLife = 800;
      bp.type = 'text';
      bp.text = labels[powerup.type] || powerup.type.toUpperCase();
    }
    if (powerup.type === 'xp') {
      const xpp = particlePool.acquire();
      xpp.id = generateId();
      xpp.position.x = player.position.x;
      xpp.position.y = player.position.y - 15;
      xpp.velocity.x = 0;
      xpp.velocity.y = -3.5;
      xpp.color = COLORS.cyan;
      xpp.size = 18;
      xpp.life = 800;
      xpp.maxLife = 800;
      xpp.type = 'text';
      xpp.text = '+50 XP';
    }
    if (powerup.type === 'bomb') {
      const bombRadius = 350;
      const bombRadiusSq = bombRadius * bombRadius;
      let bombKills = 0;

      // Kill all enemies within radius
      const survivingEnemies: Enemy[] = [];
      enemies.forEach(enemy => {
        const dx = enemy.position.x - player.position.x;
        const dy = enemy.position.y - player.position.y;
        const distSq = dx * dx + dy * dy;
        if (distSq < bombRadiusSq) {
          // Kill this enemy
          score += enemy.points * multiplier;
          player.kills++;
          bombKills++;
          multiplier = Math.min(multiplier + 0.1, 10);
          multiplierTimer = currentTime + 3000;

          // Spawn XP orb
          const orb = xpOrbPool.acquire();
          orb.id = generateId();
          orb.position.x = enemy.position.x;
          orb.position.y = enemy.position.y;
          orb.value = Math.floor(enemy.points / 2);
          orb.createdAt = currentTime;

          // Death explosion per enemy
          createExplosion(enemy.position, enemy.color, 15);
          const dr = particlePool.acquire();
          dr.id = generateId();
          dr.position.x = enemy.position.x;
          dr.position.y = enemy.position.y;
          dr.velocity.x = 0;
          dr.velocity.y = 0;
          dr.color = enemy.color;
          dr.size = 15 + enemy.radius;
          dr.life = 200;
          dr.maxLife = 200;
          dr.type = 'ring';
        } else {
          survivingEnemies.push(enemy);
        }
      });
      enemies = survivingEnemies;
      state = { ...state, enemiesKilledThisWave: state.enemiesKilledThisWave + bombKills };

      // Shockwave rings (warm palette, reduced washout)
      const ringColors = [COLORS.orange, COLORS.yellow, COLORS.pink];
      const ringSizes = [bombRadius * 0.72, bombRadius * 0.5, bombRadius * 0.3];
      const ringLives = [430, 340, 260];
      for (let ri = 0; ri < 3; ri++) {
        const sr = particlePool.acquire();
        sr.id = generateId();
        sr.position.x = player.position.x;
        sr.position.y = player.position.y;
        sr.velocity.x = 0;
        sr.velocity.y = 0;
        sr.color = ringColors[ri];
        sr.size = ringSizes[ri];
        sr.life = ringLives[ri];
        sr.maxLife = ringLives[ri];
        sr.type = 'ring';
      }

      // Fire/debris particles radiating outward
      for (let fi = 0; fi < 64; fi++) {
        const angle = (fi / 64) * Math.PI * 2 + Math.random() * 0.35;
        const speed = 5 + Math.random() * 10;
        const fp = particlePool.acquire();
        fp.id = generateId();
        fp.position.x = player.position.x + (Math.random() - 0.5) * 10;
        fp.position.y = player.position.y + (Math.random() - 0.5) * 10;
        fp.velocity.x = Math.cos(angle) * speed;
        fp.velocity.y = Math.sin(angle) * speed;
        fp.color = fi % 3 === 0 ? COLORS.yellow : fi % 3 === 1 ? COLORS.orange : COLORS.white;
        fp.size = 4 + Math.random() * 5;
        fp.life = 320 + Math.random() * 220;
        fp.maxLife = 540;
        fp.type = fi % 4 === 0 ? 'trail' : 'explosion';
      }

      // Fast spark burst for crisp arcade readability
      for (let si = 0; si < 24; si++) {
        const angle = (si / 24) * Math.PI * 2 + Math.random() * 0.45;
        const speed = 10 + Math.random() * 14;
        const sp = particlePool.acquire();
        sp.id = generateId();
        sp.position.x = player.position.x;
        sp.position.y = player.position.y;
        sp.velocity.x = Math.cos(angle) * speed;
        sp.velocity.y = Math.sin(angle) * speed;
        sp.color = si % 3 === 0 ? COLORS.white : si % 2 === 0 ? COLORS.yellow : COLORS.orange;
        sp.size = 2 + Math.random() * 2;
        sp.life = 220 + Math.random() * 150;
        sp.maxLife = 370;
        sp.type = 'spark';
      }

      // Spoke trails to emphasize blast directionality
      for (let ti = 0; ti < 12; ti++) {
        const angle = (ti / 12) * Math.PI * 2;
        const speed = 8 + Math.random() * 6;
        const tp = particlePool.acquire();
        tp.id = generateId();
        tp.position.x = player.position.x;
        tp.position.y = player.position.y;
        tp.velocity.x = Math.cos(angle) * speed;
        tp.velocity.y = Math.sin(angle) * speed;
        tp.color = ti % 2 === 0 ? COLORS.orange : COLORS.yellow;
        tp.size = 10 + Math.random() * 4;
        tp.life = 230 + Math.random() * 120;
        tp.maxLife = 350;
        tp.type = 'trail';
      }

      // Tinted center pulse instead of full white flash
      const cf = particlePool.acquire();
      cf.id = generateId();
      cf.position.x = player.position.x;
      cf.position.y = player.position.y;
      cf.velocity.x = 0;
      cf.velocity.y = 0;
      cf.color = COLORS.yellow;
      cf.size = bombRadius * 0.2;
      cf.life = 110;
      cf.maxLife = 110;
      cf.type = 'ring';

      // "BOMB!" text - bright yellow-green to feel positive
      const bt = particlePool.acquire();
      bt.id = generateId();
      bt.position.x = player.position.x;
      bt.position.y = player.position.y - 25;
      bt.velocity.x = 0;
      bt.velocity.y = -2;
      bt.color = COLORS.yellow;
      bt.size = 34;
      bt.life = 1400;
      bt.maxLife = 1400;
      bt.type = 'text';
      bt.text = 'BOMB!';

      // Kill count text
      if (bombKills > 0) {
        const kt = particlePool.acquire();
        kt.id = generateId();
        kt.position.x = player.position.x;
        kt.position.y = player.position.y + 15;
        kt.velocity.x = 0;
        kt.velocity.y = -1.5;
        kt.color = COLORS.green;
        kt.size = 24;
        kt.life = 1200;
        kt.maxLife = 1200;
        kt.type = 'text';
        kt.text = `x${bombKills} KILLS`;
      }

      screenShake = 20;
      state = {
        ...state,
        screenFlash: currentTime,
        screenFlashColor: '255, 170, 45',
        slowMoUntil: currentTime + 160,
        slowMoFactor: 0.14,
        bombPulseAt: currentTime,
        bombPulseOrigin: { x: player.position.x, y: player.position.y },
      };
    }
    player = applyPowerup(player, powerup, currentTime);
  });

  // Check if XP powerup caused a level up
  if (player.level > levelBeforePowerups) {
    const levelsGained = player.level - levelBeforePowerups;
    state = {
      ...state,
      pendingLevelUps: state.pendingLevelUps + levelsGained,
      availableUpgrades: state.availableUpgrades.length === 0 ? generateUpgrades(player) : state.availableUpgrades,
      slowMoUntil: currentTime + 500,
      slowMoFactor: 0.3,
    };
  }

  // Update buff timers and recalculate stats
  player = updatePlayerBuffs(player, currentTime);

  // Wave event modifiers
  if (eventActive && state.activeEvent === 'magnet_storm') {
    player = { ...player, magnetMultiplier: player.magnetMultiplier * 1.6 };
  }

  // Spawn enemies
  let spawnInterval = config.enemySpawnRate / (1 + state.wave * 0.2);
  if (eventActive && state.activeEvent === 'surge') {
    spawnInterval *= 0.72;
  }
  if (currentTime - state.lastEnemySpawn > spawnInterval) {
    const spawnCount = Math.min(1 + Math.floor(state.wave / 3), 5);
    for (let i = 0; i < spawnCount; i++) {
      const newEnemy = spawnEnemy(state.wave, width, height, player.position);
      enemies.push(newEnemy);
    }
    state = { ...state, lastEnemySpawn: currentTime };
  }

  // Check wave completion
  if (state.enemiesKilledThisWave >= state.enemiesRequiredForWave) {
    const newWave = state.wave + 1;
    const shouldStartEvent = newWave >= 4 && newWave % 4 === 0;
    const nextEvent: WaveEventType | undefined = shouldStartEvent
      ? (Math.random() < 0.5 ? 'surge' : 'magnet_storm')
      : undefined;
    state = {
      ...state,
      wave: newWave,
      enemiesKilledThisWave: 0,
      enemiesRequiredForWave: Math.floor(state.enemiesRequiredForWave * 1.2),
      waveAnnounceTime: currentTime,
      activeEvent: nextEvent ?? state.activeEvent,
      eventUntil: nextEvent ? currentTime + 9000 : state.eventUntil,
      eventAnnounceTime: nextEvent ? currentTime : state.eventAnnounceTime,
    };

    // Wave celebration particles
    for (let i = 0; i < 30; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 3 + Math.random() * 5;
      const cp = particlePool.acquire();
      cp.id = generateId();
      cp.position.x = width / 2;
      cp.position.y = height / 2;
      cp.velocity.x = Math.cos(angle) * speed;
      cp.velocity.y = Math.sin(angle) * speed;
      cp.color = [COLORS.cyan, COLORS.yellow, COLORS.pink][Math.floor(Math.random() * 3)];
      cp.size = 4 + Math.random() * 3;
      cp.life = 400 + Math.random() * 200;
      cp.maxLife = 600;
      cp.type = 'spark';
    }

    // Spawn boss every 5 waves
    if (newWave % 5 === 0) {
      enemies.push(spawnBoss(width, height, player.position));
    }

    if (nextEvent) {
      const ep = particlePool.acquire();
      ep.id = generateId();
      ep.position.x = width / 2;
      ep.position.y = height * 0.35;
      ep.velocity.x = 0;
      ep.velocity.y = -1.4;
      ep.color = nextEvent === 'surge' ? COLORS.pink : COLORS.cyan;
      ep.size = 30;
      ep.life = 1400;
      ep.maxLife = 1400;
      ep.type = 'text';
      ep.text = nextEvent === 'surge' ? 'SURGE MODE' : 'MAGNET STORM';

      state = {
        ...state,
        screenFlash: currentTime,
        screenFlashColor: nextEvent === 'surge' ? '255, 45, 106' : '0, 240, 255',
      };
    }
  }

  if (state.activeEvent && state.eventUntil && currentTime >= state.eventUntil) {
    state = { ...state, activeEvent: undefined, eventUntil: undefined };
  }

  // Update particles in-place and release dead ones
  particlePool.forEach(p => {
    // In-place update
    const newLife = p.life - effectiveDelta * 16;
    const lifeRatio = Math.max(0, newLife / p.maxLife);
    p.position.x += p.velocity.x * effectiveDelta * 0.1;
    p.position.y += p.velocity.y * effectiveDelta * 0.1;
    p.velocity.x *= 0.98;
    p.velocity.y *= 0.98;
    p.life = newLife;
    p.size = Math.max(0.1, p.size * lifeRatio);
    if (p.life <= 0) return false; // release
    return true; // keep
  });

  // Decay screen shake
  screenShake = Math.max(0, screenShake - deltaTime * 0.5);

  return {
    ...state,
    player,
    enemies,
    projectiles: projectilePool.items,
    projectileCount: projectilePool.activeCount,
    powerups,
    experienceOrbs: xpOrbPool.items,
    experienceOrbCount: xpOrbPool.activeCount,
    particles: particlePool.items,
    particleCount: particlePool.activeCount,
    score,
    multiplier,
    multiplierTimer,
    screenShake,
    killStreak,
    killStreakTimer,
    nearMissCount,
    totalDamageDealt,
  };
}

function updatePlayer(
  player: Player,
  input: { keys: Set<string>; mousePos: Vector2; mouseDown: boolean },
  width: number,
  height: number,
  config: GameConfig,
  deltaTime: number
): Player {
  let targetVx = 0;
  let targetVy = 0;

  if (input.keys.has('w') || input.keys.has('arrowup')) targetVy -= 1;
  if (input.keys.has('s') || input.keys.has('arrowdown')) targetVy += 1;
  if (input.keys.has('a') || input.keys.has('arrowleft')) targetVx -= 1;
  if (input.keys.has('d') || input.keys.has('arrowright')) targetVx += 1;

  const length = Math.sqrt(targetVx * targetVx + targetVy * targetVy);
  if (length > 0) {
    targetVx = (targetVx / length) * player.speed;
    targetVy = (targetVy / length) * player.speed;
  }

  const acceleration = 0.25;
  const vx = player.velocity.x + (targetVx - player.velocity.x) * acceleration;
  const vy = player.velocity.y + (targetVy - player.velocity.y) * acceleration;

  let newX = player.position.x + vx * deltaTime;
  let newY = player.position.y + vy * deltaTime;

  const margin = player.radius;
  if (newX < margin) { newX = margin; }
  if (newX > width - margin) { newX = width - margin; }
  if (newY < margin) { newY = margin; }
  if (newY > height - margin) { newY = height - margin; }

  return {
    ...player,
    position: { x: newX, y: newY },
    velocity: { x: vx, y: vy },
  };
}

function emitWeaponMuzzleEffect(
  weaponType: WeaponType,
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

function emitProjectileSignatureTrail(projectile: Projectile): void {
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

function emitWeaponImpactEffect(projectile: Projectile, enemy: Enemy): void {
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

function fireWeapons(player: Player, mousePos: Vector2, currentTime: number): void {
  const damageBuff = player.activeBuffs.find(b => b.type === 'damage');
  const damageMultiplier = damageBuff ? damageBuff.multiplier : 1;

  player.weapons.forEach(weapon => {
    if (currentTime - weapon.lastFired < weapon.fireRate) return;
    weapon.lastFired = currentTime;

    const config = WEAPON_CONFIGS[weapon.type];

    if (weapon.type === 'orbit') {
      // Keep orbit strong without forming a permanent full-coverage shield.
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
        // Avoid multi-layer orbit stacking from repeated refires.
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

function updateProjectileInPlace(projectile: Projectile, deltaTime: number, playerPos: Vector2): void {
  if (projectile.orbit) {
    projectile.orbit.angle += projectile.orbit.speed * deltaTime;
    projectile.position.x = playerPos.x + Math.cos(projectile.orbit.angle) * projectile.orbit.radius;
    projectile.position.y = playerPos.y + Math.sin(projectile.orbit.angle) * projectile.orbit.radius;
    projectile.orbit.owner = playerPos;
    projectile.lifetime = (projectile.lifetime || 3000) - deltaTime * 16;
    return;
  }

  projectile.position.x += projectile.velocity.x * deltaTime;
  projectile.position.y += projectile.velocity.y * deltaTime;
}

function isProjectileAlive(projectile: Projectile, width: number, height: number): boolean {
  if (projectile.orbit) {
    return (projectile.lifetime || 0) > 0;
  }

  const { x, y } = projectile.position;
  const margin = 50;
  return x > -margin && x < width + margin && y > -margin && y < height + margin;
}

function checkProjectileCollisions(
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
        enemy.health -= projectile.damage;
        damageDealt += projectile.damage;

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
        dp.text = Math.floor(projectile.damage).toString();

        emitWeaponImpactEffect(projectile, enemy);

        // Enemy body-chip sparks for readability, regardless of weapon.
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

        // Missile explosion - dramatic multi-layer effect
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

          // Inner fire burst (orange/yellow)
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

          // Debris trails radiating outward
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

          // Explosion shockwave rings (3 layers)
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

function updateEnemy(
  enemy: Enemy,
  player: Player,
  deltaTime: number,
  currentTime: number,
  player2?: Player | null,
  activeEvent?: WaveEventType
): Enemy {
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

  if (enemy.type === 'magnet') {
    vx *= 0.8;
    vy *= 0.8;
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

function checkEnemyPlayerCollision(
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

function spawnEnemy(wave: number, width: number, height: number, playerPos: Vector2, isSplit = false): Enemy {
  let type: EnemyType = 'chaser';
  const roll = Math.random();

  if (wave >= 2 && roll < 0.25) type = 'swarm';
  if (wave >= 2 && roll >= 0.25 && roll < 0.35) type = 'zigzag';
  if (wave >= 3 && roll >= 0.35 && roll < 0.45) type = 'shooter';
  if (wave >= 4 && roll >= 0.45 && roll < 0.55) type = 'splitter';
  if (wave >= 5 && roll >= 0.55 && roll < 0.62) type = 'tank';
  if (wave >= 5 && roll >= 0.62 && roll < 0.70) type = 'ghost';
  if (wave >= 6 && roll >= 0.70 && roll < 0.78) type = 'bomber';
  if (wave >= 7 && roll >= 0.78 && roll < 0.85) type = 'magnet';

  const config = ENEMY_CONFIGS[type];
  const waveMultiplier = 1 + wave * 0.1;
  const eliteChance = isSplit ? 0 : Math.min(0.22, 0.06 + wave * 0.01);
  const isElite = wave >= 3 && Math.random() < eliteChance;
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

function spawnBoss(width: number, height: number, playerPos: Vector2): Enemy {
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

function collectExperienceOrbs(
  player: Player,
  config: GameConfig
): number {
  let collectedXP = 0;
  const magnetRange = config.magnetRange * (player.magnetMultiplier || 1);

  xpOrbPool.forEach(orb => {
    const dx = player.position.x - orb.position.x;
    const dy = player.position.y - orb.position.y;
    const distSq = dx * dx + dy * dy;

    if (distSq < (player.radius + 10) * (player.radius + 10)) {
      collectedXP += orb.value;

      // XP collection sparkle
      for (let si = 0; si < 3; si++) {
        const sparkAngle = Math.random() * Math.PI * 2;
        const sp = particlePool.acquire();
        sp.id = generateId();
        sp.position.x = orb.position.x;
        sp.position.y = orb.position.y;
        sp.velocity.x = Math.cos(sparkAngle) * (1 + Math.random() * 2);
        sp.velocity.y = Math.sin(sparkAngle) * (1 + Math.random() * 2) - 1;
        sp.color = COLORS.green;
        sp.size = 2 + Math.random() * 2;
        sp.life = 150 + Math.random() * 100;
        sp.maxLife = 250;
        sp.type = 'spark';
      }

      return false; // release
    }

    // Move orbs towards player if within magnet range
    if (distSq < magnetRange * magnetRange) {
      const distance = Math.sqrt(distSq);
      const speed = 5 * (1 - distance / magnetRange);
      orb.position.x += (dx / distance) * speed;
      orb.position.y += (dy / distance) * speed;
    }

    return true; // keep
  });

  return collectedXP;
}

function addExperience(player: Player, xp: number, config: GameConfig): { player: Player; leveledUp: boolean } {
  let experience = player.experience + xp;
  let level = player.level;
  let leveledUp = false;
  let xpNeeded = config.experienceToLevel * level;

  while (experience >= xpNeeded) {
    experience -= xpNeeded;
    level++;
    leveledUp = true;
    xpNeeded = config.experienceToLevel * level;
  }

  return { player: { ...player, experience, level }, leveledUp };
}

export function generateUpgrades(player: Player): Upgrade[] {
  const upgrades: Upgrade[] = [];
  const ownedWeaponTypes = new Set(player.weapons.map(w => w.type));

  player.weapons.forEach(weapon => {
    if (weapon.level < 5) {
      const config = WEAPON_CONFIGS[weapon.type];
      upgrades.push({
        id: `upgrade_${weapon.type}`,
        type: 'weapon_upgrade',
        weaponType: weapon.type,
        name: `${weapon.type.charAt(0).toUpperCase() + weapon.type.slice(1)} +`,
        description: `Level ${weapon.level} \u2192 ${weapon.level + 1}: +20% damage, faster fire`,
        icon: getWeaponIcon(weapon.type),
        color: config.color,
      });
    }
  });

  const allWeapons: WeaponType[] = ['blaster', 'spread', 'laser', 'orbit', 'missile'];
  allWeapons.forEach(weaponType => {
    if (!ownedWeaponTypes.has(weaponType)) {
      const config = WEAPON_CONFIGS[weaponType];
      upgrades.push({
        id: `new_${weaponType}`,
        type: 'weapon_new',
        weaponType,
        name: weaponType.charAt(0).toUpperCase() + weaponType.slice(1),
        description: getWeaponDescription(weaponType),
        icon: getWeaponIcon(weaponType),
        color: config.color,
      });
    }
  });

  upgrades.push({
    id: 'stat_health',
    type: 'stat',
    stat: 'health',
    name: 'Vitality',
    description: '+25 Max HP, heal 25 HP',
    icon: '\u2764\ufe0f',
    color: '#39ff14',
  });

  upgrades.push({
    id: 'stat_speed',
    type: 'stat',
    stat: 'speed',
    name: 'Swift',
    description: '+15% movement speed',
    icon: '\u26a1',
    color: '#e4ff1a',
  });

  upgrades.push({
    id: 'stat_magnet',
    type: 'stat',
    stat: 'magnet',
    name: 'Magnet',
    description: '+30% pickup range',
    icon: '\ud83e\uddf2',
    color: '#bf5fff',
  });

  const shuffled = upgrades.sort(() => Math.random() - 0.5);
  return shuffled.slice(0, 3);
}

function getWeaponIcon(type: WeaponType): string {
  switch (type) {
    case 'blaster': return '\ud83d\udd2b';
    case 'spread': return '\ud83d\udca8';
    case 'laser': return '\u26a1';
    case 'orbit': return '\ud83d\udd2e';
    case 'missile': return '\ud83d\ude80';
    default: return '\ud83d\udd2b';
  }
}

function getWeaponDescription(type: WeaponType): string {
  switch (type) {
    case 'blaster': return 'Basic rapid-fire weapon';
    case 'spread': return '5-shot spread, covers wide area';
    case 'laser': return 'Fast piercing beam, hits multiple enemies';
    case 'orbit': return 'Orbs circle around you, constant damage';
    case 'missile': return 'Slow but devastating explosive shots';
    default: return '';
  }
}

export function applyUpgrade(state: GameState, upgrade: Upgrade): GameState {
  let { player } = state;

  if (upgrade.type === 'weapon_new' && upgrade.weaponType) {
    const config = WEAPON_CONFIGS[upgrade.weaponType];
    player = {
      ...player,
      weapons: [
        ...player.weapons,
        {
          type: upgrade.weaponType,
          level: 1,
          lastFired: 0,
          ...config,
        },
      ],
    };
  } else if (upgrade.type === 'weapon_upgrade' && upgrade.weaponType) {
    player = {
      ...player,
      weapons: player.weapons.map(w => {
        if (w.type === upgrade.weaponType) {
          const isOrbit = w.type === 'orbit';
          return {
            ...w,
            level: w.level + 1,
            damage: w.damage * (isOrbit ? 1.12 : 1.2),
            fireRate: Math.max(isOrbit ? 220 : 50, w.fireRate * (isOrbit ? 0.96 : 0.9)),
            projectileCount: w.type === 'spread' ? w.projectileCount + 1 : w.projectileCount,
            piercing: w.type === 'laser' ? w.piercing + 1 : w.piercing,
          };
        }
        return w;
      }),
    };
  } else if (upgrade.type === 'stat') {
    switch (upgrade.stat) {
      case 'health':
        player = {
          ...player,
          maxHealth: player.maxHealth + 25,
          health: Math.min(player.health + 25, player.maxHealth + 25),
        };
        break;
      case 'speed':
        player = { ...player, speedBonus: player.speedBonus + 0.5 };
        break;
      case 'magnet':
        player = { ...player, magnetBonus: player.magnetBonus + 0.3 };
        break;
    }
  }

  return {
    ...state,
    player,
    pendingLevelUps: state.pendingLevelUps - 1,
    availableUpgrades: state.pendingLevelUps > 1 ? generateUpgrades(player) : [],
  };
}

const POWERUP_DROP_WEIGHTS: Array<{ type: PowerUpType; weight: number }> = [
  { type: 'health', weight: 0.24 },
  { type: 'speed', weight: 0.2 },
  { type: 'damage', weight: 0.2 },
  { type: 'magnet', weight: 0.16 },
  { type: 'xp', weight: 0.14 },
  { type: 'bomb', weight: 0.06 },
];

function rollPowerUpType(): PowerUpType {
  const totalWeight = POWERUP_DROP_WEIGHTS.reduce((sum, entry) => sum + entry.weight, 0);
  const roll = Math.random() * totalWeight;
  let acc = 0;
  for (const entry of POWERUP_DROP_WEIGHTS) {
    acc += entry.weight;
    if (roll <= acc) return entry.type;
  }
  return 'health';
}

function createPowerup(position: Vector2): PowerUp {
  const type = rollPowerUpType();

  return {
    id: generateId(),
    position: { ...position },
    type,
    createdAt: Date.now(),
    duration: POWERUP_CONFIGS[type].duration,
  };
}

function collectPowerups(
  player: Player,
  powerups: PowerUp[],
  currentTime: number
): { collectedPowerups: PowerUp[]; remainingPowerups: PowerUp[] } {
  const collectedPowerups: PowerUp[] = [];

  const remainingPowerups = powerups.filter(powerup => {
    if (currentTime - powerup.createdAt > 15000) return false;

    const dx = player.position.x - powerup.position.x;
    const dy = player.position.y - powerup.position.y;
    const distSq = dx * dx + dy * dy;

    if (distSq < (player.radius + 15) * (player.radius + 15)) {
      collectedPowerups.push(powerup);
      createExplosion(powerup.position, POWERUP_CONFIGS[powerup.type].color, 18);
      return false;
    }

    return true;
  });

  return { collectedPowerups, remainingPowerups };
}

function applyPowerup(player: Player, powerup: PowerUp, currentTime: number): Player {
  const duration = POWERUP_CONFIGS[powerup.type].duration;

  switch (powerup.type) {
    case 'health':
      return { ...player, health: Math.min(player.maxHealth, player.health + 25) };
    case 'speed':
      return {
        ...player,
        activeBuffs: [
          ...player.activeBuffs.filter(b => b.type !== 'speed'),
          { type: 'speed', expiresAt: currentTime + duration, multiplier: 1.5 }
        ],
      };
    case 'damage':
      return {
        ...player,
        activeBuffs: [
          ...player.activeBuffs.filter(b => b.type !== 'damage'),
          { type: 'damage', expiresAt: currentTime + duration, multiplier: 1.5 }
        ],
      };
    case 'magnet':
      return {
        ...player,
        activeBuffs: [
          ...player.activeBuffs.filter(b => b.type !== 'magnet'),
          { type: 'magnet', expiresAt: currentTime + duration, multiplier: 3 }
        ],
      };
    case 'xp':
      return addExperience(player, 50, DEFAULT_CONFIG).player;
    case 'bomb':
      return player; // bomb effect handled in collection loop
    default:
      return player;
  }
}

function updatePlayerBuffs(player: Player, currentTime: number): Player {
  const activeBuffs = player.activeBuffs.filter(b => b.expiresAt > currentTime);

  const speedBuff = activeBuffs.find(b => b.type === 'speed');
  const magnetBuff = activeBuffs.find(b => b.type === 'magnet');

  const effectiveSpeed = Math.min(8, (player.baseSpeed + player.speedBonus) * (speedBuff?.multiplier || 1));
  const effectiveMagnet = (1 + player.magnetBonus) * (magnetBuff?.multiplier || 1);

  return {
    ...player,
    activeBuffs,
    speed: effectiveSpeed,
    magnetMultiplier: effectiveMagnet,
  };
}

function createExplosion(position: Vector2, color: string, count: number): void {
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

// Phase 3: Serialize game state for render worker (lean visual-only data)
export interface RenderState {
  player: {
    position: Vector2;
    radius: number;
    color: string;
    health: number;
    maxHealth: number;
    invulnerableUntil: number;
    level: number;
    experience: number;
    weapons: Array<{ type: WeaponType; level: number }>;
    activeBuffs: Array<{ type: string; expiresAt: number; multiplier: number }>;
  };
  enemies: Array<{
    position: Vector2;
    radius: number;
    color: string;
    health: number;
    maxHealth: number;
    type: EnemyType;
    ghostAlpha?: number;
    spawnTime: number;
  }>;
  projectiles: Array<{
    position: Vector2;
    velocity: Vector2;
    radius: number;
    color: string;
    orbit?: { angle: number; radius: number; speed: number; owner: Vector2 };
    weaponType?: WeaponType;
  }>;
  projectileCount: number;
  particles: Array<{
    position: Vector2;
    velocity: Vector2;
    color: string;
    size: number;
    life: number;
    maxLife: number;
    type: 'explosion' | 'trail' | 'spark' | 'text' | 'ring';
    text?: string;
  }>;
  particleCount: number;
  experienceOrbs: Array<{
    position: Vector2;
  }>;
  experienceOrbCount: number;
  powerups: Array<{
    position: Vector2;
    type: PowerUpType;
  }>;
  score: number;
  wave: number;
  multiplier: number;
  killStreak: number;
  nearMissCount: number;
  screenShake: number;
  arena: ArenaType;
  waveAnnounceTime?: number;
  activeEvent?: WaveEventType;
  eventAnnounceTime?: number;
  screenFlash?: number;
  screenFlashColor?: string;
}

export function serializeForRender(state: GameState): RenderState {
  const enemies: RenderState['enemies'] = [];
  for (let i = 0; i < state.enemies.length; i++) {
    const e = state.enemies[i];
    enemies.push({
      position: { x: e.position.x, y: e.position.y },
      radius: e.radius,
      color: e.color,
      health: e.health,
      maxHealth: e.maxHealth,
      type: e.type,
      ghostAlpha: e.ghostAlpha,
      spawnTime: e.spawnTime,
    });
  }

  const projectiles: RenderState['projectiles'] = [];
  for (let i = 0; i < state.projectileCount; i++) {
    const p = state.projectiles[i];
    projectiles.push({
      position: { x: p.position.x, y: p.position.y },
      velocity: { x: p.velocity.x, y: p.velocity.y },
      radius: p.radius,
      color: p.color,
      orbit: p.orbit ? { angle: p.orbit.angle, radius: p.orbit.radius, speed: p.orbit.speed, owner: { x: p.orbit.owner.x, y: p.orbit.owner.y } } : undefined,
      weaponType: p.weaponType,
    });
  }

  const particles: RenderState['particles'] = [];
  for (let i = 0; i < state.particleCount; i++) {
    const pt = state.particles[i];
    particles.push({
      position: { x: pt.position.x, y: pt.position.y },
      velocity: { x: pt.velocity.x, y: pt.velocity.y },
      color: pt.color,
      size: pt.size,
      life: pt.life,
      maxLife: pt.maxLife,
      type: pt.type,
      text: pt.text,
    });
  }

  const experienceOrbs: RenderState['experienceOrbs'] = [];
  for (let i = 0; i < state.experienceOrbCount; i++) {
    const o = state.experienceOrbs[i];
    experienceOrbs.push({
      position: { x: o.position.x, y: o.position.y },
    });
  }

  const powerups: RenderState['powerups'] = [];
  for (let i = 0; i < state.powerups.length; i++) {
    const pw = state.powerups[i];
    powerups.push({
      position: { x: pw.position.x, y: pw.position.y },
      type: pw.type,
    });
  }

  return {
    player: {
      position: { x: state.player.position.x, y: state.player.position.y },
      radius: state.player.radius,
      color: state.player.color,
      health: state.player.health,
      maxHealth: state.player.maxHealth,
      invulnerableUntil: state.player.invulnerableUntil,
      level: state.player.level,
      experience: state.player.experience,
      weapons: state.player.weapons.map(w => ({ type: w.type, level: w.level })),
      activeBuffs: state.player.activeBuffs.map(b => ({ type: b.type, expiresAt: b.expiresAt, multiplier: b.multiplier })),
    },
    enemies,
    projectiles,
    projectileCount: projectiles.length,
    particles,
    particleCount: particles.length,
    experienceOrbs,
    experienceOrbCount: experienceOrbs.length,
    powerups,
    score: state.score,
    wave: state.wave,
    multiplier: state.multiplier,
    killStreak: state.killStreak,
    nearMissCount: state.nearMissCount,
    screenShake: state.screenShake,
    arena: state.arena,
    waveAnnounceTime: state.waveAnnounceTime,
    activeEvent: state.activeEvent,
    eventAnnounceTime: state.eventAnnounceTime,
    screenFlash: state.screenFlash,
    screenFlashColor: state.screenFlashColor,
  };
}
