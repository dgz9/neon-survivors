'use client';

import { useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { GameState } from '@/types/game';
import { ViewTransform } from '@/lib/viewport';
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
  viewRef: React.RefObject<ViewTransform>;
}

/** Zooms and centres the world so game coords (x, -y) line up with R3F's centred ortho camera. */
export function SceneRoot({
  children,
  viewRef,
}: {
  children: React.ReactNode;
  viewRef: React.RefObject<ViewTransform>;
}) {
  const groupRef = useRef<THREE.Group>(null);
  const { camera } = useThree();

  useFrame(() => {
    const view = viewRef.current;
    if (!groupRef.current || !view) return;

    const cam = camera as THREE.OrthographicCamera;
    if (cam.zoom !== view.scale) {
      cam.zoom = view.scale;
      cam.updateProjectionMatrix();
    }

    // The camera looks at the middle of the canvas, so putting the world's
    // top-left corner half a world away from the origin centres it — and
    // letterboxes it when the world and the canvas have different shapes.
    groupRef.current.position.set(-view.worldWidth / 2, view.worldHeight / 2, 0);
  });

  return <group ref={groupRef}>{children}</group>;
}

export function GameScene({ gameStateRef, playerImage, viewRef }: GameSceneProps) {
  return (
    <>
      <SceneRoot viewRef={viewRef}>
        <ArenaBackground gameStateRef={gameStateRef} viewRef={viewRef} />
        <XPOrbInstances gameStateRef={gameStateRef} />
        <ParticleSystem gameStateRef={gameStateRef} />
        <EnemyInstances gameStateRef={gameStateRef} />
        <ProjectileInstances gameStateRef={gameStateRef} />
        <PlayerMesh gameStateRef={gameStateRef} playerImage={playerImage} />
        <ScreenEffects gameStateRef={gameStateRef} viewRef={viewRef} />
      </SceneRoot>
      <PostFX gameStateRef={gameStateRef} />
    </>
  );
}
