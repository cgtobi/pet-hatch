import * as THREE from 'three';
import { mulberry32 } from '../sim/rng';
import { facet, hash3, toon } from './toon';

/** Height of the island's grassy top surface. */
export const GROUND_Y = 0.18;

function floatingRock(radius: number, depth: number, seed: number): THREE.Group {
  const g = new THREE.Group();
  const under = new THREE.ConeGeometry(radius, depth, 10, 3);
  under.rotateX(Math.PI);
  const pos = under.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    if (y > depth / 2 - 0.01) continue; // keep the top rim flat
    const n = hash3(x + seed, y, z) - 0.5;
    pos.setXYZ(i, x * (1 + n * 0.25), y + n * 0.15, z * (1 + n * 0.25));
  }
  const rock = new THREE.Mesh(facet(under), toon('#c99b74'));
  rock.position.y = -depth / 2 - 0.05;
  const lip = new THREE.Mesh(new THREE.CylinderGeometry(radius * 1.03, radius * 0.98, 0.22, 32), toon('#6dbe7e'));
  lip.position.y = -0.06;
  const top = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, 0.16, 32), toon('#9adca4'));
  top.position.y = GROUND_Y - 0.08;
  g.add(rock, lip, top);
  return g;
}

function tree(): THREE.Group {
  const g = new THREE.Group();
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.15, 1, 7), toon('#a6764f'));
  trunk.position.y = 0.5;
  g.add(trunk);
  const blobs: [number, number, number, number, string][] = [
    [0, 1.35, 0, 0.62, '#73c285'],
    [-0.42, 1.1, 0.1, 0.42, '#62b275'],
    [0.42, 1.12, -0.05, 0.45, '#62b275'],
    [-0.1, 1.75, 0.1, 0.36, '#8fd69e'],
  ];
  for (const [x, y, z, r, c] of blobs) {
    const m = new THREE.Mesh(facet(new THREE.IcosahedronGeometry(r, 1)), toon(c));
    m.position.set(x, y, z);
    g.add(m);
  }
  return g;
}

function flower(color: string): THREE.Group {
  const g = new THREE.Group();
  const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.16, 4), toon('#5fae70'));
  stem.position.y = 0.08;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 6), toon(color));
  head.position.y = 0.17;
  const eye = new THREE.Mesh(new THREE.SphereGeometry(0.028, 6, 4), toon('#ffd66b'));
  eye.position.set(0, 0.18, 0.045);
  g.add(stem, head, eye);
  return g;
}

function cloud(rand: () => number): THREE.Group {
  const g = new THREE.Group();
  const mat = toon('#ffffff');
  const n = 3 + Math.floor(rand() * 3);
  for (let i = 0; i < n; i++) {
    const r = 0.5 + rand() * 0.5;
    const m = new THREE.Mesh(new THREE.SphereGeometry(r, 12, 8), mat);
    m.position.set((i - n / 2) * 0.6, rand() * 0.3, rand() * 0.3);
    m.scale.y = 0.75;
    g.add(m);
  }
  return g;
}

interface Drifter {
  obj: THREE.Object3D;
  base: THREE.Vector3;
  phase: number;
  speed: number;
}

export class Island {
  readonly group = new THREE.Group();
  private bobbers: Drifter[] = [];
  private clouds: Drifter[] = [];

  constructor(seed: number) {
    const rand = mulberry32(seed ^ 0x51a4d);
    this.group.add(floatingRock(3.1, 3.4, 1));

    const t = tree();
    t.position.set(-1.75, GROUND_Y, -1.0);
    this.group.add(t);

    const rockMat = toon('#c8c3d6');
    for (const [x, z, s] of [
      [1.9, -0.9, 0.38],
      [2.25, -0.35, 0.2],
      [-2.3, 0.9, 0.22],
    ]) {
      const r = new THREE.Mesh(new THREE.DodecahedronGeometry(s, 0), rockMat);
      r.position.set(x, GROUND_Y + s * 0.5, z);
      r.rotation.set(rand(), rand() * 3, rand());
      this.group.add(r);
    }

    const flowerColors = ['#ffb0c4', '#ffffff', '#ffb0c4', '#c9b8ff'];
    for (let i = 0; i < 14; i++) {
      const a = rand() * Math.PI * 2;
      const d = 1.35 + rand() * 1.5;
      const x = Math.cos(a) * d;
      const z = Math.sin(a) * d;
      if (Math.hypot(x + 1.75, z + 1.0) < 0.7) continue; // keep the tree clear
      const f = flower(flowerColors[i % flowerColors.length]);
      f.position.set(x, GROUND_Y, z);
      this.group.add(f);
    }

    const grass = toon('#5fae70');
    for (let i = 0; i < 22; i++) {
      const a = rand() * Math.PI * 2;
      const d = 1.2 + rand() * 1.8;
      const blade = new THREE.Mesh(new THREE.ConeGeometry(0.04, 0.18, 4), grass);
      blade.position.set(Math.cos(a) * d, GROUND_Y + 0.09, Math.sin(a) * d);
      this.group.add(blade);
    }

    for (const [x, y, z, r, s] of [
      [4.6, -1.2, -2.5, 0.6, 2],
      [-4.8, 0.6, -3.5, 0.45, 3],
    ]) {
      const mini = floatingRock(r, r * 1.6, s);
      mini.position.set(x, y, z);
      this.group.add(mini);
      this.bobbers.push({ obj: mini, base: mini.position.clone(), phase: rand() * 6, speed: 0.6 + rand() * 0.4 });
    }

    for (let i = 0; i < 5; i++) {
      const c = cloud(rand);
      c.position.set(-9 + rand() * 18, 2.5 + rand() * 4, -6 - rand() * 8);
      c.scale.setScalar(0.8 + rand() * 0.7);
      this.group.add(c);
      this.clouds.push({ obj: c, base: c.position.clone(), phase: 0, speed: 0.15 + rand() * 0.2 });
    }
  }

  update(time: number, dt: number): void {
    for (const b of this.bobbers) {
      b.obj.position.y = b.base.y + Math.sin(time * b.speed + b.phase) * 0.12;
    }
    for (const c of this.clouds) {
      c.obj.position.x += c.speed * dt;
      if (c.obj.position.x > 11) c.obj.position.x = -11;
    }
  }
}
