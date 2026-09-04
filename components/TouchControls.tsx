'use client';

import { useEffect, useRef, useCallback } from 'react';
import { Vector2 } from '@/types/game';

interface TouchControlsProps {
  onMovementChange: (direction: Vector2) => void;
  onAimChange: (position: Vector2 | null) => void;
  onPause: () => void;
  visible: boolean;
  soundEnabled?: boolean;
  onToggleSound?: () => void;
}

interface JoystickState {
  touchId: number | null;
  origin: Vector2;
  current: Vector2;
  active: boolean;
  /** Eases the ring in/out so sticks don't pop. */
  opacity: number;
}

/** Fraction of travel ignored around the centre. */
const DEAD_ZONE = 0.14;
/** Distance the aim vector is projected in world units. */
const AIM_DISTANCE = 220;
/** Top strip kept clear so a thumb reaching for pause doesn't spawn a stick. */
const TOP_RESERVED = 64;
/** Backing-store guard — no phone needs more, and it caps memory on high-DPR screens. */
const MAX_BACKING_PX = 4096;

function createStick(): JoystickState {
  return {
    touchId: null,
    origin: { x: 0, y: 0 },
    current: { x: 0, y: 0 },
    active: false,
    opacity: 0,
  };
}

function vibrate(ms: number) {
  if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
    navigator.vibrate(ms);
  }
}

