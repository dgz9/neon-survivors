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

const bombWarpShaderChunk = `
  uniform vec2 uBombCenter;
  uniform float uBombPulse;

  vec2 bombWarpOffset(vec2 pos) {
    if (uBombPulse <= 0.0) return vec2(0.0);

    float age = uBombPulse;
    float life = clamp(1.0 - age / 1.9, 0.0, 1.0);
    float fade = life * life * (3.0 - 2.0 * life);
    vec2 delta = pos - uBombCenter;
    float d = length(delta) + 0.0001;
    vec2 dir = delta / d;
    vec2 tangent = vec2(-dir.y, dir.x);

    float shockRadius = age * 2050.0;
    float shockWidth = 44.0 + age * 200.0;
    float shockRing = exp(-pow((d - shockRadius) / shockWidth, 2.0));
    float shockForce = shockRing * (84.0 * exp(-age * 1.35)) * fade;

    float ripple = sin(d * 0.13 - age * 25.0) * 0.62 + sin(d * 0.06 - age * 11.5) * 0.38;
    float rippleEnvelope = exp(-age * 0.75) * exp(-d * 0.0010) * fade;
    float rippleForce = ripple * 28.0 * rippleEnvelope;

    // Long-tail settle waves so the distortion eases back to flat.
    float settlePhase = max(age - 0.65, 0.0);
    float settleWave = sin(d * 0.045 - settlePhase * 4.2);
    float settleEnvelope = exp(-settlePhase * 0.45) * exp(-d * 0.0008) * fade;
    float settleForce = settleWave * 8.5 * settleEnvelope;

    float swirl = shockRing * 14.0 * exp(-age * 1.9) * fade;
    return dir * (shockForce + rippleForce + settleForce) + tangent * swirl;
  }

  float bombRippleLight(vec2 pos) {
    if (uBombPulse <= 0.0) return 0.0;

    float age = uBombPulse;
    float life = clamp(1.0 - age / 1.9, 0.0, 1.0);
    float fade = life * life * (3.0 - 2.0 * life);
    float d = length(pos - uBombCenter);
    float shockRadius = age * 2050.0;
    float shockWidth = 36.0 + age * 165.0;
    float ring = exp(-pow((d - shockRadius) / shockWidth, 2.0)) * exp(-age * 1.0) * fade;
    float ripples = (sin(d * 0.17 - age * 19.0) * 0.5 + 0.5) * exp(-age * 0.95) * exp(-d * 0.0012) * fade;
    float settlePhase = max(age - 0.65, 0.0);
    float settleLight = (sin(d * 0.06 - settlePhase * 3.8) * 0.5 + 0.5) * exp(-settlePhase * 0.5) * exp(-d * 0.001) * fade;
    return ring * 0.44 + ripples * 0.24 + settleLight * 0.08;
  }
`;

const fragmentShaders: Record<ArenaType, string> = {
  void: `
    uniform float uTime;
    uniform vec2 uResolution;
    ${bombWarpShaderChunk}
    varying vec2 vUv;
    void main() {
      vec2 basePos = vUv * uResolution;
      vec2 pos = basePos + bombWarpOffset(basePos);
      float brightness = 0.0;
      for (int i = 0; i < 50; i++) {
        float fi = float(i);
        float x = mod(fi * 73.0 + uTime * 0.01, uResolution.x);
        float y = mod(fi * 97.0, uResolution.y);
        float d = length(pos - vec2(x, y));
        brightness += smoothstep(3.0, 0.0, d) * (0.2 + sin(uTime * 0.002 + fi) * 0.15);
      }
      brightness += bombRippleLight(basePos);
      gl_FragColor = vec4(vec3(brightness), 1.0);
    }
  `,
  grid: `
    uniform float uTime;
    uniform vec2 uResolution;
    ${bombWarpShaderChunk}
    varying vec2 vUv;
    void main() {
      vec2 basePos = vUv * uResolution;
      vec2 pos = basePos + bombWarpOffset(basePos);
      float gridSize = 50.0;
      vec2 grid = abs(fract(pos / gridSize) - 0.5);
      float line = min(grid.x, grid.y);
      float alpha = smoothstep(0.0, 0.02, line);
      float intensity = (1.0 - alpha) * 0.03 + bombRippleLight(basePos);
      gl_FragColor = vec4(0.894, 1.0, 0.102, intensity);
    }
  `,
  cyber: `
    uniform float uTime;
    uniform vec2 uResolution;
    ${bombWarpShaderChunk}
    varying vec2 vUv;
    void main() {
      vec2 basePos = vUv * uResolution;
      vec2 pos = basePos + bombWarpOffset(basePos);
      float hexSize = 40.0;
      vec2 r = vec2(1.0, 1.73205);
      vec2 h = r * 0.5;
      vec2 a = mod(pos, r) - h;
      vec2 b = mod(pos - h, r) - h;
      vec2 gv = dot(a, a) < dot(b, b) ? a : b;
      float d = max(abs(gv.x), abs(gv.y));
      float hexLine = smoothstep(0.0, 2.0, abs(d - hexSize * 0.4));
      float intensity = (1.0 - hexLine) * 0.04 + bombRippleLight(basePos);
      gl_FragColor = vec4(0.0, 0.941, 1.0, intensity);
    }
  `,
  neon: `
    uniform float uTime;
    uniform vec2 uResolution;
    ${bombWarpShaderChunk}
    varying vec2 vUv;
    void main() {
      vec2 basePos = vUv * uResolution;
      vec2 pos = basePos + bombWarpOffset(basePos);
      vec2 center = uResolution * 0.5;
      float dist = length(pos - center);
      float ring = abs(sin((dist - uTime * 0.3) / 100.0 * 3.14159));
      float ringAlpha = (1.0 - smoothstep(0.0, 0.1, ring)) * 0.03;
      float angle = atan(pos.y - center.y, pos.x - center.x);
      float radialLine = abs(sin(angle * 6.0 + uTime * 0.0005));
      float radialAlpha = (1.0 - smoothstep(0.0, 0.05, radialLine)) * 0.02;
      float intensity = ringAlpha + radialAlpha + bombRippleLight(basePos);
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
    uBombCenter: { value: new THREE.Vector2(960, 540) },
    uBombPulse: { value: 0 },
  }), []);

  useFrame(({ clock, size }) => {
    const state = gameStateRef.current;
    if (!state || !materialRef.current) return;

    uniforms.uTime.value = clock.elapsedTime * 1000;
    uniforms.uResolution.value.set(size.width, size.height);
    const bombPulseAgeMs = state.bombPulseAt ? Date.now() - state.bombPulseAt : Infinity;
    if (bombPulseAgeMs <= 1900) {
      const bombPos = state.bombPulseOrigin || state.player.position;
      uniforms.uBombCenter.value.set(bombPos.x, size.height - bombPos.y);
      uniforms.uBombPulse.value = bombPulseAgeMs / 1000;
    } else {
      uniforms.uBombPulse.value = 0;
    }

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
