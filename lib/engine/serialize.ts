import { GameState, Vector2, EnemyType, WeaponType, PowerUpType, ArenaType, WaveEventType } from '@/types/game';

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
  killStreak: number;
  nearMissCount: number;
  screenShake: number;
  arena: ArenaType;
  waveAnnounceTime?: number;
  activeEvent?: WaveEventType;
  eventAnnounceTime?: number;
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
    killStreak: state.killStreak,
    nearMissCount: state.nearMissCount,
    screenShake: state.screenShake,
    arena: state.arena,
    waveAnnounceTime: state.waveAnnounceTime,
    activeEvent: state.activeEvent,
    eventAnnounceTime: state.eventAnnounceTime,
    screenFlash: state.screenFlash,
    screenFlashColor: state.screenFlashColor,
  };
}
