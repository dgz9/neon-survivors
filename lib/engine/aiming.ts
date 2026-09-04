import { Vector2 } from '@/types/game';

/**
 * Where a touch player is pointing.
 *
 * The aim stick is the only thing that aims. When it is idle the player faces
 * the way they are walking, and when they stop they keep facing wherever they
 * last faced — deliberately *not* snapping onto the nearest enemy, which took
 * the shot away from the player and made the aim stick feel decorative.
 */
export interface AimState {
  /** Last direction the player actually pointed, in radians. */
  angle: number;
}

/** How far ahead of the player the aim point is projected, in world units. */
const AIM_DISTANCE = 200;
/** Stick travel below this is treated as no input at all. */
const MOVE_EPSILON = 0.12;

export function createAimState(): AimState {
  // Facing right is as good a starting pose as any, and it only survives until
  // the first stick input.
  return { angle: 0 };
}

/**
 * Resolves the aim point for a touch player and writes it into `out`.
 *
 * `stick` is the aim stick's offset from the player, or null when it is idle;
 * `move` is the movement stick. The chosen direction is remembered in `state`
 * so releasing both sticks holds the facing instead of resetting it.
 */
export function resolveTouchAim(
  state: AimState,
  origin: Vector2,
  stick: Vector2 | null,
  move: Vector2 | undefined,
  out: Vector2,
): void {
  if (stick && (stick.x !== 0 || stick.y !== 0)) {
    state.angle = Math.atan2(stick.y, stick.x);
  } else if (move && (Math.abs(move.x) > MOVE_EPSILON || Math.abs(move.y) > MOVE_EPSILON)) {
    state.angle = Math.atan2(move.y, move.x);
  }

  out.x = origin.x + Math.cos(state.angle) * AIM_DISTANCE;
  out.y = origin.y + Math.sin(state.angle) * AIM_DISTANCE;
}
