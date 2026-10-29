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

/** Spots on the island the pet steers around: x, z and radius. */
export type Obstacle = [number, number, number];

type TreeKind = 'round' | 'pine' | 'blossom' | 'apple';

const blob = (r: number, color: string, detail = 1) =>
  new THREE.Mesh(facet(new THREE.IcosahedronGeometry(r, detail)), toon(color));

function tree(kind: TreeKind, rand: () => number): THREE.Group {
  const g = new THREE.Group();
  const trunkColor = kind === 'blossom' ? '#b98a68' : '#a6764f';
  const trunkHeight = kind === 'pine' ? 0.7 : 1;
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.15, trunkHeight, 7), toon(trunkColor));
  trunk.position.y = trunkHeight / 2;
  g.add(trunk);
  if (kind === 'pine') {
    // Three stacked cones, each a little narrower.
    const shades = ['#4f9a6a', '#5aa874', '#68b781'];
    [0.72, 0.56, 0.4].forEach((r, i) => {
      const cone = new THREE.Mesh(facet(new THREE.ConeGeometry(r, 0.8, 7)), toon(shades[i]));
      cone.position.y = 0.75 + i * 0.45;
      cone.rotation.y = rand() * Math.PI;
      g.add(cone);
    });
    return g;
  }
  const palette =
    kind === 'blossom' ? ['#ffc1d6', '#ffb0c8', '#ffd6e4'] : rand() < 0.5 ? ['#73c285', '#62b275', '#8fd69e'] : ['#7fcb7a', '#6bbb6a', '#9ddc8f'];
  const blobs: [number, number, number, number, number][] = [
    [0, 1.35, 0, 0.62, 0],
    [-0.42, 1.1, 0.1, 0.42, 1],
    [0.42, 1.12, -0.05, 0.45, 1],
    [-0.1, 1.75, 0.1, 0.36, 2],
  ];
  for (const [x, y, z, r, c] of blobs) {
    const m = blob(r * (0.9 + rand() * 0.2), palette[c]);
    m.position.set(x, y, z);
    g.add(m);
  }
  if (kind === 'apple') {
    const apple = toon('#f2564a');
    for (let i = 0; i < 5; i++) {
      const a = rand() * Math.PI * 2;
      const fruit = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 6), apple);
      fruit.position.set(Math.cos(a) * 0.55, 1.0 + rand() * 0.6, Math.sin(a) * 0.45 + 0.15);
      g.add(fruit);
    }
  }
  return g;
}

function bush(rand: () => number): THREE.Group {
  const g = new THREE.Group();
  const greens = ['#5fae70', '#6dbe7e', '#7cc98a'];
  const n = 2 + Math.floor(rand() * 2);
  for (let i = 0; i < n; i++) {
    const r = 0.18 + rand() * 0.1;
    const m = blob(r, greens[i % greens.length], 0);
    m.position.set((i - (n - 1) / 2) * 0.22, r * 0.8, (rand() - 0.5) * 0.15);
    m.scale.y = 0.85;
    g.add(m);
  }
  // Some bushes carry berries or little flowers.
  const extra = rand();
  if (extra < 0.45) {
    const color = extra < 0.2 ? '#e2465a' : extra < 0.32 ? '#6c7bd9' : '#ffffff';
    const mat = toon(color);
    for (let i = 0; i < 6; i++) {
      const dot = new THREE.Mesh(new THREE.SphereGeometry(0.035, 6, 4), mat);
      const a = rand() * Math.PI * 2;
      dot.position.set(Math.cos(a) * 0.22, 0.18 + rand() * 0.15, Math.sin(a) * 0.12 + 0.1);
      g.add(dot);
    }
  }
  return g;
}

function rock(size: number, color: string, rand: () => number): THREE.Mesh {
  const r = new THREE.Mesh(new THREE.DodecahedronGeometry(size, 0), toon(color));
  r.position.y = GROUND_Y + size * 0.45;
  r.rotation.set(rand(), rand() * 3, rand());
  r.scale.y = 0.75 + rand() * 0.35;
  return r;
}

