'use client';

import { useEffect, useRef } from 'react';
import { GameState } from '@/types/game';

interface TextParticlesProps {
  gameStateRef: React.RefObject<GameState | null>;
}

export function TextParticles({ gameStateRef }: TextParticlesProps) {
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
      const particles = state.particles;
      const count = state.particleCount;

      for (let i = 0; i < count; i++) {
        const p = particles[i];
        if (!p._active || p.type !== 'text') continue;

        const opacity = p.life / p.maxLife;
        const x = p.position.x;
        const y = p.position.y;
        const color = p.color;
        const size = p.size;
        const text = p.text || '';

        html += `<div style="position:absolute;left:${x}px;top:${y}px;transform:translate(-50%,-50%);opacity:${opacity.toFixed(2)};color:${color};font-size:${size}px;font-family:monospace;font-weight:bold;text-shadow:0 0 8px ${color};background:rgba(0,0,0,0.6);padding:2px 6px;border-radius:4px;white-space:nowrap;pointer-events:none">${text}</div>`;
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
      style={{ zIndex: 11 }}
    />
  );
}
