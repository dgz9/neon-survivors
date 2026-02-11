'use client';

import { useEffect, useRef } from 'react';
import { GameState } from '@/types/game';

interface CoopOverlayProps {
  gameStateRef: React.RefObject<GameState | null>;
}

export function CoopOverlay({ gameStateRef }: CoopOverlayProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let rafId: number;

    const update = () => {
      rafId = requestAnimationFrame(update);

      const container = containerRef.current;
      const state = gameStateRef.current;
      if (!container || !state) {
        if (container) container.innerHTML = '';
        return;
      }

      let html = '';

      // P1 label
      if (state.player) {
        const x = state.player.position.x;
        const y = state.player.position.y - state.player.radius - 18;
        html += `<div style="position:absolute;left:${x}px;top:${y}px;transform:translateX(-50%);color:#00f0ff;font-size:10px;font-family:monospace;font-weight:bold;text-shadow:0 0 6px #00f0ff;pointer-events:none">P1</div>`;
      }

      // P2 label
      const p2 = (state as any).player2;
      if (p2) {
        const x = p2.position.x;
        const y = p2.position.y - p2.radius - 18;
        html += `<div style="position:absolute;left:${x}px;top:${y}px;transform:translateX(-50%);color:#ff2d6a;font-size:10px;font-family:monospace;font-weight:bold;text-shadow:0 0 6px #ff2d6a;pointer-events:none">P2</div>`;
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
      style={{ zIndex: 12 }}
    />
  );
}
