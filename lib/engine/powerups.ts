import { Player, PowerUp, PowerUpType, Vector2, DEFAULT_CONFIG, POWERUP_CONFIGS } from '@/types/game';
import { generateId } from './context';
import { createExplosion } from './effects';
import { addExperience } from './experience';

const POWERUP_DROP_WEIGHTS: Array<{ type: PowerUpType; weight: number }> = [
  { type: 'health', weight: 0.24 },
  { type: 'speed', weight: 0.2 },
  { type: 'damage', weight: 0.2 },
  { type: 'magnet', weight: 0.16 },
  { type: 'xp', weight: 0.14 },
  { type: 'bomb', weight: 0.06 },
];

export function rollPowerUpType(): PowerUpType {
  const totalWeight = POWERUP_DROP_WEIGHTS.reduce((sum, entry) => sum + entry.weight, 0);
  const roll = Math.random() * totalWeight;
  let acc = 0;
  for (const entry of POWERUP_DROP_WEIGHTS) {
    acc += entry.weight;
    if (roll <= acc) return entry.type;
  }
  return 'health';
}

export function createPowerup(position: Vector2): PowerUp {
  const type = rollPowerUpType();

  return {
    id: generateId(),
    position: { ...position },
    type,
    createdAt: Date.now(),
    duration: POWERUP_CONFIGS[type].duration,
  };
}

export function collectPowerups(
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

export function applyPowerup(player: Player, powerup: PowerUp, currentTime: number): Player {
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
