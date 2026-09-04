'use client';

import { useEffect, useRef } from 'react';
import { GameState, POWERUP_CONFIGS } from '@/types/game';
import { ViewTransform } from '@/lib/viewport';

interface PowerupSpritesProps {
  gameStateRef: React.RefObject<GameState | null>;
  /** World-to-canvas mapping, so overlay children land on the same
   *  pixels as the entities they belong to. */
  viewRef: React.RefObject<ViewTransform>;
}

/** Keeps the overlay's world-coordinate box aligned with the WebGL canvas. */
function applyView(container: HTMLElement, view: ViewTransform | null): void {
  if (!view) return;
  container.style.transformOrigin = '0 0';
  container.style.transform =
    `translate(${view.offsetX}px, ${view.offsetY}px) scale(${view.scale})`;
  container.style.width = `${view.worldWidth}px`;
  container.style.height = `${view.worldHeight}px`;
}

export function PowerupSprites({ gameStateRef, viewRef }: PowerupSpritesProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let rafId: number;

    const update = () => {
      rafId = requestAnimationFrame(update);

      const container = containerRef.current;
      if (!container) return;
      applyView(container, viewRef.current);

      const state = gameStateRef.current;
      if (!state) {
        container.innerHTML = '';
        return;
      }

      let html = '';
      const now = Date.now();
      const pulseScale = 1 + 0.2 * Math.sin(now * 0.004);

      for (let i = 0; i < state.powerups.length; i++) {
        const pu = state.powerups[i];
        const config = POWERUP_CONFIGS[pu.type];
        if (!config) continue;

        const x = pu.position.x;
        const y = pu.position.y;

        html += `<div style="position:absolute;left:${x}px;top:${y}px;transform:translate(-50%,-50%) scale(${pulseScale.toFixed(3)});font-size:24px;filter:drop-shadow(0 0 8px ${config.color});pointer-events:none;line-height:1">${config.icon}</div>`;
      }

      container.innerHTML = html;
    };

    rafId = requestAnimationFrame(update);

    return () => {
      cancelAnimationFrame(rafId);
    };
  }, [gameStateRef, viewRef]);

  return (
    <div
      ref={containerRef}
      className="absolute inset-0 pointer-events-none overflow-hidden"
      style={{ zIndex: 11 }}
    />
  );
}
