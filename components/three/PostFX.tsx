'use client';

import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { EffectComposer, Bloom, ChromaticAberration, Noise, Vignette } from '@react-three/postprocessing';
import * as THREE from 'three';
import { GameState } from '@/types/game';

interface PostFXProps {
  gameStateRef: React.RefObject<GameState | null>;
}

export function PostFX({ gameStateRef }: PostFXProps) {
  const bloomRef = useRef<any>(null);
  const chromaRef = useRef<any>(null);
  const noiseRef = useRef<any>(null);
  const vignetteRef = useRef<any>(null);
  const chromaOffset = useMemo(() => new THREE.Vector2(0.0005, 0.0005), []);

  useFrame(({ clock }) => {
    const state = gameStateRef.current;
    if (!state) return;

    const healthRatio = Math.max(0, Math.min(1, state.player.health / Math.max(1, state.player.maxHealth)));
    const danger = 1 - healthRatio;
    const shake = Math.max(0, Math.min(1, state.screenShake / 28));
    const momentum = Math.max(0, Math.min(1, (state.multiplier - 1) / 8));

    const flashAge = state.screenFlash ? Date.now() - state.screenFlash : 9999;
    const flash = flashAge < 120 ? 1 - flashAge / 120 : 0;

    const targetBloom = 1.2 + momentum * 0.3 + shake * 0.35 + flash * 0.28;
    const targetDarkness = 0.5 + danger * 0.28 + flash * 0.07;
    const targetNoise = 0.01 + danger * 0.02 + shake * 0.02 + flash * 0.012;
    const targetChroma = 0.0003 + shake * 0.001 + flash * 0.0008;

    if (bloomRef.current) {
      bloomRef.current.intensity = THREE.MathUtils.lerp(bloomRef.current.intensity, targetBloom, 0.12);
    }
    if (vignetteRef.current) {
      vignetteRef.current.darkness = THREE.MathUtils.lerp(vignetteRef.current.darkness, targetDarkness, 0.1);
      vignetteRef.current.offset = THREE.MathUtils.lerp(vignetteRef.current.offset, 0.18 + danger * 0.05, 0.1);
    }
    if (noiseRef.current?.blendMode?.opacity?.value !== undefined) {
      const currentOpacity = noiseRef.current.blendMode.opacity.value as number;
      noiseRef.current.blendMode.opacity.value = THREE.MathUtils.lerp(currentOpacity, targetNoise, 0.1);
    }
    if (chromaRef.current?.offset) {
      const t = clock.elapsedTime * 1.7;
      chromaOffset.set(
        targetChroma * (1 + Math.sin(t) * 0.15),
        targetChroma * (1 + Math.cos(t * 1.13) * 0.15)
      );
      chromaRef.current.offset.copy(chromaOffset);
    }
  });

  return (
    <EffectComposer multisampling={0}>
      <Bloom ref={bloomRef} luminanceThreshold={0.28} luminanceSmoothing={0.85} intensity={1.2} mipmapBlur />
      <ChromaticAberration ref={chromaRef} offset={chromaOffset} radialModulation={false} modulationOffset={0} />
      <Noise ref={noiseRef} opacity={0.0125} />
      <Vignette ref={vignetteRef} eskil={false} offset={0.2} darkness={0.5} />
    </EffectComposer>
  );
}
