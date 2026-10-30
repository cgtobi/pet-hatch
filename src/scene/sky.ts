import * as THREE from 'three';
import { TWILIGHT_H, type SunState } from '../sim/sun';

/** Twinkling and shooting stars stay still for players who asked for less motion. */
const STILL = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
const DEG = Math.PI / 180;

/** How far the sun and moon sit from the island (inside the dome, in front of the stars). */
const ORB_R = 60;
const STAR_R = 70;
/**
 * Where the sun and moon go down: low behind the island, beside its rock. The view looks down at the island,
 * so this "horizon" sits well below eye level; the sky above it is what shows between the card and the island.
 */
const HORIZON = -30 * DEG;
/** The sun climbs out of view above the status card by mid-morning. */
const SUN_TOP = 14 * DEG;
/** The moon stays in view all night, at its highest just under the status card. */
const MOON_TOP = -6 * DEG;
/** Hours after sunrise (or before sunset) at which the sun reaches SUN_TOP. */
const SUN_CLIMB_H = 3;
const STAR_COUNT = 520;
/** Seconds between shooting stars, at random within this range. */
const SHOOTING_EVERY: [number, number] = [25, 80];
const SHOOTING_S = 0.9;

interface Key {
  s: number;
  top: string;
  bottom: string;
  light: number;
  glow: number;
}

const NIGHT = { top: '#151a3d', bottom: '#2e3366', light: 0.28, glow: 0 };
const DAY = { top: '#a9daf5', bottom: '#ffe6d6', light: 1, glow: 0 };
/** The sky by hours from the horizon (see SunState.fromHorizon): night, twilight, sunrise or sunset, day. */
const KEYS: Key[] = [
  { s: -TWILIGHT_H, ...NIGHT },
  { s: -0.6, top: '#262a63', bottom: '#5d4f8f', light: 0.36, glow: 0.35 },
  { s: 0, top: '#6874c2', bottom: '#ff9d76', light: 0.6, glow: 1 },
  { s: 0.7, top: '#93c3ec', bottom: '#ffcfae', light: 0.86, glow: 0.45 },
  { s: TWILIGHT_H, ...DAY },
];

const SUNLIGHT = new THREE.Color('#fff3e0');
const LOW_SUNLIGHT = new THREE.Color('#ffa86b');
const MOONLIGHT = new THREE.Color('#aab6ff');

export interface SkyLook {
  top: THREE.Color;
  bottom: THREE.Color;
  /** 0.28 (night) … 1 (day). */
  light: number;
  /** 0 (day) … 1 (night): how much the stars and moon show. */
  night: number;
  /** 0 … 1: the warm sunrise and sunset glow. */
  glow: number;
  /** The colour of the light falling on the island: white by day, orange at sunrise and sunset, blue by night. */
  sunColor: THREE.Color;
}

export function skyAt(sun: SunState): SkyLook {
  const s = THREE.MathUtils.clamp(sun.fromHorizon, -TWILIGHT_H, TWILIGHT_H);
  const next = KEYS.findIndex((k) => k.s > s);
  const i = next === -1 ? KEYS.length - 1 : Math.max(0, next - 1);
  const a = KEYS[i];
  const b = KEYS[i + 1] ?? a;
  const f = b.s === a.s ? 0 : (s - a.s) / (b.s - a.s);
  const light = a.light + (b.light - a.light) * f;
  const glow = a.glow + (b.glow - a.glow) * f;
  const night = THREE.MathUtils.clamp(1 - (light - NIGHT.light) / (0.6 - NIGHT.light), 0, 1);
  return {
    top: new THREE.Color(a.top).lerp(new THREE.Color(b.top), f),
    bottom: new THREE.Color(a.bottom).lerp(new THREE.Color(b.bottom), f),
    light,
    night,
    glow,
    sunColor: SUNLIGHT.clone().lerp(LOW_SUNLIGHT, glow).lerp(MOONLIGHT, night),
  };
}

/** A point on a sphere of radius r, `az` radians right of straight ahead (−z) and `el` radians up. */
function onSphere(r: number, az: number, el: number, out = new THREE.Vector3()): THREE.Vector3 {
  return out.set(Math.sin(az) * Math.cos(el) * r, Math.sin(el) * r, -Math.cos(az) * Math.cos(el) * r);
}

