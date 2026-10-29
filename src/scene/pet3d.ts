import * as THREE from 'three';
import { mulberry32 } from '../sim/rng';
import type { ElementType, FormId } from '../sim/types';
import { GROUND_Y, type Obstacle } from './island';
import { facet, toon, TYPE_COLORS } from './toon';

/** Overall size per life stage (baby … elder). */
const STAGE_SCALE = [1.3, 1.55, 1.8, 2.0, 1.95];
const WANDER_RADIUS = 1.9;
/** The tipped-over eggshell beside the nest, which every island has. */
const SHELL: Obstacle = [0.95, 0.35, 1.0];
const SICK_TINT = new THREE.Color('#a8b88a');
const ELDER_TINT = new THREE.Color('#d9d2c8');

type Anim = 'hop' | 'eat' | 'cower' | 'dance' | 'evolve' | 'pop' | 'lunge' | 'hurt';

export interface PetLook {
  sleeping: boolean;
  sick: boolean;
  calling: boolean;
  /** 0 … 100 */
  mood: number;
}

/** Body plan of each form; the type adds its own colors, crest and accents. */
interface Build {
  /** Torso scale (x, y, z) of a 0.42 sphere. */
  body: [number, number, number];
  ears?: 'round' | 'pointy' | 'long';
  tail?: 'stub' | 'long';
  arms?: 'small' | 'big';
  wings?: boolean;
  shell?: boolean;
  /** Glowing orbs circling the head. */
  orbs?: number;
  horn?: boolean;
  tufts?: boolean;
  /** Body color brightness. */
  shade: number;
  /** Size of the type crest on top of the head. */
  crest: number;
  eye: number;
  /** How far the eyes open (scruffy pets look sleepy). */
  eyeOpen?: number;
}

const BUILDS: Record<FormId, Build> = {
  baby: { body: [1, 0.9, 0.95], shade: 1, crest: 0.8, eye: 1 },
  'child.bright': { body: [1, 0.95, 0.95], ears: 'round', tail: 'stub', shade: 1.06, crest: 1, eye: 1.15 },
  'child.scruffy': {
    body: [1.05, 0.88, 1],
    ears: 'pointy',
    tail: 'stub',
    tufts: true,
    shade: 0.8,
    crest: 0.85,
    eye: 0.9,
    eyeOpen: 0.7,
  },
  'teen.physical': { body: [0.95, 1.08, 0.95], ears: 'pointy', tail: 'long', arms: 'small', shade: 1, crest: 1.15, eye: 1 },
  'teen.technical': { body: [1.05, 0.95, 1], ears: 'long', tail: 'stub', orbs: 1, shade: 1.02, crest: 1.1, eye: 1.05 },
  'adult.power': {
    body: [1.2, 1.02, 1.1],
    ears: 'round',
    tail: 'long',
    arms: 'big',
    horn: true,
    shade: 0.94,
    crest: 1.35,
    eye: 0.9,
  },
  'adult.speed': { body: [0.88, 1.12, 0.9], ears: 'pointy', tail: 'long', wings: true, shade: 1.05, crest: 1.25, eye: 1 },
  'adult.guard': { body: [1.18, 0.95, 1.12], ears: 'round', tail: 'stub', shell: true, shade: 0.92, crest: 1.2, eye: 0.9 },
  'adult.wits': { body: [1, 1.02, 1], ears: 'long', tail: 'long', orbs: 3, shade: 1.08, crest: 1.3, eye: 1.1 },
};

/** Accent color per type: tail tips, orbs, wing edges. */
const ACCENT: Record<ElementType, string> = { ember: '#ffc94d', tide: '#e4f6ff', bloom: '#ffb3d1', astral: '#ffe9a8' };

/** The living pet: built from primitives, wanders the island, reacts to care, grows and evolves. */
export class Pet3D {
  readonly group = new THREE.Group();
  private body = new THREE.Group();
  private eyes: THREE.Mesh[] = [];
  private eyeOpen = 1;
  private sweatY = 0.62;
  private orbY = 1;
  private smile!: THREE.Mesh;
  private frown!: THREE.Mesh;
  private flat!: THREE.Mesh;
  private sweat!: THREE.Mesh;
  private wings: THREE.Object3D[] = [];
  private orb: THREE.Object3D | null = null;
  private bubble: THREE.Sprite;
  private food!: THREE.Group;
  private tinted: { mat: THREE.MeshToonMaterial; base: THREE.Color }[] = [];
  private rand: () => number;

