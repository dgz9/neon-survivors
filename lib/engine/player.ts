import { Player, GameConfig, Vector2 } from '@/types/game';

export function updatePlayer(
  player: Player,
  input: { keys: Set<string>; mousePos: Vector2; mouseDown: boolean },
  width: number,
  height: number,
  config: GameConfig,
  deltaTime: number
): Player {
  let targetVx = 0;
  let targetVy = 0;

  if (input.keys.has('w') || input.keys.has('arrowup')) targetVy -= 1;
  if (input.keys.has('s') || input.keys.has('arrowdown')) targetVy += 1;
  if (input.keys.has('a') || input.keys.has('arrowleft')) targetVx -= 1;
  if (input.keys.has('d') || input.keys.has('arrowright')) targetVx += 1;

  const length = Math.sqrt(targetVx * targetVx + targetVy * targetVy);
  if (length > 0) {
    targetVx = (targetVx / length) * player.speed;
    targetVy = (targetVy / length) * player.speed;
  }

  const acceleration = 0.25;
  const vx = player.velocity.x + (targetVx - player.velocity.x) * acceleration;
  const vy = player.velocity.y + (targetVy - player.velocity.y) * acceleration;

  let newX = player.position.x + vx * deltaTime;
  let newY = player.position.y + vy * deltaTime;

  const margin = player.radius;
  if (newX < margin) { newX = margin; }
  if (newX > width - margin) { newX = width - margin; }
  if (newY < margin) { newY = margin; }
  if (newY > height - margin) { newY = height - margin; }

  return {
    ...player,
    position: { x: newX, y: newY },
    velocity: { x: vx, y: vy },
  };
}

export function updatePlayerBuffs(player: Player, currentTime: number): Player {
  const activeBuffs = player.activeBuffs.filter(b => b.expiresAt > currentTime);

  const speedBuff = activeBuffs.find(b => b.type === 'speed');
  const magnetBuff = activeBuffs.find(b => b.type === 'magnet');

  const effectiveSpeed = Math.min(8, (player.baseSpeed + player.speedBonus) * (speedBuff?.multiplier || 1));
  const effectiveMagnet = (1 + player.magnetBonus) * (magnetBuff?.multiplier || 1);

  return {
    ...player,
    activeBuffs,
    speed: effectiveSpeed,
    magnetMultiplier: effectiveMagnet,
  };
}
