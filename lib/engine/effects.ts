import { Vector2, Projectile, Enemy, Particle, ParticleType } from '@/types/game';
import { particlePool, generateId } from './context';
import { COLORS } from '../colors';

interface EmitOptions {
  vx?: number;
  vy?: number;
  size: number;
  life: number;
  color: string;
  type: ParticleType;
  drag?: number;
  gravity?: number;
  spin?: number;
  rotation?: number;
  fade?: number;
  glow?: number;
  text?: string;
}

/**
 * Single spawn helper so every effect goes through the same defaults.
 * `baseSize` is set here and never mutated afterwards — the renderer derives
 * the drawn size from it, which is what keeps effects from collapsing.
 */
function emit(x: number, y: number, o: EmitOptions): Particle {
  const p = particlePool.acquire();
  p.id = generateId();
  p.position.x = x;
  p.position.y = y;
  p.velocity.x = o.vx ?? 0;
  p.velocity.y = o.vy ?? 0;
  p.color = o.color;
  p.baseSize = o.size;
  p.size = o.size;
  p.life = o.life;
  p.maxLife = o.life;
  p.type = o.type;
  p.drag = o.drag ?? 0.92;
  p.gravity = o.gravity ?? 0;
  p.rotation = o.rotation ?? 0;
  p.spin = o.spin ?? 0;
  p.fade = o.fade ?? 1;
  p.glow = o.glow ?? 1;
  p.text = o.text;
  return p;
}

export function emitParticle(x: number, y: number, o: EmitOptions): Particle {
  return emit(x, y, o);
}

/** Floating text (damage numbers, callouts). */
export function emitText(
  x: number,
  y: number,
  text: string,
  color: string,
  size: number,
  life = 600,
  vy = -3.5,
): void {
  emit(x, y, {
    text,
    color,
    size,
    life,
    type: 'text',
    vx: (Math.random() - 0.5) * 2.5,
    vy,
    drag: 0.94,
    gravity: 0.06,
  });
}

/**
 * Advances every live particle. Extracted from the main update so the co-op
 * guest — which does not run the simulation — can still animate the effects it
 * spawns from replayed host events.
 */
export function updateParticles(deltaTime: number): void {
  particlePool.forEach(p => {
    const newLife = p.life - deltaTime * 16.667;
    if (newLife <= 0) return false; // release

    // Backfill for particles spawned by call sites that set `size` directly
    // rather than going through emit().
    if (p.baseSize === 0) p.baseSize = p.size;

    p.life = newLife;

    p.velocity.y += p.gravity * deltaTime;
    p.position.x += p.velocity.x * deltaTime * 0.1;
    p.position.y += p.velocity.y * deltaTime * 0.1;

    // Drag is a per-16ms figure, so raise it to the frame's tick count to stay
    // frame-rate independent instead of applying it once per call.
    const damping = p.drag === 1 ? 1 : Math.pow(p.drag, deltaTime);
    p.velocity.x *= damping;
    p.velocity.y *= damping;

    p.rotation += p.spin * deltaTime;

    // Derived from baseSize, never from the previous frame's size — the old
    // `size *= lifeRatio` compounded and shrank everything to nothing within a
    // few frames, which is why explosions used to barely register.
    const t = newLife / p.maxLife;
    switch (p.type) {
      case 'ring':
      case 'shockwave':
        // Rings expand outward as they die.
        p.size = p.baseSize * (1 - t);
        break;
      case 'flash':
        // Hard, fast bloom then out.
        p.size = p.baseSize * (0.55 + t * 0.45);
        break;
      case 'text':
        p.size = p.baseSize * (0.85 + Math.min(1, (1 - t) * 6) * 0.15);
        break;
      case 'trail':
        p.size = p.baseSize * t;
        break;
      default:
        // Sparks/embers hold their mass then shrink at the tail.
        p.size = p.baseSize * (0.35 + t * 0.65);
        break;
    }

    return true; // keep
  });
}

/**
 * Enemy death burst. Scales with `count` (driven by enemy size) and layers a
 * white core flash, an expanding shockwave, fast sparks, drifting embers and
 * directional streaks so the kill reads instantly at any zoom level.
 */
