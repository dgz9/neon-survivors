'use client';

import { useRef, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { GameState } from '@/types/game';

const MAX_PROJECTILES = 300;
const dummyObj = new THREE.Object3D();
const tmpColor = new THREE.Color();

interface ProjectileInstancesProps {
  gameStateRef: React.RefObject<GameState | null>;
}

export function ProjectileInstances({ gameStateRef }: ProjectileInstancesProps) {
  const linearRef = useRef<THREE.InstancedMesh>(null);
  const coreRef = useRef<THREE.InstancedMesh>(null);
  const orbitRef = useRef<THREE.InstancedMesh>(null);

  const ellipseGeo = useMemo(() => {
    // Elongated ellipse for linear projectiles
    const shape = new THREE.Shape();
    shape.ellipse(0, 0, 8, 2, 0, Math.PI * 2, false, 0);
    return new THREE.ShapeGeometry(shape);
  }, []);

  const coreGeo = useMemo(() => {
    const shape = new THREE.Shape();
    shape.ellipse(0, 0, 4, 1, 0, Math.PI * 2, false, 0);
    return new THREE.ShapeGeometry(shape);
  }, []);

  const orbitGeo = useMemo(() => new THREE.CircleGeometry(6, 16), []);

  const linearMat = useMemo(() => new THREE.MeshBasicMaterial({ transparent: true }), []);
  const coreMat = useMemo(() => new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.8 }), []);
  const orbitMat = useMemo(() => new THREE.MeshBasicMaterial({ transparent: true }), []);

  useFrame(() => {
    const state = gameStateRef.current;
    if (!state) return;

    let linearCount = 0;
    let orbitCount = 0;
    const count = state.projectileCount ?? state.projectiles.length;

    for (let i = 0; i < count; i++) {
      const proj = state.projectiles[i];

      if (proj.orbit) {
        // Orbit projectile
        if (orbitRef.current) {
          dummyObj.position.set(proj.position.x, -proj.position.y, 5);
          dummyObj.rotation.set(0, 0, 0);
          dummyObj.scale.set(1, 1, 1);
          dummyObj.updateMatrix();
          orbitRef.current.setMatrixAt(orbitCount, dummyObj.matrix);
          tmpColor.set(proj.color);
          orbitRef.current.setColorAt(orbitCount, tmpColor);
          orbitCount++;
        }
      } else {
        // Linear projectile
        if (linearRef.current && coreRef.current) {
          const angle = Math.atan2(proj.velocity.y, proj.velocity.x);
          dummyObj.position.set(proj.position.x, -proj.position.y, 5);
          dummyObj.rotation.set(0, 0, -angle);
          dummyObj.scale.set(1, 1, 1);
          dummyObj.updateMatrix();
          linearRef.current.setMatrixAt(linearCount, dummyObj.matrix);
          coreRef.current.setMatrixAt(linearCount, dummyObj.matrix);

          tmpColor.set(proj.color);
          linearRef.current.setColorAt(linearCount, tmpColor);
          linearCount++;
        }
      }
    }

    if (linearRef.current) {
      linearRef.current.count = linearCount;
      linearRef.current.instanceMatrix.needsUpdate = true;
      if (linearRef.current.instanceColor) linearRef.current.instanceColor.needsUpdate = true;
    }
    if (coreRef.current) {
      coreRef.current.count = linearCount;
      coreRef.current.instanceMatrix.needsUpdate = true;
    }
    if (orbitRef.current) {
      orbitRef.current.count = orbitCount;
      orbitRef.current.instanceMatrix.needsUpdate = true;
      if (orbitRef.current.instanceColor) orbitRef.current.instanceColor.needsUpdate = true;
    }
  });

  return (
    <>
      <instancedMesh ref={linearRef} args={[ellipseGeo, linearMat, MAX_PROJECTILES]} frustumCulled={false}>
        <instancedBufferAttribute attach="instanceColor" args={[new Float32Array(MAX_PROJECTILES * 3), 3]} />
      </instancedMesh>
      <instancedMesh ref={coreRef} args={[coreGeo, coreMat, MAX_PROJECTILES]} frustumCulled={false} />
      <instancedMesh ref={orbitRef} args={[orbitGeo, orbitMat, MAX_PROJECTILES]} frustumCulled={false}>
        <instancedBufferAttribute attach="instanceColor" args={[new Float32Array(MAX_PROJECTILES * 3), 3]} />
      </instancedMesh>
    </>
  );
}
