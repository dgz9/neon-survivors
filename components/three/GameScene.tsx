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
import { PostFX } from './PostFX';

interface GameSceneProps {
  gameStateRef: React.RefObject<GameState | null>;
  playerImage: HTMLImageElement | null;
  mobileScale?: number;
}

// Offsets all children so game coords (x, -y) align with R3F's centered ortho camera
function SceneRoot({ children, mobileScale = 1 }: { children: React.ReactNode; mobileScale?: number }) {
  const groupRef = useRef<THREE.Group>(null);
  const { size, camera } = useThree();

  useFrame(() => {
    if (groupRef.current) {
      // Adjust camera zoom to show more of the world (zoomed out on mobile)
      const cam = camera as THREE.OrthographicCamera;
      cam.zoom = mobileScale;
      cam.updateProjectionMatrix();

      // Offset to map game (0,0) to the visible top-left corner
      groupRef.current.position.set(-size.width / (2 * mobileScale), size.height / (2 * mobileScale), 0);
    }
  });

  return <group ref={groupRef}>{children}</group>;
}

export function GameScene({ gameStateRef, playerImage, mobileScale = 1 }: GameSceneProps) {
  return (
    <>
      <SceneRoot mobileScale={mobileScale}>
        <ArenaBackground gameStateRef={gameStateRef} />
        <XPOrbInstances gameStateRef={gameStateRef} />
        <ParticleSystem gameStateRef={gameStateRef} />
        <EnemyInstances gameStateRef={gameStateRef} />
        <ProjectileInstances gameStateRef={gameStateRef} />
        <PlayerMesh gameStateRef={gameStateRef} playerImage={playerImage} />
        <ScreenEffects gameStateRef={gameStateRef} />
      </SceneRoot>
      <PostFX gameStateRef={gameStateRef} />
    </>
  );
}
