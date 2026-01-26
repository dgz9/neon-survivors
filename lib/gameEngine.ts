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
  DEFAULT_CONFIG,
  ENEMY_CONFIGS,
  WEAPON_CONFIGS,
  POWERUP_CONFIGS,
  EnemyType,
  WeaponType,
  PowerUpType,
} from '@/types/game';

// Brutalist color palette
const COLORS = {
  black: '#0a0a0a',
  dark: '#141414',
  yellow: '#e4ff1a',
  pink: '#ff2d6a',
  cyan: '#00f0ff',
  green: '#39ff14',
  purple: '#bf5fff',
  orange: '#ff6b1a',
  white: '#fafafa',
};

let nextId = 0;
const generateId = () => `id-${nextId++}-${Math.random().toString(36).substr(2, 9)}`;

export function createInitialGameState(
  playerImageUrl: string,
  width: number,
  height: number,
  config: GameConfig = DEFAULT_CONFIG
): GameState {
  const player: Player = {
    position: { x: width / 2, y: height / 2 },
    velocity: { x: 0, y: 0 },
    radius: config.playerRadius,
    color: COLORS.cyan,
    health: config.playerMaxHealth,
    maxHealth: config.playerMaxHealth,
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
  };

  return {
    player,
    enemies: [],
    projectiles: [],
    powerups: [],
    experienceOrbs: [],
    particles: [],
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
  config: GameConfig = DEFAULT_CONFIG
): GameState {
  if (!state.isRunning || state.isPaused || state.isGameOver) {
    return state;
  }

  const currentTime = Date.now();
  let { player, enemies, projectiles, powerups, experienceOrbs, particles, score, multiplier, multiplierTimer, screenShake } = state;

  // Update player position based on input
  player = updatePlayer(player, input, width, height, config, deltaTime);

  // Fire weapons
  const newProjectiles = fireWeapons(player, input.mousePos, currentTime);
  projectiles = [...projectiles, ...newProjectiles];

  // Update projectiles
  projectiles = projectiles
    .map(p => updateProjectile(p, deltaTime, player.position))
    .filter(p => isProjectileAlive(p, width, height));

  // Check projectile-enemy collisions
  const { updatedEnemies, updatedProjectiles, killedEnemies, damageParticles } = 
    checkProjectileCollisions(enemies, projectiles, currentTime);
  enemies = updatedEnemies;
  projectiles = updatedProjectiles;
  particles = [...particles, ...damageParticles];

  // Process killed enemies
  killedEnemies.forEach(enemy => {
    score += enemy.points * multiplier;
    player.kills++;
    multiplier = Math.min(multiplier + 0.1, 10);
    multiplierTimer = currentTime + 3000;
    
    // Spawn experience orb
    experienceOrbs.push({
      id: generateId(),
      position: { ...enemy.position },
      value: Math.floor(enemy.points / 2),
      createdAt: currentTime,
    });

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

    // Death particles - more dramatic
    particles = [...particles, ...createExplosion(enemy.position, enemy.color, 20 + enemy.radius)];
  });

  state = { ...state, enemiesKilledThisWave: state.enemiesKilledThisWave + killedEnemies.length };

  // Check if multiplier should decay
  if (currentTime > multiplierTimer) {
    multiplier = Math.max(1, multiplier - 0.01 * deltaTime);
  }

  // Update enemies
  enemies = enemies.map(e => updateEnemy(e, player, deltaTime, currentTime));

  // Check enemy-player collision
  const collision = checkEnemyPlayerCollision(enemies, player, currentTime);
  if (collision.hit && currentTime > player.invulnerableUntil) {
    player = {
      ...player,
      health: player.health - collision.damage,
      invulnerableUntil: currentTime + 1000,
    };
    screenShake = 10;
    particles = [...particles, ...createExplosion(player.position, COLORS.pink, 20)];
  }

  // Check if player is dead
  if (player.health <= 0) {
    return {
      ...state,
      player,
      isGameOver: true,
      isRunning: false,
    };
  }

  // Collect experience orbs
  const { collectedXP, remainingOrbs } = collectExperienceOrbs(player, experienceOrbs, config);
  experienceOrbs = remainingOrbs;
  
  if (collectedXP > 0) {
    const xpResult = addExperience(player, collectedXP, config);
    player = xpResult.player;
    if (xpResult.leveledUp) {
      // Queue level up selection
      state = {
        ...state,
        pendingLevelUps: state.pendingLevelUps + 1,
        availableUpgrades: state.availableUpgrades.length === 0 ? generateUpgrades(player) : state.availableUpgrades,
      };
    }
  }

  // Collect powerups
  const { collectedPowerups, remainingPowerups, powerupParticles } = 
    collectPowerups(player, powerups, currentTime);
  powerups = remainingPowerups;
  particles = [...particles, ...powerupParticles];
  
  collectedPowerups.forEach(powerup => {
    player = applyPowerup(player, powerup, state);
  });

  // Spawn enemies - more frequent and in groups as waves progress
  const spawnInterval = config.enemySpawnRate / (1 + state.wave * 0.2);
  if (currentTime - state.lastEnemySpawn > spawnInterval) {
    // Spawn multiple enemies at higher waves
    const spawnCount = Math.min(1 + Math.floor(state.wave / 3), 5);
    for (let i = 0; i < spawnCount; i++) {
      const newEnemy = spawnEnemy(state.wave, width, height, player.position);
      enemies.push(newEnemy);
    }
    state = { ...state, lastEnemySpawn: currentTime };
  }

  // Check wave completion
  if (state.enemiesKilledThisWave >= state.enemiesRequiredForWave) {
    state = {
      ...state,
      wave: state.wave + 1,
      enemiesKilledThisWave: 0,
      enemiesRequiredForWave: Math.floor(state.enemiesRequiredForWave * 1.2),
    };
    // Spawn boss every 5 waves
    if (state.wave % 5 === 0) {
      enemies.push(spawnBoss(width, height, player.position));
    }
  }

  // Update particles
  particles = particles
    .map(p => updateParticle(p, deltaTime))
    .filter(p => p.life > 0);

  // Decay screen shake
  screenShake = Math.max(0, screenShake - deltaTime * 0.5);

  return {
    ...state,
    player,
    enemies,
    projectiles,
    powerups,
    experienceOrbs,
    particles,
    score,
    multiplier,
    multiplierTimer,
    screenShake,
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
  let vx = 0;
  let vy = 0;

  if (input.keys.has('w') || input.keys.has('arrowup')) vy -= 1;
  if (input.keys.has('s') || input.keys.has('arrowdown')) vy += 1;
  if (input.keys.has('a') || input.keys.has('arrowleft')) vx -= 1;
  if (input.keys.has('d') || input.keys.has('arrowright')) vx += 1;

  // Normalize diagonal movement
  const length = Math.sqrt(vx * vx + vy * vy);
  if (length > 0) {
    vx = (vx / length) * player.speed;
    vy = (vy / length) * player.speed;
  }

  let newX = player.position.x + vx * deltaTime;
  let newY = player.position.y + vy * deltaTime;

  // Keep player in bounds
  newX = Math.max(player.radius, Math.min(width - player.radius, newX));
  newY = Math.max(player.radius, Math.min(height - player.radius, newY));

  return {
    ...player,
    position: { x: newX, y: newY },
    velocity: { x: vx, y: vy },
  };
}

function fireWeapons(player: Player, mousePos: Vector2, currentTime: number): Projectile[] {
  const projectiles: Projectile[] = [];

  player.weapons.forEach(weapon => {
    if (currentTime - weapon.lastFired < weapon.fireRate) return;
    weapon.lastFired = currentTime;

    const config = WEAPON_CONFIGS[weapon.type];

    // Orbit weapon creates orbs that circle around player
    if (weapon.type === 'orbit') {
      for (let i = 0; i < weapon.projectileCount + weapon.level - 1; i++) {
        const orbitAngle = (i / (weapon.projectileCount + weapon.level - 1)) * Math.PI * 2;
        projectiles.push({
          id: generateId(),
          position: { ...player.position },
          velocity: { x: 0, y: 0 },
          radius: 10 + weapon.level * 2,
          color: config.color,
          damage: weapon.damage * (1 + (weapon.level - 1) * 0.3),
          isEnemy: false,
          piercing: 999,
          hitEnemies: new Set(),
          orbit: {
            angle: orbitAngle,
            radius: 60 + weapon.level * 10,
            speed: 0.05 + weapon.level * 0.01,
            owner: player.position,
          },
        } as Projectile);
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

      projectiles.push({
        id: generateId(),
        position: { ...player.position },
        velocity: {
          x: Math.cos(projectileAngle) * weapon.projectileSpeed,
          y: Math.sin(projectileAngle) * weapon.projectileSpeed,
        },
        radius: weapon.type === 'missile' ? 10 : 6,
        color: config.color,
        damage: weapon.damage * (1 + (weapon.level - 1) * 0.2),
        isEnemy: false,
        piercing: weapon.piercing,
        hitEnemies: new Set(),
      });
    }
  });

  return projectiles;
}

function updateProjectile(projectile: Projectile, deltaTime: number, playerPos: Vector2): Projectile {
  // Handle orbiting projectiles
  if (projectile.orbit) {
    const newAngle = projectile.orbit.angle + projectile.orbit.speed * deltaTime;
    return {
      ...projectile,
      position: {
        x: playerPos.x + Math.cos(newAngle) * projectile.orbit.radius,
        y: playerPos.y + Math.sin(newAngle) * projectile.orbit.radius,
      },
      orbit: {
        ...projectile.orbit,
        angle: newAngle,
        owner: playerPos,
      },
      lifetime: (projectile.lifetime || 3000) - deltaTime * 16,
    };
  }

  return {
    ...projectile,
    position: {
      x: projectile.position.x + projectile.velocity.x * deltaTime,
      y: projectile.position.y + projectile.velocity.y * deltaTime,
    },
  };
}

function isProjectileAlive(projectile: Projectile, width: number, height: number): boolean {
  // Orbiting projectiles expire based on lifetime
  if (projectile.orbit) {
    return (projectile.lifetime || 0) > 0;
  }
  
  const { x, y } = projectile.position;
  const margin = 50;
  return x > -margin && x < width + margin && y > -margin && y < height + margin;
}

function checkProjectileCollisions(
  enemies: Enemy[],
  projectiles: Projectile[],
  currentTime: number
): {
  updatedEnemies: Enemy[];
  updatedProjectiles: Projectile[];
  killedEnemies: Enemy[];
  damageParticles: Particle[];
} {
  const killedEnemies: Enemy[] = [];
  const damageParticles: Particle[] = [];
  let updatedProjectiles = [...projectiles];
  let updatedEnemies = [...enemies];

  updatedProjectiles = updatedProjectiles.filter(projectile => {
    if (projectile.isEnemy) return true;

    for (let i = 0; i < updatedEnemies.length; i++) {
      const enemy = updatedEnemies[i];
      if (projectile.hitEnemies.has(enemy.id)) continue;

      const dx = enemy.position.x - projectile.position.x;
      const dy = enemy.position.y - projectile.position.y;
      const distance = Math.sqrt(dx * dx + dy * dy);

      if (distance < enemy.radius + projectile.radius) {
        // Hit!
        projectile.hitEnemies.add(enemy.id);
        enemy.health -= projectile.damage;

        // Create damage particle
        damageParticles.push({
          id: generateId(),
          position: { ...projectile.position },
          velocity: { x: 0, y: -2 },
          color: COLORS.white,
          size: 12,
          life: 500,
          maxLife: 500,
          type: 'text',
          text: Math.floor(projectile.damage).toString(),
        });

        if (enemy.health <= 0) {
          killedEnemies.push(enemy);
          updatedEnemies = updatedEnemies.filter(e => e.id !== enemy.id);
        }

        if (projectile.piercing <= 0) {
          return false; // Remove projectile
        }
        projectile.piercing--;
      }
    }
    return true;
  });

  return { updatedEnemies, updatedProjectiles, killedEnemies, damageParticles };
}

function updateEnemy(enemy: Enemy, player: Player, deltaTime: number, currentTime: number): Enemy {
  const dx = player.position.x - enemy.position.x;
  const dy = player.position.y - enemy.position.y;
  const distance = Math.sqrt(dx * dx + dy * dy);

  if (distance <= 0) return enemy;

  let vx = (dx / distance) * enemy.speed;
  let vy = (dy / distance) * enemy.speed;
  let updatedEnemy = { ...enemy };

  // Zigzag movement
  if (enemy.type === 'zigzag') {
    const phase = (enemy.zigzagPhase || 0) + deltaTime * 0.15;
    const perpX = -dy / distance;
    const perpY = dx / distance;
    const zigzagAmount = Math.sin(phase) * 3;
    vx += perpX * zigzagAmount;
    vy += perpY * zigzagAmount;
    updatedEnemy.zigzagPhase = phase;
  }

  // Ghost fades in and out, phases through when faded
  if (enemy.type === 'ghost') {
    const fadeSpeed = 0.002;
    const timeSinceSpawn = currentTime - enemy.spawnTime;
    const alpha = 0.3 + Math.sin(timeSinceSpawn * fadeSpeed) * 0.7;
    updatedEnemy.ghostAlpha = Math.max(0.1, Math.min(1, alpha));
  }

  // Magnet pulls XP orbs away from player (handled elsewhere)
  // Just moves slower but steadily
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
    const distance = Math.sqrt(dx * dx + dy * dy);

    if (distance < player.radius + enemy.radius) {
      return { hit: true, damage: enemy.damage };
    }
  }
  return { hit: false, damage: 0 };
}

function spawnEnemy(wave: number, width: number, height: number, playerPos: Vector2, isSplit = false): Enemy {
  // Determine enemy type based on wave
  let type: EnemyType = 'chaser';
  const roll = Math.random();
  
  // More variety as waves progress
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

  // Spawn at edge of screen, away from player
  let x: number, y: number;
  const side = Math.floor(Math.random() * 4);
  const margin = 50;

  switch (side) {
    case 0: x = -margin; y = Math.random() * height; break;
    case 1: x = width + margin; y = Math.random() * height; break;
    case 2: x = Math.random() * width; y = -margin; break;
    default: x = Math.random() * width; y = height + margin; break;
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
  orbs: ExperienceOrb[],
  config: GameConfig
): { collectedXP: number; remainingOrbs: ExperienceOrb[] } {
  let collectedXP = 0;
  const magnetRange = config.magnetRange * (player.magnetMultiplier || 1);
  
  const remainingOrbs = orbs.filter(orb => {
    const dx = player.position.x - orb.position.x;
    const dy = player.position.y - orb.position.y;
    const distance = Math.sqrt(dx * dx + dy * dy);

    if (distance < player.radius + 10) {
      collectedXP += orb.value;
      return false;
    }

    // Move orbs towards player if within magnet range
    if (distance < magnetRange) {
      const speed = 5 * (1 - distance / magnetRange);
      orb.position.x += (dx / distance) * speed;
      orb.position.y += (dy / distance) * speed;
    }

    return true;
  });

  return { collectedXP, remainingOrbs };
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
  
  // Weapon upgrades for owned weapons
  player.weapons.forEach(weapon => {
    if (weapon.level < 5) {
      const config = WEAPON_CONFIGS[weapon.type];
      upgrades.push({
        id: `upgrade_${weapon.type}`,
        type: 'weapon_upgrade',
        weaponType: weapon.type,
        name: `${weapon.type.charAt(0).toUpperCase() + weapon.type.slice(1)} +`,
        description: `Level ${weapon.level} → ${weapon.level + 1}: +20% damage, faster fire`,
        icon: getWeaponIcon(weapon.type),
        color: config.color,
      });
    }
  });

  // New weapons not yet owned
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

  // Stat upgrades
  upgrades.push({
    id: 'stat_health',
    type: 'stat',
    stat: 'health',
    name: 'Vitality',
    description: '+25 Max HP, heal 25 HP',
    icon: '❤️',
    color: '#39ff14',
  });

  upgrades.push({
    id: 'stat_speed',
    type: 'stat',
    stat: 'speed',
    name: 'Swift',
    description: '+15% movement speed',
    icon: '⚡',
    color: '#e4ff1a',
  });

  upgrades.push({
    id: 'stat_magnet',
    type: 'stat',
    stat: 'magnet',
    name: 'Magnet',
    description: '+30% pickup range',
    icon: '🧲',
    color: '#bf5fff',
  });

  // Shuffle and return 3 random upgrades
  const shuffled = upgrades.sort(() => Math.random() - 0.5);
  return shuffled.slice(0, 3);
}

function getWeaponIcon(type: WeaponType): string {
  switch (type) {
    case 'blaster': return '🔫';
    case 'spread': return '💨';
    case 'laser': return '⚡';
    case 'orbit': return '🔮';
    case 'missile': return '🚀';
    default: return '🔫';
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
        // Cap speed at 12 to keep it controllable
        player = { ...player, speed: Math.min(12, player.speed * 1.15) };
        break;
      case 'magnet':
        // Magnet range is in config, we'll track it on player
        player = { ...player, magnetMultiplier: (player.magnetMultiplier || 1) * 1.3 };
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
  const types: PowerUpType[] = ['health', 'speed', 'damage', 'magnet', 'xp'];
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
): { collectedPowerups: PowerUp[]; remainingPowerups: PowerUp[]; powerupParticles: Particle[] } {
  const collectedPowerups: PowerUp[] = [];
  const powerupParticles: Particle[] = [];

  const remainingPowerups = powerups.filter(powerup => {
    // Remove old powerups
    if (currentTime - powerup.createdAt > 15000) return false;

    const dx = player.position.x - powerup.position.x;
    const dy = player.position.y - powerup.position.y;
    const distance = Math.sqrt(dx * dx + dy * dy);

    if (distance < player.radius + 15) {
      collectedPowerups.push(powerup);
      powerupParticles.push(...createExplosion(powerup.position, POWERUP_CONFIGS[powerup.type].color, 10));
      return false;
    }

    return true;
  });

  return { collectedPowerups, remainingPowerups, powerupParticles };
}

function applyPowerup(player: Player, powerup: PowerUp, state: GameState): Player {
  switch (powerup.type) {
    case 'health':
      return { ...player, health: Math.min(player.maxHealth, player.health + 25) };
    case 'speed':
      return { ...player, speed: player.speed * 1.5 }; // Temporary boost
    case 'damage':
      return {
        ...player,
        weapons: player.weapons.map(w => ({ ...w, damage: w.damage * 1.5 })),
      };
    case 'xp':
      return addExperience(player, 50, DEFAULT_CONFIG).player;
    default:
      return player;
  }
}

function createExplosion(position: Vector2, color: string, count: number): Particle[] {
  const particles: Particle[] = [];
  
  // Inner burst - fast small particles
  for (let i = 0; i < count; i++) {
    const angle = (Math.PI * 2 * i) / count + Math.random() * 0.5;
    const speed = 4 + Math.random() * 6;
    
    particles.push({
      id: generateId(),
      position: { x: position.x + (Math.random() - 0.5) * 10, y: position.y + (Math.random() - 0.5) * 10 },
      velocity: {
        x: Math.cos(angle) * speed,
        y: Math.sin(angle) * speed,
      },
      color,
      size: 3 + Math.random() * 3,
      life: 400 + Math.random() * 200,
      maxLife: 600,
      type: 'explosion',
    });
  }

  // Outer ring - slower larger particles
  for (let i = 0; i < Math.floor(count / 2); i++) {
    const angle = (Math.PI * 2 * i) / (count / 2) + Math.random() * 0.3;
    const speed = 1 + Math.random() * 2;
    
    particles.push({
      id: generateId(),
      position: { ...position },
      velocity: {
        x: Math.cos(angle) * speed,
        y: Math.sin(angle) * speed,
      },
      color: COLORS.white,
      size: 2 + Math.random() * 2,
      life: 300 + Math.random() * 200,
      maxLife: 500,
      type: 'spark',
    });
  }

  // Geometry Wars style line trails
  for (let i = 0; i < 6; i++) {
    const angle = (Math.PI * 2 * i) / 6;
    particles.push({
      id: generateId(),
      position: { ...position },
      velocity: {
        x: Math.cos(angle) * 8,
        y: Math.sin(angle) * 8,
      },
      color,
      size: 12,
      life: 200,
      maxLife: 200,
      type: 'trail',
    });
  }

  return particles;
}

function updateParticle(particle: Particle, deltaTime: number): Particle {
  return {
    ...particle,
    position: {
      x: particle.position.x + particle.velocity.x * deltaTime * 0.1,
      y: particle.position.y + particle.velocity.y * deltaTime * 0.1,
    },
    velocity: {
      x: particle.velocity.x * 0.98,
      y: particle.velocity.y * 0.98,
    },
    life: particle.life - deltaTime * 16,
    size: particle.size * (particle.life / particle.maxLife),
  };
}

// Render functions
export function renderGame(
  ctx: CanvasRenderingContext2D,
  state: GameState,
  width: number,
  height: number,
  time: number
) {
  const { player, enemies, projectiles, powerups, experienceOrbs, particles, screenShake } = state;

  // Apply screen shake
  ctx.save();
  if (screenShake > 0) {
    ctx.translate(
      (Math.random() - 0.5) * screenShake,
      (Math.random() - 0.5) * screenShake
    );
  }

  // Clear and draw background
  ctx.fillStyle = COLORS.black;
  ctx.fillRect(0, 0, width, height);

  // Draw grid
  ctx.strokeStyle = 'rgba(228, 255, 26, 0.03)';
  ctx.lineWidth = 1;
  const gridSize = 50;
  for (let x = 0; x < width; x += gridSize) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
    ctx.stroke();
  }
  for (let y = 0; y < height; y += gridSize) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
    ctx.stroke();
  }

  // Draw experience orbs - diamond shape with glow to distinguish from projectiles
  experienceOrbs.forEach(orb => {
    const pulse = 1 + Math.sin(time * 0.008 + orb.position.x * 0.1) * 0.3;
    const size = 6 * pulse;
    
    // Outer glow
    ctx.shadowColor = COLORS.green;
    ctx.shadowBlur = 12;
    
    // Diamond shape
    ctx.fillStyle = COLORS.green;
    ctx.globalAlpha = 0.9;
    ctx.beginPath();
    ctx.moveTo(orb.position.x, orb.position.y - size);
    ctx.lineTo(orb.position.x + size * 0.7, orb.position.y);
    ctx.lineTo(orb.position.x, orb.position.y + size);
    ctx.lineTo(orb.position.x - size * 0.7, orb.position.y);
    ctx.closePath();
    ctx.fill();
    
    // Inner bright core
    ctx.fillStyle = COLORS.white;
    ctx.globalAlpha = 0.7;
    ctx.beginPath();
    ctx.arc(orb.position.x, orb.position.y, 2, 0, Math.PI * 2);
    ctx.fill();
    
    ctx.shadowBlur = 0;
    ctx.globalAlpha = 1;
  });

  // Draw powerups
  powerups.forEach(powerup => {
    const config = POWERUP_CONFIGS[powerup.type];
    const pulse = 1 + Math.sin(time * 0.01) * 0.2;
    
    ctx.fillStyle = config.color;
    ctx.font = `${20 * pulse}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(config.icon, powerup.position.x, powerup.position.y);
  });

  // Draw particles with Geometry Wars style effects
  particles.forEach(particle => {
    const alpha = particle.life / particle.maxLife;
    ctx.globalAlpha = alpha;
    
    if (particle.type === 'text') {
      ctx.fillStyle = particle.color;
      ctx.font = `bold ${particle.size}px "JetBrains Mono", monospace`;
      ctx.textAlign = 'center';
      ctx.fillText(particle.text || '', particle.position.x, particle.position.y);
    } else if (particle.type === 'trail') {
      // Line trail effect
      ctx.strokeStyle = particle.color;
      ctx.lineWidth = particle.size * alpha * 0.5;
      ctx.lineCap = 'round';
      ctx.shadowColor = particle.color;
      ctx.shadowBlur = 8;
      ctx.beginPath();
      ctx.moveTo(
        particle.position.x - particle.velocity.x * 2,
        particle.position.y - particle.velocity.y * 2
      );
      ctx.lineTo(particle.position.x, particle.position.y);
      ctx.stroke();
      ctx.shadowBlur = 0;
    } else if (particle.type === 'spark') {
      // Small bright spark
      ctx.fillStyle = particle.color;
      ctx.shadowColor = particle.color;
      ctx.shadowBlur = 6;
      ctx.beginPath();
      ctx.arc(particle.position.x, particle.position.y, particle.size * 0.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
    } else if (particle.type === 'ring') {
      // Expanding ring
      ctx.strokeStyle = particle.color;
      ctx.lineWidth = 2 * alpha;
      ctx.beginPath();
      ctx.arc(particle.position.x, particle.position.y, particle.size * (1 - alpha) * 3, 0, Math.PI * 2);
      ctx.stroke();
    } else {
      // Default explosion particle - square with glow
      ctx.fillStyle = particle.color;
      ctx.shadowColor = particle.color;
      ctx.shadowBlur = 4;
      ctx.save();
      ctx.translate(particle.position.x, particle.position.y);
      ctx.rotate(Math.atan2(particle.velocity.y, particle.velocity.x));
      ctx.fillRect(-particle.size / 2, -particle.size / 4, particle.size, particle.size / 2);
      ctx.restore();
      ctx.shadowBlur = 0;
    }
    ctx.globalAlpha = 1;
  });

  // Draw projectiles
  projectiles.forEach(projectile => {
    ctx.fillStyle = projectile.color;
    ctx.shadowColor = projectile.color;
    ctx.shadowBlur = 10;
    ctx.beginPath();
    ctx.arc(projectile.position.x, projectile.position.y, projectile.radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
  });

  // Draw enemies
  enemies.forEach(enemy => {
    renderEnemy(ctx, enemy, time);
  });

  // Draw player
  renderPlayer(ctx, player, time);

  ctx.restore();

  // Draw UI (not affected by screen shake)
  renderUI(ctx, state, width, height);
}

function renderPlayer(ctx: CanvasRenderingContext2D, player: Player, time: number) {
  const { position, radius, image, color, invulnerableUntil } = player;
  const isInvulnerable = Date.now() < invulnerableUntil;
  const flash = isInvulnerable && Math.floor(time / 100) % 2 === 0;

  ctx.save();
  ctx.translate(position.x, position.y);
  ctx.globalAlpha = flash ? 0.5 : 1;

  // Octagonal border
  ctx.strokeStyle = color;
  ctx.lineWidth = 3;
  const sides = 8;
  ctx.beginPath();
  for (let i = 0; i < sides; i++) {
    const angle = (i / sides) * Math.PI * 2 - Math.PI / 2;
    const x = Math.cos(angle) * radius;
    const y = Math.sin(angle) * radius;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.stroke();

  // Draw image or fill
  ctx.save();
  ctx.beginPath();
  for (let i = 0; i < sides; i++) {
    const angle = (i / sides) * Math.PI * 2 - Math.PI / 2;
    const x = Math.cos(angle) * (radius - 3);
    const y = Math.sin(angle) * (radius - 3);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.clip();

  if (image) {
    const size = (radius - 3) * 2;
    ctx.drawImage(image, -radius + 3, -radius + 3, size, size);
  } else {
    ctx.fillStyle = `${color}44`;
    ctx.fill();
  }
  ctx.restore();

  ctx.restore();
}

function renderEnemy(ctx: CanvasRenderingContext2D, enemy: Enemy, time: number) {
  const { position, radius, color, health, maxHealth, type } = enemy;

  ctx.save();
  ctx.translate(position.x, position.y);

  // Ghost enemies fade in and out
  if (type === 'ghost') {
    ctx.globalAlpha = enemy.ghostAlpha || 0.5;
  }

  // Add glow effect
  ctx.shadowColor = color;
  ctx.shadowBlur = 8;

  // Draw enemy shape based on type
  ctx.fillStyle = color;
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;

  if (type === 'boss') {
    // Boss is larger octagon with rotation
    const sides = 8;
    ctx.beginPath();
    for (let i = 0; i < sides; i++) {
      const angle = (i / sides) * Math.PI * 2 + time * 0.002;
      const x = Math.cos(angle) * radius;
      const y = Math.sin(angle) * radius;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.stroke();
    ctx.fillStyle = `${color}44`;
    ctx.fill();
  } else if (type === 'tank') {
    // Tank is square
    ctx.strokeRect(-radius, -radius, radius * 2, radius * 2);
    ctx.fillStyle = `${color}44`;
    ctx.fillRect(-radius, -radius, radius * 2, radius * 2);
  } else if (type === 'swarm') {
    // Swarm is diamond
    ctx.beginPath();
    ctx.moveTo(0, -radius);
    ctx.lineTo(radius, 0);
    ctx.lineTo(0, radius);
    ctx.lineTo(-radius, 0);
    ctx.closePath();
    ctx.stroke();
    ctx.fillStyle = `${color}44`;
    ctx.fill();
  } else if (type === 'zigzag') {
    // Zigzag is triangle
    ctx.beginPath();
    ctx.moveTo(0, -radius);
    ctx.lineTo(radius, radius);
    ctx.lineTo(-radius, radius);
    ctx.closePath();
    ctx.stroke();
    ctx.fillStyle = `${color}44`;
    ctx.fill();
  } else if (type === 'splitter') {
    // Splitter is hexagon
    const sides = 6;
    ctx.beginPath();
    for (let i = 0; i < sides; i++) {
      const angle = (i / sides) * Math.PI * 2;
      const x = Math.cos(angle) * radius;
      const y = Math.sin(angle) * radius;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.stroke();
    ctx.fillStyle = `${color}44`;
    ctx.fill();
  } else if (type === 'ghost') {
    // Ghost is wavy circle
    ctx.beginPath();
    for (let i = 0; i <= 32; i++) {
      const angle = (i / 32) * Math.PI * 2;
      const wobble = Math.sin(angle * 4 + time * 0.01) * 3;
      const x = Math.cos(angle) * (radius + wobble);
      const y = Math.sin(angle) * (radius + wobble);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.stroke();
    ctx.fillStyle = `${color}22`;
    ctx.fill();
  } else if (type === 'magnet') {
    // Magnet is horseshoe shape (simplified as arc)
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(0, 0, radius, Math.PI * 0.2, Math.PI * 1.8);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(0, 0, radius * 0.6, 0, Math.PI * 2);
    ctx.fillStyle = `${color}44`;
    ctx.fill();
  } else if (type === 'bomber') {
    // Bomber is star shape
    ctx.beginPath();
    for (let i = 0; i < 10; i++) {
      const angle = (i / 10) * Math.PI * 2 - Math.PI / 2;
      const r = i % 2 === 0 ? radius : radius * 0.5;
      const x = Math.cos(angle) * r;
      const y = Math.sin(angle) * r;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.stroke();
    ctx.fillStyle = `${color}44`;
    ctx.fill();
  } else {
    // Default circle (chaser, shooter)
    ctx.beginPath();
    ctx.arc(0, 0, radius, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = `${color}44`;
    ctx.fill();
  }

  ctx.shadowBlur = 0;

  // Health bar (skip for ghosts when faded)
  if (type !== 'ghost' || (enemy.ghostAlpha || 1) > 0.3) {
    const healthPercent = health / maxHealth;
    const barWidth = radius * 2;
    const barHeight = 4;
    ctx.globalAlpha = type === 'ghost' ? (enemy.ghostAlpha || 1) : 1;
    ctx.fillStyle = COLORS.dark;
    ctx.fillRect(-barWidth / 2, radius + 5, barWidth, barHeight);
    ctx.fillStyle = healthPercent > 0.5 ? COLORS.green : healthPercent > 0.25 ? COLORS.yellow : COLORS.pink;
    ctx.fillRect(-barWidth / 2, radius + 5, barWidth * healthPercent, barHeight);
  }

  ctx.restore();
}

function renderUI(ctx: CanvasRenderingContext2D, state: GameState, width: number, height: number) {
  const { player, score, multiplier, wave } = state;

  ctx.fillStyle = COLORS.white;
  ctx.font = 'bold 16px "JetBrains Mono", monospace';

  // Score
  ctx.textAlign = 'left';
  ctx.fillText(`SCORE: ${Math.floor(score).toLocaleString()}`, 20, 30);

  // Multiplier
  if (multiplier > 1) {
    ctx.fillStyle = COLORS.yellow;
    ctx.fillText(`×${multiplier.toFixed(1)}`, 20, 55);
  }

  // Wave
  ctx.fillStyle = COLORS.white;
  ctx.textAlign = 'right';
  ctx.fillText(`WAVE ${wave}`, width - 20, 30);

  // Level
  ctx.fillText(`LVL ${player.level}`, width - 20, 55);

  // Health bar
  const healthBarWidth = 200;
  const healthBarHeight = 20;
  const healthX = (width - healthBarWidth) / 2;
  const healthY = height - 40;
  const healthPercent = player.health / player.maxHealth;

  ctx.fillStyle = COLORS.dark;
  ctx.fillRect(healthX, healthY, healthBarWidth, healthBarHeight);
  ctx.fillStyle = healthPercent > 0.5 ? COLORS.green : healthPercent > 0.25 ? COLORS.yellow : COLORS.pink;
  ctx.fillRect(healthX, healthY, healthBarWidth * healthPercent, healthBarHeight);
  ctx.strokeStyle = COLORS.white;
  ctx.lineWidth = 2;
  ctx.strokeRect(healthX, healthY, healthBarWidth, healthBarHeight);

  // Health text
  ctx.fillStyle = COLORS.white;
  ctx.textAlign = 'center';
  ctx.fillText(`${Math.floor(player.health)}/${player.maxHealth}`, width / 2, healthY + 15);

  // XP bar
  const xpBarWidth = 150;
  const xpBarHeight = 8;
  const xpX = (width - xpBarWidth) / 2;
  const xpY = healthY - 20;
  const xpPercent = player.experience / (DEFAULT_CONFIG.experienceToLevel * player.level);

  ctx.fillStyle = COLORS.dark;
  ctx.fillRect(xpX, xpY, xpBarWidth, xpBarHeight);
  ctx.fillStyle = COLORS.cyan;
  ctx.fillRect(xpX, xpY, xpBarWidth * xpPercent, xpBarHeight);
}
