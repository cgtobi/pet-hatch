import * as THREE from 'three';
import { mulberry32 } from '../sim/rng';
import type { ElementType } from '../sim/types';
import { GROUND_Y } from './island';
import { toon, TYPE_COLORS } from './toon';

/** Overall size per life stage (baby … elder). */
const STAGE_SCALE = [1.3, 1.55, 1.8, 2.0, 1.95];
const WANDER_RADIUS = 1.9;
/** Spots the pet steers around: tree, big rock, tipped-over shell. */
const OBSTACLES: [number, number, number][] = [
  [-1.75, -1.0, 1.05],
  [1.9, -0.9, 1.0],
  [0.95, 0.35, 1.0],
];
const SICK_TINT = new THREE.Color('#a8b88a');
const ELDER_TINT = new THREE.Color('#d9d2c8');

type Anim = 'hop' | 'eat' | 'cower' | 'dance' | 'evolve' | 'pop';

export interface PetLook {
  sleeping: boolean;
  sick: boolean;
  calling: boolean;
  /** 0 … 100 */
  mood: number;
}

/** The living pet: built from primitives, wanders the island, reacts to care and grows with each life stage. */
export class Pet3D {
  readonly group = new THREE.Group();
  private body = new THREE.Group();
  private eyes: THREE.Mesh[] = [];
  private smile: THREE.Mesh;
  private frown: THREE.Mesh;
  private flat: THREE.Mesh;
  private sweat: THREE.Mesh;
  private bubble: THREE.Sprite;
  private food: THREE.Group;
  private tinted: { mat: THREE.MeshToonMaterial; base: THREE.Color }[] = [];
  private rand: () => number;

  private stage = 0;
  private scale = STAGE_SCALE[0];
  private look: PetLook = { sleeping: false, sick: false, calling: false, mood: 80 };
  private target: THREE.Vector2 | null = null;
  private idleFor = 1.5;
  private heading = 0;
  private walkPhase = 0;
  private blinkIn = 2;
  private anim: { kind: Anim; t: number; dur: number } | null = null;

