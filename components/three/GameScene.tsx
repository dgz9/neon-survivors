'use client';

import { useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { GameState } from '@/types/game';
import { PlayerMesh } from './PlayerMesh';
import { EnemyInstances } from './EnemyInstances';
import { ProjectileInstances } from './ProjectileInstances';
import { XPOrbInstances } from './XPOrbInstances';
import { ParticleSystem } from './ParticleSystem';
import { ArenaBackground } from './ArenaBackground';
import { ScreenEffects } from './ScreenEffects';
import { EffectComposer, Bloom } from '@react-three/postprocessing';

interface GameSceneProps {
  gameStateRef: React.RefObject<GameState | null>;
  playerImage: HTMLImageElement | null;
}

// Offsets all children so game coords (x, -y) align with R3F's centered ortho camera
function SceneRoot({ children }: { children: React.ReactNode }) {
  const groupRef = useRef<THREE.Group>(null);
  const { size } = useThree();

  useFrame(() => {
    if (groupRef.current) {
      groupRef.current.position.set(-size.width / 2, size.height / 2, 0);
    }
  });

  return <group ref={groupRef}>{children}</group>;
}

export function GameScene({ gameStateRef, playerImage }: GameSceneProps) {
  return (
    <>
      <SceneRoot>
        <ArenaBackground gameStateRef={gameStateRef} />
        <XPOrbInstances gameStateRef={gameStateRef} />
        <ParticleSystem gameStateRef={gameStateRef} />
        <EnemyInstances gameStateRef={gameStateRef} />
        <ProjectileInstances gameStateRef={gameStateRef} />
        <PlayerMesh gameStateRef={gameStateRef} playerImage={playerImage} />
        <ScreenEffects gameStateRef={gameStateRef} />
      </SceneRoot>
      <EffectComposer>
        <Bloom
          luminanceThreshold={0.3}
          luminanceSmoothing={0.9}
          intensity={1.5}
          mipmapBlur
        />
      </EffectComposer>
    </>
  );
}