const DOME_FRAG = /* glsl */ `
  uniform vec3 top;
  uniform vec3 bottom;
  uniform vec3 glowColor;
  uniform vec3 sunDir;
  uniform float glow;
  uniform float horizon;
  uniform float night;
  varying vec3 vPos;

  float hash(vec3 p) {
    p = fract(p * 0.3183099 + 0.1);
    p *= 17.0;
    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
  }
  float noise(vec3 x) {
    vec3 i = floor(x);
    vec3 f = fract(x);
    f = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(mix(hash(i), hash(i + vec3(1, 0, 0)), f.x), mix(hash(i + vec3(0, 1, 0)), hash(i + vec3(1, 1, 0)), f.x), f.y),
      mix(mix(hash(i + vec3(0, 0, 1)), hash(i + vec3(1, 0, 1)), f.x), mix(hash(i + vec3(0, 1, 1)), hash(i + vec3(1, 1, 1)), f.x), f.y),
      f.z);
  }

  void main() {
    vec3 d = normalize(vPos);
    float h = d.y;
    vec3 col = mix(bottom, top, smoothstep(-0.55, 0.2, h));
    // Sunrise and sunset: a warm band low in the sky, strongest on the sun's side.
    float toward = 0.5 + 0.5 * dot(normalize(d.xz + 1e-5), normalize(sunDir.xz + 1e-5));
    float band = 1.0 - smoothstep(0.0, 0.5, abs(h - horizon));
    col = mix(col, glowColor, glow * band * (0.3 + 0.7 * pow(toward, 6.0)));
    // A faint Milky Way across the night sky.
    vec3 n = normalize(vec3(0.55, 0.45, 0.7));
    float off = dot(d, n);
    float milky = exp(-off * off * 30.0) * (0.35 + 0.65 * noise(d * 11.0)) * (0.6 + 0.4 * noise(d * 37.0));
    col += vec3(0.5, 0.46, 0.75) * milky * night * 0.2;
    gl_FragColor = vec4(col, 1.0);
    #include <colorspace_fragment>
  }`;

const POS_VERT = /* glsl */ `
  varying vec3 vPos;
  void main() {
    vPos = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }`;

const STAR_VERT = /* glsl */ `
  attribute float size;
  attribute float seed;
  attribute vec3 tint;
  uniform float time;
  uniform float opacity;
  uniform float scale;
  uniform float twinkle;
  varying float vAlpha;
  varying vec3 vTint;
  void main() {
    vTint = tint;
    float tw = 0.65 + 0.35 * sin(time * (1.2 + seed * 2.5) + seed * 50.0);
    vAlpha = opacity * mix(1.0, tw, twinkle);
    gl_PointSize = size * scale;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }`;

const STAR_FRAG = /* glsl */ `
  varying float vAlpha;
  varying vec3 vTint;
  void main() {
    float r = length(gl_PointCoord - 0.5) * 2.0;
    float a = 1.0 - smoothstep(0.35, 1.0, r);
    gl_FragColor = vec4(vTint, a * vAlpha);
    #include <colorspace_fragment>
  }`;

