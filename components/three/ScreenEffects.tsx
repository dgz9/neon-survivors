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
  const { camera, size } = useThree();

  const flashMat = useMemo(() => new THREE.MeshBasicMaterial({
    transparent: true,
    opacity: 0,
    depthWrite: false,
  }), []);

  useFrame(() => {
    const state = gameStateRef.current;
    if (!state) return;

    // Camera shake (base position is (0,0) for R3F's centered ortho camera)
    if (camera instanceof THREE.OrthographicCamera) {
      if (state.screenShake > 0) {
        camera.position.x = (Math.random() - 0.5) * state.screenShake;
        camera.position.y = (Math.random() - 0.5) * state.screenShake;
      } else {
        camera.position.x = 0;
        camera.position.y = 0;
      }
    }

    // Screen flash
    if (flashRef.current) {
      if (state.screenFlash && Date.now() - state.screenFlash < 150) {
        const flashAlpha = 1 - (Date.now() - state.screenFlash) / 150;
        const flashColor = state.screenFlashColor || '255, 45, 106';
        const parts = flashColor.split(',').map(Number);
        flashMat.color.setRGB(parts[0] / 255, parts[1] / 255, parts[2] / 255);
        flashMat.opacity = flashAlpha * 0.3;
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
