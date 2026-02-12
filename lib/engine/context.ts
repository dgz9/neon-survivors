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

let nextId = 0;
export const generateId = () => `id-${nextId++}-${Math.random().toString(36).substr(2, 9)}`;
