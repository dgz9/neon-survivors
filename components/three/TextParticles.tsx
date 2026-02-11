'use client';

import { useEffect, useRef } from 'react';
import { GameState } from '@/types/game';

interface TextParticlesProps {
  gameStateRef: React.RefObject<GameState | null>;
}

export function TextParticles({ gameStateRef }: TextParticlesProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const nodesRef = useRef<Map<string, HTMLDivElement>>(new Map());

  useEffect(() => {
    let rafId: number;
    const nodes = nodesRef.current;

    const update = () => {
      rafId = requestAnimationFrame(update);

      const container = containerRef.current;
      if (!container) return;

      const state = gameStateRef.current;
      if (!state) {
        nodes.forEach((node) => node.remove());
        nodes.clear();
        return;
      }

      const seen = new Set<string>();
      const particles = state.particles;
      const count = state.particleCount;

      for (let i = 0; i < count; i++) {
        const p = particles[i];
        if (!p._active || p.type !== 'text') continue;

        seen.add(p.id);
        const opacity = p.life / p.maxLife;
        const x = p.position.x;
        const y = p.position.y;
        const color = p.color;
        const size = p.size;
        const text = p.text || '';
        let node = nodes.get(p.id);
        if (!node) {
          node = document.createElement('div');
          node.style.position = 'absolute';
          node.style.transform = 'translate(-50%,-50%)';
          node.style.fontFamily = 'monospace';
          node.style.fontWeight = 'bold';
          node.style.background = 'rgba(0,0,0,0.6)';
          node.style.padding = '2px 6px';
          node.style.borderRadius = '4px';
          node.style.whiteSpace = 'nowrap';
          node.style.pointerEvents = 'none';
          container.appendChild(node);
          nodes.set(p.id, node);
        }

        node.style.left = `${x}px`;
        node.style.top = `${y}px`;
        node.style.opacity = opacity.toFixed(2);
        node.style.color = color;
        node.style.fontSize = `${size}px`;
        node.style.textShadow = `0 0 8px ${color}`;
        if (node.textContent !== text) node.textContent = text;
      }

      nodes.forEach((node, id) => {
        if (!seen.has(id)) {
          node.remove();
          nodes.delete(id);
        }
      });
    };

    rafId = requestAnimationFrame(update);

    return () => {
      cancelAnimationFrame(rafId);
      nodes.forEach((node) => node.remove());
      nodes.clear();
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
