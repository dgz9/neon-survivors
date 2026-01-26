// Achievements system

export interface Achievement {
  id: string;
  name: string;
  description: string;
  icon: string;
  check: (stats: AchievementStats) => boolean;
}

export interface AchievementStats {
  score: number;
  wave: number;
  kills: number;
  totalDamageDealt: number;
  totalDamageTaken: number;
  survivalTimeMs: number;
  peakMultiplier: number;
  weaponsUnlocked: number;
  maxWeaponLevel: number;
  noDamageTaken: boolean;
}

export const ACHIEVEMENTS: Achievement[] = [
  // Score achievements
  {
    id: 'score_1k',
    name: 'Getting Started',
    description: 'Score 1,000 points',
    icon: '⭐',
    check: (s) => s.score >= 1000,
  },
  {
    id: 'score_10k',
    name: 'Neon Warrior',
    description: 'Score 10,000 points',
    icon: '🌟',
    check: (s) => s.score >= 10000,
  },
  {
    id: 'score_50k',
    name: 'Legendary',
    description: 'Score 50,000 points',
    icon: '💫',
    check: (s) => s.score >= 50000,
  },
  {
    id: 'score_100k',
    name: 'Neon God',
    description: 'Score 100,000 points',
    icon: '👑',
    check: (s) => s.score >= 100000,
  },
  
  // Wave achievements
  {
    id: 'wave_5',
    name: 'Survivor',
    description: 'Reach wave 5',
    icon: '🛡️',
    check: (s) => s.wave >= 5,
  },
  {
    id: 'wave_10',
    name: 'Veteran',
    description: 'Reach wave 10',
    icon: '⚔️',
    check: (s) => s.wave >= 10,
  },
  {
    id: 'wave_20',
    name: 'Unstoppable',
    description: 'Reach wave 20',
    icon: '🔥',
    check: (s) => s.wave >= 20,
  },
  
  // Kill achievements
  {
    id: 'kills_50',
    name: 'First Blood',
    description: 'Kill 50 enemies in one run',
    icon: '💀',
    check: (s) => s.kills >= 50,
  },
  {
    id: 'kills_200',
    name: 'Slayer',
    description: 'Kill 200 enemies in one run',
    icon: '☠️',
    check: (s) => s.kills >= 200,
  },
  {
    id: 'kills_500',
    name: 'Massacre',
    description: 'Kill 500 enemies in one run',
    icon: '💥',
    check: (s) => s.kills >= 500,
  },
  
  // Damage achievements
  {
    id: 'damage_10k',
    name: 'Heavy Hitter',
    description: 'Deal 10,000 damage in one run',
    icon: '💪',
    check: (s) => s.totalDamageDealt >= 10000,
  },
  {
    id: 'damage_50k',
    name: 'Devastator',
    description: 'Deal 50,000 damage in one run',
    icon: '🔨',
    check: (s) => s.totalDamageDealt >= 50000,
  },
  
  // Survival achievements
  {
    id: 'survive_2min',
    name: 'Staying Alive',
    description: 'Survive for 2 minutes',
    icon: '⏱️',
    check: (s) => s.survivalTimeMs >= 120000,
  },
  {
    id: 'survive_5min',
    name: 'Marathon',
    description: 'Survive for 5 minutes',
    icon: '🏃',
    check: (s) => s.survivalTimeMs >= 300000,
  },
  
  // Multiplier achievements
  {
    id: 'multi_5x',
    name: 'Combo Master',
    description: 'Reach 5x multiplier',
    icon: '✖️',
    check: (s) => s.peakMultiplier >= 5,
  },
  {
    id: 'multi_10x',
    name: 'Combo God',
    description: 'Reach 10x multiplier',
    icon: '🎯',
    check: (s) => s.peakMultiplier >= 10,
  },
  
  // Weapon achievements
  {
    id: 'weapons_3',
    name: 'Arsenal',
    description: 'Have 3 weapons at once',
    icon: '🔫',
    check: (s) => s.weaponsUnlocked >= 3,
  },
  {
    id: 'weapons_5',
    name: 'Fully Loaded',
    description: 'Have all 5 weapons at once',
    icon: '🎖️',
    check: (s) => s.weaponsUnlocked >= 5,
  },
  {
    id: 'weapon_max',
    name: 'Maxed Out',
    description: 'Get a weapon to level 5',
    icon: '⬆️',
    check: (s) => s.maxWeaponLevel >= 5,
  },
  
  // Special achievements
  {
    id: 'no_damage',
    name: 'Untouchable',
    description: 'Complete wave 3 without taking damage',
    icon: '👻',
    check: (s) => s.wave >= 3 && s.noDamageTaken,
  },
];

// Get unlocked achievements from localStorage
export function getUnlockedAchievements(): Set<string> {
  if (typeof window === 'undefined') return new Set();
  
  try {
    const saved = localStorage.getItem('neon-survivors-achievements');
    if (saved) {
      return new Set(JSON.parse(saved));
    }
  } catch (e) {
    console.warn('Failed to load achievements');
  }
  return new Set();
}

// Save unlocked achievement
export function unlockAchievement(id: string): void {
  if (typeof window === 'undefined') return;
  
  try {
    const unlocked = getUnlockedAchievements();
    unlocked.add(id);
    localStorage.setItem('neon-survivors-achievements', JSON.stringify(Array.from(unlocked)));
  } catch (e) {
    console.warn('Failed to save achievement');
  }
}

// Check for newly unlocked achievements
export function checkAchievements(stats: AchievementStats): Achievement[] {
  const unlocked = getUnlockedAchievements();
  const newlyUnlocked: Achievement[] = [];
  
  for (const achievement of ACHIEVEMENTS) {
    if (!unlocked.has(achievement.id) && achievement.check(stats)) {
      newlyUnlocked.push(achievement);
      unlockAchievement(achievement.id);
    }
  }
  
  return newlyUnlocked;
}

// Get all achievements with unlock status
export function getAllAchievements(): (Achievement & { unlocked: boolean })[] {
  const unlocked = getUnlockedAchievements();
  return ACHIEVEMENTS.map(a => ({
    ...a,
    unlocked: unlocked.has(a.id),
  }));
}
