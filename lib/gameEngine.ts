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
    .map(p => updateProjectile(p, deltaTime, enemies))
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

    // Death particles
    particles = [...particles, ...createExplosion(enemy.position, enemy.color, 15)];
  });

  state = { ...state, enemiesKilledThisWave: state.enemiesKilledThisWave + killedEnemies.length };

  // Check if multiplier should decay
  if (currentTime > multiplierTimer) {
    multiplier = Math.max(1, multiplier - 0.01 * deltaTime);
  }

  // Update enemies
  enemies = enemies.map(e => updateEnemy(e, player, deltaTime));

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
  player = addExperience(player, collectedXP, config);

  // Collect powerups
  const { collectedPowerups, remainingPowerups, powerupParticles } = 
    collectPowerups(player, powerups, currentTime);
  powerups = remainingPowerups;
  particles = [...particles, ...powerupParticles];
  
  collectedPowerups.forEach(powerup => {
    player = applyPowerup(player, powerup, state);
  });

  // Spawn enemies
  if (currentTime - state.lastEnemySpawn > config.enemySpawnRate / (1 + state.wave * 0.1)) {
    const newEnemy = spawnEnemy(state.wave, width, height, player.position);
    enemies.push(newEnemy);
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

    const angle = Math.atan2(
      mousePos.y - player.position.y,
      mousePos.x - player.position.x
    );

    const config = WEAPON_CONFIGS[weapon.type];
    
    for (let i = 0; i < weapon.projectileCount; i++) {
      let projectileAngle = angle;
      
      if (weapon.projectileCount > 1) {
        const spread = Math.PI / 6;
        projectileAngle = angle - spread / 2 + (spread * i / (weapon.projectileCount - 1));
      }

      projectiles.push({
        id: generateId(),
        position: { ...player.position },
        velocity: {
          x: Math.cos(projectileAngle) * weapon.projectileSpeed,
          y: Math.sin(projectileAngle) * weapon.projectileSpeed,
        },
        radius: 6,
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

function updateProjectile(projectile: Projectile, deltaTime: number, enemies: Enemy[]): Projectile {
  return {
    ...projectile,
    position: {
      x: projectile.position.x + projectile.velocity.x * deltaTime,
      y: projectile.position.y + projectile.velocity.y * deltaTime,
    },
  };
}

function isProjectileAlive(projectile: Projectile, width: number, height: number): boolean {
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

function updateEnemy(enemy: Enemy, player: Player, deltaTime: number): Enemy {
  // Move towards player
  const dx = player.position.x - enemy.position.x;
  const dy = player.position.y - enemy.position.y;
  const distance = Math.sqrt(dx * dx + dy * dy);

  if (distance > 0) {
    const vx = (dx / distance) * enemy.speed;
    const vy = (dy / distance) * enemy.speed;

    return {
      ...enemy,
      position: {
        x: enemy.position.x + vx * deltaTime,
        y: enemy.position.y + vy * deltaTime,
      },
      velocity: { x: vx, y: vy },
    };
  }

  return enemy;
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

function spawnEnemy(wave: number, width: number, height: number, playerPos: Vector2): Enemy {
  // Determine enemy type based on wave
  let type: EnemyType = 'chaser';
  const roll = Math.random();
  
  if (wave >= 3 && roll < 0.2) type = 'shooter';
  if (wave >= 5 && roll < 0.15) type = 'tank';
  if (wave >= 2 && roll < 0.3) type = 'swarm';
  if (wave >= 4 && roll < 0.1) type = 'bomber';

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
    radius: config.radius,
    color: config.color,
    health: config.health * waveMultiplier,
    maxHealth: config.health * waveMultiplier,
    speed: config.speed * (1 + wave * 0.02),
    damage: config.damage * waveMultiplier,
    type,
    points: config.points,
    spawnTime: Date.now(),
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
  const remainingOrbs = orbs.filter(orb => {
    const dx = player.position.x - orb.position.x;
    const dy = player.position.y - orb.position.y;
    const distance = Math.sqrt(dx * dx + dy * dy);

    if (distance < player.radius + 10) {
      collectedXP += orb.value;
      return false;
    }

    // Move orbs towards player if within magnet range
    if (distance < config.magnetRange) {
      const speed = 5 * (1 - distance / config.magnetRange);
      orb.position.x += (dx / distance) * speed;
      orb.position.y += (dy / distance) * speed;
    }

    return true;
  });

  return { collectedXP, remainingOrbs };
}

function addExperience(player: Player, xp: number, config: GameConfig): Player {
  let experience = player.experience + xp;
  let level = player.level;
  const xpNeeded = config.experienceToLevel * level;

  while (experience >= xpNeeded) {
    experience -= xpNeeded;
    level++;
  }

  return { ...player, experience, level };
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
      return addExperience(player, 50, DEFAULT_CONFIG);
    default:
      return player;
  }
}

function createExplosion(position: Vector2, color: string, count: number): Particle[] {
  const particles: Particle[] = [];
  
  for (let i = 0; i < count; i++) {
    const angle = (Math.PI * 2 * i) / count + Math.random() * 0.3;
    const speed = 2 + Math.random() * 4;
    
    particles.push({
      id: generateId(),
      position: { ...position },
      velocity: {
        x: Math.cos(angle) * speed,
        y: Math.sin(angle) * speed,
      },
      color,
      size: 4 + Math.random() * 4,
      life: 500 + Math.random() * 300,
      maxLife: 800,
      type: 'explosion',
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

  // Draw experience orbs
  experienceOrbs.forEach(orb => {
    ctx.fillStyle = COLORS.cyan;
    ctx.globalAlpha = 0.8;
    ctx.beginPath();
    ctx.arc(orb.position.x, orb.position.y, 5, 0, Math.PI * 2);
    ctx.fill();
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

  // Draw particles
  particles.forEach(particle => {
    ctx.globalAlpha = particle.life / particle.maxLife;
    if (particle.type === 'text') {
      ctx.fillStyle = particle.color;
      ctx.font = `bold ${particle.size}px "JetBrains Mono", monospace`;
      ctx.textAlign = 'center';
      ctx.fillText(particle.text || '', particle.position.x, particle.position.y);
    } else {
      ctx.fillStyle = particle.color;
      ctx.fillRect(
        particle.position.x - particle.size / 2,
        particle.position.y - particle.size / 2,
        particle.size,
        particle.size
      );
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

  // Draw enemy shape based on type
  ctx.fillStyle = color;
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;

  if (type === 'boss') {
    // Boss is larger octagon
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
  } else {
    // Default circle
    ctx.beginPath();
    ctx.arc(0, 0, radius, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = `${color}44`;
    ctx.fill();
  }

  // Health bar
  const healthPercent = health / maxHealth;
  const barWidth = radius * 2;
  const barHeight = 4;
  ctx.fillStyle = COLORS.dark;
  ctx.fillRect(-barWidth / 2, radius + 5, barWidth, barHeight);
  ctx.fillStyle = healthPercent > 0.5 ? COLORS.green : healthPercent > 0.25 ? COLORS.yellow : COLORS.pink;
  ctx.fillRect(-barWidth / 2, radius + 5, barWidth * healthPercent, barHeight);

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