export default function TouchControls({
  onMovementChange,
  onAimChange,
  onPause,
  visible,
  soundEnabled,
  onToggleSound,
}: TouchControlsProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const leftStick = useRef<JoystickState>(createStick());
  const rightStick = useRef<JoystickState>(createStick());
  const animFrameRef = useRef<number>(0);
  /** Scaled to the viewport so the stick suits both phones and tablets. */
  const radiusRef = useRef(56);
  /** Resting positions for the idle hint rings. */
  const anchorsRef = useRef({ left: { x: 0, y: 0 }, right: { x: 0, y: 0 } });
  /**
   * CSS size of the overlay, measured from the wrapper div.
   * A <canvas> is a replaced element: absolutely positioned, its used size comes
   * from the width/height attributes rather than from `inset: 0`. Measuring the
   * canvas to pick its own backing store therefore feeds back on itself and the
   * element grows without bound. The wrapper is a plain block, so it is safe.
   */
  const sizeRef = useRef({ width: 0, height: 0 });

  const layout = useCallback((width: number, height: number) => {
    const shortSide = Math.min(width, height);
    radiusRef.current = Math.max(42, Math.min(68, shortSide * 0.16));
    const inset = radiusRef.current + Math.max(18, Math.min(36, shortSide * 0.055));
    anchorsRef.current.left = { x: inset, y: height - inset };
    anchorsRef.current.right = { x: width - inset, y: height - inset };
  }, []);

  // Track the overlay's real size so the rings land where the thumbs are, and
  // keep following it: the bottom HUD bar mounting and device rotation both
  // resize the arena without firing a window resize.
  useEffect(() => {
    if (!visible) return;
    const root = rootRef.current;
    if (!root) return;

    const measure = () => {
      const rect = root.getBoundingClientRect();
      const width = Math.max(1, Math.round(rect.width));
      const height = Math.max(1, Math.round(rect.height));
      if (width === sizeRef.current.width && height === sizeRef.current.height) return;
      sizeRef.current = { width, height };
      layout(width, height);
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(root);
    window.addEventListener('orientationchange', measure);
    return () => {
      observer.disconnect();
      window.removeEventListener('orientationchange', measure);
    };
  }, [visible, layout]);

  const drawJoysticks = useCallback(() => {
    animFrameRef.current = requestAnimationFrame(drawJoysticks);

    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const { width, height } = sizeRef.current;
    if (width <= 1 || height <= 1) return;

    // Back the canvas with real device pixels — at 1x the rings were visibly
    // soft on every modern phone.
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    const targetW = Math.min(MAX_BACKING_PX, Math.round(width * dpr));
    const targetH = Math.min(MAX_BACKING_PX, Math.round(height * dpr));
    if (canvas.width !== targetW || canvas.height !== targetH) {
      canvas.width = targetW;
      canvas.height = targetH;
    }

    ctx.setTransform(targetW / width, 0, 0, targetH / height, 0, 0);
    ctx.clearRect(0, 0, width, height);

    const radius = radiusRef.current;

    const drawStick = (stick: JoystickState, anchor: Vector2, color: string, label: string) => {
      // Ease the ring toward its target visibility instead of snapping.
      const target = stick.active ? 1 : 0.34;
      stick.opacity += (target - stick.opacity) * 0.18;
      if (stick.opacity < 0.01) return;

      const cx = stick.active ? stick.origin.x : anchor.x;
      const cy = stick.active ? stick.origin.y : anchor.y;
      const o = stick.opacity;

      ctx.save();

      // Outer ring
      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.globalAlpha = 0.45 * o;
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.globalAlpha = 0.08 * o;
      ctx.fill();

      if (!stick.active) {
        // Idle hint so a new player knows where to put their thumbs.
        ctx.globalAlpha = 0.7 * o;
        ctx.fillStyle = color;
        ctx.font = '600 11px ui-monospace, monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(label, cx, cy);
        ctx.restore();
        return;
      }

      const dx = stick.current.x - stick.origin.x;
      const dy = stick.current.y - stick.origin.y;
      const dist = Math.hypot(dx, dy);
      const clampedDist = Math.min(dist, radius);
      const angle = Math.atan2(dy, dx);
      const thumbX = cx + Math.cos(angle) * clampedDist;
      const thumbY = cy + Math.sin(angle) * clampedDist;
      const thumbR = radius * 0.4;

      // Direction wedge — reads the input at a glance without looking down.
      if (dist > radius * DEAD_ZONE) {
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.arc(cx, cy, radius, angle - 0.34, angle + 0.34);
        ctx.closePath();
        ctx.fillStyle = color;
        ctx.globalAlpha = 0.14 * o;
        ctx.fill();
      }

      ctx.globalAlpha = o;
      ctx.shadowColor = color;
      ctx.shadowBlur = 18;

      ctx.beginPath();
      ctx.arc(thumbX, thumbY, thumbR, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.globalAlpha = 0.45 * o;
      ctx.fill();

      ctx.beginPath();
      ctx.arc(thumbX, thumbY, thumbR, 0, Math.PI * 2);
      ctx.strokeStyle = color;
      ctx.lineWidth = 2.5;
      ctx.globalAlpha = 0.95 * o;
      ctx.stroke();

      ctx.restore();
    };

    drawStick(leftStick.current, anchorsRef.current.left, '#00f0ff', 'MOVE');
    drawStick(rightStick.current, anchorsRef.current.right, '#ff2d6a', 'AIM');
  }, []);

  useEffect(() => {
    if (!visible) return;
    animFrameRef.current = requestAnimationFrame(drawJoysticks);
    return () => cancelAnimationFrame(animFrameRef.current);
  }, [visible, drawJoysticks]);

  useEffect(() => {
    if (!visible) return;

    const canvas = canvasRef.current;
    const root = rootRef.current;
    if (!canvas || !root) return;

    const getStickOutput = (stick: JoystickState): Vector2 => {
      const radius = radiusRef.current;
      const dx = stick.current.x - stick.origin.x;
      const dy = stick.current.y - stick.origin.y;
      const dist = Math.hypot(dx, dy);
      const normalized = Math.min(dist / radius, 1);
      if (normalized < DEAD_ZONE) return { x: 0, y: 0 };

      // Rescale past the dead zone so the very first pixel of real travel maps
      // to a small movement rather than an instant jump to ~15% speed.
      const magnitude = (normalized - DEAD_ZONE) / (1 - DEAD_ZONE);
      const angle = Math.atan2(dy, dx);
      return {
        x: Math.cos(angle) * magnitude,
        y: Math.sin(angle) * magnitude,
      };
    };

    /**
     * Keeps the stick usable when a thumb drags well past the ring: the origin
     * trails the finger so the stick stays pinned at full deflection instead of
     * silently clamping and feeling stuck.
     */
    const trailOrigin = (stick: JoystickState) => {
      const radius = radiusRef.current;
      const dx = stick.current.x - stick.origin.x;
      const dy = stick.current.y - stick.origin.y;
      const dist = Math.hypot(dx, dy);
      if (dist > radius) {
        const pull = (dist - radius) / dist;
        stick.origin.x += dx * pull;
        stick.origin.y += dy * pull;
      }
    };

    const emitAim = (stick: JoystickState) => {
      const output = getStickOutput(stick);
      if (output.x === 0 && output.y === 0) {
        // Inside the dead zone the player is not steering — hand aiming back to
        // auto-target rather than freezing on the last direction.
        onAimChange(null);
        return;
      }
      const len = Math.hypot(output.x, output.y) || 1;
      onAimChange({
        x: (output.x / len) * AIM_DISTANCE,
        y: (output.y / len) * AIM_DISTANCE,
      });
    };

    const releaseLeft = () => {
      leftStick.current.touchId = null;
      leftStick.current.active = false;
      onMovementChange({ x: 0, y: 0 });
    };

    const releaseRight = () => {
      rightStick.current.touchId = null;
      rightStick.current.active = false;
      onAimChange(null);
    };

    const handleTouchStart = (e: TouchEvent) => {
      e.preventDefault();
      const rect = root.getBoundingClientRect();
      const midX = rect.width / 2;

      for (let i = 0; i < e.changedTouches.length; i++) {
        const touch = e.changedTouches[i];
        const x = touch.clientX - rect.left;
        const y = touch.clientY - rect.top;
        // Leave the pause/sound row alone.
        if (y < TOP_RESERVED) continue;
        const prefersLeft = x < midX;

        // Prefer the stick on the side that was touched, but fall back to the
        // free one — otherwise a thumb that lands slightly across the midline
        // does nothing at all.
        let stick: JoystickState | null = null;
        let isLeft = prefersLeft;
        if (prefersLeft && leftStick.current.touchId === null) {
          stick = leftStick.current;
        } else if (!prefersLeft && rightStick.current.touchId === null) {
          stick = rightStick.current;
        } else if (prefersLeft && rightStick.current.touchId === null) {
          stick = rightStick.current;
          isLeft = false;
        } else if (!prefersLeft && leftStick.current.touchId === null) {
          stick = leftStick.current;
          isLeft = true;
        }
        if (!stick) continue;

        stick.touchId = touch.identifier;
        stick.origin.x = x;
        stick.origin.y = y;
        stick.current.x = x;
        stick.current.y = y;
        stick.active = true;

        if (isLeft) onMovementChange({ x: 0, y: 0 });
        else onAimChange(null);
        vibrate(8);
      }
    };

    const handleTouchMove = (e: TouchEvent) => {
      e.preventDefault();
      const rect = root.getBoundingClientRect();

      for (let i = 0; i < e.changedTouches.length; i++) {
        const touch = e.changedTouches[i];
        const x = touch.clientX - rect.left;
        const y = touch.clientY - rect.top;

        if (touch.identifier === leftStick.current.touchId) {
          leftStick.current.current.x = x;
          leftStick.current.current.y = y;
          trailOrigin(leftStick.current);
          onMovementChange(getStickOutput(leftStick.current));
        } else if (touch.identifier === rightStick.current.touchId) {
          rightStick.current.current.x = x;
          rightStick.current.current.y = y;
          trailOrigin(rightStick.current);
          emitAim(rightStick.current);
        }
      }
    };

    const handleTouchEnd = (e: TouchEvent) => {
      e.preventDefault();
      for (let i = 0; i < e.changedTouches.length; i++) {
        const touch = e.changedTouches[i];
        if (touch.identifier === leftStick.current.touchId) releaseLeft();
        else if (touch.identifier === rightStick.current.touchId) releaseRight();
      }
    };

    /** A backgrounded tab never delivers touchend, which used to leave the
     *  player sprinting into a wall on return. */
    const releaseAll = () => {
      releaseLeft();
      releaseRight();
    };

    const handleVisibility = () => {
      if (document.hidden) releaseAll();
    };

    canvas.addEventListener('touchstart', handleTouchStart, { passive: false });
    canvas.addEventListener('touchmove', handleTouchMove, { passive: false });
    canvas.addEventListener('touchend', handleTouchEnd, { passive: false });
    canvas.addEventListener('touchcancel', handleTouchEnd, { passive: false });
    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('blur', releaseAll);

    return () => {
      canvas.removeEventListener('touchstart', handleTouchStart);
      canvas.removeEventListener('touchmove', handleTouchMove);
      canvas.removeEventListener('touchend', handleTouchEnd);
      canvas.removeEventListener('touchcancel', handleTouchEnd);
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('blur', releaseAll);
      releaseAll();
    };
  }, [visible, onMovementChange, onAimChange]);

  if (!visible) return null;

  return (
    <div ref={rootRef} className="absolute inset-0 z-40 pointer-events-none">
      {/* Touch overlay canvas for joystick rendering. w-full/h-full is load
          bearing: without it the canvas sizes itself from its own attributes. */}
      <canvas
        ref={canvasRef}
        className="block w-full h-full touch-none select-none"
        style={{ pointerEvents: 'auto' }}
      />
      {/* Sound + pause, sized to a comfortable tap target. The game shell
          already pads for the safe area, so plain offsets are enough here. */}
      <div className="absolute top-2 right-2 flex items-center gap-2">
        {onToggleSound && (
          <button
            onClick={onToggleSound}
            aria-label={soundEnabled ? 'Mute sound' : 'Unmute sound'}
            className="w-11 h-11 flex items-center justify-center bg-brutal-dark/80 border border-white/20 active:bg-white/25 touch-none pointer-events-auto"
          >
            <span className="text-base leading-none">{soundEnabled ? '🔊' : '🔇'}</span>
          </button>
        )}
        <button
          onClick={onPause}
          aria-label="Pause"
          className="w-11 h-11 flex items-center justify-center bg-brutal-dark/80 border border-white/20 active:bg-white/25 touch-none pointer-events-auto"
        >
          <span className="text-white/70 text-xl font-mono leading-none">||</span>
        </button>
      </div>
    </div>
  );
}
