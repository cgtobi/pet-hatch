import * as THREE from 'three';
import { GROUND_Y } from './island';
import { toon } from './toon';

export type ParticleKind = 'drop' | 'heart' | 'note' | 'spark' | 'zzz';

function icon(draw: (g: CanvasRenderingContext2D) => void): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  draw(c.getContext('2d')!);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

const textures: Record<ParticleKind, () => THREE.CanvasTexture> = {
  drop: () =>
    icon((g) => {
      g.fillStyle = '#7cc0ea';
      g.beginPath();
      g.moveTo(32, 6);
      g.bezierCurveTo(32, 6, 52, 32, 52, 42);
      g.arc(32, 42, 20, 0, Math.PI);
      g.bezierCurveTo(12, 32, 32, 6, 32, 6);
      g.fill();
      g.fillStyle = 'rgba(255,255,255,0.7)';
      g.beginPath();
      g.ellipse(25, 42, 4, 7, -0.3, 0, Math.PI * 2);
      g.fill();
    }),
  heart: () =>
    icon((g) => {
      g.fillStyle = '#ff8fb1';
      g.beginPath();
      g.moveTo(32, 56);
      g.bezierCurveTo(4, 36, 6, 10, 22, 10);
      g.bezierCurveTo(28, 10, 32, 16, 32, 20);
      g.bezierCurveTo(32, 16, 36, 10, 42, 10);
      g.bezierCurveTo(58, 10, 60, 36, 32, 56);
      g.fill();
    }),
  note: () =>
    icon((g) => {
      g.fillStyle = '#4fb877';
      g.strokeStyle = '#4fb877';
      g.lineWidth = 6;
      g.beginPath();
      g.ellipse(20, 48, 11, 8, -0.4, 0, Math.PI * 2);
      g.fill();
      g.beginPath();
      g.moveTo(29, 46);
      g.lineTo(29, 10);
      g.quadraticCurveTo(44, 16, 50, 28);
      g.stroke();
    }),
  spark: () =>
    icon((g) => {
      g.fillStyle = '#ffd36b';
      g.beginPath();
      for (let i = 0; i < 8; i++) {
        const r = i % 2 ? 9 : 30;
        const a = (i / 8) * Math.PI * 2;
        g.lineTo(32 + Math.cos(a) * r, 32 + Math.sin(a) * r);
      }
      g.fill();
    }),
  zzz: () =>
    icon((g) => {
      g.fillStyle = '#ffffff';
      g.font = 'bold 44px sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText('z', 32, 34);
    }),
};

interface Particle {
  sprite: THREE.Sprite;
  vel: THREE.Vector3;
  life: number;
  maxLife: number;
  kind: ParticleKind;
  size: number;
}

interface Shard {
  mesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshToonMaterial>;
  vel: THREE.Vector3;
  spin: THREE.Vector3;
  life: number;
}

/** Pooled sprite particles (mist, hearts, notes, sparkles, z's) and eggshell shards. */
export class Effects {
  readonly group = new THREE.Group();
  private maps = new Map<ParticleKind, THREE.CanvasTexture>();
  private particles: Particle[] = [];
  private shards: Shard[] = [];

  private map(kind: ParticleKind): THREE.CanvasTexture {
    let m = this.maps.get(kind);
    if (!m) {
      m = textures[kind]();
      this.maps.set(kind, m);
    }
    return m;
  }

