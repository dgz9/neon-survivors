// Game Types for Neon Survivors

export interface Vector2 {
  x: number;
  y: number;
}

export interface ActiveBuff {
  type: 'speed' | 'damage' | 'magnet';
  expiresAt: number;
  multiplier: number;
}

export interface Player {
  position: Vector2;
  velocity: Vector2;
  radius: number;
  color: string;
  health: number;
  maxHealth: number;
  baseSpeed: number;
  speed: number;
  image: HTMLImageElement | null;
  imageUrl: string;
  invulnerableUntil: number;
  weapons: Weapon[];
  experience: number;
  level: number;
  kills: number;
  magnetMultiplier: number;
  activeBuffs: ActiveBuff[];
  // Permanent stat upgrades from level-ups
  speedBonus: number;
  magnetBonus: number;
}

export interface Enemy {
  id: string;
  position: Vector2;
  velocity: Vector2;
  radius: number;
  color: string;
  health: number;
  maxHealth: number;
  speed: number;
  damage: number;
  type: EnemyType;
  points: number;
  spawnTime: number;
  // Special properties
  zigzagPhase?: number;
  ghostAlpha?: number;
  isSplit?: boolean;
  isElite?: boolean;
  eliteModifier?: 'swift' | 'volatile' | 'shielded';
}

export type EnemyType = 'chaser' | 'shooter' | 'tank' | 'swarm' | 'bomber' | 'boss' | 'zigzag' | 'splitter' | 'ghost' | 'magnet';

export interface Projectile {
  _active: boolean;
  _poolIndex: number;
  id: string;
  position: Vector2;
  velocity: Vector2;
  radius: number;
  color: string;
  damage: number;
  isEnemy: boolean;
  piercing: number;
  hitEnemies: Set<string>;
  orbit?: {
    angle: number;
    radius: number;
    speed: number;
    owner: Vector2;
  };
  lifetime?: number;
  weaponType?: WeaponType;
  explosionRadius?: number;
}

export interface Weapon {
  type: WeaponType;
  level: number;
  lastFired: number;
  fireRate: number; // ms between shots
  damage: number;
  projectileSpeed: number;
  projectileCount: number;
  piercing: number;
}

export type WeaponType = 'blaster' | 'spread' | 'laser' | 'orbit' | 'missile';

export interface PowerUp {
  id: string;
  position: Vector2;
  type: PowerUpType;
  createdAt: number;
  duration: number;
}

export type PowerUpType = 'health' | 'speed' | 'damage' | 'magnet' | 'bomb' | 'xp';

export interface ExperienceOrb {
  _active: boolean;
  _poolIndex: number;
  id: string;
  position: Vector2;
  value: number;
  createdAt: number;
}

export interface Particle {
  _active: boolean;
  _poolIndex: number;
  id: string;
  position: Vector2;
  velocity: Vector2;
  color: string;
  size: number;
  life: number;
  maxLife: number;
  type: 'explosion' | 'trail' | 'spark' | 'text' | 'ring';
  text?: string;
}

export interface Upgrade {
  id: string;
  type: 'weapon_new' | 'weapon_upgrade' | 'stat';
  weaponType?: WeaponType;
  stat?: 'health' | 'speed' | 'magnet' | 'armor';
  name: string;
  description: string;
  icon: string;
  color: string;
}

export interface GameState {
  player: Player;
  enemies: Enemy[];
  projectiles: Projectile[];
  projectileCount: number;
  powerups: PowerUp[];
  experienceOrbs: ExperienceOrb[];
  experienceOrbCount: number;
  particles: Particle[];
  particleCount: number;
  wave: number;
  score: number;
  multiplier: number;
  multiplierTimer: number;
  gameTime: number;
  isRunning: boolean;
  isPaused: boolean;
  isGameOver: boolean;
  lastEnemySpawn: number;
  enemiesKilledThisWave: number;
  enemiesRequiredForWave: number;
  screenShake: number;
  pendingLevelUps: number;
  availableUpgrades: Upgrade[];
  waveAnnounceTime?: number;
  screenFlash?: number;
  screenFlashColor?: string;
  slowMoUntil?: number;
  slowMoFactor?: number;
  killStreak: number;
  killStreakTimer: number;
  lastNearMissTime?: number;
  nearMissCount: number;
  activeEvent?: WaveEventType;
  eventUntil?: number;
  eventAnnounceTime?: number;
  bombPulseAt?: number;
  bombPulseOrigin?: Vector2;
  // Stats tracking
  totalDamageDealt: number;
  totalDamageTaken: number;
  startTime: number;
  peakMultiplier: number;
  // Arena
  arena: ArenaType;
}

export type ArenaType = 'void' | 'grid' | 'cyber' | 'neon';
export type WaveEventType = 'surge' | 'magnet_storm';

