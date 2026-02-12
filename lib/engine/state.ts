import {
  GameState,
  GameConfig,
  Player,
  DEFAULT_CONFIG,
  WEAPON_CONFIGS,
} from '@/types/game';
import { particlePool, projectilePool, xpOrbPool, resizeEnemyGrid } from './context';
import { COLORS } from '../colors';

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
  resizeEnemyGrid(width, height);

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
    metaDamageMultiplier: 1,
    metaXpMultiplier: 1,
    metaArmorMultiplier: 1,
    bossesKilledThisRun: 0,
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
