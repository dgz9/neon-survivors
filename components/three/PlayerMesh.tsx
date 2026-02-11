'use client';

import { useRef, useMemo, useEffect } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { GameState } from '@/types/game';
import { getThreeColor } from '@/lib/colors';

interface PlayerMeshProps {
  gameStateRef: React.RefObject<GameState | null>;
  playerImage: HTMLImageElement | null;
  isP2?: boolean;
  p2Color?: string;
}

function createOctagonGeometry(radius: number): THREE.BufferGeometry {
  const sides = 8;
  const vertices: number[] = [0, 0, 0]; // center
  const uvs: number[] = [0.5, 0.5]; // center UV
  for (let i = 0; i < sides; i++) {
    const angle = (i / sides) * Math.PI * 2 - Math.PI / 2;
    const cx = Math.cos(angle);
    const cy = Math.sin(angle);
    vertices.push(cx * radius, cy * radius, 0);
    uvs.push(0.5 + cx * 0.5, 0.5 + cy * 0.5);
  }
  const indices: number[] = [];
  for (let i = 1; i <= sides; i++) {
    indices.push(0, i, i === sides ? 1 : i + 1);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  return geo;
}

function createOctagonLineGeometry(radius: number): THREE.BufferGeometry {
  const sides = 8;
  const points: THREE.Vector3[] = [];
  for (let i = 0; i <= sides; i++) {
    const angle = (i % sides / sides) * Math.PI * 2 - Math.PI / 2;
    points.push(new THREE.Vector3(Math.cos(angle) * radius, Math.sin(angle) * radius, 0));
  }
  return new THREE.BufferGeometry().setFromPoints(points);
}

export function PlayerMesh({ gameStateRef, playerImage, isP2, p2Color }: PlayerMeshProps) {
  const groupRef = useRef<THREE.Group>(null);
  const fillRef = useRef<THREE.Mesh>(null);
  const lineRef = useRef<THREE.LineLoop>(null);
  const textureRef = useRef<THREE.Texture | null>(null);

  const radius = 24;
  const fillGeo = useMemo(() => createOctagonGeometry(radius - 3), []);
  const lineGeo = useMemo(() => createOctagonLineGeometry(radius), []);

  // Create texture from image
  useEffect(() => {
    if (playerImage && !isP2) {
      const tex = new THREE.Texture(playerImage);
      tex.needsUpdate = true;
      textureRef.current = tex;
    }
    return () => {
      textureRef.current?.dispose();
    };
  }, [playerImage, isP2]);

  const fillMaterial = useMemo(() => {
    const color = isP2 ? (p2Color || '#ff2d6a') : '#00f0ff';
    return new THREE.MeshBasicMaterial({
      color: new THREE.Color(color),
      transparent: true,
      opacity: 0.27,
    });
  }, [isP2, p2Color]);

  // Apply image texture when available
  useEffect(() => {
    if (textureRef.current && fillMaterial) {
      fillMaterial.map = textureRef.current;
      fillMaterial.opacity = 1;
      fillMaterial.color.set('#ffffff');
      fillMaterial.needsUpdate = true;
    }
  }, [playerImage, fillMaterial]);

  const lineMaterial = useMemo(() => {
    const color = isP2 ? (p2Color || '#ff2d6a') : '#00f0ff';
    return new THREE.LineBasicMaterial({ color: new THREE.Color(color), linewidth: 3 });
  }, [isP2, p2Color]);

  useFrame(({ clock }) => {
    const state = gameStateRef.current;
    if (!state || !groupRef.current) return;

    const player = isP2 ? (state as any).player2 : state.player;
    if (!player) {
      groupRef.current.visible = false;
      return;
    }

    groupRef.current.visible = true;

    // Invulnerability flash
    const isInvulnerable = Date.now() < player.invulnerableUntil;
    if (isInvulnerable) {
      groupRef.current.visible = Math.floor(clock.elapsedTime * 10) % 2 === 0;
    }

    groupRef.current.position.set(player.position.x, -player.position.y, 6);
  });

  return (
    <group ref={groupRef}>
      <mesh ref={fillRef} geometry={fillGeo} material={fillMaterial} />
      <lineLoop ref={lineRef} geometry={lineGeo} material={lineMaterial} />
    </group>
  );
}
