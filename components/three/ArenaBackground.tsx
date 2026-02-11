'use client';

import { useRef, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { GameState, ArenaType } from '@/types/game';

interface ArenaBackgroundProps {
  gameStateRef: React.RefObject<GameState | null>;
}

const vertexShader = `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const fragmentShaders: Record<ArenaType, string> = {
  void: `
    uniform float uTime;
    uniform vec2 uResolution;
    varying vec2 vUv;
    void main() {
      vec2 pos = vUv * uResolution;
      float brightness = 0.0;
      for (int i = 0; i < 50; i++) {
        float fi = float(i);
        float x = mod(fi * 73.0 + uTime * 0.01, uResolution.x);
        float y = mod(fi * 97.0, uResolution.y);
        float d = length(pos - vec2(x, y));
        brightness += smoothstep(3.0, 0.0, d) * (0.2 + sin(uTime * 0.002 + fi) * 0.15);
      }
      gl_FragColor = vec4(vec3(brightness), 1.0);
    }
  `,
  grid: `
    uniform float uTime;
    uniform vec2 uResolution;
    varying vec2 vUv;
    void main() {
      vec2 pos = vUv * uResolution;
      float gridSize = 50.0;
      vec2 grid = abs(fract(pos / gridSize) - 0.5);
      float line = min(grid.x, grid.y);
      float alpha = smoothstep(0.0, 0.02, line);
      float intensity = (1.0 - alpha) * 0.03;
      gl_FragColor = vec4(0.894, 1.0, 0.102, intensity);
    }
  `,
  cyber: `
    uniform float uTime;
    uniform vec2 uResolution;
    varying vec2 vUv;
    void main() {
      vec2 pos = vUv * uResolution;
      float hexSize = 40.0;
      vec2 r = vec2(1.0, 1.73205);
      vec2 h = r * 0.5;
      vec2 a = mod(pos, r) - h;
      vec2 b = mod(pos - h, r) - h;
      vec2 gv = dot(a, a) < dot(b, b) ? a : b;
      float d = max(abs(gv.x), abs(gv.y));
      float hexLine = smoothstep(0.0, 2.0, abs(d - hexSize * 0.4));
      float intensity = (1.0 - hexLine) * 0.04;
      gl_FragColor = vec4(0.0, 0.941, 1.0, intensity);
    }
  `,
  neon: `
    uniform float uTime;
    uniform vec2 uResolution;
    varying vec2 vUv;
    void main() {
      vec2 pos = vUv * uResolution;
      vec2 center = uResolution * 0.5;
      float dist = length(pos - center);
      float ring = abs(sin((dist - uTime * 0.3) / 100.0 * 3.14159));
      float ringAlpha = (1.0 - smoothstep(0.0, 0.1, ring)) * 0.03;
      float angle = atan(pos.y - center.y, pos.x - center.x);
      float radialLine = abs(sin(angle * 6.0 + uTime * 0.0005));
      float radialAlpha = (1.0 - smoothstep(0.0, 0.05, radialLine)) * 0.02;
      float intensity = ringAlpha + radialAlpha;
      gl_FragColor = vec4(1.0, 0.176, 0.416, intensity);
    }
  `,
};

export function ArenaBackground({ gameStateRef }: ArenaBackgroundProps) {
  const meshRef = useRef<THREE.Mesh>(null);
  const materialRef = useRef<THREE.ShaderMaterial>(null);

  const currentArenaRef = useRef<ArenaType>('grid');

  const uniforms = useMemo(() => ({
    uTime: { value: 0 },
    uResolution: { value: new THREE.Vector2(1920, 1080) },
  }), []);

  useFrame(({ clock, size }) => {
    const state = gameStateRef.current;
    if (!state || !materialRef.current) return;

    uniforms.uTime.value = clock.elapsedTime * 1000;
    uniforms.uResolution.value.set(size.width, size.height);

    // Rebuild shader if arena type changed
    if (state.arena !== currentArenaRef.current) {
      currentArenaRef.current = state.arena;
      materialRef.current.fragmentShader = fragmentShaders[state.arena];
      materialRef.current.needsUpdate = true;
    }

    if (meshRef.current) {
      meshRef.current.scale.set(size.width, size.height, 1);
      meshRef.current.position.set(size.width / 2, -size.height / 2, 0);
    }
  });

  return (
    <mesh ref={meshRef}>
      <planeGeometry args={[1, 1]} />
      <shaderMaterial
        ref={materialRef}
        vertexShader={vertexShader}
        fragmentShader={fragmentShaders.grid}
        uniforms={uniforms}
        transparent
        depthWrite={false}
      />
    </mesh>
  );
}
