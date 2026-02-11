'use client';

import { useRef, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { GameState } from '@/types/game';
import { COLORS } from '@/lib/colors';

const MAX_ORBS = 200;
const dummyObj = new THREE.Object3D();

interface XPOrbInstancesProps {
  gameStateRef: React.RefObject<GameState | null>;
}

export function XPOrbInstances({ gameStateRef }: XPOrbInstancesProps) {
  const diamondRef = useRef<THREE.InstancedMesh>(null);
  const dotRef = useRef<THREE.InstancedMesh>(null);

  const diamondGeo = useMemo(() => {
    const pts = [
      new THREE.Vector2(0, -1),
      new THREE.Vector2(0.7, 0),
      new THREE.Vector2(0, 1),
      new THREE.Vector2(-0.7, 0),
    ];
    return new THREE.ShapeGeometry(new THREE.Shape(pts));
  }, []);

  const dotGeo = useMemo(() => new THREE.CircleGeometry(2, 8), []);

  const diamondMat = useMemo(() => new THREE.MeshBasicMaterial({
    color: new THREE.Color(COLORS.green),
    transparent: true,
    opacity: 0.9,
  }), []);

  const dotMat = useMemo(() => new THREE.MeshBasicMaterial({
    color: new THREE.Color(COLORS.white),
    transparent: true,
    opacity: 0.7,
  }), []);

  useFrame(({ clock }) => {
    const state = gameStateRef.current;
    if (!state) return;

    const count = state.experienceOrbCount ?? state.experienceOrbs.length;
    const time = clock.elapsedTime * 1000;

    for (let i = 0; i < count; i++) {
      const orb = state.experienceOrbs[i];
      const pulse = 1 + Math.sin(time * 0.008 + orb.position.x * 0.1) * 0.3;
      const size = 6 * pulse;

      dummyObj.position.set(orb.position.x, -orb.position.y, 1);
      dummyObj.rotation.set(0, 0, 0);
      dummyObj.scale.set(size, size, 1);
      dummyObj.updateMatrix();

      if (diamondRef.current) {
        diamondRef.current.setMatrixAt(i, dummyObj.matrix);
      }
      if (dotRef.current) {
        dummyObj.scale.set(1, 1, 1);
        dummyObj.updateMatrix();
        dotRef.current.setMatrixAt(i, dummyObj.matrix);
      }
    }

    if (diamondRef.current) {
      diamondRef.current.count = count;
      diamondRef.current.instanceMatrix.needsUpdate = true;
    }
    if (dotRef.current) {
      dotRef.current.count = count;
      dotRef.current.instanceMatrix.needsUpdate = true;
    }
  });

  return (
    <>
      <instancedMesh ref={diamondRef} args={[diamondGeo, diamondMat, MAX_ORBS]} frustumCulled={false} />
      <instancedMesh ref={dotRef} args={[dotGeo, dotMat, MAX_ORBS]} frustumCulled={false} />
    </>
  );
}
