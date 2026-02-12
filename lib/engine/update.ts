import {
  GameState,
  GameConfig,
  Player,
  Enemy,
  Vector2,
  DEFAULT_CONFIG,
  WaveEventType,
  POWERUP_CONFIGS,
} from '@/types/game';
import { particlePool, projectilePool, xpOrbPool, resizeEnemyGrid, generateId } from './context';
import { COLORS } from '../colors';
import { updatePlayer, updatePlayerBuffs } from './player';
import { fireWeapons, emitProjectileSignatureTrail } from './weapons';
import { updateProjectileInPlace, isProjectileAlive } from './projectiles';
import { checkProjectileCollisions, checkEnemyPlayerCollision, checkEnemyProjectilePlayerCollision } from './collision';
import { updateEnemy, spawnEnemy, spawnBoss, applySeparationForces, spawnFormation } from './enemies';
import { initBossState, updateBoss } from './bossAI';
import { collectExperienceOrbs, addExperience } from './experience';
import { generateUpgrades } from './upgrades';
import { createPowerup, collectPowerups, applyPowerup } from './powerups';
import { createExplosion } from './effects';

export function updateGameState(
  state: GameState,
  deltaTime: number,
  width: number,
  height: number,
  input: { keys: Set<string>; mousePos: Vector2; mouseDown: boolean },
  config: GameConfig = DEFAULT_CONFIG,
  player2?: Player | null
): GameState {
  if (!state.isRunning || state.isPaused || state.isGameOver) {
    return state;
  }

  const currentTime = Date.now();

  // Resize spatial grid if dimensions changed
  resizeEnemyGrid(width, height);

  // deltaTime is always FIXED_DT (1.0) — slow-mo is handled by the accumulator
  const effectiveDelta = deltaTime;
  let {
    player,
    enemies,
    powerups,
    score,
    multiplier,
    multiplierTimer,
    screenShake,
    totalDamageDealt,
    killStreak,
    killStreakTimer,
    nearMissCount,
  } = state;

  const eventActive = !!(state.activeEvent && state.eventUntil && currentTime < state.eventUntil);

  // Update player position based on input
  const oldPos = { ...player.position };
  player = updatePlayer(player, input, width, height, config, effectiveDelta);

  // Player movement trail particles
  const moveSpeed = Math.sqrt(player.velocity.x ** 2 + player.velocity.y ** 2);
  if (moveSpeed > 2) {
    const p = particlePool.acquire();
    p.id = generateId();
    p.position.x = oldPos.x;
    p.position.y = oldPos.y;
    p.velocity.x = -player.velocity.x * 0.1 + (Math.random() - 0.5) * 0.5;
    p.velocity.y = -player.velocity.y * 0.1 + (Math.random() - 0.5) * 0.5;
    p.color = COLORS.cyan;
    p.size = 3 + Math.random() * 2;
    p.life = 150 + Math.random() * 100;
    p.maxLife = 250;
    p.type = 'spark';
  }

  // Fire weapons (acquires from projectile pool directly)
  fireWeapons(player, input.mousePos, currentTime, state.metaDamageMultiplier || 1);

  // Update projectiles in-place and remove dead ones
  projectilePool.forEach(proj => {
    updateProjectileInPlace(proj, effectiveDelta, player.position);
    if (!isProjectileAlive(proj, width, height)) return false; // release

    emitProjectileSignatureTrail(proj);

    return true; // keep
  });

  // Check projectile-enemy collisions (uses spatial grid)
  const { updatedEnemies, killedEnemies, damageDealt, missileShake: mShake } =
    checkProjectileCollisions(enemies, currentTime);
  enemies = updatedEnemies;
  totalDamageDealt += damageDealt;
  screenShake = Math.max(screenShake, mShake);

  // Process killed enemies
  killedEnemies.forEach(enemy => {
    score += enemy.points * multiplier;
    player.kills++;
    multiplier = Math.min(multiplier + 0.1, 10);
    multiplierTimer = currentTime + 3000;
    killStreak = currentTime <= killStreakTimer ? killStreak + 1 : 1;
    killStreakTimer = currentTime + 2200;

    if (killStreak === 5 || killStreak === 10 || killStreak === 20) {
      const kp = particlePool.acquire();
      kp.id = generateId();
      kp.position.x = player.position.x;
      kp.position.y = player.position.y - 30;
      kp.velocity.x = 0;
      kp.velocity.y = -2.2;
      kp.color = killStreak >= 10 ? COLORS.pink : COLORS.yellow;
      kp.size = killStreak >= 10 ? 26 : 20;
      kp.life = 900;
      kp.maxLife = 900;
      kp.type = 'text';
      kp.text = `${killStreak} STREAK`;

      const kr = particlePool.acquire();
      kr.id = generateId();
      kr.position.x = player.position.x;
      kr.position.y = player.position.y;
      kr.velocity.x = 0;
      kr.velocity.y = 0;
      kr.color = killStreak >= 10 ? COLORS.pink : COLORS.yellow;
      kr.size = 70;
      kr.life = 220;
      kr.maxLife = 220;
      kr.type = 'ring';
    }

    // Spawn experience orb
    const orb = xpOrbPool.acquire();
    orb.id = generateId();
    orb.position.x = enemy.position.x;
    orb.position.y = enemy.position.y;
    orb.value = Math.floor(enemy.points / 2);
    orb.createdAt = currentTime;

    // Chance to spawn powerup
    if (Math.random() < config.powerupSpawnChance) {
      powerups.push(createPowerup(enemy.position));
    }

    // Splitter spawns smaller enemies on death
    if (enemy.type === 'splitter' && !enemy.isSplit) {
      const splitCount = 2 + Math.floor(Math.random() * 2);
      for (let i = 0; i < splitCount; i++) {
        const angle = (i / splitCount) * Math.PI * 2;
        const splitEnemy: Enemy = {
          id: generateId(),
          position: {
            x: enemy.position.x + Math.cos(angle) * 20,
            y: enemy.position.y + Math.sin(angle) * 20,
          },
          velocity: { x: 0, y: 0 },
          radius: 10,
          color: '#ff88ff',
          health: 15,
          maxHealth: 15,
          speed: 4,
          damage: 5,
          type: 'swarm',
          points: 5,
          spawnTime: currentTime,
          isSplit: true,
        };
        enemies.push(splitEnemy);
      }
    }

    // Death particles - scaled by enemy size
    createExplosion(enemy.position, enemy.color, 25 + Math.floor(enemy.radius * 1.2));

    if (enemy.isElite) {
      const eliteRing = particlePool.acquire();
      eliteRing.id = generateId();
      eliteRing.position.x = enemy.position.x;
      eliteRing.position.y = enemy.position.y;
      eliteRing.velocity.x = 0;
      eliteRing.velocity.y = 0;
      eliteRing.color = enemy.color;
      eliteRing.size = 32 + enemy.radius;
      eliteRing.life = 260;
      eliteRing.maxLife = 260;
      eliteRing.type = 'ring';

      if (enemy.eliteModifier === 'volatile') {
        screenShake = Math.max(screenShake, 18);
        state = {
          ...state,
          screenFlash: currentTime,
          screenFlashColor: '255, 107, 26',
        };
        for (let i = 0; i < 16; i++) {
          const a = (i / 16) * Math.PI * 2;
          const vp = particlePool.acquire();
          vp.id = generateId();
          vp.position.x = enemy.position.x;
          vp.position.y = enemy.position.y;
          vp.velocity.x = Math.cos(a) * (7 + Math.random() * 4);
          vp.velocity.y = Math.sin(a) * (7 + Math.random() * 4);
          vp.color = COLORS.orange;
          vp.size = 6 + Math.random() * 3;
          vp.life = 240 + Math.random() * 120;
          vp.maxLife = 360;
          vp.type = 'explosion';
        }
      }
    }

    // Expanding death ring for all enemies
    const deathRp = particlePool.acquire();
    deathRp.id = generateId();
    deathRp.position.x = enemy.position.x;
    deathRp.position.y = enemy.position.y;
    deathRp.velocity.x = 0;
    deathRp.velocity.y = 0;
    deathRp.color = enemy.color;
    deathRp.size = 15 + enemy.radius;
    deathRp.life = 200;
    deathRp.maxLife = 200;
    deathRp.type = 'ring';

    // Directional debris for all enemies (8 trails)
    for (let i = 0; i < 8; i++) {
      const angle = (i / 8) * Math.PI * 2 + Math.random() * 0.3;
      const speed = 4 + Math.random() * 6;
      const tp = particlePool.acquire();
      tp.id = generateId();
      tp.position.x = enemy.position.x;
      tp.position.y = enemy.position.y;
      tp.velocity.x = Math.cos(angle) * speed;
      tp.velocity.y = Math.sin(angle) * speed;
      tp.color = enemy.color;
      tp.size = 8 + Math.random() * 4;
      tp.life = 150 + Math.random() * 100;
      tp.maxLife = 250;
      tp.type = 'trail';
    }

    // Extra death effects for bigger enemies / bosses
    if (enemy.radius > 20 || enemy.type === 'boss') {
      // Brief hit-stop to make elite/boss kills land.
      state = {
        ...state,
        slowMoUntil: currentTime + 80,
        slowMoFactor: 0.18,
      };

      // Track boss kills
      if (enemy.type === 'boss') {
        state = {
          ...state,
          bossesKilledThisRun: (state.bossesKilledThisRun || 0) + 1,
        };
      }

      for (let i = 0; i < 3; i++) {
        const rp = particlePool.acquire();
        rp.id = generateId();
        rp.position.x = enemy.position.x;
        rp.position.y = enemy.position.y;
        rp.velocity.x = 0;
        rp.velocity.y = 0;
        rp.color = enemy.color;
        rp.size = 30 + i * 25;
        rp.life = 300 + i * 60;
        rp.maxLife = 360 + i * 60;
        rp.type = 'ring';
      }

      for (let i = 0; i < 16; i++) {
        const angle = (i / 16) * Math.PI * 2;
        const tp = particlePool.acquire();
        tp.id = generateId();
        tp.position.x = enemy.position.x;
        tp.position.y = enemy.position.y;
        tp.velocity.x = Math.cos(angle) * 12;
        tp.velocity.y = Math.sin(angle) * 12;
        tp.color = enemy.color;
        tp.size = 15;
        tp.life = 200;
        tp.maxLife = 200;
        tp.type = 'trail';
      }

      // White flash for big kills
      for (let i = 0; i < 6; i++) {
        const angle = Math.random() * Math.PI * 2;
        const sp = particlePool.acquire();
        sp.id = generateId();
        sp.position.x = enemy.position.x;
        sp.position.y = enemy.position.y;
        sp.velocity.x = Math.cos(angle) * (8 + Math.random() * 4);
        sp.velocity.y = Math.sin(angle) * (8 + Math.random() * 4);
        sp.color = COLORS.white;
        sp.size = 4 + Math.random() * 3;
        sp.life = 150;
        sp.maxLife = 150;
        sp.type = 'spark';
      }
    }
  });

  state = { ...state, enemiesKilledThisWave: state.enemiesKilledThisWave + killedEnemies.length };

  // Check if multiplier should decay
  if (currentTime > multiplierTimer) {
    multiplier = Math.max(1, multiplier - 0.01 * deltaTime);
  }
  if (currentTime > killStreakTimer) {
    killStreak = 0;
  }

  // Update enemies
  const newBossMinions: Enemy[] = [];
  enemies = enemies.map(e => {
    // Boss enemies use the boss AI state machine
    if (e.bossPhase) {
      const { enemy: updatedBoss, spawnedEnemies: minions } = updateBoss(e, player, effectiveDelta, currentTime, width, height, player2);
      newBossMinions.push(...minions);
      return updatedBoss;
    }
    return updateEnemy(e, player, effectiveDelta, currentTime, player2, eventActive ? state.activeEvent : undefined);
  });
  if (newBossMinions.length > 0) {
    enemies.push(...newBossMinions);
  }

  // Separation forces — push overlapping enemies apart
  applySeparationForces(enemies, effectiveDelta);

  // Near-miss reward: enemy grazes the player but does not hit.
  const nearMissCooldown = 650;
  if (!state.lastNearMissTime || currentTime - state.lastNearMissTime > nearMissCooldown) {
    let nearMissDetected = false;
    for (let i = 0; i < enemies.length; i++) {
      const e = enemies[i];
      const dx = player.position.x - e.position.x;
      const dy = player.position.y - e.position.y;
      const d = Math.sqrt(dx * dx + dy * dy);
      const hitDist = player.radius + e.radius;
      if (d > hitDist + 8 && d < hitDist + 26) {
        nearMissDetected = true;
        break;
      }
    }

    if (nearMissDetected) {
      nearMissCount += 1;
      multiplier = Math.min(10, multiplier + 0.03);
      multiplierTimer = Math.max(multiplierTimer, currentTime + 1200);
      screenShake = Math.max(screenShake, 6);
      state = {
        ...state,
        lastNearMissTime: currentTime,
      };

      if (nearMissCount % 4 === 0) {
        const nm = particlePool.acquire();
        nm.id = generateId();
        nm.position.x = player.position.x;
        nm.position.y = player.position.y - 26;
        nm.velocity.x = 0;
        nm.velocity.y = -1.9;
        nm.color = COLORS.cyan;
        nm.size = 18;
        nm.life = 650;
        nm.maxLife = 650;
        nm.type = 'text';
        nm.text = 'NEAR MISS';
      }
    }
  }

  // Check enemy-player collision
  const collision = checkEnemyPlayerCollision(enemies, player, currentTime);
  if (collision.hit && currentTime > player.invulnerableUntil) {
    const armorMult = state.metaArmorMultiplier || 1;
    const mitigatedDamage = Math.floor(collision.damage * armorMult);
    player = {
      ...player,
      health: player.health - mitigatedDamage,
      invulnerableUntil: currentTime + 1000,
    };
    screenShake = 20;
    state = {
      ...state,
      screenFlash: currentTime,
      screenFlashColor: '255, 45, 106',
      totalDamageTaken: state.totalDamageTaken + mitigatedDamage,
      slowMoUntil: currentTime + 70,
      slowMoFactor: 0.22,
    };

    // Floating damage number
    const dp = particlePool.acquire();
    dp.id = generateId();
    dp.position.x = player.position.x;
    dp.position.y = player.position.y - 10;
    dp.velocity.x = (Math.random() - 0.5) * 0.5;
    dp.velocity.y = -2.5;
    dp.color = COLORS.pink;
    dp.size = 32;
    dp.life = 1200;
    dp.maxLife = 1200;
    dp.type = 'text';
    dp.text = `-${mitigatedDamage} HP`;

    // Secondary damage echo
    const dp2 = particlePool.acquire();
    dp2.id = generateId();
    dp2.position.x = player.position.x + (Math.random() - 0.5) * 20;
    dp2.position.y = player.position.y + 5;
    dp2.velocity.x = (Math.random() - 0.5) * 3;
    dp2.velocity.y = -2.5;
    dp2.color = COLORS.orange;
    dp2.size = 20;
    dp2.life = 900;
    dp2.maxLife = 900;
    dp2.type = 'text';
    dp2.text = `${Math.ceil(player.health)}`;

    // Crash/damage particles
    createExplosion(player.position, COLORS.pink, 35);

    // Radial crash lines
    for (let i = 0; i < 12; i++) {
      const angle = (i / 12) * Math.PI * 2;
      const tp = particlePool.acquire();
      tp.id = generateId();
      tp.position.x = player.position.x;
      tp.position.y = player.position.y;
      tp.velocity.x = Math.cos(angle) * 10;
      tp.velocity.y = Math.sin(angle) * 10;
      tp.color = COLORS.pink;
      tp.size = 20;
      tp.life = 200;
      tp.maxLife = 200;
      tp.type = 'trail';
    }

    // Expanding damage ring
    const rp = particlePool.acquire();
    rp.id = generateId();
    rp.position.x = player.position.x;
    rp.position.y = player.position.y;
    rp.velocity.x = 0;
    rp.velocity.y = 0;
    rp.color = COLORS.pink;
    rp.size = 50;
    rp.life = 300;
    rp.maxLife = 300;
    rp.type = 'ring';

    // White flash particles
    for (let i = 0; i < 8; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 5 + Math.random() * 5;
      const sp = particlePool.acquire();
      sp.id = generateId();
      sp.position.x = player.position.x;
      sp.position.y = player.position.y;
      sp.velocity.x = Math.cos(angle) * speed;
      sp.velocity.y = Math.sin(angle) * speed;
      sp.color = COLORS.white;
      sp.size = 6;
      sp.life = 200;
      sp.maxLife = 200;
      sp.type = 'spark';
    }
  }

  // Check enemy projectile-player collision (shooter/boss bullets)
  if (currentTime > player.invulnerableUntil) {
    const epResult = checkEnemyProjectilePlayerCollision(player, currentTime);
    if (epResult.hit) {
      const epArmorMult = state.metaArmorMultiplier || 1;
      const epDamage = Math.floor(epResult.totalDamage * epArmorMult);
      player = {
        ...player,
        health: player.health - epDamage,
        invulnerableUntil: currentTime + 500,
      };
      screenShake = Math.max(screenShake, 10);
      state = {
        ...state,
        screenFlash: currentTime,
        screenFlashColor: '255, 45, 106',
        totalDamageTaken: state.totalDamageTaken + epDamage,
      };

      // Floating damage number
      const edp = particlePool.acquire();
      edp.id = generateId();
      edp.position.x = player.position.x;
      edp.position.y = player.position.y - 10;
      edp.velocity.x = (Math.random() - 0.5) * 0.5;
      edp.velocity.y = -2.5;
      edp.color = COLORS.pink;
      edp.size = 24;
      edp.life = 800;
      edp.maxLife = 800;
      edp.type = 'text';
      edp.text = `-${epDamage}`;

      createExplosion(player.position, COLORS.pink, 12);
    }
  }

  // Check if player is dead
  if (player.health <= 0) {
    return {
      ...state,
      player,
      isGameOver: true,
      isRunning: false,
      particleCount: particlePool.activeCount,
      projectileCount: projectilePool.activeCount,
      experienceOrbCount: xpOrbPool.activeCount,
    };
  }

  // Collect experience orbs
  let collectedXP = collectExperienceOrbs(player, config);
  // Apply meta XP multiplier
  collectedXP = Math.floor(collectedXP * (state.metaXpMultiplier || 1));

  if (collectedXP > 0) {
    const xpResult = addExperience(player, collectedXP, config);
    player = xpResult.player;
    if (xpResult.leveledUp) {
      state = {
        ...state,
        pendingLevelUps: state.pendingLevelUps + 1,
        availableUpgrades: state.availableUpgrades.length === 0 ? generateUpgrades(player) : state.availableUpgrades,
        slowMoUntil: currentTime + 500,
        slowMoFactor: 0.3,
      };
    }
  }

  // Track peak multiplier
  if (multiplier > state.peakMultiplier) {
    state = { ...state, peakMultiplier: multiplier };
  }

  // Collect powerups
  const { collectedPowerups, remainingPowerups } =
    collectPowerups(player, powerups, currentTime);
  powerups = remainingPowerups;

  const levelBeforePowerups = player.level;
  collectedPowerups.forEach(powerup => {
    if (powerup.type === 'health') {
      // Big healing text
      const hp = particlePool.acquire();
      hp.id = generateId();
      hp.position.x = player.position.x;
      hp.position.y = player.position.y - 10;
      hp.velocity.x = (Math.random() - 0.5) * 0.5;
      hp.velocity.y = -2.5;
      hp.color = COLORS.green;
      hp.size = 30;
      hp.life = 1200;
      hp.maxLife = 1200;
      hp.type = 'text';
      hp.text = '+25 HP';

      // Green healing sparkles
      for (let si = 0; si < 8; si++) {
        const sparkAngle = (si / 8) * Math.PI * 2;
        const sparkSpeed = 2 + Math.random() * 3;
        const gp = particlePool.acquire();
        gp.id = generateId();
        gp.position.x = player.position.x + Math.cos(sparkAngle) * 15;
        gp.position.y = player.position.y + Math.sin(sparkAngle) * 15;
        gp.velocity.x = Math.cos(sparkAngle) * sparkSpeed;
        gp.velocity.y = Math.sin(sparkAngle) * sparkSpeed - 2;
        gp.color = COLORS.green;
        gp.size = 3 + Math.random() * 2;
        gp.life = 300 + Math.random() * 200;
        gp.maxLife = 500;
        gp.type = 'spark';
      }

      // Healing ring
      const hr = particlePool.acquire();
      hr.id = generateId();
      hr.position.x = player.position.x;
      hr.position.y = player.position.y;
      hr.velocity.x = 0;
      hr.velocity.y = 0;
      hr.color = COLORS.green;
      hr.size = 35;
      hr.life = 250;
      hr.maxLife = 250;
      hr.type = 'ring';
    }

    // Floating text for other powerups too
    if (powerup.type === 'speed' || powerup.type === 'damage' || powerup.type === 'magnet') {
      const labels: Record<string, string> = { speed: 'SPEED UP', damage: 'DMG UP', magnet: 'MAGNET' };
      const colors: Record<string, string> = { speed: COLORS.yellow, damage: COLORS.pink, magnet: COLORS.purple };
      const bp = particlePool.acquire();
      bp.id = generateId();
      bp.position.x = player.position.x;
      bp.position.y = player.position.y - 15;
      bp.velocity.x = 0;
      bp.velocity.y = -3.5;
      bp.color = colors[powerup.type] || COLORS.white;
      bp.size = 18;
      bp.life = 800;
      bp.maxLife = 800;
      bp.type = 'text';
      bp.text = labels[powerup.type] || powerup.type.toUpperCase();
    }
    if (powerup.type === 'xp') {
      const xpp = particlePool.acquire();
      xpp.id = generateId();
      xpp.position.x = player.position.x;
      xpp.position.y = player.position.y - 15;
      xpp.velocity.x = 0;
      xpp.velocity.y = -3.5;
      xpp.color = COLORS.cyan;
      xpp.size = 18;
      xpp.life = 800;
      xpp.maxLife = 800;
      xpp.type = 'text';
      xpp.text = '+50 XP';
    }
    if (powerup.type === 'bomb') {
      const bombRadius = 350;
      const bombRadiusSq = bombRadius * bombRadius;
      let bombKills = 0;

      // Kill all enemies within radius
      const survivingEnemies: Enemy[] = [];
      enemies.forEach(enemy => {
        const dx = enemy.position.x - player.position.x;
        const dy = enemy.position.y - player.position.y;
        const distSq = dx * dx + dy * dy;
        if (distSq < bombRadiusSq) {
          // Kill this enemy
          score += enemy.points * multiplier;
          player.kills++;
          bombKills++;
          multiplier = Math.min(multiplier + 0.1, 10);
          multiplierTimer = currentTime + 3000;

          // Spawn XP orb
          const orb = xpOrbPool.acquire();
          orb.id = generateId();
          orb.position.x = enemy.position.x;
          orb.position.y = enemy.position.y;
          orb.value = Math.floor(enemy.points / 2);
          orb.createdAt = currentTime;

          // Death explosion per enemy
          createExplosion(enemy.position, enemy.color, 15);
          const dr = particlePool.acquire();
          dr.id = generateId();
          dr.position.x = enemy.position.x;
          dr.position.y = enemy.position.y;
          dr.velocity.x = 0;
          dr.velocity.y = 0;
          dr.color = enemy.color;
          dr.size = 15 + enemy.radius;
          dr.life = 200;
          dr.maxLife = 200;
          dr.type = 'ring';
        } else {
          survivingEnemies.push(enemy);
        }
      });
      enemies = survivingEnemies;
      state = { ...state, enemiesKilledThisWave: state.enemiesKilledThisWave + bombKills };

      // Shockwave rings
      const ringColors = [COLORS.orange, COLORS.yellow, COLORS.pink];
      const ringSizes = [bombRadius * 0.72, bombRadius * 0.5, bombRadius * 0.3];
      const ringLives = [430, 340, 260];
      for (let ri = 0; ri < 3; ri++) {
        const sr = particlePool.acquire();
        sr.id = generateId();
        sr.position.x = player.position.x;
        sr.position.y = player.position.y;
        sr.velocity.x = 0;
        sr.velocity.y = 0;
        sr.color = ringColors[ri];
        sr.size = ringSizes[ri];
        sr.life = ringLives[ri];
        sr.maxLife = ringLives[ri];
        sr.type = 'ring';
      }

      // Fire/debris particles
      for (let fi = 0; fi < 64; fi++) {
        const angle = (fi / 64) * Math.PI * 2 + Math.random() * 0.35;
        const speed = 5 + Math.random() * 10;
        const fp = particlePool.acquire();
        fp.id = generateId();
        fp.position.x = player.position.x + (Math.random() - 0.5) * 10;
        fp.position.y = player.position.y + (Math.random() - 0.5) * 10;
        fp.velocity.x = Math.cos(angle) * speed;
        fp.velocity.y = Math.sin(angle) * speed;
        fp.color = fi % 3 === 0 ? COLORS.yellow : fi % 3 === 1 ? COLORS.orange : COLORS.white;
        fp.size = 4 + Math.random() * 5;
        fp.life = 320 + Math.random() * 220;
        fp.maxLife = 540;
        fp.type = fi % 4 === 0 ? 'trail' : 'explosion';
      }

      // Fast spark burst
      for (let si = 0; si < 24; si++) {
        const angle = (si / 24) * Math.PI * 2 + Math.random() * 0.45;
        const speed = 10 + Math.random() * 14;
        const sp = particlePool.acquire();
        sp.id = generateId();
        sp.position.x = player.position.x;
        sp.position.y = player.position.y;
        sp.velocity.x = Math.cos(angle) * speed;
        sp.velocity.y = Math.sin(angle) * speed;
        sp.color = si % 3 === 0 ? COLORS.white : si % 2 === 0 ? COLORS.yellow : COLORS.orange;
        sp.size = 2 + Math.random() * 2;
        sp.life = 220 + Math.random() * 150;
        sp.maxLife = 370;
        sp.type = 'spark';
      }

      // Spoke trails
      for (let ti = 0; ti < 12; ti++) {
        const angle = (ti / 12) * Math.PI * 2;
        const speed = 8 + Math.random() * 6;
        const tp = particlePool.acquire();
        tp.id = generateId();
        tp.position.x = player.position.x;
        tp.position.y = player.position.y;
        tp.velocity.x = Math.cos(angle) * speed;
        tp.velocity.y = Math.sin(angle) * speed;
        tp.color = ti % 2 === 0 ? COLORS.orange : COLORS.yellow;
        tp.size = 10 + Math.random() * 4;
        tp.life = 230 + Math.random() * 120;
        tp.maxLife = 350;
        tp.type = 'trail';
      }

      // Tinted center pulse
      const cf = particlePool.acquire();
      cf.id = generateId();
      cf.position.x = player.position.x;
      cf.position.y = player.position.y;
      cf.velocity.x = 0;
      cf.velocity.y = 0;
      cf.color = COLORS.yellow;
      cf.size = bombRadius * 0.2;
      cf.life = 110;
      cf.maxLife = 110;
      cf.type = 'ring';

      // "BOMB!" text
      const bt = particlePool.acquire();
      bt.id = generateId();
      bt.position.x = player.position.x;
      bt.position.y = player.position.y - 25;
      bt.velocity.x = 0;
      bt.velocity.y = -2;
      bt.color = COLORS.yellow;
      bt.size = 34;
      bt.life = 1400;
      bt.maxLife = 1400;
      bt.type = 'text';
      bt.text = 'BOMB!';

      // Kill count text
      if (bombKills > 0) {
        const kt = particlePool.acquire();
        kt.id = generateId();
        kt.position.x = player.position.x;
        kt.position.y = player.position.y + 15;
        kt.velocity.x = 0;
        kt.velocity.y = -1.5;
        kt.color = COLORS.green;
        kt.size = 24;
        kt.life = 1200;
        kt.maxLife = 1200;
        kt.type = 'text';
        kt.text = `x${bombKills} KILLS`;
      }

      screenShake = 20;
      state = {
        ...state,
        screenFlash: currentTime,
        screenFlashColor: '255, 170, 45',
        slowMoUntil: currentTime + 160,
        slowMoFactor: 0.14,
        bombPulseAt: currentTime,
        bombPulseOrigin: { x: player.position.x, y: player.position.y },
      };
    }
    player = applyPowerup(player, powerup, currentTime);
  });

  // Check if XP powerup caused a level up
  if (player.level > levelBeforePowerups) {
    const levelsGained = player.level - levelBeforePowerups;
    state = {
      ...state,
      pendingLevelUps: state.pendingLevelUps + levelsGained,
      availableUpgrades: state.availableUpgrades.length === 0 ? generateUpgrades(player) : state.availableUpgrades,
      slowMoUntil: currentTime + 500,
      slowMoFactor: 0.3,
    };
  }

  // Update buff timers and recalculate stats
  player = updatePlayerBuffs(player, currentTime);

  // Wave event modifiers
  if (eventActive && state.activeEvent === 'magnet_storm') {
    player = { ...player, magnetMultiplier: player.magnetMultiplier * 1.6 };
  }

  // Spawn enemies
  let spawnInterval = config.enemySpawnRate / (1 + state.wave * 0.12);
  if (eventActive && state.activeEvent === 'surge') {
    spawnInterval *= 0.72;
  }
  if (currentTime - state.lastEnemySpawn > spawnInterval) {
    // Formation spawning: 10% + wave*1.5% chance at wave 7+
    const formationChance = state.wave >= 7 ? 0.10 + state.wave * 0.015 : 0;
    if (Math.random() < formationChance) {
      const formationTypes: Array<'v_shape' | 'circle' | 'line'> = ['v_shape', 'circle', 'line'];
      const fType = formationTypes[Math.floor(Math.random() * formationTypes.length)];
      const formation = spawnFormation(fType, state.wave, width, height, player.position);
      enemies.push(...formation);
    } else {
      const spawnCount = Math.min(1 + Math.floor(state.wave / 7), 5);
      for (let i = 0; i < spawnCount; i++) {
        const newEnemy = spawnEnemy(state.wave, width, height, player.position);
        enemies.push(newEnemy);
      }
    }
    state = { ...state, lastEnemySpawn: currentTime };
  }

  // Check wave completion
  if (state.enemiesKilledThisWave >= state.enemiesRequiredForWave) {
    const newWave = state.wave + 1;
    const shouldStartEvent = newWave >= 4 && newWave % 4 === 0;
    const nextEvent: WaveEventType | undefined = shouldStartEvent
      ? (Math.random() < 0.5 ? 'surge' : 'magnet_storm')
      : undefined;
    state = {
      ...state,
      wave: newWave,
      enemiesKilledThisWave: 0,
      enemiesRequiredForWave: Math.floor(state.enemiesRequiredForWave * 1.15),
      waveAnnounceTime: currentTime,
      activeEvent: nextEvent ?? state.activeEvent,
      eventUntil: nextEvent ? currentTime + 9000 : state.eventUntil,
      eventAnnounceTime: nextEvent ? currentTime : state.eventAnnounceTime,
    };

    // Wave celebration particles
    for (let i = 0; i < 30; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 3 + Math.random() * 5;
      const cp = particlePool.acquire();
      cp.id = generateId();
      cp.position.x = width / 2;
      cp.position.y = height / 2;
      cp.velocity.x = Math.cos(angle) * speed;
      cp.velocity.y = Math.sin(angle) * speed;
      cp.color = [COLORS.cyan, COLORS.yellow, COLORS.pink][Math.floor(Math.random() * 3)];
      cp.size = 4 + Math.random() * 3;
      cp.life = 400 + Math.random() * 200;
      cp.maxLife = 600;
      cp.type = 'spark';
    }

    // Spawn boss every 5 waves
    if (newWave % 5 === 0) {
      const bossLevel = Math.floor(newWave / 5);
      const boss = spawnBoss(width, height, player.position);
      // Scale boss health by level
      boss.health = boss.health * (1 + (bossLevel - 1) * 0.5);
      boss.maxHealth = boss.health;
      enemies.push(initBossState(boss, bossLevel));
    }

    if (nextEvent) {
      const ep = particlePool.acquire();
      ep.id = generateId();
      ep.position.x = width / 2;
      ep.position.y = height * 0.35;
      ep.velocity.x = 0;
      ep.velocity.y = -1.4;
      ep.color = nextEvent === 'surge' ? COLORS.pink : COLORS.cyan;
      ep.size = 30;
      ep.life = 1400;
      ep.maxLife = 1400;
      ep.type = 'text';
      ep.text = nextEvent === 'surge' ? 'SURGE MODE' : 'MAGNET STORM';

      state = {
        ...state,
        screenFlash: currentTime,
        screenFlashColor: nextEvent === 'surge' ? '255, 45, 106' : '0, 240, 255',
      };
    }
  }

  if (state.activeEvent && state.eventUntil && currentTime >= state.eventUntil) {
    state = { ...state, activeEvent: undefined, eventUntil: undefined };
  }

  // Update particles in-place and release dead ones
  particlePool.forEach(p => {
    const newLife = p.life - effectiveDelta * 16;
    const lifeRatio = Math.max(0, newLife / p.maxLife);
    p.position.x += p.velocity.x * effectiveDelta * 0.1;
    p.position.y += p.velocity.y * effectiveDelta * 0.1;
    p.velocity.x *= 0.98;
    p.velocity.y *= 0.98;
    p.life = newLife;
    p.size = Math.max(0.1, p.size * lifeRatio);
    if (p.life <= 0) return false; // release
    return true; // keep
  });

  // Decay screen shake
  screenShake = Math.max(0, screenShake - deltaTime * 0.5);

  return {
    ...state,
    player,
    enemies,
    projectiles: projectilePool.items,
    projectileCount: projectilePool.activeCount,
    powerups,
    experienceOrbs: xpOrbPool.items,
    experienceOrbCount: xpOrbPool.activeCount,
    particles: particlePool.items,
    particleCount: particlePool.activeCount,
    score,
    multiplier,
    multiplierTimer,
    screenShake,
    killStreak,
    killStreakTimer,
    nearMissCount,
    totalDamageDealt,
  };
}
