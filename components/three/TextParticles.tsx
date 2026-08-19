'use client';

import { useEffect, useRef } from 'react';
import { GameState } from '@/types/game';

interface TextParticlesProps {
  gameStateRef: React.RefObject<GameState | null>;
  /** Camera zoom. World coords must be scaled to match the WebGL canvas. */
  worldScale?: number;
}

export function TextParticles({ gameStateRef, worldScale = 1 }: TextParticlesProps) {
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
        const t = Math.max(0, Math.min(1, p.life / p.maxLife));
        // Hold full opacity for the first half of the life, then fade out —
        // a linear fade makes numbers read as washed out the instant they spawn.
        const opacity = Math.min(1, t * 2);
        const age = 1 - t;
        // Overshoot pop on spawn so hits feel like they land.
        const pop = age < 0.12 ? 1 + (1 - age / 0.12) * 0.55 : 1;
        const x = p.position.x;
        const y = p.position.y;
        const color = p.color;
        const size = p.size;
        const text = p.text || '';
        let node = nodes.get(p.id);
        if (!node) {
          node = document.createElement('div');
          node.style.position = 'absolute';
          node.style.fontFamily = 'var(--font-display, monospace)';
          node.style.fontWeight = '800';
          node.style.letterSpacing = '0.02em';
          node.style.whiteSpace = 'nowrap';
          node.style.pointerEvents = 'none';
          node.style.willChange = 'transform, opacity';
          container.appendChild(node);
          nodes.set(p.id, node);
        }

        node.style.left = `${x}px`;
        node.style.top = `${y}px`;
        node.style.transform = `translate(-50%,-50%) scale(${pop.toFixed(3)})`;
        node.style.opacity = opacity.toFixed(2);
        node.style.color = color;
        node.style.fontSize = `${size}px`;
        // Dark outline keeps it legible over bloom without a background pill.
        node.style.textShadow =
          `0 0 10px ${color}, 0 0 22px ${color}, 0 2px 3px rgba(0,0,0,0.95), 0 0 2px rgba(0,0,0,0.9)`;
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
      style={{
        zIndex: 11,
        // Matches the orthographic camera zoom so overlay text lands on the
        // same pixels as the entity it belongs to.
        transform: worldScale === 1 ? undefined : `scale(${worldScale})`,
        transformOrigin: '0 0',
        width: worldScale === 1 ? undefined : `${100 / worldScale}%`,
        height: worldScale === 1 ? undefined : `${100 / worldScale}%`,
      }}
    />
  );
}
