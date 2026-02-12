// Barrel re-export — all engine logic lives in lib/engine/*.ts
export { createInitialGameState, loadPlayerImage, startGame } from './engine/state';
export { updateGameState } from './engine/update';
export { generateUpgrades, applyUpgrade } from './engine/upgrades';
export { acquireProjectile, getProjectileCount, releaseXPOrb, getXPOrbCount, generateId } from './engine/context';
export { serializeForRender } from './engine/serialize';
export type { RenderState } from './engine/serialize';
