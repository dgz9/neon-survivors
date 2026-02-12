import { Player, GameState, Upgrade, WeaponType, WEAPON_CONFIGS } from '@/types/game';

export function getWeaponIcon(type: WeaponType): string {
  switch (type) {
    case 'blaster': return '\ud83d\udd2b';
    case 'spread': return '\ud83d\udca8';
    case 'laser': return '\u26a1';
    case 'orbit': return '\ud83d\udd2e';
    case 'missile': return '\ud83d\ude80';
    default: return '\ud83d\udd2b';
  }
}

export function getWeaponDescription(type: WeaponType): string {
  switch (type) {
    case 'blaster': return 'Basic rapid-fire weapon';
    case 'spread': return '5-shot spread, covers wide area';
    case 'laser': return 'Fast piercing beam, hits multiple enemies';
    case 'orbit': return 'Orbs circle around you, constant damage';
    case 'missile': return 'Slow but devastating explosive shots';
    default: return '';
  }
}

function getUpgradeDescription(type: WeaponType, currentLevel: number): string {
  const next = currentLevel + 1;
  const base = `Lv ${currentLevel} \u2192 ${next}`;
  switch (type) {
    case 'blaster':
      if (next === 3) return `${base}: +20% dmg, faster fire, twin shot`;
      if (next === 5) return `${base}: +20% dmg, faster fire, triple shot`;
      return `${base}: +20% dmg, faster fire`;
    case 'spread':
      return `${base}: +20% dmg, faster fire, +1 pellet`;
    case 'laser':
      return `${base}: +20% dmg, faster fire, +1 pierce`;
    case 'orbit':
      return `${base}: +1 orb, wider orbit`;
    case 'missile':
      if (next >= 4) return `${base}: +20% dmg, +blast radius, +1 pierce`;
      return `${base}: +20% dmg, faster fire, +blast radius`;
    default:
      return `${base}: +20% dmg, faster fire`;
  }
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
        description: getUpgradeDescription(weapon.type, weapon.level),
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
          const newLevel = w.level + 1;
          const isOrbit = w.type === 'orbit';
          let projectileCount = w.projectileCount;
          let piercing = w.piercing;

          if (w.type === 'spread') projectileCount += 1;
          if (w.type === 'blaster' && (newLevel === 3 || newLevel === 5)) projectileCount += 1;
          if (w.type === 'laser') piercing += 1;
          if (w.type === 'missile' && newLevel >= 4) piercing += 1;

          return {
            ...w,
            level: newLevel,
            damage: w.damage * (isOrbit ? 1.12 : 1.2),
            fireRate: Math.max(isOrbit ? 220 : 50, w.fireRate * (isOrbit ? 0.96 : 0.9)),
            projectileCount,
            piercing,
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