  private spawn(kind: ParticleKind): Particle {
    let p = this.particles.find((q) => q.life <= 0);
    if (!p) {
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ transparent: true, depthWrite: false }));
      p = { sprite, vel: new THREE.Vector3(), life: 0, maxLife: 1, kind, size: 0.2 };
      this.particles.push(p);
      this.group.add(sprite);
    }
    p.kind = kind;
    p.sprite.material.map = this.map(kind);
    p.sprite.material.needsUpdate = true;
    p.sprite.visible = true;
    return p;
  }

  emit(kind: ParticleKind, origin: THREE.Vector3, count = 1): void {
    for (let i = 0; i < count; i++) {
      const p = this.spawn(kind);
      const s = p.sprite.position.copy(origin);
      const rnd = () => Math.random() - 0.5;
      switch (kind) {
        case 'drop':
          s.add(new THREE.Vector3(rnd() * 1.2, 1.1 + Math.random() * 0.5, rnd() * 0.8));
          p.vel.set(rnd() * 0.3, -0.5, rnd() * 0.3);
          p.size = 0.14 + Math.random() * 0.08;
          p.maxLife = 1.1;
          break;
        case 'heart':
        case 'note':
          s.add(new THREE.Vector3(rnd() * 0.8, 0.2, rnd() * 0.5));
          p.vel.set(rnd() * 0.4, 0.9 + Math.random() * 0.4, 0);
          p.size = 0.22 + Math.random() * 0.08;
          p.maxLife = 1.6;
          break;
        case 'spark': {
          const a = Math.random() * Math.PI * 2;
          p.vel.set(Math.cos(a) * 1.6, 0.8 + Math.random() * 1.2, Math.sin(a) * 1.6);
          p.size = 0.12 + Math.random() * 0.1;
          p.maxLife = 0.9;
          break;
        }
        case 'zzz':
          s.add(new THREE.Vector3(0.3, 0.6, 0));
          p.vel.set(0.25, 0.35, 0);
          p.size = 0.25;
          p.maxLife = 2.4;
          break;
      }
      p.life = p.maxLife;
    }
  }

  /** Burst the shell into pieces that fly out, bounce on the grass and fade. */
  shatter(origin: THREE.Vector3, count = 26): void {
    for (let i = 0; i < count; i++) {
      const s = 0.07 + Math.random() * 0.09;
      const geo = new THREE.BufferGeometry();
      geo.setAttribute(
        'position',
        new THREE.Float32BufferAttribute([0, s, 0, -s, -s * 0.6, s * 0.3, s, -s * 0.5, -s * 0.2], 3),
      );
      geo.computeVertexNormals();
      const mesh = new THREE.Mesh(geo, toon('#fff4e2', { side: THREE.DoubleSide, transparent: true }));
      mesh.position.copy(origin).add(new THREE.Vector3(0, Math.random() * 0.5, 0));
      const a = Math.random() * Math.PI * 2;
      const v = 1.2 + Math.random() * 2;
      this.shards.push({
        mesh,
        vel: new THREE.Vector3(Math.cos(a) * v, 2.5 + Math.random() * 2.5, Math.sin(a) * v),
        spin: new THREE.Vector3(Math.random() * 10, Math.random() * 10, Math.random() * 10),
        life: 3 + Math.random(),
      });
      this.group.add(mesh);
    }
  }

  update(dt: number): void {
    for (const p of this.particles) {
      if (p.life <= 0) continue;
      p.life -= dt;
      if (p.life <= 0) {
        p.sprite.visible = false;
        continue;
      }
      if (p.kind === 'spark') p.vel.y -= 3 * dt;
      if (p.kind === 'heart' || p.kind === 'note') p.vel.x += Math.sin(p.life * 6) * dt * 0.6;
      p.sprite.position.addScaledVector(p.vel, dt);
      const t = p.life / p.maxLife;
      const grow = Math.min(1, (1 - t) * 6);
      p.sprite.scale.setScalar(p.size * grow);
      p.sprite.material.opacity = Math.min(1, t * 3);
    }

    for (let i = this.shards.length - 1; i >= 0; i--) {
      const s = this.shards[i];
      s.life -= dt;
      s.vel.y -= 9 * dt;
      s.mesh.position.addScaledVector(s.vel, dt);
      if (s.mesh.position.y < GROUND_Y + 0.03 && Math.hypot(s.mesh.position.x, s.mesh.position.z) < 3) {
        s.mesh.position.y = GROUND_Y + 0.03;
        s.vel.y *= -0.3;
        s.vel.x *= 0.6;
        s.vel.z *= 0.6;
        s.spin.multiplyScalar(0.5);
      }
      s.mesh.rotation.x += s.spin.x * dt;
      s.mesh.rotation.y += s.spin.y * dt;
      s.mesh.rotation.z += s.spin.z * dt;
      s.mesh.material.opacity = Math.min(1, s.life);
      if (s.life <= 0) {
        this.group.remove(s.mesh);
        s.mesh.geometry.dispose();
        s.mesh.material.dispose();
        this.shards.splice(i, 1);
      }
    }
  }
}
