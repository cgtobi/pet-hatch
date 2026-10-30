import * as THREE from 'three';
import { GROUND_Y } from './island';

const COUNT = 14;
const STILL = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

const VERT = /* glsl */ `
  attribute float seed;
  uniform float time;
  uniform float opacity;
  uniform float scale;
  uniform float motion;
  varying float vAlpha;
  void main() {
    vec3 p = position;
    float t = time * motion;
    p += vec3(sin(t * 0.7 + seed * 9.0), sin(t * 1.1 + seed * 5.0) * 0.5, cos(t * 0.6 + seed * 7.0)) * 0.25;
    // Each one lights up now and then and fades out again.
    float blink = smoothstep(0.55, 1.0, sin(time * (0.8 + seed) + seed * 30.0));
    vAlpha = opacity * mix(0.6, 0.25 + 0.75 * blink, motion);
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_PointSize = scale * 44.0 * (8.0 / -mv.z);
    gl_Position = projectionMatrix * mv;
  }`;

const FRAG = /* glsl */ `
  varying float vAlpha;
  void main() {
    float r = length(gl_PointCoord - 0.5) * 2.0;
    float a = (0.8 * exp(-r * r * 5.0) + 0.7 * (1.0 - smoothstep(0.12, 0.22, r))) * vAlpha;
    gl_FragColor = vec4(0.91, 1.0, 0.55, a);
  }`;

/** A few fireflies drifting over the island once it gets dark. */
export class Fireflies {
  readonly points: THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial>;

  constructor(seed: number) {
    let s = seed || 1;
    const rand = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    const pos: number[] = [];
    const seeds: number[] = [];
    for (let i = 0; i < COUNT; i++) {
      const a = rand() * Math.PI * 2;
      const r = 1.2 + rand() * 2.1;
      pos.push(Math.cos(a) * r, GROUND_Y + 0.35 + rand() * 1.1, Math.sin(a) * r);
      seeds.push(rand());
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('seed', new THREE.Float32BufferAttribute(seeds, 1));
    this.points = new THREE.Points(
      geo,
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        uniforms: {
          time: { value: 0 },
          opacity: { value: 0 },
          scale: { value: Math.min(window.devicePixelRatio, 2) },
          motion: { value: STILL ? 0 : 1 },
        },
        vertexShader: VERT,
        fragmentShader: FRAG,
      }),
    );
  }

  /** @param dark 0 (day) … 1 (night) */
  update(time: number, dark: number): void {
    const u = this.points.material.uniforms;
    u.time.value = time;
    u.opacity.value = THREE.MathUtils.smoothstep(dark, 0.3, 0.8);
    this.points.visible = u.opacity.value > 0.01;
  }
}