/** A small pond: water set into the grass, a stone rim, a lily pad and sometimes reeds. */
function pond(radius: number, rand: () => number): { group: THREE.Group; shine: THREE.Mesh; pad: THREE.Object3D } {
  const g = new THREE.Group();
  const squash = 0.72;
  const bank = new THREE.Mesh(new THREE.CircleGeometry(radius * 1.12, 28), toon('#7fbf88'));
  bank.rotation.x = -Math.PI / 2;
  bank.scale.y = squash;
  bank.position.y = GROUND_Y + 0.004;
  const water = new THREE.Mesh(new THREE.CircleGeometry(radius, 28), toon('#6fbfe6'));
  water.rotation.x = -Math.PI / 2;
  water.scale.y = squash;
  water.position.y = GROUND_Y + 0.008;
  const shine = new THREE.Mesh(new THREE.CircleGeometry(radius * 0.3, 16), toon('#c4ecfb'));
  shine.rotation.x = -Math.PI / 2;
  shine.scale.y = 0.4;
  shine.position.set(-radius * 0.3, GROUND_Y + 0.012, -radius * 0.25);
  g.add(bank, water, shine);

  const stoneMat = toon('#c8c3d6');
  const stones = 7 + Math.floor(rand() * 4);
  for (let i = 0; i < stones; i++) {
    const a = (i / stones) * Math.PI * 2 + rand() * 0.3;
    const sz = 0.05 + rand() * 0.05;
    const stone = new THREE.Mesh(new THREE.DodecahedronGeometry(sz, 0), stoneMat);
    stone.position.set(Math.cos(a) * radius * 1.08, GROUND_Y + sz * 0.4, Math.sin(a) * radius * 1.08 * squash);
    stone.rotation.set(rand(), rand(), rand());
    g.add(stone);
  }

  const pad = new THREE.Group();
  const leaf = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.012, 12, 1, false, 0.3, Math.PI * 2 - 0.6), toon('#5cae6c'));
  pad.add(leaf);
  if (rand() < 0.6) {
    const bloom = new THREE.Mesh(new THREE.SphereGeometry(0.045, 8, 6), toon('#ffb0c4'));
    bloom.position.set(0.02, 0.03, 0.01);
    pad.add(bloom);
  }
  pad.position.set(radius * 0.35, GROUND_Y + 0.016, radius * 0.15 * squash);
  g.add(pad);

  if (rand() < 0.6) {
    const reed = toon('#6aa86f');
    for (let i = 0; i < 3; i++) {
      const blade = new THREE.Mesh(new THREE.ConeGeometry(0.025, 0.35 + rand() * 0.15, 4), reed);
      blade.position.set(-radius * 0.85 + i * 0.07, GROUND_Y + 0.18, -radius * 0.45 * squash + rand() * 0.05);
      blade.rotation.z = (rand() - 0.5) * 0.3;
      g.add(blade);
    }
  }
  return { group: g, shine, pad };
}

/** Places decorations without overlapping each other or the spots the game needs free. */
class Layout {
  private taken: Obstacle[] = [];

  constructor(
    private rand: () => number,
    keepClear: Obstacle[],
  ) {
    this.taken.push(...keepClear);
  }

  /** A free spot inside the ring [minD, maxD] from the center, or null if none was found. */
  place(radius: number, minD: number, maxD: number, ok: (x: number, z: number) => boolean = () => true): [number, number] | null {
    for (let tries = 0; tries < 40; tries++) {
      const a = this.rand() * Math.PI * 2;
      const d = minD + this.rand() * (maxD - minD);
      const x = Math.cos(a) * d;
      const z = Math.sin(a) * d;
      if (!ok(x, z)) continue;
      if (this.taken.some(([ox, oz, r]) => Math.hypot(x - ox, z - oz) < r + radius)) continue;
      this.taken.push([x, z, radius]);
      return [x, z];
    }
    return null;
  }
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

  /** Where the pet must not walk: trees, bushes, rocks and the pond of this particular island. */
  readonly obstacles: Obstacle[] = [];
  private shine: THREE.Mesh | null = null;
  private pad: THREE.Object3D | null = null;

