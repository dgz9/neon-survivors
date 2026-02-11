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
  let { player, enemies, powerups, score, multiplier, multiplierTimer, screenShake, totalDamageDealt } = state;

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

    // Missile smoke trail
    if (proj.weaponType === 'missile' && !proj.orbit) {
      const tp = particlePool.acquire();
      tp.id = generateId();
      tp.position.x = proj.position.x - proj.velocity.x * 0.3 + (Math.random() - 0.5) * 4;
      tp.position.y = proj.position.y - proj.velocity.y * 0.3 + (Math.random() - 0.5) * 4;
      tp.velocity.x = -proj.velocity.x * 0.05 + (Math.random() - 0.5) * 1.5;
      tp.velocity.y = -proj.velocity.y * 0.05 + (Math.random() - 0.5) * 1.5;
      tp.color = COLORS.orange;
      tp.size = 4 + Math.random() * 3;
      tp.life = 200 + Math.random() * 100;
      tp.maxLife = 300;
      tp.type = 'explosion';

      // Secondary grey smoke
      if (Math.random() < 0.5) {
        const sp = particlePool.acquire();
        sp.id = generateId();
        sp.position.x = proj.position.x - proj.velocity.x * 0.5 + (Math.random() - 0.5) * 6;
        sp.position.y = proj.position.y - proj.velocity.y * 0.5 + (Math.random() - 0.5) * 6;
        sp.velocity.x = (Math.random() - 0.5) * 0.8;
        sp.velocity.y = (Math.random() - 0.5) * 0.8 - 0.5;
        sp.color = '#888888';
        sp.size = 5 + Math.random() * 4;
        sp.life = 300 + Math.random() * 200;
        sp.maxLife = 500;
        sp.type = 'spark';
      }
    }

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

  // Update enemies
  enemies = enemies.map(e => updateEnemy(e, player, effectiveDelta, currentTime, player2));

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

      // Shockwave rings (orange, yellow, white)
      const ringColors = [COLORS.orange, COLORS.yellow, COLORS.white];
      const ringSizes = [bombRadius * 0.8, bombRadius * 0.55, bombRadius * 0.35];
      const ringLives = [500, 400, 300];
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
      for (let fi = 0; fi < 45; fi++) {
        const angle = (fi / 45) * Math.PI * 2 + Math.random() * 0.3;
        const speed = 4 + Math.random() * 8;
        const fp = particlePool.acquire();
        fp.id = generateId();
        fp.position.x = player.position.x + (Math.random() - 0.5) * 10;
        fp.position.y = player.position.y + (Math.random() - 0.5) * 10;
        fp.velocity.x = Math.cos(angle) * speed;
        fp.velocity.y = Math.sin(angle) * speed;
        fp.color = fi % 3 === 0 ? COLORS.yellow : fi % 3 === 1 ? COLORS.orange : COLORS.white;
        fp.size = 4 + Math.random() * 5;
        fp.life = 300 + Math.random() * 200;
        fp.maxLife = 500;
        fp.type = fi % 4 === 0 ? 'trail' : 'explosion';
      }

      // Bright white center flash
      const cf = particlePool.acquire();
      cf.id = generateId();
      cf.position.x = player.position.x;
      cf.position.y = player.position.y;
      cf.velocity.x = 0;
      cf.velocity.y = 0;
      cf.color = COLORS.white;
      cf.size = bombRadius * 0.3;
      cf.life = 150;
      cf.maxLife = 150;
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

      screenShake = 30;
      state = { ...state, screenFlash: currentTime, screenFlashColor: '228, 255, 26' };
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

  // Spawn enemies
  const spawnInterval = config.enemySpawnRate / (1 + state.wave * 0.2);
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
    state = {
      ...state,
      wave: newWave,
      enemiesKilledThisWave: 0,
      enemiesRequiredForWave: Math.floor(state.enemiesRequiredForWave * 1.2),
      waveAnnounceTime: currentTime,
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

function fireWeapons(player: Player, mousePos: Vector2, currentTime: number): void {
  const damageBuff = player.activeBuffs.find(b => b.type === 'damage');
  const damageMultiplier = damageBuff ? damageBuff.multiplier : 1;

  player.weapons.forEach(weapon => {
    if (currentTime - weapon.lastFired < weapon.fireRate) return;
    weapon.lastFired = currentTime;

    const config = WEAPON_CONFIGS[weapon.type];

    if (weapon.type === 'orbit') {
      // Cap orbit count to prevent invincibility at high levels
      const orbitCount = Math.min(6, weapon.projectileCount + weapon.level - 1);
      for (let i = 0; i < orbitCount; i++) {
        const orbitAngle = (i / orbitCount) * Math.PI * 2;
        const p = projectilePool.acquire();
        p.id = generateId();
        p.position.x = player.position.x;
        p.position.y = player.position.y;
        p.velocity.x = 0;
        p.velocity.y = 0;
        p.radius = 8 + weapon.level;
        p.color = config.color;
        p.damage = weapon.damage * (1 + (weapon.level - 1) * 0.2) * damageMultiplier;
        p.isEnemy = false;
        p.piercing = 999;
        p.orbit = {
          angle: orbitAngle,
          radius: 55 + weapon.level * 8,
          speed: 0.04 + weapon.level * 0.008,
          owner: player.position,
        };
        p.weaponType = 'orbit';
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

        // Hit spark particles
        for (let j = 0; j < 10; j++) {
          const sparkAngle = Math.random() * Math.PI * 2;
          const sparkSpeed = 3 + Math.random() * 5;
          const sp = particlePool.acquire();
          sp.id = generateId();
          sp.position.x = projectile.position.x + (Math.random() - 0.5) * 10;
          sp.position.y = projectile.position.y + (Math.random() - 0.5) * 10;
          sp.velocity.x = Math.cos(sparkAngle) * sparkSpeed;
          sp.velocity.y = Math.sin(sparkAngle) * sparkSpeed;
          sp.color = projectile.color;
          sp.size = 2 + Math.random() * 3;
          sp.life = 200 + Math.random() * 150;
          sp.maxLife = 350;
          sp.type = 'spark';
        }

        // Enemy color sparks
        for (let j = 0; j < 6; j++) {
          const sparkAngle = Math.random() * Math.PI * 2;
          const sparkSpeed = 2 + Math.random() * 4;
          const ep = particlePool.acquire();
          ep.id = generateId();
          ep.position.x = projectile.position.x;
          ep.position.y = projectile.position.y;
          ep.velocity.x = Math.cos(sparkAngle) * sparkSpeed;
          ep.velocity.y = Math.sin(sparkAngle) * sparkSpeed;
          ep.color = enemy.color;
          ep.size = 3 + Math.random() * 2;
          ep.life = 180 + Math.random() * 120;
          ep.maxLife = 300;
          ep.type = 'explosion';
        }

        // Impact ring
        const ir = particlePool.acquire();
        ir.id = generateId();
        ir.position.x = projectile.position.x;
        ir.position.y = projectile.position.y;
        ir.velocity.x = 0;
        ir.velocity.y = 0;
        ir.color = projectile.color;
        ir.size = 20;
        ir.life = 180;
        ir.maxLife = 180;
        ir.type = 'ring';

        // Secondary ring
        const sr = particlePool.acquire();
        sr.id = generateId();
        sr.position.x = projectile.position.x;
        sr.position.y = projectile.position.y;
        sr.velocity.x = 0;
        sr.velocity.y = 0;
        sr.color = enemy.color;
        sr.size = 12;
        sr.life = 120;
        sr.maxLife = 120;
        sr.type = 'ring';

        // Missile explosion - dramatic multi-layer effect
        if (projectile.weaponType === 'missile' && projectile.explosionRadius) {
          const explosionRadius = projectile.explosionRadius;
          const explosionRadiusSq = explosionRadius * explosionRadius;
          missileShake += 18;

          // Bright center flash
          const flash = particlePool.acquire();
          flash.id = generateId();
          flash.position.x = projectile.position.x;
          flash.position.y = projectile.position.y;
          flash.velocity.x = 0;
          flash.velocity.y = 0;
          flash.color = COLORS.white;
          flash.size = explosionRadius * 0.4;
          flash.life = 120;
          flash.maxLife = 120;
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

function updateEnemy(enemy: Enemy, player: Player, deltaTime: number, currentTime: number, player2?: Player | null): Enemy {
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

  let x: number, y: number;
  const side = Math.floor(Math.random() * 4);
  const marginDist = 50;

  switch (side) {
    case 0: x = -marginDist; y = Math.random() * height; break;
    case 1: x = width + marginDist; y = Math.random() * height; break;
    case 2: x = Math.random() * width; y = -marginDist; break;
    default: x = Math.random() * width; y = height + marginDist; break;
  }

  return {
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
  };
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
          return {
            ...w,
            level: w.level + 1,
            damage: w.damage * 1.2,
            fireRate: Math.max(50, w.fireRate * 0.9),
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

function createPowerup(position: Vector2): PowerUp {
  const types: PowerUpType[] = ['health', 'speed', 'damage', 'magnet', 'xp', 'bomb'];
  const type = types[Math.floor(Math.random() * types.length)];

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
    p.color = COLORS.white;
    p.size = 2 + Math.random() * 2;
    p.life = 300 + Math.random() * 200;
    p.maxLife = 500;
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
  screenShake: number;
  arena: ArenaType;
  waveAnnounceTime?: number;
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
    screenShake: state.screenShake,
    arena: state.arena,
    waveAnnounceTime: state.waveAnnounceTime,
    screenFlash: state.screenFlash,
    screenFlashColor: state.screenFlashColor,
  };
}
