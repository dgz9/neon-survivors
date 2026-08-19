'use client';

import { useEffect, useRef } from 'react';
import { GameState, POWERUP_CONFIGS } from '@/types/game';

interface PowerupSpritesProps {
  gameStateRef: React.RefObject<GameState | null>;
  /** Camera zoom. World coords must be scaled to match the WebGL canvas. */
  worldScale?: number;
}

export function PowerupSprites({ gameStateRef, worldScale = 1 }: PowerupSpritesProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let rafId: number;

    const update = () => {
      rafId = requestAnimationFrame(update);

      const container = containerRef.current;
      if (!container) return;

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
  }, [gameStateRef]);

  return (
    <div
      ref={containerRef}
      className="absolute inset-0 pointer-events-none overflow-hidden"
      style={{
        zIndex: 11,
        // Matches the orthographic camera zoom so overlay sprites land on the
        // same pixels as the entities they belong to.
        transform: worldScale === 1 ? undefined : `scale(${worldScale})`,
        transformOrigin: '0 0',
        width: worldScale === 1 ? undefined : `${100 / worldScale}%`,
        height: worldScale === 1 ? undefined : `${100 / worldScale}%`,
      }}
    />
  );
}
