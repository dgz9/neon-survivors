'use client';

import { useEffect, useRef, useCallback } from 'react';
import { Vector2 } from '@/types/game';

interface TouchControlsProps {
  onMovementChange: (direction: Vector2) => void;
  onAimChange: (position: Vector2 | null) => void;
  onPause: () => void;
  gameAreaRef: React.RefObject<HTMLDivElement | null>;
  visible: boolean;
}

interface JoystickState {
  touchId: number | null;
  origin: Vector2;
  current: Vector2;
  active: boolean;
}

const JOYSTICK_RADIUS = 50;
const JOYSTICK_DEAD_ZONE = 8;

export default function TouchControls({
  onMovementChange,
  onAimChange,
  onPause,
  gameAreaRef,
  visible,
}: TouchControlsProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const leftStick = useRef<JoystickState>({
    touchId: null,
    origin: { x: 0, y: 0 },
    current: { x: 0, y: 0 },
    active: false,
  });
  const rightStick = useRef<JoystickState>({
    touchId: null,
    origin: { x: 0, y: 0 },
    current: { x: 0, y: 0 },
    active: false,
  });
  const animFrameRef = useRef<number>(0);

  const drawJoysticks = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Match canvas internal size to display size
    const rect = canvas.getBoundingClientRect();
    if (canvas.width !== rect.width || canvas.height !== rect.height) {
      canvas.width = rect.width;
      canvas.height = rect.height;
    }

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const drawStick = (stick: JoystickState, color: string) => {
      if (!stick.active) return;

      // Outer ring
      ctx.beginPath();
      ctx.arc(stick.origin.x, stick.origin.y, JOYSTICK_RADIUS, 0, Math.PI * 2);
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.globalAlpha = 0.3;
      ctx.stroke();

      // Filled background
      ctx.beginPath();
      ctx.arc(stick.origin.x, stick.origin.y, JOYSTICK_RADIUS, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.globalAlpha = 0.08;
      ctx.fill();

      // Inner thumb
      const dx = stick.current.x - stick.origin.x;
      const dy = stick.current.y - stick.origin.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const clampedDist = Math.min(dist, JOYSTICK_RADIUS);
      const angle = Math.atan2(dy, dx);
      const thumbX = stick.origin.x + Math.cos(angle) * clampedDist;
      const thumbY = stick.origin.y + Math.sin(angle) * clampedDist;

      ctx.beginPath();
      ctx.arc(thumbX, thumbY, 20, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.globalAlpha = 0.5;
      ctx.fill();

      ctx.beginPath();
      ctx.arc(thumbX, thumbY, 20, 0, Math.PI * 2);
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.globalAlpha = 0.8;
      ctx.stroke();

      ctx.globalAlpha = 1;
    };

    drawStick(leftStick.current, '#00f0ff');
    drawStick(rightStick.current, '#ff2d6a');

    animFrameRef.current = requestAnimationFrame(drawJoysticks);
  }, []);

  useEffect(() => {
    if (!visible) return;
    animFrameRef.current = requestAnimationFrame(drawJoysticks);
    return () => cancelAnimationFrame(animFrameRef.current);
  }, [visible, drawJoysticks]);

  useEffect(() => {
    if (!visible) return;

    const canvas = canvasRef.current;
    if (!canvas) return;

    const getStickOutput = (stick: JoystickState): Vector2 => {
      const dx = stick.current.x - stick.origin.x;
      const dy = stick.current.y - stick.origin.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < JOYSTICK_DEAD_ZONE) return { x: 0, y: 0 };
      const clampedDist = Math.min(dist, JOYSTICK_RADIUS);
      const normalizedDist = clampedDist / JOYSTICK_RADIUS;
      const angle = Math.atan2(dy, dx);
      return {
        x: Math.cos(angle) * normalizedDist,
        y: Math.sin(angle) * normalizedDist,
      };
    };

    const handleTouchStart = (e: TouchEvent) => {
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const midX = rect.width / 2;

      for (let i = 0; i < e.changedTouches.length; i++) {
        const touch = e.changedTouches[i];
        const x = touch.clientX - rect.left;
        const y = touch.clientY - rect.top;

        if (x < midX) {
          // Left side -> movement joystick
          if (leftStick.current.touchId === null) {
            leftStick.current = {
              touchId: touch.identifier,
              origin: { x, y },
              current: { x, y },
              active: true,
            };
          }
        } else {
          // Right side -> aim joystick
          if (rightStick.current.touchId === null) {
            rightStick.current = {
              touchId: touch.identifier,
              origin: { x, y },
              current: { x, y },
              active: true,
            };
          }
        }
      }
    };

    const handleTouchMove = (e: TouchEvent) => {
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();

      for (let i = 0; i < e.changedTouches.length; i++) {
        const touch = e.changedTouches[i];
        const x = touch.clientX - rect.left;
        const y = touch.clientY - rect.top;

        if (touch.identifier === leftStick.current.touchId) {
          leftStick.current.current = { x, y };
          const output = getStickOutput(leftStick.current);
          onMovementChange(output);
        } else if (touch.identifier === rightStick.current.touchId) {
          rightStick.current.current = { x, y };
          // Convert aim joystick to a world position relative to game area center
          const gameRect = gameAreaRef.current?.getBoundingClientRect();
          if (gameRect) {
            const output = getStickOutput(rightStick.current);
            if (Math.abs(output.x) > 0 || Math.abs(output.y) > 0) {
              // Project aim direction from player center with large distance
              const aimDistance = 200;
              onAimChange({
                x: output.x * aimDistance,
                y: output.y * aimDistance,
              });
            }
          }
        }
      }
    };

    const handleTouchEnd = (e: TouchEvent) => {
      e.preventDefault();
      for (let i = 0; i < e.changedTouches.length; i++) {
        const touch = e.changedTouches[i];

        if (touch.identifier === leftStick.current.touchId) {
          leftStick.current = {
            touchId: null,
            origin: { x: 0, y: 0 },
            current: { x: 0, y: 0 },
            active: false,
          };
          onMovementChange({ x: 0, y: 0 });
        } else if (touch.identifier === rightStick.current.touchId) {
          rightStick.current = {
            touchId: null,
            origin: { x: 0, y: 0 },
            current: { x: 0, y: 0 },
            active: false,
          };
          onAimChange(null);
        }
      }
    };

    canvas.addEventListener('touchstart', handleTouchStart, { passive: false });
    canvas.addEventListener('touchmove', handleTouchMove, { passive: false });
    canvas.addEventListener('touchend', handleTouchEnd, { passive: false });
    canvas.addEventListener('touchcancel', handleTouchEnd, { passive: false });

    return () => {
      canvas.removeEventListener('touchstart', handleTouchStart);
      canvas.removeEventListener('touchmove', handleTouchMove);
      canvas.removeEventListener('touchend', handleTouchEnd);
      canvas.removeEventListener('touchcancel', handleTouchEnd);
    };
  }, [visible, onMovementChange, onAimChange, gameAreaRef]);

  if (!visible) return null;

  return (
    <>
      {/* Touch overlay canvas for joystick rendering */}
      <canvas
        ref={canvasRef}
        className="absolute inset-0 z-40 touch-none"
        style={{ pointerEvents: 'auto' }}
      />
      {/* Pause button for mobile */}
      <button
        onClick={onPause}
        className="absolute top-2 right-2 z-50 w-10 h-10 flex items-center justify-center bg-brutal-dark/80 border border-white/20 active:bg-white/20 touch-none"
        style={{ pointerEvents: 'auto' }}
      >
        <span className="text-white/60 text-lg font-mono">||</span>
      </button>
    </>
  );
}