const UV_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }`;

/** The moon, lit by its phase: the terminator sweeps right to left from new to full and on to new again. */
const MOON_FRAG = /* glsl */ `
  uniform float phase;
  uniform float opacity;
  uniform vec3 litColor;
  uniform vec3 darkColor;
  varying vec2 vUv;
  void main() {
    vec2 p = vUv * 2.0 - 1.0;
    float w = sqrt(max(0.0, 1.0 - p.y * p.y));
    float k = cos(6.2831853 * phase);
    float edge = phase < 0.5 ? p.x - k * w : -k * w - p.x;
    float lit = smoothstep(-0.05, 0.05, edge);
    float disc = 1.0 - smoothstep(0.94, 1.0, length(p));
    // A few soft "seas" on the lit side.
    float seas = smoothstep(0.32, 0.0, length(p - vec2(-0.25, 0.2))) * 0.12 + smoothstep(0.25, 0.0, length(p - vec2(0.3, -0.25))) * 0.1;
    vec3 c = mix(darkColor, litColor * (1.0 - seas), lit);
    gl_FragColor = vec4(c, disc * opacity * mix(0.22, 1.0, lit));
    #include <colorspace_fragment>
  }`;

/** A soft round glow around the sun or moon. */
const HALO_FRAG = /* glsl */ `
  uniform vec3 color;
  uniform float opacity;
  varying vec2 vUv;
  void main() {
    float r = length(vUv * 2.0 - 1.0);
    float a = pow(max(0.0, 1.0 - r), 2.2) * opacity;
    gl_FragColor = vec4(color, a);
    #include <colorspace_fragment>
  }`;

function halo(radius: number, color: string): THREE.Mesh<THREE.CircleGeometry, THREE.ShaderMaterial> {
  return new THREE.Mesh(
    new THREE.CircleGeometry(radius, 40),
    new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: { color: { value: new THREE.Color(color) }, opacity: { value: 0 } },
      vertexShader: UV_VERT,
      fragmentShader: HALO_FRAG,
    }),
  );
}

/** A shooting star's streak: bright at the head, fading along its tail. */
const STREAK_FRAG = /* glsl */ `
  uniform float opacity;
  varying vec2 vUv;
  void main() {
    float across = 1.0 - abs(vUv.y * 2.0 - 1.0);
    float a = pow(vUv.x, 2.5) * across * opacity;
    gl_FragColor = vec4(1.0, 0.97, 0.88, a);
  }`;

/** The sky dome behind the island: colours by time of day, sun, moon, stars and the odd shooting star. */
export class Sky {
  /** Turns with the view, so the sky stays a backdrop: the sun rises on the left and sets on the right. */
  readonly group = new THREE.Group();
  private dome: THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial>;
  private stars: THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial>;
  private sun: THREE.Mesh<THREE.CircleGeometry, THREE.MeshBasicMaterial>;
  private sunHalo: THREE.Mesh<THREE.CircleGeometry, THREE.ShaderMaterial>;
  private moon: THREE.Mesh<THREE.CircleGeometry, THREE.ShaderMaterial>;
  private moonHalo: THREE.Mesh<THREE.CircleGeometry, THREE.ShaderMaterial>;
  private streak: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  private shooting: { from: THREE.Vector3; dir: THREE.Vector3; age: number } | null = null;
  private nextShooting = 10;

  constructor() {
    this.dome = new THREE.Mesh(
      new THREE.SphereGeometry(80, 48, 24),
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        depthWrite: false,
        uniforms: {
          top: { value: new THREE.Color() },
          bottom: { value: new THREE.Color() },
          glowColor: { value: new THREE.Color('#ff8a5c') },
          sunDir: { value: new THREE.Vector3(0, 0, -1) },
          glow: { value: 0 },
          horizon: { value: Math.sin(HORIZON + 8 * DEG) },
          night: { value: 0 },
        },
        vertexShader: POS_VERT,
        fragmentShader: DOME_FRAG,
      }),
    );

    // Stars fill the part of the sky the view can show (it turns with the view), a few big and bright, most faint.
    const pos: number[] = [];
    const size: number[] = [];
    const seed: number[] = [];
    const tint: number[] = [];
    const v = new THREE.Vector3();
    const tints = [new THREE.Color('#fff8e0'), new THREE.Color('#dfe6ff'), new THREE.Color('#ffe2c4')];
    for (let i = 0; i < STAR_COUNT; i++) {
      const el = Math.asin(-0.75 + Math.random() * 1.3);
      const az = (Math.random() * 2 - 1) * 70 * DEG;
      pos.push(...onSphere(STAR_R, az, el, v).toArray());
      const big = Math.random();
      size.push(big > 0.97 ? 5 : big > 0.85 ? 3.6 : 2 + Math.random() * 1.2);
      seed.push(Math.random());
      tint.push(...tints[Math.floor(Math.random() * tints.length)].toArray());
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('size', new THREE.Float32BufferAttribute(size, 1));
    geo.setAttribute('seed', new THREE.Float32BufferAttribute(seed, 1));
    geo.setAttribute('tint', new THREE.Float32BufferAttribute(tint, 3));
    this.stars = new THREE.Points(
      geo,
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        uniforms: {
          time: { value: 0 },
          opacity: { value: 0 },
          scale: { value: Math.min(window.devicePixelRatio, 2) },
          twinkle: { value: STILL ? 0 : 1 },
        },
        vertexShader: STAR_VERT,
        fragmentShader: STAR_FRAG,
      }),
    );

    this.sun = new THREE.Mesh(new THREE.CircleGeometry(1.5, 40), new THREE.MeshBasicMaterial({ fog: false, transparent: true }));
    this.sunHalo = halo(4.5, '#fff1c9');
    this.moon = new THREE.Mesh(
      new THREE.CircleGeometry(1.25, 40),
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        uniforms: {
          phase: { value: 0.5 },
          opacity: { value: 0 },
          litColor: { value: new THREE.Color('#f6f3ff') },
          darkColor: { value: new THREE.Color('#2a2f5c') },
        },
        vertexShader: UV_VERT,
        fragmentShader: MOON_FRAG,
      }),
    );
    this.moonHalo = halo(4, '#c9c6f2');
    this.streak = new THREE.Mesh(
      new THREE.PlaneGeometry(9, 0.14),
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        uniforms: { opacity: { value: 0 } },
        vertexShader: UV_VERT,
        fragmentShader: STREAK_FRAG,
      }),
    );
    this.streak.visible = false;
    this.group.add(this.dome, this.stars, this.streak, this.sunHalo, this.sun, this.moonHalo, this.moon);
  }

  /**
   * @param yaw the view's turn, so the sky turns along with it
   * @param halfWidth the view's horizontal half-angle: the sun and moon travel within it, so a narrow phone sees them
   */
  update(sun: SunState, look: SkyLook, yaw: number, halfWidth: number, time: number, dt: number): void {
    this.group.rotation.y = yaw;
    const dome = this.dome.material.uniforms;
    dome.top.value.copy(look.top);
    dome.bottom.value.copy(look.bottom);
    dome.glow.value = look.glow;
    dome.night.value = look.night;

    const span = Math.min(halfWidth * 0.7, 35 * DEG);

    // The sun: rises bottom left, climbs out of view, comes down on the right in the evening and sinks.
    const climb = THREE.MathUtils.clamp(sun.fromHorizon / SUN_CLIMB_H, -1, 1);
    const sunEl = HORIZON + (SUN_TOP - HORIZON) * Math.sin((climb * Math.PI) / 2);
    const sunAz = span * (2 * THREE.MathUtils.clamp(sun.sun, -0.1, 1.1) - 1);
    onSphere(ORB_R, sunAz, sunEl, this.sun.position);
    this.sunHalo.position.copy(this.sun.position).multiplyScalar(1.01);
    dome.sunDir.value.copy(this.sun.position).normalize();
    const low = look.glow;
    this.sun.material.color.set('#ffe29a').lerp(new THREE.Color('#ff8f57'), low);
    this.sun.scale.setScalar(1 + 0.25 * low);
    const sunHalo = this.sunHalo.material.uniforms;
    sunHalo.color.value.set('#fff1c9').lerp(new THREE.Color('#ffb07a'), low);
    sunHalo.opacity.value = 0.55 + 0.3 * low;
    this.sunHalo.scale.setScalar(1 + 0.6 * low);
    const sunShows = sun.fromHorizon > -0.8;
    this.sun.visible = this.sunHalo.visible = sunShows;
    this.sun.material.opacity = THREE.MathUtils.clamp((sun.fromHorizon + 0.8) / 0.5, 0, 1);

    // The moon: crosses the night sky, in its real phase.
    const moonShows = sun.moon >= 0 && look.night > 0.02;
    this.moon.visible = this.moonHalo.visible = moonShows;
    if (moonShows) {
      const rise = Math.sin(Math.PI * sun.moon);
      onSphere(ORB_R - 1, span * (2 * sun.moon - 1), HORIZON + (MOON_TOP - HORIZON) * Math.min(1, rise * 1.6), this.moon.position);
      this.moonHalo.position.copy(this.moon.position).multiplyScalar(1.01);
      const m = this.moon.material.uniforms;
      m.phase.value = sun.phase;
      m.opacity.value = look.night;
      // A full moon glows; a thin crescent hardly at all.
      this.moonHalo.material.uniforms.opacity.value = 0.45 * look.night * (0.5 - 0.5 * Math.cos(2 * Math.PI * sun.phase));
    }
    for (const o of [this.sun, this.sunHalo, this.moon, this.moonHalo]) o.lookAt(this.group.localToWorld(new THREE.Vector3()));

    const stars = this.stars.material.uniforms;
    stars.opacity.value = look.night;
    stars.time.value = time;
    this.stars.visible = look.night > 0.02;

    this.updateShootingStar(look.night, span, dt);
  }

  private updateShootingStar(night: number, span: number, dt: number): void {
    if (STILL || night < 0.9) {
      this.streak.visible = false;
      this.shooting = null;
      return;
    }
    if (!this.shooting) {
      this.nextShooting -= dt;
      if (this.nextShooting > 0) return;
      this.nextShooting = SHOOTING_EVERY[0] + Math.random() * (SHOOTING_EVERY[1] - SHOOTING_EVERY[0]);
      const side = Math.random() < 0.5 ? -1 : 1;
      const from = onSphere(STAR_R - 4, side * span * (0.2 + Math.random() * 0.6), (-8 + Math.random() * 10) * DEG);
      const dir = new THREE.Vector3(-side * (0.6 + Math.random() * 0.4), -(0.3 + Math.random() * 0.4), 0).normalize();
      this.shooting = { from, dir, age: 0 };
    }
    const s = this.shooting;
    s.age += dt;
    const k = s.age / SHOOTING_S;
    if (k >= 1) {
      this.shooting = null;
      this.streak.visible = false;
      return;
    }
    this.streak.visible = true;
    this.streak.position.copy(s.from).addScaledVector(s.dir, k * 14);
    this.streak.lookAt(this.group.localToWorld(new THREE.Vector3()));
    this.streak.rotateZ(Math.atan2(s.dir.y, s.dir.x));
    this.streak.material.uniforms.opacity.value = night * Math.sin(Math.PI * k);
  }
}
