import * as THREE from 'three';
import type { ElementType } from '../sim/types';
import { GROUND_Y } from './island';
import { toon, TYPE_COLORS } from './toon';

const BABY_SCALE = 1.3;

/** A freshly hatched baby, built from primitives; its head feature shows its element. */
export class Baby {
  readonly group = new THREE.Group();
  private body = new THREE.Group();
  private eyes: THREE.Mesh[] = [];
  private blinkIn = 2;
  private popIn = 0;

  constructor(type: ElementType) {
    const base = new THREE.Color(TYPE_COLORS[type]);
    const bodyMat = toon(base);
    const light = toon(base.clone().lerp(new THREE.Color('#ffffff'), 0.6));
    const dark = toon(base.clone().multiplyScalar(0.75));
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

    this.body.add(this.feature(type, dark));
    this.group.add(this.body);
    // Standing on the nest bed.
    this.group.position.y = GROUND_Y + 0.07;
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

  /** Start the pop-out animation. */
  pop(): void {
    this.popIn = 0.001;
  }

  update(dt: number, time: number): void {
    if (this.popIn > 0 && this.popIn < 1) this.popIn = Math.min(1, this.popIn + dt * 2.2);
    const p = this.popIn === 0 ? 1 : this.popIn;
    const overshoot = 1 + Math.sin(p * Math.PI) * 0.25;
    this.group.scale.setScalar(BABY_SCALE * p * overshoot);

    const squash = Math.sin(time * 3.2) * 0.03;
    this.body.scale.set(1 + squash, 1 - squash, 1 + squash);
    this.body.rotation.y = Math.sin(time * 0.7) * 0.35;

    this.blinkIn -= dt;
    const closed = this.blinkIn < 0.12;
    for (const e of this.eyes) e.scale.y = closed ? 0.15 : 1.15;
    if (this.blinkIn < 0) this.blinkIn = 2 + Math.random() * 3;
  }
}
