import { Projectile, ExperienceOrb } from '@/types/game';
import { createParticlePool, createProjectilePool, createXPOrbPool } from '../objectPool';
import { SpatialGrid } from '../spatialGrid';

// Pool singletons
export const particlePool = createParticlePool(1200);
export const projectilePool = createProjectilePool(200);
export const xpOrbPool = createXPOrbPool(150);

// Spatial grid singleton
export let enemyGrid = new SpatialGrid(1920, 1080, 128);

export function resizeEnemyGrid(width: number, height: number): void {
  enemyGrid.resize(width, height);
}

// Export pool helpers for CoopGame P2 projectile/orb management
export function acquireProjectile(): Projectile {
  return projectilePool.acquire();
}
export function getProjectileCount(): number {
  return projectilePool.activeCount;
}
export function releaseXPOrb(orb: ExperienceOrb): void {
  xpOrbPool.release(orb);
}
export function getXPOrbCount(): number {
  return xpOrbPool.activeCount;
}
export function getParticleCount(): number {
  return particlePool.activeCount;
}

// Short base-36 ids: entity ids ride in every multiplayer snapshot, so keeping
// them a few characters long meaningfully shrinks the wire payload.
let nextId = 0;
export const generateId = () => (nextId++).toString(36);
