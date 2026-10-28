import * as THREE from 'three';

interface Key {
  h: number;
  top: string;
  bottom: string;
  light: number;
}

const NIGHT = { top: '#151a3d', bottom: '#2e3366', light: 0.28 };
const KEYS: Key[] = [
  { h: 0, ...NIGHT },
  { h: 5, ...NIGHT },
  { h: 6.5, top: '#f7b9a4', bottom: '#e6d8f2', light: 0.75 },
  { h: 8, top: '#a9daf5', bottom: '#ffe6d6', light: 1 },
  { h: 17, top: '#a9daf5', bottom: '#ffe6d6', light: 1 },
  { h: 19, top: '#f4a58f', bottom: '#9c86cf', light: 0.75 },
  { h: 20.5, ...NIGHT },
  { h: 24, ...NIGHT },
];

export interface SkyLook {
  top: THREE.Color;
  bottom: THREE.Color;
  /** 0.28 (night) … 1 (day). */
  light: number;
  /** 0 (day) … 1 (night). */
  night: number;
}

export function skyAt(hour: number): SkyLook {
  const i = Math.max(0, KEYS.findIndex((k) => k.h > hour) - 1);
  const a = KEYS[i];
  const b = KEYS[i + 1] ?? a;
  const f = b.h === a.h ? 0 : (hour - a.h) / (b.h - a.h);
  const top = new THREE.Color(a.top).lerp(new THREE.Color(b.top), f);
  const bottom = new THREE.Color(a.bottom).lerp(new THREE.Color(b.bottom), f);
  const light = a.light + (b.light - a.light) * f;
  const night = THREE.MathUtils.clamp(1 - (light - NIGHT.light) / (0.75 - NIGHT.light), 0, 1);
  return { top, bottom, light, night };
}

export class Sky {
  readonly group = new THREE.Group();
  private dome: THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial>;
  private stars: THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial>;
  private orb: THREE.Mesh<THREE.CircleGeometry, THREE.MeshBasicMaterial>;
  private halo: THREE.Mesh<THREE.CircleGeometry, THREE.MeshBasicMaterial>;

  constructor() {
    this.dome = new THREE.Mesh(
      new THREE.SphereGeometry(80, 32, 16),
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        depthWrite: false,
        uniforms: { top: { value: new THREE.Color() }, bottom: { value: new THREE.Color() } },
        vertexShader: /* glsl */ `
          varying vec3 vPos;
          void main() {
            vPos = position;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }`,
        fragmentShader: /* glsl */ `
          uniform vec3 top;
          uniform vec3 bottom;
          varying vec3 vPos;
          void main() {
            float h = normalize(vPos).y;
            gl_FragColor = vec4(mix(bottom, top, smoothstep(-0.55, 0.2, h)), 1.0);
            #include <colorspace_fragment>
          }`,
      }),
    );
    this.group.add(this.dome);

    const pts: number[] = [];
    for (let i = 0; i < 240; i++) {
      const theta = Math.random() * Math.PI * 2;
      const y = 0.05 + Math.random() * 0.95;
      const r = Math.sqrt(1 - y * y);
      pts.push(Math.cos(theta) * r * 70, y * 70, Math.sin(theta) * r * 70);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    this.stars = new THREE.Points(
      geo,
      new THREE.PointsMaterial({ color: '#fff8e0', size: 0.45, transparent: true, depthWrite: false }),
    );
    this.group.add(this.stars);

    this.orb = new THREE.Mesh(new THREE.CircleGeometry(2.4, 32), new THREE.MeshBasicMaterial({ fog: false }));
    this.halo = new THREE.Mesh(
      new THREE.CircleGeometry(4.2, 32),
      new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.35, depthWrite: false }),
    );
    this.group.add(this.halo, this.orb);
  }

  update(hour: number, look: SkyLook, camera: THREE.Camera): void {
    this.dome.material.uniforms.top.value.copy(look.top);
    this.dome.material.uniforms.bottom.value.copy(look.bottom);
    this.stars.material.opacity = look.night;
    this.stars.visible = look.night > 0.02;

    const isDay = hour >= 6 && hour < 20;
    const a = isDay ? ((hour - 6) / 14) * Math.PI : (((hour + 4) % 24) / 10) * Math.PI;
    this.orb.position.set(-34 * Math.cos(a), 6 + 20 * Math.sin(a), -48);
    this.orb.material.color.set(isDay ? '#ffe29a' : '#f4f1ff');
    this.halo.material.color.set(isDay ? '#fff1c9' : '#c9c6f2');
    this.halo.position.copy(this.orb.position).multiplyScalar(1.01);
    this.orb.lookAt(camera.position);
    this.halo.lookAt(camera.position);
  }
}