  constructor(type: ElementType, seed: number) {
    this.rand = mulberry32(seed ^ 0x9e7);
    const base = new THREE.Color(TYPE_COLORS[type]);
    const mat = (c: THREE.Color) => {
      const m = toon(c.clone());
      this.tinted.push({ mat: m, base: c.clone() });
      return m;
    };
    const bodyMat = mat(base);
    const light = mat(base.clone().lerp(new THREE.Color('#ffffff'), 0.6));
    const dark = mat(base.clone().multiplyScalar(0.75));
    const ink = toon('#2e2a3a');

    const torso = new THREE.Mesh(new THREE.SphereGeometry(0.42, 24, 16), bodyMat);
    torso.scale.set(1, 0.9, 0.95);
    torso.position.y = 0.38;
    const belly = new THREE.Mesh(new THREE.SphereGeometry(0.26, 16, 12), light);
    belly.scale.set(1, 0.85, 0.5);
    belly.position.set(0, 0.3, 0.3);
    this.body.add(torso, belly);

    for (const side of [-1, 1]) {
      const foot = new THREE.Mesh(new THREE.SphereGeometry(0.12, 12, 8), dark);
      foot.scale.set(1.1, 0.6, 1.3);
      foot.position.set(side * 0.2, 0.05, 0.08);
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.065, 12, 8), ink);
      eye.scale.set(0.85, 1.15, 0.6);
      eye.position.set(side * 0.15, 0.46, 0.36);
      const shine = new THREE.Mesh(new THREE.SphereGeometry(0.022, 8, 6), toon('#ffffff'));
      shine.position.set(0.02, 0.03, 0.05);
      eye.add(shine);
      const blush = new THREE.Mesh(new THREE.SphereGeometry(0.06, 10, 6), toon('#ff9fb2'));
      blush.scale.set(1.2, 0.6, 0.3);
      blush.position.set(side * 0.27, 0.36, 0.31);
      this.eyes.push(eye);
      this.body.add(foot, eye, blush);
    }

    const mouthGeo = new THREE.TorusGeometry(0.055, 0.014, 6, 12, Math.PI);
    this.smile = new THREE.Mesh(mouthGeo, ink);
    this.smile.rotation.z = Math.PI;
    this.smile.position.set(0, 0.36, 0.385);
    this.frown = new THREE.Mesh(mouthGeo, ink);
    this.frown.position.set(0, 0.31, 0.385);
    this.flat = new THREE.Mesh(new THREE.CapsuleGeometry(0.013, 0.07, 4, 8), ink);
    this.flat.rotation.z = Math.PI / 2;
    this.flat.position.set(0, 0.33, 0.39);
    this.body.add(this.smile, this.frown, this.flat);

    this.sweat = new THREE.Mesh(new THREE.SphereGeometry(0.05, 10, 8), toon('#8fd0f5'));
    this.sweat.scale.set(0.8, 1.2, 0.8);
    this.sweat.position.set(0.3, 0.62, 0.22);
    this.body.add(this.sweat);

    this.body.add(this.feature(type, dark));
    this.food = this.buildFood();
    this.body.add(this.food);
    this.bubble = this.buildBubble();
    // Invisible, generous tap target around the body.
    const hit = new THREE.Mesh(new THREE.SphereGeometry(0.62, 12, 8), new THREE.MeshBasicMaterial({ visible: false }));
    hit.position.y = 0.42;
    this.body.add(hit);
    this.group.add(this.body, this.bubble);
    this.group.position.y = GROUND_Y + 0.07;
    this.group.scale.setScalar(this.scale);
  }

  private feature(type: ElementType, dark: THREE.Material): THREE.Object3D {
    const g = new THREE.Group();
    g.position.y = 0.76;
    switch (type) {
      case 'ember': {
        const outer = new THREE.Mesh(new THREE.ConeGeometry(0.13, 0.32, 8), toon('#ff7a3d'));
        const inner = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.2, 8), toon('#ffc94d'));
        outer.position.y = 0.1;
        inner.position.set(0, 0.07, 0.05);
        const side = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.2, 8), toon('#ff7a3d'));
        side.position.set(0.12, 0.03, 0);
        side.rotation.z = -0.5;
        g.add(outer, inner, side);
        break;
      }
      case 'tide': {
        const fin = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.3, 3), dark);
        fin.scale.z = 0.35;
        fin.position.y = 0.06;
        fin.rotation.z = -0.25;
        g.add(fin);
        break;
      }
      case 'bloom': {
        const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.025, 0.2, 5), toon('#4e9e68'));
        stem.position.y = 0.06;
        g.add(stem);
        for (const side of [-1, 1]) {
          const leaf = new THREE.Mesh(new THREE.SphereGeometry(0.11, 10, 6), toon(side > 0 ? '#5cc98a' : '#74d49a'));
          leaf.scale.set(1, 0.35, 0.6);
          leaf.position.set(side * 0.11, 0.17, 0);
          leaf.rotation.z = side * 0.4;
          g.add(leaf);
        }
        break;
      }
      case 'astral': {
        const halo = new THREE.Mesh(
          new THREE.TorusGeometry(0.2, 0.025, 8, 28),
          toon('#ffe9a8', { emissive: '#ffe9a8', emissiveIntensity: 0.6 }),
        );
        halo.rotation.x = Math.PI / 2;
        halo.position.y = 0.18;
        g.add(halo);
        break;
      }
    }
    return g;
  }

  private buildFood(): THREE.Group {
    const g = new THREE.Group();
    const apple = new THREE.Mesh(new THREE.SphereGeometry(0.13, 14, 10), toon('#f2564a'));
    apple.scale.y = 0.9;
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.08, 5), toon('#7a5236'));
    stem.position.y = 0.13;
    const leaf = new THREE.Mesh(new THREE.SphereGeometry(0.045, 8, 6), toon('#5cc98a'));
    leaf.scale.set(1.4, 0.4, 0.8);
    leaf.position.set(0.05, 0.15, 0);
    g.add(apple, stem, leaf);
    g.position.set(0, 0.13, 0.62);
    g.visible = false;
    return g;
  }

  private buildBubble(): THREE.Sprite {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const g = c.getContext('2d')!;
    g.fillStyle = '#ffffff';
    g.beginPath();
    g.roundRect(14, 8, 100, 92, 34);
    g.fill();
    g.beginPath();
    g.moveTo(44, 92);
    g.lineTo(36, 122);
    g.lineTo(70, 96);
    g.fill();
    g.fillStyle = '#e2462f';
    g.beginPath();
    g.roundRect(56, 22, 16, 46, 8);
    g.fill();
    g.beginPath();
    g.arc(64, 82, 9, 0, Math.PI * 2);
    g.fill();
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false }));
    s.renderOrder = 10;
    s.visible = false;
    return s;
  }

  setStage(index: number, animate: boolean): void {
    if (index === this.stage && !animate) return;
    this.stage = Math.min(index, STAGE_SCALE.length - 1);
    if (animate) this.play('evolve', 1.6);
    else this.scale = STAGE_SCALE[this.stage];
    this.applyTint();
  }

  setLook(look: PetLook): void {
    const changed = look.sick !== this.look.sick;
    this.look = look;
    if (changed) this.applyTint();
  }

  private applyTint(): void {
    for (const { mat, base } of this.tinted) {
      mat.color.copy(base);
      if (this.stage === 4) mat.color.lerp(ELDER_TINT, 0.25);
      if (this.look.sick) mat.color.lerp(SICK_TINT, 0.4);
    }
  }

  private play(kind: Anim, dur: number): void {
    this.anim = { kind, t: 0, dur };
    this.target = null;
    this.idleFor = dur + 0.8;
  }

  pop(): void {
    this.play('pop', 0.6);
  }
  hop(): void {
    if (!this.anim) this.play('hop', 0.45);
  }
  eat(): void {
    this.play('eat', 1.5);
  }
  dance(): void {
    this.play('dance', 1.6);
  }
  cower(): void {
    this.play('cower', 1.2);
  }

  /** World position of the pet's middle, for particle effects. */
  center(target = new THREE.Vector3()): THREE.Vector3 {
    return target.copy(this.group.position).setY(this.group.position.y + 0.45 * this.scale);
  }

  private pickTarget(): THREE.Vector2 {
    for (let i = 0; i < 12; i++) {
      const a = this.rand() * Math.PI * 2;
      const d = Math.sqrt(this.rand()) * WANDER_RADIUS;
      const x = Math.cos(a) * d;
      const z = Math.sin(a) * d;
      if (OBSTACLES.every(([ox, oz, r]) => Math.hypot(x - ox, z - oz) > r)) return new THREE.Vector2(x, z);
    }
    return new THREE.Vector2(0, 0.3);
  }

  update(dt: number, time: number): void {
    const { sleeping, sick, calling, mood } = this.look;
    let hopY = 0;
    let spin = 0;
    let squash = Math.sin(time * (sleeping ? 1.2 : 3.2)) * (sleeping ? 0.05 : 0.03);
    let tilt = 0;
    let flash = 0;
    let scaleMul = 1;

    if (this.anim) {
      const a = this.anim;
      a.t += dt;
      const p = Math.min(1, a.t / a.dur);
      switch (a.kind) {
        case 'pop':
          scaleMul = p * (1 + Math.sin(p * Math.PI) * 0.25);
          break;
        case 'hop':
          hopY = Math.sin(p * Math.PI) * 0.35;
          break;
        case 'dance':
          hopY = Math.abs(Math.sin(p * Math.PI * 3)) * 0.3;
          spin = p * Math.PI * 2;
          break;
        case 'eat':
          squash = Math.sin(a.t * 18) * 0.08;
          this.food.visible = p < 0.9;
          this.food.scale.setScalar(Math.max(0.05, 1 - p));
          break;
        case 'cower':
          tilt = 0.3 * Math.sin(p * Math.PI);
          squash = -0.08 * Math.sin(p * Math.PI);
          break;
        case 'evolve': {
          const target = STAGE_SCALE[this.stage];
          this.scale += (target - this.scale) * Math.min(1, dt * 3);
          spin = p * Math.PI * 4;
          hopY = Math.sin(p * Math.PI) * 0.5;
          flash = Math.sin(p * Math.PI);
          break;
        }
      }
      if (p >= 1) {
        if (a.kind === 'evolve') this.scale = STAGE_SCALE[this.stage];
        this.food.visible = false;
        this.anim = null;
      }
    }

    // Wandering.
    const pos = this.group.position;
    let walking = false;
    if (!this.anim && !sleeping) {
      if (this.target) {
        const dx = this.target.x - pos.x;
        const dz = this.target.y - pos.z;
        const dist = Math.hypot(dx, dz);
        const speed = (sick ? 0.2 : 0.4) * (this.scale / 1.3);
        if (dist < 0.05) {
          this.target = null;
          this.idleFor = 2 + this.rand() * 5;
        } else {
          walking = true;
          const step = Math.min(dist, speed * dt);
          pos.x += (dx / dist) * step;
          pos.z += (dz / dist) * step;
          this.heading = turnToward(this.heading, Math.atan2(dx, dz), dt * 5);
        }
      } else {
        this.idleFor -= dt;
        // Face the player while standing around.
        this.heading = turnToward(this.heading, 0, dt * 2);
        if (this.idleFor <= 0) this.target = this.pickTarget();
      }
    }
    if (walking) this.walkPhase += dt * 10;
    hopY += walking ? Math.abs(Math.sin(this.walkPhase)) * 0.06 : 0;

    this.group.scale.setScalar(this.scale * scaleMul);
    this.body.position.y = hopY;
    this.body.rotation.set(tilt, this.heading + spin, walking ? Math.sin(this.walkPhase) * 0.1 : 0);
    this.body.scale.set(1 + squash, 1 - squash, 1 + squash);

    for (const { mat } of this.tinted) {
      mat.emissive.setRGB(1, 1, 1);
      mat.emissiveIntensity = flash * 0.8;
    }

    // Face.
    this.blinkIn -= dt;
    const closed = sleeping || this.blinkIn < 0.12 || this.anim?.kind === 'cower';
    for (const e of this.eyes) e.scale.y = closed ? 0.15 : 1.15;
    if (this.blinkIn < 0) this.blinkIn = 2 + this.rand() * 3;
    const happy = mood >= 60 && !sick;
    const sad = mood < 30 || sick || this.anim?.kind === 'cower';
    this.smile.visible = happy && !sad;
    this.frown.visible = sad;
    this.flat.visible = !this.smile.visible && !this.frown.visible;

    this.sweat.visible = sick;
    this.sweat.position.y = 0.62 - ((time * 0.4) % 1) * 0.25;

    this.bubble.visible = calling && !sleeping;
    const s = 0.55 / this.scale;
    this.bubble.scale.set(s, s, s);
    this.bubble.position.set(0.25, 1.15 + Math.sin(time * 4) * 0.04, 0);
  }
}

function turnToward(from: number, to: number, maxStep: number): number {
  let d = to - from;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return from + Math.max(-maxStep, Math.min(maxStep, d));
}
