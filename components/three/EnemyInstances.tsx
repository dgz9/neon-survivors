'use client';

import { useRef, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { GameState, EnemyType } from '@/types/game';
import { getThreeColor, COLORS } from '@/lib/colors';

const MAX_ENEMIES = 300;
const dummyObj = new THREE.Object3D();
const tmpColor = new THREE.Color();

// Shape archetype geometries
function createShapeGeometry(type: string): THREE.BufferGeometry {
  switch (type) {
    case 'circle':
      return new THREE.CircleGeometry(1, 24);
    case 'square':
      return new THREE.PlaneGeometry(2, 2);
    case 'diamond': {
      const pts = [
        new THREE.Vector2(0, -1),
        new THREE.Vector2(0.7, 0),
        new THREE.Vector2(0, 1),
        new THREE.Vector2(-0.7, 0),
      ];
      return new THREE.ShapeGeometry(new THREE.Shape(pts));
    }
    case 'triangle': {
      const pts = [
        new THREE.Vector2(0, -1),
        new THREE.Vector2(1, 1),
        new THREE.Vector2(-1, 1),
      ];
      return new THREE.ShapeGeometry(new THREE.Shape(pts));
    }
    case 'hexagon': {
      const pts: THREE.Vector2[] = [];
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        pts.push(new THREE.Vector2(Math.cos(a), Math.sin(a)));
      }
      return new THREE.ShapeGeometry(new THREE.Shape(pts));
    }
    case 'star': {
      const pts: THREE.Vector2[] = [];
      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
        const r = i % 2 === 0 ? 1 : 0.5;
        pts.push(new THREE.Vector2(Math.cos(a) * r, Math.sin(a) * r));
      }
      return new THREE.ShapeGeometry(new THREE.Shape(pts));
    }
    case 'octagon': {
      const pts: THREE.Vector2[] = [];
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        pts.push(new THREE.Vector2(Math.cos(a), Math.sin(a)));
      }
      return new THREE.ShapeGeometry(new THREE.Shape(pts));
    }
    default:
      return new THREE.CircleGeometry(1, 24);
  }
}

const ENEMY_SHAPE_MAP: Record<EnemyType, string> = {
  chaser: 'circle',
  shooter: 'circle',
  tank: 'square',
  swarm: 'diamond',
  zigzag: 'triangle',
  splitter: 'hexagon',
  bomber: 'star',
  boss: 'octagon',
  ghost: 'circle',
  magnet: 'circle',
};

const SHAPE_TYPES = ['circle', 'square', 'diamond', 'triangle', 'hexagon', 'star', 'octagon'];

interface ShapeInstance {
  meshRef: React.RefObject<THREE.InstancedMesh>;
  geometry: THREE.BufferGeometry;
}

interface EnemyInstancesProps {
  gameStateRef: React.RefObject<GameState | null>;
}

