import { Player, GameConfig } from '@/types/game';
import { particlePool, xpOrbPool, generateId } from './context';
import { COLORS } from '../colors';

export function collectExperienceOrbs(
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

export function addExperience(player: Player, xp: number, config: GameConfig): { player: Player; leveledUp: boolean } {
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
