'use client';

import { useRef, useMemo } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { GameState } from '@/types/game';

interface ScreenEffectsProps {
  gameStateRef: React.RefObject<GameState | null>;
}

export function ScreenEffects({ gameStateRef }: ScreenEffectsProps) {
  const flashRef = useRef<THREE.Mesh>(null);
  const shakeTimeRef = useRef(0);
  const shakeOffsetRef = useRef(new THREE.Vector2(0, 0));
  const rollRef = useRef(0);
  const { camera, size } = useThree();

  const flashMat = useMemo(() => new THREE.MeshBasicMaterial({
    transparent: true,
    opacity: 0,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  }), []);

  useFrame((_, delta) => {
    const state = gameStateRef.current;
    if (!state) return;
    const now = Date.now();

    // Smooth camera shake with damping and coherent noise.
    if (camera instanceof THREE.OrthographicCamera) {
      if (state.screenShake > 0) {
        shakeTimeRef.current += delta * (22 + state.screenShake * 0.2);
        const t = shakeTimeRef.current;
        const amplitude = Math.min(34, state.screenShake * 0.85);
        const targetX = (Math.sin(t * 2.17) + Math.sin(t * 3.31) * 0.55) * amplitude;
        const targetY = (Math.cos(t * 2.53) + Math.cos(t * 3.73) * 0.55) * amplitude;

        shakeOffsetRef.current.x += (targetX - shakeOffsetRef.current.x) * 0.34;
        shakeOffsetRef.current.y += (targetY - shakeOffsetRef.current.y) * 0.34;

        // A touch of camera roll turns a translation wobble into a real jolt.
        const targetRoll = Math.sin(t * 1.61) * Math.min(0.02, state.screenShake * 0.0007);
        rollRef.current += (targetRoll - rollRef.current) * 0.25;
      } else {
        shakeOffsetRef.current.x += (0 - shakeOffsetRef.current.x) * 0.18;
        shakeOffsetRef.current.y += (0 - shakeOffsetRef.current.y) * 0.18;
        rollRef.current += (0 - rollRef.current) * 0.16;
      }

      camera.position.x = shakeOffsetRef.current.x;
      camera.position.y = shakeOffsetRef.current.y;
      camera.rotation.z = rollRef.current;
    }

    // Screen flash — additive so it reads as a blast of light rather than fog.
    if (flashRef.current) {
      const FLASH_MS = 150;
      if (state.screenFlash && now - state.screenFlash < FLASH_MS) {
        const age = (now - state.screenFlash) / FLASH_MS;
        // Fast attack, exponential release.
        const flashAlpha = Math.pow(1 - age, 2.2);
        const flashColor = state.screenFlashColor || '255, 45, 106';
        const parts = flashColor.split(',').map(Number);
        flashMat.color.setRGB(parts[0] / 255, parts[1] / 255, parts[2] / 255);
        flashMat.opacity = flashAlpha * 0.3;
        flashRef.current.visible = true;
        flashRef.current.position.set(size.width / 2, -size.height / 2, 8);
        // Oversized so camera shake can never expose an unpainted edge.
        flashRef.current.scale.set(size.width * 2, size.height * 2, 1);
      } else {
        flashRef.current.visible = false;
      }
    }
  });

  return (
    <mesh ref={flashRef} visible={false}>
      <planeGeometry args={[1, 1]} />
      <primitive object={flashMat} attach="material" />
    </mesh>
  );
}