export function EnemyInstances({ gameStateRef }: EnemyInstancesProps) {
  const meshRefs = useRef<Record<string, THREE.InstancedMesh | null>>({});
  // Health bar instances
  const healthBgRef = useRef<THREE.InstancedMesh>(null);
  const healthFillRef = useRef<THREE.InstancedMesh>(null);

  const geometries = useMemo(() => {
    const geos: Record<string, THREE.BufferGeometry> = {};
    for (const shape of SHAPE_TYPES) {
      geos[shape] = createShapeGeometry(shape);
    }
    return geos;
  }, []);

  const materials = useMemo(() => {
    const mats: Record<string, THREE.MeshBasicMaterial> = {};
    for (const shape of SHAPE_TYPES) {
      mats[shape] = new THREE.MeshBasicMaterial({
        transparent: true,
        opacity: 0.27,
        side: THREE.DoubleSide,
      });
    }
    return mats;
  }, []);

  const healthBgMaterial = useMemo(() => new THREE.MeshBasicMaterial({
    color: new THREE.Color(COLORS.dark),
  }), []);

  const healthFillMaterial = useMemo(() => new THREE.MeshBasicMaterial({
    color: new THREE.Color(COLORS.green),
  }), []);

  const healthBarGeo = useMemo(() => new THREE.PlaneGeometry(1, 4), []);

  useFrame(({ clock }) => {
    const state = gameStateRef.current;
    if (!state) return;

    // Bucket enemies by shape
    const buckets: Record<string, typeof state.enemies> = {};
    for (const shape of SHAPE_TYPES) {
      buckets[shape] = [];
    }

    for (const enemy of state.enemies) {
      const shape = ENEMY_SHAPE_MAP[enemy.type] || 'circle';
      buckets[shape].push(enemy);
    }

    let totalEnemyIdx = 0;

    for (const shape of SHAPE_TYPES) {
      const mesh = meshRefs.current[shape];
      if (!mesh) continue;

      const enemies = buckets[shape];
      mesh.count = enemies.length;

      for (let i = 0; i < enemies.length; i++) {
        const enemy = enemies[i];
        const r = enemy.radius;

        dummyObj.position.set(enemy.position.x, -enemy.position.y, 4);

        if (enemy.type === 'boss') {
          dummyObj.rotation.set(0, 0, clock.elapsedTime * 0.5);
        } else {
          dummyObj.rotation.set(0, 0, 0);
        }

        dummyObj.scale.set(r, r, 1);
        dummyObj.updateMatrix();
        mesh.setMatrixAt(i, dummyObj.matrix);

        tmpColor.set(enemy.color);
        mesh.setColorAt(i, tmpColor);

        // Health bars
        if (healthBgRef.current && healthFillRef.current) {
          const barWidth = r * 2;
          const barY = -(enemy.position.y) - r - 5;

          // Background
          dummyObj.position.set(enemy.position.x, barY, 4.1);
          dummyObj.rotation.set(0, 0, 0);
          dummyObj.scale.set(barWidth, 1, 1);
          dummyObj.updateMatrix();
          healthBgRef.current.setMatrixAt(totalEnemyIdx, dummyObj.matrix);

          // Fill
          const healthPct = Math.max(0, enemy.health / enemy.maxHealth);
          const fillWidth = barWidth * healthPct;
          const fillOffset = (barWidth - fillWidth) / 2;
          dummyObj.position.set(enemy.position.x - fillOffset, barY, 4.2);
          dummyObj.scale.set(fillWidth, 1, 1);
          dummyObj.updateMatrix();
          healthFillRef.current.setMatrixAt(totalEnemyIdx, dummyObj.matrix);

          // Health bar color
          const hpColor = healthPct > 0.5 ? COLORS.green : healthPct > 0.25 ? COLORS.yellow : COLORS.pink;
          tmpColor.set(hpColor);
          healthFillRef.current.setColorAt(totalEnemyIdx, tmpColor);

          totalEnemyIdx++;
        }
      }

      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }

    // Update health bar instance counts
    if (healthBgRef.current) {
      healthBgRef.current.count = totalEnemyIdx;
      healthBgRef.current.instanceMatrix.needsUpdate = true;
    }
    if (healthFillRef.current) {
      healthFillRef.current.count = totalEnemyIdx;
      healthFillRef.current.instanceMatrix.needsUpdate = true;
      if (healthFillRef.current.instanceColor) healthFillRef.current.instanceColor.needsUpdate = true;
    }
  });

  return (
    <>
      {SHAPE_TYPES.map((shape) => (
        <instancedMesh
          key={shape}
          ref={(el) => { meshRefs.current[shape] = el; }}
          args={[geometries[shape], materials[shape], MAX_ENEMIES]}
          frustumCulled={false}
        >
          <instancedBufferAttribute attach="instanceColor" args={[new Float32Array(MAX_ENEMIES * 3), 3]} />
        </instancedMesh>
      ))}
      {/* Health bar background */}
      <instancedMesh ref={healthBgRef} args={[healthBarGeo, healthBgMaterial, MAX_ENEMIES]} frustumCulled={false} />
      {/* Health bar fill */}
      <instancedMesh ref={healthFillRef} args={[healthBarGeo, healthFillMaterial, MAX_ENEMIES]} frustumCulled={false}>
        <instancedBufferAttribute attach="instanceColor" args={[new Float32Array(MAX_ENEMIES * 3), 3]} />
      </instancedMesh>
    </>
  );
}