  /** Every island is laid out from its egg's seed: different trees, bushes, rocks, and sometimes a pond. */
  constructor(seed: number) {
    const rand = mulberry32(seed ^ 0x51a4d);
    this.group.add(floatingRock(3.1, 3.4, 1));

    // Spots that stay free: the nest, the hatched shell, both battle spots, and a margin at the rim.
    const layout = new Layout(rand, [
      [0, 0, 1.0],
      [0.95, 0.35, 0.55],
      [-1.35, 0.55, 0.7],
      [1.35, 0.55, 0.7],
    ]);
    const add = (obj: THREE.Object3D, x: number, z: number, block: number) => {
      obj.position.x = x;
      obj.position.z = z;
      this.group.add(obj);
      if (block > 0) this.obstacles.push([x, z, block]);
    };
    // Tall things stay at the back and sides, where they never hide the pet from the camera.
    const behind = (x: number, z: number) => z < -0.35 || (Math.abs(x) > 2.1 && z < 0.4);

    if (rand() < 0.4) {
      const r = 0.55 + rand() * 0.2;
      const spot = layout.place(r * 1.15, 1.4, 2.2, (_, z) => z < 0.45);
      if (spot) {
        const p = pond(r, rand);
        add(p.group, spot[0], spot[1], r * 1.1 + 0.25);
        this.shine = p.shine;
        this.pad = p.pad;
      }
    }

    const kinds: TreeKind[] = ['round', 'pine', 'blossom', 'apple'];
    const trees = 1 + Math.floor(rand() * 3);
    for (let i = 0; i < trees; i++) {
      const scale = 0.8 + rand() * 0.35;
      const spot = layout.place(0.75 * scale, 1.6, 2.55, behind);
      if (!spot) continue;
      const t = tree(kinds[Math.floor(rand() * kinds.length)], rand);
      t.scale.setScalar(scale);
      t.rotation.y = rand() * Math.PI * 2;
      t.position.y = GROUND_Y;
      add(t, spot[0], spot[1], 0.75 * scale + 0.3);
    }

    const bushes = 2 + Math.floor(rand() * 4);
    for (let i = 0; i < bushes; i++) {
      const scale = 0.8 + rand() * 0.5;
      const spot = layout.place(0.35 * scale, 1.5, 2.7);
      if (!spot) continue;
      const b = bush(rand);
      b.scale.setScalar(scale);
      b.rotation.y = rand() * Math.PI * 2;
      b.position.y = GROUND_Y;
      add(b, spot[0], spot[1], 0.35 * scale + 0.3);
    }

    const rockColors = ['#c8c3d6', '#bdb6cc', '#d3cdc0'];
    const rocks = 1 + Math.floor(rand() * 4);
    for (let i = 0; i < rocks; i++) {
      const size = 0.12 + rand() * 0.28;
      const spot = layout.place(size + 0.05, 1.5, 2.75);
      if (!spot) continue;
      add(rock(size, rockColors[Math.floor(rand() * rockColors.length)], rand), spot[0], spot[1], size > 0.2 ? size + 0.3 : 0);
    }

    // Flowers and grass fill the gaps, a different amount on every island.
    const flowerColors = ['#ffb0c4', '#ffffff', '#ffb0c4', '#c9b8ff', '#ffe08a'];
    const flowers = 8 + Math.floor(rand() * 12);
    for (let i = 0; i < flowers; i++) {
      const spot = layout.place(0.08, 1.3, 2.85);
      if (!spot) continue;
      const f = flower(flowerColors[Math.floor(rand() * flowerColors.length)]);
      f.position.y = GROUND_Y;
      add(f, spot[0], spot[1], 0);
    }
    const grass = toon('#5fae70');
    const blades = 16 + Math.floor(rand() * 14);
    for (let i = 0; i < blades; i++) {
      const spot = layout.place(0.04, 1.2, 2.95);
      if (!spot) continue;
      const blade = new THREE.Mesh(new THREE.ConeGeometry(0.04, 0.18, 4), grass);
      blade.position.y = GROUND_Y + 0.09;
      add(blade, spot[0], spot[1], 0);
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
    if (this.shine) this.shine.scale.x = 1 + Math.sin(time * 1.3) * 0.15;
    if (this.pad) this.pad.rotation.y = Math.sin(time * 0.4) * 0.3;
    for (const b of this.bobbers) {
      b.obj.position.y = b.base.y + Math.sin(time * b.speed + b.phase) * 0.12;
    }
    for (const c of this.clouds) {
      c.obj.position.x += c.speed * dt;
      if (c.obj.position.x > 11) c.obj.position.x = -11;
    }
  }
}