  private stage = 0;
  private scale = STAGE_SCALE[0];
  private pendingForm: FormId | null = null;
  private look: PetLook = { sleeping: false, sick: false, calling: false, mood: 80 };
  private target: THREE.Vector2 | null = null;
  private idleFor = 1.5;
  private heading = 0;
  private walkPhase = 0;
  private blinkIn = 2;
  private anim: { kind: Anim; t: number; dur: number } | null = null;
  /** Spots to steer around while wandering: this island's trees, bushes, rocks and pond, plus the shell. */
  obstacles: Obstacle[] = [SHELL];
  /** In a battle: hold this spot and facing instead of wandering. */
  private post: { x: number; z: number; heading: number } | null = null;
  private fainted = false;

  constructor(
    private type: ElementType,
    seed: number,
    form: FormId,
  ) {
    this.rand = mulberry32(seed ^ 0x9e7);
    this.bubble = this.buildBubble();
    this.build(form);
    this.group.add(this.body, this.bubble);
    this.group.position.y = GROUND_Y + 0.07;
    this.group.scale.setScalar(this.scale);
  }

  /** (Re)build the body for a form; everything type-specific comes from this.type. */
  private build(form: FormId): void {
    this.body.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        o.geometry.dispose();
        (o.material as THREE.Material).dispose();
      }
    });
    this.body.clear();
    this.tinted = [];
    this.eyes = [];
    this.wings = [];
    this.orb = null;

    const b = BUILDS[form];
    const [sx, sy, sz] = b.body;
    const R = 0.42;
    const cy = R * sy;
    /** Point on the front of the torso at offset (x, dy) from its center. */
    const front = (x: number, dy: number, inset = 0) =>
      R * sz * Math.sqrt(Math.max(0, 1 - (x / (R * sx)) ** 2 - (dy / (R * sy)) ** 2)) - inset;

    const base = new THREE.Color(TYPE_COLORS[this.type]).multiplyScalar(b.shade);
    const mat = (c: THREE.Color) => {
      const m = toon(c.clone());
      this.tinted.push({ mat: m, base: c.clone() });
      return m;
    };
    const bodyMat = mat(base);
    const light = mat(base.clone().lerp(new THREE.Color('#ffffff'), 0.6));
    const dark = mat(base.clone().multiplyScalar(0.75));
    const accent = toon(ACCENT[this.type], this.type === 'astral' ? { emissive: ACCENT.astral, emissiveIntensity: 0.5 } : {});
    const ink = toon('#2e2a3a');

    const torso = new THREE.Mesh(new THREE.SphereGeometry(R, 24, 16), bodyMat);
    torso.scale.set(sx, sy, sz);
    torso.position.y = cy;
    const belly = new THREE.Mesh(new THREE.SphereGeometry(0.26, 16, 12), b.shell ? mat(new THREE.Color('#f3dc9a')) : light);
    belly.scale.set(sx, 0.85 * sy, 0.5);
    belly.position.set(0, cy - 0.08 * sy, front(0, -0.08 * sy, 0.13));
    this.body.add(torso, belly);

    for (const side of [-1, 1]) {
      const foot = new THREE.Mesh(new THREE.SphereGeometry(0.12, 12, 8), dark);
      foot.scale.set(1.1 * sx, 0.6, 1.3);
      foot.position.set(side * 0.2 * sx, 0.05, 0.08);
      const ex = side * 0.15 * sx;
      const ey = 0.08 * sy;
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.065 * b.eye, 12, 8), ink);
      eye.scale.set(0.85, 1.15, 0.6);
      eye.position.set(ex, cy + ey, front(ex, ey, 0.025));
      const shine = new THREE.Mesh(new THREE.SphereGeometry(0.022 * b.eye, 8, 6), toon('#ffffff'));
      shine.position.set(0.02, 0.03, 0.05);
      eye.add(shine);
      const bx = side * 0.27 * sx;
      const blush = new THREE.Mesh(new THREE.SphereGeometry(0.06, 10, 6), toon('#ff9fb2'));
      blush.scale.set(1.2, 0.6, 0.3);
      blush.position.set(bx, cy - 0.02 * sy, front(bx, -0.02 * sy, 0.04));
      this.eyes.push(eye);
      this.body.add(foot, eye, blush);

      if (b.ears) {
        const ear =
          b.ears === 'round'
            ? new THREE.Mesh(new THREE.SphereGeometry(0.1, 12, 8), bodyMat)
            : new THREE.Mesh(new THREE.ConeGeometry(b.ears === 'long' ? 0.07 : 0.09, b.ears === 'long' ? 0.38 : 0.24, 8), bodyMat);
        if (b.ears === 'round') ear.scale.set(1, 1, 0.55);
        ear.position.set(side * 0.24 * sx, cy + R * sy * 0.78, -0.02);
        ear.rotation.z = -side * (b.ears === 'long' ? 0.35 : 0.5);
        if (b.ears !== 'round') ear.position.y += 0.06;
        this.body.add(ear);
      }
      if (b.arms) {
        const r = b.arms === 'big' ? 0.14 : 0.1;
        const arm = new THREE.Mesh(new THREE.SphereGeometry(r, 12, 8), bodyMat);
        arm.scale.set(0.8, 1.25, 0.8);
        arm.position.set(side * R * sx * 0.98, cy - 0.06, 0.06);
        arm.rotation.z = side * 0.5;
        this.body.add(arm);
      }
      if (b.wings) {
        // Swept-up wings rooted on the upper back, so they show beside the head from the front.
        const pivot = new THREE.Group();
        pivot.position.set(side * 0.2 * sx, cy + 0.16, -R * sz * 0.55);
        const wing = new THREE.Mesh(new THREE.SphereGeometry(0.22, 12, 8), light);
        wing.scale.set(1.35, 0.6, 0.16);
        wing.position.set(side * 0.24, 0.14, 0);
        wing.rotation.z = side * 0.7;
        const edge = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 6), accent);
        edge.position.set(side * 0.44, 0.34, 0);
        pivot.add(wing, edge);
        pivot.userData.side = side;
        this.wings.push(pivot);
        this.body.add(pivot);
      }
      if (b.tufts) {
        const tuft = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.14, 5), dark);
        tuft.position.set(side * 0.34 * sx, cy + 0.12 * sy, 0.05);
        tuft.rotation.z = -side * 1.1;
        this.body.add(tuft);
      }
    }

    if (b.tufts) {
      const tuft = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.16, 5), dark);
      tuft.position.set(-0.1, cy + R * sy - 0.02, 0.18);
      tuft.rotation.set(0.5, 0, 0.6);
      this.body.add(tuft);
    }
    if (b.tail) {
      const tail = new THREE.Group();
      tail.position.set(b.tail === 'long' ? 0.12 * sx : 0, cy - 0.16 * sy, -R * sz * 0.9);
      if (b.tail === 'stub') {
        tail.add(new THREE.Mesh(new THREE.SphereGeometry(0.1, 10, 8), bodyMat));
      } else {
        // Swings out to one side so it peeks out beside the body from the front.
        const stem = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.55, 8), bodyMat);
        stem.rotation.x = -1.15;
        stem.position.set(0, 0.12, -0.24);
        const tip = new THREE.Mesh(new THREE.SphereGeometry(0.085, 10, 8), accent);
        tip.position.set(0, 0.25, -0.48);
        tail.rotation.y = -1.3;
        tail.add(stem, tip);
      }
      this.body.add(tail);
    }
    if (b.horn) {
      const horn = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.24, 8), toon('#fff4dc'));
      horn.position.set(0, cy + 0.3 * sy, front(0, 0.3 * sy, 0.02));
      horn.rotation.x = 0.55;
      this.body.add(horn);
    }
    if (b.shell) {
      const shell = new THREE.Mesh(
        facet(new THREE.SphereGeometry(R * 1.02, 8, 6, 0, Math.PI * 2, 0, Math.PI / 2)),
        mat(base.clone().multiplyScalar(0.6)),
      );
      // Slightly larger than the torso, so its rim frames the body from the front.
      shell.scale.set(sx * 1.12, sy * 1.04, sz * 0.85);
      shell.position.set(0, cy + 0.02, -0.04);
      shell.rotation.x = -Math.PI / 2;
      this.body.add(shell);
    }
    if (b.orbs) {
      const orbit = new THREE.Group();
      orbit.position.y = this.orbY = cy + R * sy + 0.3;
      const glow = toon(ACCENT[this.type], { emissive: ACCENT[this.type], emissiveIntensity: 0.7 });
      for (let i = 0; i < b.orbs; i++) {
        const a = (i / b.orbs) * Math.PI * 2;
        const orb = new THREE.Mesh(new THREE.SphereGeometry(b.orbs > 1 ? 0.065 : 0.08, 14, 10), glow);
        orb.position.set(Math.cos(a) * 0.42, 0, Math.sin(a) * 0.42);
        orbit.add(orb);
      }
      this.orb = orbit;
      this.body.add(orbit);
    }

    const mouthGeo = new THREE.TorusGeometry(0.055, 0.014, 6, 12, Math.PI);
    const mouthZ = front(0, -0.04 * sy, 0.03);
    this.smile = new THREE.Mesh(mouthGeo, ink);
    this.smile.rotation.z = Math.PI;
    this.smile.position.set(0, cy - 0.02 * sy, mouthZ);
    this.frown = new THREE.Mesh(mouthGeo, ink);
    this.frown.position.set(0, cy - 0.07 * sy, mouthZ);
    this.flat = new THREE.Mesh(new THREE.CapsuleGeometry(0.013, 0.07, 4, 8), ink);
    this.flat.rotation.z = Math.PI / 2;
    this.flat.position.set(0, cy - 0.05 * sy, mouthZ + 0.005);
    this.body.add(this.smile, this.frown, this.flat);

    this.sweat = new THREE.Mesh(new THREE.SphereGeometry(0.05, 10, 8), toon('#8fd0f5'));
    this.sweat.scale.set(0.8, 1.2, 0.8);
    this.sweatY = cy + 0.24;
    this.sweat.position.set(0.3 * sx, this.sweatY, 0.22);
    this.body.add(this.sweat);

    const crest = this.feature(dark);
    crest.position.y = cy + R * sy - 0.04;
    crest.scale.setScalar(b.crest);
    this.body.add(crest);
    this.food = this.buildFood();
    this.body.add(this.food);
    // Invisible, generous tap target around the body.
    const hit = new THREE.Mesh(new THREE.SphereGeometry(0.62, 12, 8), new THREE.MeshBasicMaterial({ visible: false }));
    hit.scale.set(sx, sy / 0.9, sz);
    hit.position.y = cy + 0.04;
    this.body.add(hit);
    this.eyeOpen = b.eyeOpen ?? 1;
    this.applyTint();
  }

  private feature(dark: THREE.Material): THREE.Object3D {
    const g = new THREE.Group();
    switch (this.type) {
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

  /** Grow to a life stage and take on a form; animated, the body swaps at the peak of the flash. */
  setForm(form: FormId, stage: number, animate: boolean): void {
    this.stage = Math.min(stage, STAGE_SCALE.length - 1);
    if (animate) {
      this.pendingForm = form;
      this.play('evolve', 1.8);
    } else {
      this.scale = STAGE_SCALE[this.stage];
      this.build(form);
    }
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
  /** Jump toward the opponent (battle attack). */
  lunge(): void {
    this.play('lunge', 0.5);
  }
  /** Shake with a red flash (took a hit). */
  hurt(): void {
    this.play('hurt', 0.5);
  }
  /** Topple over until the battle ends. */
  faint(): void {
    this.anim = null;
    this.fainted = true;
  }

  /** Walk to a spot and face a direction until released; used for battles. */
  hold(x: number, z: number, heading: number): void {
    this.post = { x, z, heading };
    this.target = new THREE.Vector2(x, z);
    this.fainted = false;
  }

  release(): void {
    this.post = null;
    this.fainted = false;
    this.target = null;
    this.idleFor = 1;
  }

  /** Put the pet straight on a spot (a creature that just appeared). */
  placeAt(x: number, z: number, heading: number): void {
    this.group.position.x = x;
    this.group.position.z = z;
    this.heading = heading;
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
      if (this.obstacles.every(([ox, oz, r]) => Math.hypot(x - ox, z - oz) > r)) return new THREE.Vector2(x, z);
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
    let flashColor = 0xffffff;
    let lunge = 0;
    let shake = 0;
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
        case 'lunge':
          lunge = Math.sin(p * Math.PI) * 0.55;
          hopY = Math.sin(p * Math.PI) * 0.15;
          break;
        case 'hurt':
          shake = Math.sin(a.t * 60) * 0.06 * (1 - p);
          flash = 0.9 * (1 - p);
          flashColor = 0xff3b2f;
          break;
        case 'evolve': {
          const target = STAGE_SCALE[this.stage];
          this.scale += (target - this.scale) * Math.min(1, dt * 3);
          spin = p * Math.PI * 4;
          hopY = Math.sin(p * Math.PI) * 0.5;
          flash = Math.sin(p * Math.PI);
          if (p >= 0.5 && this.pendingForm) {
            this.build(this.pendingForm);
            this.pendingForm = null;
          }
          break;
        }
      }
      if (p >= 1) {
        if (a.kind === 'evolve') {
          this.scale = STAGE_SCALE[this.stage];
          if (this.pendingForm) this.build(this.pendingForm);
          this.pendingForm = null;
        }
        this.food.visible = false;
        this.anim = null;
      }
    }

    // Wandering.
    const pos = this.group.position;
    let walking = false;
    if (!this.anim && !sleeping && !this.fainted) {
      if (this.target) {
        const dx = this.target.x - pos.x;
        const dz = this.target.y - pos.z;
        const dist = Math.hypot(dx, dz);
        // Hurry to the spot when a battle starts.
        const speed = (sick ? 0.2 : 0.4) * (this.scale / 1.3) * (this.post ? 3 : 1);
        if (dist < 0.05) {
          this.target = null;
          this.idleFor = 2 + this.rand() * 5;
        } else {
          if (this.post) walking = true;
          walking = true;
          const step = Math.min(dist, speed * dt);
          pos.x += (dx / dist) * step;
          pos.z += (dz / dist) * step;
          this.heading = turnToward(this.heading, Math.atan2(dx, dz), dt * 5);
        }
      } else {
        // Face the opponent in a battle, otherwise the player while standing around.
        this.heading = turnToward(this.heading, this.post?.heading ?? 0, dt * (this.post ? 6 : 2));
        if (!this.post) {
          this.idleFor -= dt;
          if (this.idleFor <= 0) this.target = this.pickTarget();
        } else if (Math.hypot(pos.x - this.post.x, pos.z - this.post.z) > 0.05) {
          // An animation interrupted the walk to the battle spot.
          this.target = new THREE.Vector2(this.post.x, this.post.z);
        }
      }
    }
    if (walking) this.walkPhase += dt * 10;
    hopY += walking ? Math.abs(Math.sin(this.walkPhase)) * 0.06 : 0;

    this.group.scale.setScalar(this.scale * scaleMul);
    this.body.position.set(Math.sin(this.heading) * lunge + shake, hopY, Math.cos(this.heading) * lunge);
    const roll = this.fainted ? 1.35 : walking ? Math.sin(this.walkPhase) * 0.1 : 0;
    this.body.rotation.set(tilt, this.heading + spin, roll);
    this.body.scale.set(1 + squash, 1 - squash, 1 + squash);

    for (const { mat } of this.tinted) {
      mat.emissive.setHex(flashColor);
      mat.emissiveIntensity = flash * 0.8;
    }

    // Face.
    this.blinkIn -= dt;
    const closed = sleeping || this.fainted || this.blinkIn < 0.12 || this.anim?.kind === 'cower';
    for (const e of this.eyes) e.scale.y = closed ? 0.15 : 1.15 * this.eyeOpen;
    if (this.blinkIn < 0) this.blinkIn = 2 + this.rand() * 3;
    const happy = mood >= 60 && !sick;
    const sad = mood < 30 || sick || this.fainted || this.anim?.kind === 'cower' || this.anim?.kind === 'hurt';
    this.smile.visible = happy && !sad;
    this.frown.visible = sad;
    this.flat.visible = !this.smile.visible && !this.frown.visible;

    this.sweat.visible = sick;
    this.sweat.position.y = this.sweatY - ((time * 0.4) % 1) * 0.25;

    for (const w of this.wings) {
      const flap = sleeping ? 0.1 : walking || this.anim ? 0.6 : 0.25;
      w.rotation.y = w.userData.side * (0.4 + Math.sin(time * (walking ? 14 : 4)) * flap);
    }
    if (this.orb) {
      this.orb.rotation.y = time * 1.6;
      this.orb.position.y = this.orbY + Math.sin(time * 2.3) * 0.04;
    }

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