export function createExplosion(position: Vector2, color: string, count: number): void {
  const x = position.x;
  const y = position.y;
  const scale = Math.min(2.2, count / 25);

  // Core flash — the white-hot instant of the kill.
  emit(x, y, {
    color: COLORS.white,
    size: 16 * scale,
    life: 110,
    type: 'flash',
    drag: 1,
    glow: 1.6,
  });

  // Expanding shockwave rings, offset in time so the blast reads as a pulse.
  emit(x, y, {
    color,
    size: 62 * scale,
    life: 320,
    type: 'shockwave',
    drag: 1,
    fade: 1.5,
    glow: 1.3,
  });
  emit(x, y, {
    color: COLORS.white,
    size: 34 * scale,
    life: 190,
    type: 'shockwave',
    drag: 1,
    fade: 2,
    glow: 1.5,
  });

  // Fast sparks — high initial speed, heavy drag, so they snap outward.
  for (let i = 0; i < count; i++) {
    const angle = (Math.PI * 2 * i) / count + Math.random() * 0.6;
    const speed = 9 + Math.random() * 13;
    emit(x + Math.cos(angle) * 4, y + Math.sin(angle) * 4, {
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      color: Math.random() < 0.3 ? COLORS.white : color,
      size: 3.5 + Math.random() * 3.5,
      life: 320 + Math.random() * 280,
      type: 'explosion',
      drag: 0.88,
      glow: 1.25,
    });
  }

  // Embers — slow, gravity-touched, they linger after the flash is gone.
  const emberCount = Math.floor(count * 0.45);
  for (let i = 0; i < emberCount; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = 2 + Math.random() * 5;
    emit(x, y, {
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - 1,
      color: Math.random() < 0.35 ? COLORS.white : color,
      size: 1.8 + Math.random() * 2,
      life: 520 + Math.random() * 420,
      type: 'ember',
      drag: 0.965,
      gravity: 0.12,
      glow: 0.9,
    });
  }

  // Directional streaks for silhouette.
  const streaks = 8;
  for (let i = 0; i < streaks; i++) {
    const angle = (Math.PI * 2 * i) / streaks + Math.random() * 0.25;
    const speed = 13 + Math.random() * 7;
    emit(x, y, {
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      color,
      size: 20 * scale,
      life: 230,
      type: 'trail',
      drag: 0.9,
      glow: 1.2,
    });
  }
}

/** Big scripted blast (missiles, volatile elites, bombs). */
export function createBlast(
  position: Vector2,
  radius: number,
  innerColor: string,
  outerColor: string,
): void {
  const x = position.x;
  const y = position.y;

  emit(x, y, { color: COLORS.white, size: radius * 0.7, life: 130, type: 'flash', drag: 1, glow: 1.8 });
  emit(x, y, { color: outerColor, size: radius * 2.4, life: 420, type: 'shockwave', drag: 1, fade: 1.4, glow: 1.4 });
  emit(x, y, { color: innerColor, size: radius * 1.5, life: 280, type: 'shockwave', drag: 1, fade: 1.8, glow: 1.5 });
  emit(x, y, { color: COLORS.white, size: radius * 0.8, life: 170, type: 'shockwave', drag: 1, fade: 2.2, glow: 1.6 });

  for (let i = 0; i < 38; i++) {
    const angle = (i / 38) * Math.PI * 2 + Math.random() * 0.4;
    const speed = 6 + Math.random() * 16;
    emit(x + (Math.random() - 0.5) * 14, y + (Math.random() - 0.5) * 14, {
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      color: i % 3 === 0 ? innerColor : outerColor,
      size: 5 + Math.random() * 7,
      life: 380 + Math.random() * 320,
      type: 'explosion',
      drag: 0.9,
      glow: 1.35,
    });
  }

  for (let i = 0; i < 22; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = 14 + Math.random() * 14;
    emit(x, y, {
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      color: i % 2 === 0 ? COLORS.white : innerColor,
      size: 2.5 + Math.random() * 2.5,
      life: 260 + Math.random() * 200,
      type: 'spark',
      drag: 0.86,
      glow: 1.4,
    });
  }

  for (let i = 0; i < 12; i++) {
    const angle = (i / 12) * Math.PI * 2 + Math.random() * 0.5;
    const speed = 10 + Math.random() * 8;
    emit(x, y, {
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      color: outerColor,
      size: 26,
      life: 300,
      type: 'trail',
      drag: 0.9,
      glow: 1.2,
    });
  }

  for (let i = 0; i < 16; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = 3 + Math.random() * 6;
    emit(x, y, {
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - 2,
      color: outerColor,
      size: 2 + Math.random() * 2.5,
      life: 700 + Math.random() * 500,
      type: 'ember',
      drag: 0.97,
      gravity: 0.14,
    });
  }
}

/** Muzzle flash when a weapon fires. */
export function createMuzzleFlash(
  position: Vector2,
  angle: number,
  color: string,
  power = 1,
): void {
  const x = position.x;
  const y = position.y;

  emit(x, y, {
    color: COLORS.white,
    size: 9 * power,
    life: 70,
    type: 'flash',
    drag: 1,
    glow: 1.4,
  });

  emit(x, y, {
    vx: Math.cos(angle) * 6,
    vy: Math.sin(angle) * 6,
    color,
    size: 16 * power,
    life: 90,
    type: 'trail',
    drag: 0.85,
    glow: 1.3,
  });

  for (let i = 0; i < 3; i++) {
    const a = angle + (Math.random() - 0.5) * 0.9;
    const speed = 4 + Math.random() * 5;
    emit(x, y, {
      vx: Math.cos(a) * speed,
      vy: Math.sin(a) * speed,
      color,
      size: 2 + Math.random() * 1.5,
      life: 110 + Math.random() * 80,
      type: 'spark',
      drag: 0.85,
    });
  }
}

