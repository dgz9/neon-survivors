// Barrel re-export — all engine logic lives in lib/engine/*.ts
export { createInitialGameState, loadPlayerImage, startGame } from './engine/state';
export { updateGameState } from './engine/update';
export { generateUpgrades, applyUpgrade } from './engine/upgrades';
export { acquireProjectile, getProjectileCount, releaseXPOrb, getXPOrbCount, getParticleCount, generateId } from './engine/context';
export { updateParticles, createMuzzleFlash, createPlayerHurtEffect, createExplosion } from './engine/effects';
export { setEventRecording, drainEvents, recordEvent, NetEventKind } from './engine/netEvents';
export { serializeForRender } from './engine/serialize';
export type { RenderState } from './engine/serialize';
