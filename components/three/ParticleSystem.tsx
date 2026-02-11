'use client';

import { useRef, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { GameState } from '@/types/game';

const MAX_PARTICLES = 1200;

interface ParticleSystemProps {
  gameStateRef: React.RefObject<GameState | null>;
}

export function ParticleSystem({ gameStateRef }: ParticleSystemProps) {
  const pointsRef = useRef<THREE.Points>(null);
  const pointsMatRef = useRef<THREE.ShaderMaterial>(null);
  const trailRef = useRef<THREE.InstancedMesh>(null);
  const ringRef = useRef<THREE.InstancedMesh>(null);

  const dummyObj = useMemo(() => new THREE.Object3D(), []);
  const tmpColor = useMemo(() => new THREE.Color(), []);

  // Points geometry for spark/explosion particles
  const pointsGeo = useMemo(() => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(MAX_PARTICLES * 3), 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(MAX_PARTICLES * 3), 3));
    geo.setAttribute('size', new THREE.Float32BufferAttribute(new Float32Array(MAX_PARTICLES), 1));
    geo.setAttribute('alpha', new THREE.Float32BufferAttribute(new Float32Array(MAX_PARTICLES), 1));
    return geo;
  }, []);

  const pointsMat = useMemo(() => new THREE.ShaderMaterial({
    uniforms: {
      uPixelRatio: { value: Math.min(window.devicePixelRatio || 1, 2) },
    },
    vertexShader: `
      attribute float size;
      attribute float alpha;
      varying vec3 vColor;
      varying float vAlpha;

      void main() {
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        gl_PointSize = max(1.0, size * (1.6 + alpha * 1.5) * uPixelRatio);
        vColor = color;
        vAlpha = alpha;
      }
    `,
    fragmentShader: `
      varying vec3 vColor;
      varying float vAlpha;

      void main() {
        vec2 uv = gl_PointCoord * 2.0 - 1.0;
        float dist = dot(uv, uv);
        if (dist > 1.0) discard;

        float core = 1.0 - smoothstep(0.0, 0.45, dist);
        float glow = 1.0 - smoothstep(0.2, 1.0, dist);
        vec3 tint = mix(vColor, vec3(1.0), core * 0.6);
        float alpha = (glow * 0.7 + core * 0.8) * vAlpha;
        gl_FragColor = vec4(tint * alpha, alpha);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexColors: true,
  }), []);

  // Trail: thin quads
  const trailGeo = useMemo(() => new THREE.PlaneGeometry(1, 0.3), []);
  const trailMat = useMemo(() => new THREE.MeshBasicMaterial({
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  }), []);

  // Ring: ring geometry
  const ringGeo = useMemo(() => new THREE.RingGeometry(0.8, 1, 32), []);
  const ringMat = useMemo(() => new THREE.MeshBasicMaterial({
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  }), []);

  useFrame(() => {
    const state = gameStateRef.current;
    if (!state) return;

    const pCount = state.particleCount ?? state.particles.length;
    const positions = pointsGeo.attributes.position as THREE.BufferAttribute;
    const colors = pointsGeo.attributes.color as THREE.BufferAttribute;
    const sizes = pointsGeo.attributes.size as THREE.BufferAttribute;
    const alphas = pointsGeo.attributes.alpha as THREE.BufferAttribute;

    let sparkIdx = 0;
    let trailIdx = 0;
    let ringIdx = 0;

    for (let i = 0; i < pCount; i++) {
      const p = state.particles[i];
      const alpha = Math.max(0, p.life / p.maxLife);

      if (p.type === 'text') continue; // Handled by HTML overlay

      if (p.type === 'ring') {
        if (ringRef.current) {
          const ringRadius = Math.max(0.1, p.size * (1 - alpha) * 3);
          dummyObj.position.set(p.position.x, -p.position.y, 3);
          dummyObj.rotation.set(0, 0, 0);
          dummyObj.scale.set(ringRadius, ringRadius, 1);
          dummyObj.updateMatrix();
          ringRef.current.setMatrixAt(ringIdx, dummyObj.matrix);
          tmpColor.set(p.color).multiplyScalar(0.2 + alpha * 0.8);
          ringRef.current.setColorAt(ringIdx, tmpColor);
          ringIdx++;
        }
      } else if (p.type === 'trail') {
        if (trailRef.current) {
          const angle = Math.atan2(p.velocity.y, p.velocity.x);
          const len = p.size * alpha * 2;
          dummyObj.position.set(p.position.x, -p.position.y, 3);
          dummyObj.rotation.set(0, 0, -angle);
          dummyObj.scale.set(len, p.size * alpha * 0.5, 1);
          dummyObj.updateMatrix();
          trailRef.current.setMatrixAt(trailIdx, dummyObj.matrix);
          tmpColor.set(p.color).multiplyScalar(0.2 + alpha * 0.8);
          trailRef.current.setColorAt(trailIdx, tmpColor);
          trailIdx++;
        }
      } else {
        // spark or explosion -> point particle
        positions.setXYZ(sparkIdx, p.position.x, -p.position.y, 3);
        tmpColor.set(p.color);
        colors.setXYZ(sparkIdx, tmpColor.r, tmpColor.g, tmpColor.b);
        sizes.setX(sparkIdx, Math.max(0.6, p.size * 0.5));
        alphas.setX(sparkIdx, alpha);
        sparkIdx++;
      }
    }

    // Update points draw range
    pointsGeo.setDrawRange(0, sparkIdx);
    positions.needsUpdate = true;
    colors.needsUpdate = true;
    sizes.needsUpdate = true;
    alphas.needsUpdate = true;

    // Update trails
    if (trailRef.current) {
      trailRef.current.count = trailIdx;
      trailRef.current.instanceMatrix.needsUpdate = true;
      if (trailRef.current.instanceColor) trailRef.current.instanceColor.needsUpdate = true;
    }

    // Update rings
    if (ringRef.current) {
      ringRef.current.count = ringIdx;
      ringRef.current.instanceMatrix.needsUpdate = true;
      if (ringRef.current.instanceColor) ringRef.current.instanceColor.needsUpdate = true;
    }
  });

  return (
    <>
      <points ref={pointsRef} geometry={pointsGeo} frustumCulled={false}>
        <primitive ref={pointsMatRef} object={pointsMat} attach="material" />
      </points>
      <instancedMesh ref={trailRef} args={[trailGeo, trailMat, MAX_PARTICLES]} frustumCulled={false}>
        <instancedBufferAttribute attach="instanceColor" args={[new Float32Array(MAX_PARTICLES * 3), 3]} />
      </instancedMesh>
      <instancedMesh ref={ringRef} args={[ringGeo, ringMat, MAX_PARTICLES]} frustumCulled={false}>
        <instancedBufferAttribute attach="instanceColor" args={[new Float32Array(MAX_PARTICLES * 3), 3]} />
      </instancedMesh>
    </>
  );
}
