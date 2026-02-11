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
  const { camera, size } = useThree();

  const flashMat = useMemo(() => new THREE.MeshBasicMaterial({
    transparent: true,
    opacity: 0,
    depthWrite: false,
  }), []);

  useFrame((_, delta) => {
    const state = gameStateRef.current;
    if (!state) return;
    const now = Date.now();

    // Smooth camera shake with damping and coherent noise.
    if (camera instanceof THREE.OrthographicCamera) {
      if (state.screenShake > 0) {
        shakeTimeRef.current += delta * (18 + state.screenShake * 0.15);
        const t = shakeTimeRef.current;
        const amplitude = Math.min(24, state.screenShake * 0.65);
        const targetX = (Math.sin(t * 2.17) + Math.sin(t * 3.31) * 0.55) * amplitude;
        const targetY = (Math.cos(t * 2.53) + Math.cos(t * 3.73) * 0.55) * amplitude;

        shakeOffsetRef.current.x += (targetX - shakeOffsetRef.current.x) * 0.24;
        shakeOffsetRef.current.y += (targetY - shakeOffsetRef.current.y) * 0.24;
      } else {
        shakeOffsetRef.current.x += (0 - shakeOffsetRef.current.x) * 0.16;
        shakeOffsetRef.current.y += (0 - shakeOffsetRef.current.y) * 0.16;
      }

      camera.position.x = shakeOffsetRef.current.x;
      camera.position.y = shakeOffsetRef.current.y;
    }

    // Screen flash
    if (flashRef.current) {
      if (state.screenFlash && now - state.screenFlash < 110) {
        const flashAlpha = 1 - (now - state.screenFlash) / 110;
        const flashColor = state.screenFlashColor || '255, 45, 106';
        const parts = flashColor.split(',').map(Number);
        flashMat.color.setRGB(parts[0] / 255, parts[1] / 255, parts[2] / 255);
        flashMat.opacity = flashAlpha * 0.17;
        flashRef.current.visible = true;
        flashRef.current.position.set(size.width / 2, -size.height / 2, 8);
        flashRef.current.scale.set(size.width, size.height, 1);
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
