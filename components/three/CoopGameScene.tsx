'use client';

import { useRef, useMemo } from 'react';
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

interface LocalPredictedProjectile {
  id: string;
  position: { x: number; y: number };
  velocity: { x: number; y: number };
  radius: number;
  color: string;
  lifeMs: number;
  maxLifeMs: number;
}

interface CoopGameSceneProps {
  gameStateRef: React.RefObject<GameState | null>;
  playerImage: HTMLImageElement | null;
  player2Image: HTMLImageElement | null;
  localPredictedProjectilesRef: React.RefObject<LocalPredictedProjectile[]>;
  isHost: boolean;
}

const MAX_PREDICTED = 50;
const dummyObj = new THREE.Object3D();
const tmpColor = new THREE.Color();

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

function LocalPredictedProjectiles({
  projectilesRef,
}: {
  projectilesRef: React.RefObject<LocalPredictedProjectile[]>;
}) {
  const meshRef = useRef<THREE.InstancedMesh>(null);

  const geometry = useMemo(() => new THREE.CircleGeometry(1, 16), []);

  const material = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    []
  );

  useFrame(() => {
    const mesh = meshRef.current;
    const projectiles = projectilesRef.current;
    if (!mesh || !projectiles) return;

    const count = Math.min(projectiles.length, MAX_PREDICTED);

    for (let i = 0; i < count; i++) {
      const p = projectiles[i];

      dummyObj.position.set(p.position.x, -p.position.y, 5.5);
      dummyObj.rotation.set(0, 0, 0);
      dummyObj.scale.set(p.radius, p.radius, 1);
      dummyObj.updateMatrix();
      mesh.setMatrixAt(i, dummyObj.matrix);

      tmpColor.set(p.color);
      mesh.setColorAt(i, tmpColor);
    }

    mesh.count = count;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;

    material.opacity = count > 0 ? 0.9 : 0;
  });

  return (
    <instancedMesh
      ref={meshRef}
      args={[geometry, material, MAX_PREDICTED]}
      frustumCulled={false}
    >
      <instancedBufferAttribute
        attach="instanceColor"
        args={[new Float32Array(MAX_PREDICTED * 3), 3]}
      />
    </instancedMesh>
  );
}

export function CoopGameScene({
  gameStateRef,
  playerImage,
  player2Image,
  localPredictedProjectilesRef,
  isHost,
}: CoopGameSceneProps) {
  return (
    <>
      <SceneRoot>
        <ArenaBackground gameStateRef={gameStateRef} />
        <XPOrbInstances gameStateRef={gameStateRef} />
        <ParticleSystem gameStateRef={gameStateRef} />
        <EnemyInstances gameStateRef={gameStateRef} />
        <ProjectileInstances gameStateRef={gameStateRef} />
        <PlayerMesh gameStateRef={gameStateRef} playerImage={playerImage} />
        <PlayerMesh
          gameStateRef={gameStateRef}
          playerImage={player2Image}
          isP2
          p2Color="#ff2d6a"
        />
        {!isHost && (
          <LocalPredictedProjectiles
            projectilesRef={localPredictedProjectilesRef}
          />
        )}
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
