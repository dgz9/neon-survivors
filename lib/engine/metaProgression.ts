import { GameState, WEAPON_CONFIGS } from '@/types/game';

const STORAGE_KEY = 'neon-bit-meta-progression';

export interface MetaUnlock {
  id: string;
  name: string;
  maxLevel: number;
  costPerLevel: number[];
  description: (level: number) => string;
}

export interface MetaProgression {
  crystals: number;
  totalCrystalsEarned: number;
  unlocks: Record<string, number>;
}

export const META_UNLOCKS: MetaUnlock[] = [
  {
    id: 'start_spread',
    name: 'Spread Training',
    maxLevel: 1,
    costPerLevel: [50],
    description: () => 'Start with Spread weapon',
  },
  {
    id: 'start_laser',
    name: 'Laser Proficiency',
    maxLevel: 1,
    costPerLevel: [50],
    description: () => 'Start with Laser weapon',
  },
  {
    id: 'meta_health',
    name: 'Hardened Hull',
    maxLevel: 5,
    costPerLevel: [20, 35, 55, 80, 120],
    description: (lvl) => `+${lvl * 10}% max HP`,
  },
  {
    id: 'meta_speed',
    name: 'Neural Reflexes',
    maxLevel: 5,
    costPerLevel: [20, 35, 55, 80, 120],
    description: (lvl) => `+${lvl * 5}% move speed`,
  },
  {
    id: 'meta_damage',
    name: 'Overclocked Weapons',
    maxLevel: 5,
    costPerLevel: [25, 40, 60, 90, 130],
    description: (lvl) => `+${lvl * 5}% weapon damage`,
  },
  {
    id: 'meta_xp',
    name: 'Data Siphon',
    maxLevel: 3,
    costPerLevel: [30, 55, 90],
    description: (lvl) => `+${lvl * 10}% XP gain`,
  },
  {
    id: 'meta_magnet',
    name: 'Gravity Well',
    maxLevel: 3,
    costPerLevel: [25, 45, 75],
    description: (lvl) => `+${lvl * 15}% pickup range`,
  },
  {
    id: 'meta_armor',
    name: 'Plating',
    maxLevel: 3,
    costPerLevel: [30, 55, 90],
    description: (lvl) => `-${lvl * 5}% damage taken`,
  },
];

export function loadMetaProgression(): MetaProgression {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return {
        crystals: parsed.crystals || 0,
        totalCrystalsEarned: parsed.totalCrystalsEarned || 0,
        unlocks: parsed.unlocks || {},
      };
    }
  } catch {
    // Ignore parse errors
  }
  return { crystals: 0, totalCrystalsEarned: 0, unlocks: {} };
}

export function saveMetaProgression(meta: MetaProgression): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(meta));
  } catch {
    // Ignore quota errors
  }
}

/**
 * Attempt to purchase an unlock. Returns updated meta or null if not enough crystals.
 */
export function purchaseUnlock(meta: MetaProgression, unlockId: string): MetaProgression | null {
  const unlock = META_UNLOCKS.find(u => u.id === unlockId);
  if (!unlock) return null;

  const currentLevel = meta.unlocks[unlockId] || 0;
  if (currentLevel >= unlock.maxLevel) return null;

  const cost = unlock.costPerLevel[currentLevel];
  if (meta.crystals < cost) return null;

  return {
    ...meta,
    crystals: meta.crystals - cost,
    unlocks: {
      ...meta.unlocks,
      [unlockId]: currentLevel + 1,
    },
  };
}

/**
 * Calculate crystal reward for a run.
 */
export function calculateRunReward(score: number, wave: number, bossesKilled: number): number {
  let crystals = 0;
  crystals += Math.floor(score / 1000); // 1 per 1000 score
  crystals += wave - 1; // 1 per wave survived (minus starting wave)
  crystals += bossesKilled * 5; // 5 per boss killed
  return Math.max(1, crystals); // at least 1
}

/**
 * Apply meta-progression bonuses to initial game state.
 */
export function applyMetaToInitialState(state: GameState, meta: MetaProgression): GameState {
  let { player } = state;
  const unlocks = meta.unlocks;

  // Starting weapons
  if (unlocks['start_spread'] && unlocks['start_spread'] >= 1) {
    const hasSpread = player.weapons.some(w => w.type === 'spread');
    if (!hasSpread) {
      player = {
        ...player,
        weapons: [
          ...player.weapons,
          { type: 'spread', level: 1, lastFired: 0, ...WEAPON_CONFIGS.spread },
        ],
      };
    }
  }
  if (unlocks['start_laser'] && unlocks['start_laser'] >= 1) {
    const hasLaser = player.weapons.some(w => w.type === 'laser');
    if (!hasLaser) {
      player = {
        ...player,
        weapons: [
          ...player.weapons,
          { type: 'laser', level: 1, lastFired: 0, ...WEAPON_CONFIGS.laser },
        ],
      };
    }
  }

  // Health bonus
  const healthLevel = unlocks['meta_health'] || 0;
  if (healthLevel > 0) {
    const bonus = 1 + healthLevel * 0.1;
    const newMax = Math.floor(player.maxHealth * bonus);
    player = { ...player, maxHealth: newMax, health: newMax };
  }

  // Speed bonus
  const speedLevel = unlocks['meta_speed'] || 0;
  if (speedLevel > 0) {
    const bonus = 1 + speedLevel * 0.05;
    player = { ...player, baseSpeed: player.baseSpeed * bonus, speed: player.speed * bonus };
  }

  // Magnet bonus
  const magnetLevel = unlocks['meta_magnet'] || 0;
  if (magnetLevel > 0) {
    player = { ...player, magnetBonus: player.magnetBonus + magnetLevel * 0.15 };
  }

  // Damage multiplier
  const damageLevel = unlocks['meta_damage'] || 0;
  const metaDamageMultiplier = 1 + damageLevel * 0.05;

  // XP multiplier
  const xpLevel = unlocks['meta_xp'] || 0;
  const metaXpMultiplier = 1 + xpLevel * 0.1;

  // Armor multiplier
  const armorLevel = unlocks['meta_armor'] || 0;
  const metaArmorMultiplier = 1 - armorLevel * 0.05;

  return {
    ...state,
    player,
    metaDamageMultiplier,
    metaXpMultiplier,
    metaArmorMultiplier,
  };
}