export interface Achievement {
  id: string;
  name: string;
  description: string;
  icon: string;
  unlocked: boolean;
  unlockedAt?: number;
}

export interface GameConfig {
  playerSpeed: number;
  playerRadius: number;
  playerMaxHealth: number;
  enemySpawnRate: number;
  baseEnemySpeed: number;
  baseEnemyHealth: number;
  baseEnemyDamage: number;
  experienceToLevel: number;
  powerupSpawnChance: number;
  magnetRange: number;
}

export const DEFAULT_CONFIG: GameConfig = {
  playerSpeed: 6.5,  // Increased base speed for more responsive feel
  playerRadius: 24,
  playerMaxHealth: 100,
  enemySpawnRate: 2000,
  baseEnemySpeed: 2,
  baseEnemyHealth: 30,
  baseEnemyDamage: 10,
  experienceToLevel: 100,
  powerupSpawnChance: 0.13,
  magnetRange: 100,
};

export interface LeaderboardEntry {
  id: string;
  name: string;
  score: number;
  wave: number;
  kills: number;
  timestamp: number;
}

export const ENEMY_CONFIGS: Record<EnemyType, {
  health: number;
  speed: number;
  damage: number;
  radius: number;
  points: number;
  color: string;
}> = {
  chaser: {
    health: 30,
    speed: 2.5,
    damage: 10,
    radius: 16,
    points: 10,
    color: '#ff2d6a',
  },
  shooter: {
    health: 25,
    speed: 1.5,
    damage: 15,
    radius: 18,
    points: 15,
    color: '#00f0ff',
  },
  tank: {
    health: 100,
    speed: 1,
    damage: 20,
    radius: 28,
    points: 30,
    color: '#e4ff1a',
  },
  swarm: {
    health: 10,
    speed: 4,
    damage: 5,
    radius: 10,
    points: 5,
    color: '#bf5fff',
  },
  bomber: {
    health: 40,
    speed: 2,
    damage: 30,
    radius: 20,
    points: 25,
    color: '#ff6b1a',
  },
  boss: {
    health: 500,
    speed: 1.5,
    damage: 25,
    radius: 48,
    points: 200,
    color: '#ff1a4b',
  },
  zigzag: {
    health: 20,
    speed: 3.5,
    damage: 8,
    radius: 14,
    points: 15,
    color: '#00ff88',
  },
  splitter: {
    health: 60,
    speed: 1.8,
    damage: 12,
    radius: 22,
    points: 20,
    color: '#ff00ff',
  },
  ghost: {
    health: 15,
    speed: 2,
    damage: 15,
    radius: 18,
    points: 25,
    color: '#8888ff',
  },
  magnet: {
    health: 45,
    speed: 1.5,
    damage: 5,
    radius: 20,
    points: 20,
    color: '#ff4488',
  },
};

export const WEAPON_CONFIGS: Record<WeaponType, {
  fireRate: number;
  damage: number;
  projectileSpeed: number;
  projectileCount: number;
  piercing: number;
  color: string;
}> = {
  blaster: {
    fireRate: 250,      // Faster fire rate
    damage: 15,
    projectileSpeed: 16, // Faster projectiles
    projectileCount: 1,
    piercing: 0,
    color: '#00f0ff',
  },
  spread: {
    fireRate: 400,      // Slightly faster
    damage: 10,
    projectileSpeed: 14, // Faster projectiles
    projectileCount: 5,
    piercing: 0,
    color: '#e4ff1a',
  },
  laser: {
    fireRate: 80,       // Even faster for laser
    damage: 5,
    projectileSpeed: 25, // Very fast
    projectileCount: 1,
    piercing: 3,
    color: '#ff2d6a',
  },
  orbit: {
    fireRate: 1000,
    damage: 20,
    projectileSpeed: 0,
    projectileCount: 4,
    piercing: 999,
    color: '#bf5fff',
  },
  missile: {
    fireRate: 1500,
    damage: 50,
    projectileSpeed: 6,
    projectileCount: 1,
    piercing: 0,
    color: '#ff6b1a',
  },
};

export const POWERUP_CONFIGS: Record<PowerUpType, {
  color: string;
  icon: string;
  duration: number;
}> = {
  health: { color: '#39ff14', icon: '❤', duration: 0 },
  speed: { color: '#e4ff1a', icon: '⚡', duration: 10000 },
  damage: { color: '#ff2d6a', icon: '💥', duration: 10000 },
  magnet: { color: '#bf5fff', icon: '🧲', duration: 15000 },
  bomb: { color: '#ff6b1a', icon: '💣', duration: 0 },
  xp: { color: '#00f0ff', icon: '✨', duration: 0 },
};
