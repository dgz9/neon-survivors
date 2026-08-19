'use client';

import { useRef, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { GameState } from '@/types/game';

const MAX_PARTICLES = 2000;
const MAX_RINGS = 400;
const MAX_FLASHES = 400;
const MAX_TRAILS = 600;

interface ParticleSystemProps {
  gameStateRef: React.RefObject<GameState | null>;
}

/**
 * Quad geometry carrying its own per-instance colour attribute.
 *
 * We use a custom `aColor` attribute rather than three's built-in
 * `instanceColor` so the shader can declare it unconditionally — the built-in
 * is only injected when three decides the object has instance colours, which
 * is fragile with hand-written ShaderMaterials.
 */
function createInstancedQuad(maxInstances: number) {
  const geo = new THREE.PlaneGeometry(1, 1);
  const colors = new THREE.InstancedBufferAttribute(new Float32Array(maxInstances * 3), 3);
  colors.setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('aColor', colors);
  return { geo, colors };
}

const QUAD_VERTEX_SHADER = `
  attribute vec3 aColor;
  varying vec2 vUv;
  varying vec3 vTint;
  void main() {
    vUv = uv;
    vTint = aColor;
    gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
  }
`;

export function ParticleSystem({ gameStateRef }: ParticleSystemProps) {
  const pointsRef = useRef<THREE.Points>(null);
  const trailRef = useRef<THREE.InstancedMesh>(null);
  const ringRef = useRef<THREE.InstancedMesh>(null);
  const flashRef = useRef<THREE.InstancedMesh>(null);

  const dummyObj = useMemo(() => new THREE.Object3D(), []);
  const tmpColor = useMemo(() => new THREE.Color(), []);

  // --- Points: sparks, explosion debris, embers -----------------------------
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
      uniform float uPixelRatio;
      varying vec3 vColor;
      varying float vAlpha;

      void main() {
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        // Size already encodes the life curve; alpha only adds extra bloom
        // while the particle is still hot.
        gl_PointSize = max(1.0, size * (2.2 + alpha * 1.4) * uPixelRatio);
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

        // Tight white-hot core inside a soft additive halo.
        float core = 1.0 - smoothstep(0.0, 0.28, dist);
        float glow = 1.0 - smoothstep(0.0, 1.0, sqrt(dist));
        vec3 tint = mix(vColor, vec3(1.0), core * 0.85);
        float a = (glow * glow * 0.85 + core) * vAlpha;
        gl_FragColor = vec4(tint * a, a);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexColors: true,
  }), []);

  // --- Trails: tapered streaks ----------------------------------------------
  const trail = useMemo(() => createInstancedQuad(MAX_TRAILS), []);
  const trailMat = useMemo(() => new THREE.ShaderMaterial({
    vertexShader: QUAD_VERTEX_SHADER,
    fragmentShader: `
      varying vec2 vUv;
      varying vec3 vTint;
      void main() {
        // Taper toward the tail and feather the long edges.
        float along = 1.0 - vUv.x;
        float across = 1.0 - abs(vUv.y - 0.5) * 2.0;
        float a = pow(along, 1.5) * pow(across, 1.2);
        gl_FragColor = vec4(vTint * a, a);
      }
    `,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  }), []);

  // --- Rings / shockwaves: soft-edged pressure waves ------------------------
  const ring = useMemo(() => createInstancedQuad(MAX_RINGS), []);
  const ringMat = useMemo(() => new THREE.ShaderMaterial({
    vertexShader: QUAD_VERTEX_SHADER,
    fragmentShader: `
      varying vec2 vUv;
      varying vec3 vTint;
      void main() {
        float d = length(vUv - 0.5) * 2.0;
        if (d > 1.0) discard;
        // Bright band at the leading edge, faint fill behind it.
        float band = smoothstep(0.62, 0.94, d) * (1.0 - smoothstep(0.94, 1.0, d));
        float inner = (1.0 - smoothstep(0.0, 0.94, d)) * 0.12;
        float a = band + inner;
        vec3 tint = mix(vTint, vec3(1.0), band * 0.45);
        gl_FragColor = vec4(tint * a, a);
      }
    `,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  }), []);

  // --- Flashes: lens-flare cores for muzzles, impacts, kills ----------------
  const flash = useMemo(() => createInstancedQuad(MAX_FLASHES), []);
  const flashMat = useMemo(() => new THREE.ShaderMaterial({
    vertexShader: QUAD_VERTEX_SHADER,
    fragmentShader: `
      varying vec2 vUv;
      varying vec3 vTint;
      void main() {
        vec2 p = (vUv - 0.5) * 2.0;
        float d = length(p);
        if (d > 1.0) discard;
        float core = pow(1.0 - d, 2.5);
        // Horizontal/vertical streaks give it an anamorphic read.
        float streak = pow(max(0.0, 1.0 - abs(p.y) * 9.0), 2.0) * (1.0 - d)
                     + pow(max(0.0, 1.0 - abs(p.x) * 9.0), 2.0) * (1.0 - d);
        float a = core + streak * 0.55;
        gl_FragColor = vec4(mix(vTint, vec3(1.0), 0.6) * a, a);
      }
    `,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  }), []);

  useFrame(() => {
    const state = gameStateRef.current;
    if (!state) return;

    const pCount = Math.min(state.particleCount ?? state.particles.length, MAX_PARTICLES);
    const positions = pointsGeo.attributes.position as THREE.BufferAttribute;
    const colors = pointsGeo.attributes.color as THREE.BufferAttribute;
    const sizes = pointsGeo.attributes.size as THREE.BufferAttribute;
    const alphas = pointsGeo.attributes.alpha as THREE.BufferAttribute;

    let sparkIdx = 0;
    let trailIdx = 0;
    let ringIdx = 0;
    let flashIdx = 0;

    for (let i = 0; i < pCount; i++) {
      const p = state.particles[i];
      if (p.type === 'text') continue; // Handled by the HTML overlay

      const t = Math.max(0, Math.min(1, p.life / p.maxLife));
      const alpha = p.fade === 1 ? t : Math.pow(t, p.fade);
      const glow = p.glow || 1;

      if (p.type === 'ring' || p.type === 'shockwave') {
        if (ringIdx < MAX_RINGS) {
          const d = Math.max(0.1, p.size * 2);
          dummyObj.position.set(p.position.x, -p.position.y, 3);
          dummyObj.rotation.set(0, 0, 0);
          dummyObj.scale.set(d, d, 1);
          dummyObj.updateMatrix();
          ringRef.current?.setMatrixAt(ringIdx, dummyObj.matrix);
          tmpColor.set(p.color).multiplyScalar(alpha * glow);
          ring.colors.setXYZ(ringIdx, tmpColor.r, tmpColor.g, tmpColor.b);
          ringIdx++;
        }
      } else if (p.type === 'flash') {
        if (flashIdx < MAX_FLASHES) {
          const d = Math.max(0.1, p.size * 4);
          dummyObj.position.set(p.position.x, -p.position.y, 3.5);
          dummyObj.rotation.set(0, 0, p.rotation);
          dummyObj.scale.set(d, d, 1);
          dummyObj.updateMatrix();
          flashRef.current?.setMatrixAt(flashIdx, dummyObj.matrix);
          tmpColor.set(p.color).multiplyScalar(alpha * glow);
          flash.colors.setXYZ(flashIdx, tmpColor.r, tmpColor.g, tmpColor.b);
          flashIdx++;
        }
      } else if (p.type === 'trail') {
        if (trailIdx < MAX_TRAILS) {
          const angle = Math.atan2(p.velocity.y, p.velocity.x);
          const len = Math.max(0.1, p.size * 2.2);
          const width = Math.max(0.1, p.size * 0.28);
          // Anchor the head at the particle and stretch the streak backwards.
          dummyObj.position.set(
            p.position.x - Math.cos(angle) * len * 0.5,
            -(p.position.y - Math.sin(angle) * len * 0.5),
            3,
          );
          dummyObj.rotation.set(0, 0, -angle);
          dummyObj.scale.set(len, width, 1);
          dummyObj.updateMatrix();
          trailRef.current?.setMatrixAt(trailIdx, dummyObj.matrix);
          tmpColor.set(p.color).multiplyScalar(alpha * glow);
          trail.colors.setXYZ(trailIdx, tmpColor.r, tmpColor.g, tmpColor.b);
          trailIdx++;
        }
      } else {
        // spark / explosion / ember -> point particle
        positions.setXYZ(sparkIdx, p.position.x, -p.position.y, 3);
        tmpColor.set(p.color).multiplyScalar(glow);
        colors.setXYZ(sparkIdx, tmpColor.r, tmpColor.g, tmpColor.b);
        sizes.setX(sparkIdx, Math.max(0.6, p.size * 0.6));
        alphas.setX(sparkIdx, alpha);
        sparkIdx++;
      }
    }

    pointsGeo.setDrawRange(0, sparkIdx);
    positions.needsUpdate = true;
    colors.needsUpdate = true;
    sizes.needsUpdate = true;
    alphas.needsUpdate = true;

    if (trailRef.current) {
      trailRef.current.count = trailIdx;
      trailRef.current.instanceMatrix.needsUpdate = true;
      trail.colors.needsUpdate = true;
    }
    if (ringRef.current) {
      ringRef.current.count = ringIdx;
      ringRef.current.instanceMatrix.needsUpdate = true;
      ring.colors.needsUpdate = true;
    }
    if (flashRef.current) {
      flashRef.current.count = flashIdx;
      flashRef.current.instanceMatrix.needsUpdate = true;
      flash.colors.needsUpdate = true;
    }
  });

  return (
    <>
      <points ref={pointsRef} geometry={pointsGeo} material={pointsMat} frustumCulled={false} />
      <instancedMesh ref={trailRef} args={[trail.geo, trailMat, MAX_TRAILS]} frustumCulled={false} />
      <instancedMesh ref={ringRef} args={[ring.geo, ringMat, MAX_RINGS]} frustumCulled={false} />
      <instancedMesh ref={flashRef} args={[flash.geo, flashMat, MAX_FLASHES]} frustumCulled={false} />
    </>
  );
}
