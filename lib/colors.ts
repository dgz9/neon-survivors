import * as THREE from 'three';

// Brutalist color palette
export const COLORS = {
  black: '#0a0a0a',
  dark: '#141414',
  yellow: '#e4ff1a',
  pink: '#ff2d6a',
  cyan: '#00f0ff',
  green: '#39ff14',
  purple: '#bf5fff',
  orange: '#ff6b1a',
  white: '#fafafa',
};

// Cache THREE.Color instances for reuse
const colorCache = new Map<string, THREE.Color>();

export function getThreeColor(hex: string): THREE.Color {
  let cached = colorCache.get(hex);
  if (!cached) {
    cached = new THREE.Color(hex);
    colorCache.set(hex, cached);
  }
  return cached;
}

// Pre-cache common colors
Object.values(COLORS).forEach(getThreeColor);