/** Hit feedback on the player taking damage. */
export function createPlayerHurtEffect(position: Vector2, heavy: boolean): void {
  const x = position.x;
  const y = position.y;

  emit(x, y, {
    color: COLORS.pink,
    size: heavy ? 130 : 90,
    life: heavy ? 340 : 240,
    type: 'shockwave',
    drag: 1,
    fade: 1.6,
    glow: 1.4,
  });
  emit(x, y, { color: COLORS.white, size: heavy ? 26 : 16, life: 110, type: 'flash', drag: 1, glow: 1.5 });

  const shards = heavy ? 24 : 12;
  for (let i = 0; i < shards; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = 6 + Math.random() * 10;
    emit(x, y, {
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      color: i % 3 === 0 ? COLORS.white : COLORS.pink,
      size: 3 + Math.random() * 3,
      life: 280 + Math.random() * 220,
      type: 'explosion',
      drag: 0.89,
      glow: 1.2,
    });
  }
}

export function emitWeaponImpactEffect(projectile: Projectile, enemy: Enemy): void {
  const impactX = projectile.position.x;
  const impactY = projectile.position.y;
  const baseAngle = Math.atan2(projectile.velocity.y, projectile.velocity.x);

  // Every impact gets a white core spark — the common "it connected" read.
  emit(impactX, impactY, {
    color: COLORS.white,
    size: 7,
    life: 70,
    type: 'flash',
    drag: 1,
    glow: 1.5,
  });

  switch (projectile.weaponType) {
    case 'blaster': {
      for (let j = 0; j < 8; j++) {
        // Sparks spray back along the impact normal.
        const sparkAngle = baseAngle + Math.PI + (Math.random() - 0.5) * 1.9;
        const sparkSpeed = 4 + Math.random() * 7;
        emit(impactX, impactY, {
          vx: Math.cos(sparkAngle) * sparkSpeed,
          vy: Math.sin(sparkAngle) * sparkSpeed,
          color: j % 3 === 0 ? COLORS.white : COLORS.cyan,
          size: 2.5 + Math.random() * 2,
          life: 170 + Math.random() * 120,
          type: 'spark',
          drag: 0.87,
          glow: 1.3,
        });
      }
      break;
    }
    case 'spread': {
      for (let j = 0; j < 11; j++) {
        const shardAngle = baseAngle + Math.PI + (Math.random() - 0.5) * 2.4;
        const shardSpeed = 5 + Math.random() * 8;
        emit(impactX, impactY, {
          vx: Math.cos(shardAngle) * shardSpeed,
          vy: Math.sin(shardAngle) * shardSpeed,
          color: j % 2 === 0 ? COLORS.yellow : COLORS.orange,
          size: 3 + Math.random() * 2.5,
          life: 160 + Math.random() * 140,
          type: 'spark',
          drag: 0.87,
          glow: 1.3,
        });
      }
      break;
    }
    case 'laser': {
      for (let j = 0; j < 4; j++) {
        emit(impactX, impactY, {
          vx: Math.cos(baseAngle + (Math.random() - 0.5) * 0.35) * (10 + Math.random() * 7),
          vy: Math.sin(baseAngle + (Math.random() - 0.5) * 0.35) * (10 + Math.random() * 7),
          color: j === 3 ? COLORS.white : COLORS.pink,
          size: 18,
          life: 130 + j * 22,
          type: 'trail',
          drag: 0.88,
          glow: 1.4,
        });
      }
      break;
    }
    case 'orbit': {
      for (let j = 0; j < 12; j++) {
        const a = (j / 12) * Math.PI * 2 + Math.random() * 0.25;
        emit(impactX, impactY, {
          vx: Math.cos(a) * (4 + Math.random() * 6),
          vy: Math.sin(a) * (4 + Math.random() * 6),
          color: j % 4 === 0 ? COLORS.white : COLORS.purple,
          size: 2.5 + Math.random() * 3,
          life: 200 + Math.random() * 160,
          type: 'spark',
          drag: 0.89,
          glow: 1.25,
        });
      }
      break;
    }
    default: {
      for (let j = 0; j < 7; j++) {
        const sparkAngle = Math.random() * Math.PI * 2;
        const sparkSpeed = 4 + Math.random() * 6;
        emit(impactX, impactY, {
          vx: Math.cos(sparkAngle) * sparkSpeed,
          vy: Math.sin(sparkAngle) * sparkSpeed,
          color: projectile.color,
          size: 2.5 + Math.random() * 2,
          life: 170 + Math.random() * 130,
          type: 'spark',
          drag: 0.88,
          glow: 1.2,
        });
      }
      break;
    }
  }

  // Impact ring in the weapon's colour...
  emit(impactX, impactY, {
    color: projectile.color,
    size:
      projectile.weaponType === 'laser' ? 46 : projectile.weaponType === 'spread' ? 34 : 26,
    life: projectile.weaponType === 'laser' ? 150 : 190,
    type: 'ring',
    drag: 1,
    fade: 1.4,
    glow: 1.3,
  });

  // ...and a tighter counter-ring in the enemy's colour so the target reads.
  if (projectile.weaponType !== 'missile') {
    emit(impactX, impactY, {
      color: enemy.color,
      size: 20,
      life: 140,
      type: 'ring',
      drag: 1,
      fade: 1.6,
    });
  }
}
