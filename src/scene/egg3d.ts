import * as THREE from 'three';
import type { Leaning } from '../sim/egg';
import { mulberry32 } from '../sim/rng';
import { GROUND_Y } from './island';
import { facet, toon } from './toon';

const TEX_W = 512;
const TEX_H = 256;
const EGG_HEIGHT = 1.24;
const SPECKLE_COLORS = { ember: '#f5a36c', tide: '#7cc0ea', bloom: '#86cfa0', none: '#e5d2b8' };

function eggProfile(from = 0, to = 1, steps = 32): THREE.Vector2[] {
  const pts: THREE.Vector2[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = (from + ((to - from) * i) / steps) * Math.PI;
    const r = 0.47 * Math.sin(t) * (1 + 0.12 * Math.cos(t));
    pts.push(new THREE.Vector2(Math.max(r, 0.0001), ((1 - Math.cos(t)) / 2) * EGG_HEIGHT));
  }
  return pts;
}

export interface EggLook {
  /** 0 … 1 how far the cracks have spread. */
  crack: number;
  leaning: Leaning;
  failed: boolean;
}

/** Egg in its nest: procedural speckles and cracks, a spring wobble and a warm glow. */
export class Egg3D {
  readonly group = new THREE.Group();
  readonly hitTargets: THREE.Object3D[] = [];
  private pivot = new THREE.Group();
  private spinner = new THREE.Group();
  private mesh: THREE.Mesh<THREE.LatheGeometry, THREE.MeshToonMaterial>;
  private shellBottom: THREE.Mesh;
  private glow: THREE.Sprite;
  private ctx: CanvasRenderingContext2D;
  private emCtx: CanvasRenderingContext2D;
  private tex: THREE.CanvasTexture;
  private emTex: THREE.CanvasTexture;
  private speckles: { x: number; y: number; r: number; roll: number }[] = [];
  private cracks: { x: number; y: number }[][] = [];
  private lookKey = '';

  // Spring wobble state (tilt around X and Z).
  private tilt = new THREE.Vector2();
  private tiltVel = new THREE.Vector2();
  private hop = 0;
  private hopVel = 0;
  private spinTarget = 0;
  private glowPulse = 0;

  constructor(seed: number) {
    const rand = mulberry32(seed ^ 0xe66);
    for (let i = 0; i < 46; i++) {
      this.speckles.push({ x: rand() * TEX_W, y: 30 + rand() * 200, r: 3 + rand() * 7, roll: rand() });
    }
    for (let c = 0; c < 7; c++) {
      let x = (c / 7) * TEX_W + rand() * 40;
      let y = 55 + rand() * 60;
      const crack = [{ x, y }];
      for (let s = 0; s < 10; s++) {
        x += (8 + rand() * 12) * (c % 2 ? 1 : -1);
        y += (s % 2 ? -1 : 1) * (5 + rand() * 9) + (rand() - 0.4) * 6;
        crack.push({ x, y });
      }
      this.cracks.push(crack);
    }

    const canvas = document.createElement('canvas');
    canvas.width = TEX_W;
    canvas.height = TEX_H;
    this.ctx = canvas.getContext('2d')!;
    const emCanvas = document.createElement('canvas');
    emCanvas.width = TEX_W;
    emCanvas.height = TEX_H;
    this.emCtx = emCanvas.getContext('2d')!;
    this.tex = new THREE.CanvasTexture(canvas);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.emTex = new THREE.CanvasTexture(emCanvas);
    this.emTex.colorSpace = THREE.SRGBColorSpace;

    this.mesh = new THREE.Mesh(
      new THREE.LatheGeometry(eggProfile(), 48),
      toon('#ffffff', { map: this.tex, emissive: '#ffffff', emissiveMap: this.emTex, emissiveIntensity: 0 }),
    );
    this.spinner.add(this.mesh);
    this.pivot.add(this.spinner);
    this.pivot.position.y = 0.06;

    // Lower shell half with a jagged rim, left behind after hatching.
    const half = new THREE.LatheGeometry(eggProfile(0, 0.52, 16), 24);
    const pos = half.attributes.position;
    const uv = half.attributes.uv;
    for (let i = 0; i < pos.count; i++) {
      if (uv.getY(i) > 0.999) pos.setY(i, pos.getY(i) + (i % 2 ? 0.08 : -0.05));
    }
    half.computeVertexNormals();
    this.shellBottom = new THREE.Mesh(half, toon('#fff4e2', { side: THREE.DoubleSide }));
    // Tipped over beside the nest, so the baby stands in the open.
    this.shellBottom.position.set(0.95, 0.22, 0.35);
    this.shellBottom.rotation.set(0.3, 0.6, -1.25);
    this.shellBottom.visible = false;

    const nest = this.buildNest(rand);
    this.glow = this.buildGlow();
    this.group.add(this.glow, nest, this.pivot, this.shellBottom);
    this.group.position.y = GROUND_Y;
    // An invisible, generous tap target so a hopping egg is still easy to hit.
    const hit = new THREE.Mesh(new THREE.SphereGeometry(0.85, 12, 8), new THREE.MeshBasicMaterial({ visible: false }));
    hit.scale.y = 1.15;
    hit.position.y = 0.6;
    this.pivot.add(hit);
    this.hitTargets.push(hit, nest);
    this.draw({ crack: 0, leaning: { ember: 0, tide: 0, bloom: 0, total: 0, label: 'Unknown' }, failed: false });
  }

  private buildNest(rand: () => number): THREE.Group {
    const nest = new THREE.Group();
    const ring = new THREE.Mesh(facet(new THREE.TorusGeometry(0.6, 0.2, 8, 20)), toon('#b9845a'));
    ring.rotation.x = Math.PI / 2;
    ring.scale.z = 0.6;
    ring.position.y = 0.08;
    const bed = new THREE.Mesh(new THREE.CircleGeometry(0.55, 20), toon('#8f6343'));
    bed.rotation.x = -Math.PI / 2;
    bed.position.y = 0.04;
    nest.add(ring, bed);
    const twigMats = [toon('#a8744c'), toon('#cf9c6e')];
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2 + rand() * 0.3;
      const twig = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.5, 4), twigMats[i % 2]);
      twig.position.set(Math.cos(a) * 0.66, 0.14 + rand() * 0.05, Math.sin(a) * 0.66);
      twig.rotation.set(Math.PI / 2 + (rand() - 0.5) * 0.6, -a, (rand() - 0.5) * 0.5);
      nest.add(twig);
    }
    return nest;
  }

  private buildGlow(): THREE.Sprite {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const g = c.getContext('2d')!;
    const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 128, 128);
    const tex = new THREE.CanvasTexture(c);
    const sprite = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: tex,
        color: '#ffd98a',
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    sprite.position.y = 0.65;
    sprite.scale.setScalar(2.8);
    return sprite;
  }

  /** Repaint speckles and cracks; skipped when nothing visible changed. */
  draw(look: EggLook): void {
    const l = look.leaning;
    const segs = this.cracks.reduce((n, c) => n + c.length - 1, 0);
    const shown = Math.round(look.crack * segs);
    const key = `${shown}|${l.label}|${l.ember.toFixed(2)}|${l.tide.toFixed(2)}|${look.failed}`;
    if (key === this.lookKey) return;
    this.lookKey = key;

    const { ctx, emCtx } = this;
    ctx.fillStyle = '#fff4e2';
    ctx.fillRect(0, 0, TEX_W, TEX_H);
    emCtx.fillStyle = '#000000';
    emCtx.fillRect(0, 0, TEX_W, TEX_H);

    for (const s of this.speckles) {
      ctx.fillStyle =
        l.total < 1
          ? SPECKLE_COLORS.none
          : s.roll < l.ember
            ? SPECKLE_COLORS.ember
            : s.roll < l.ember + l.tide
              ? SPECKLE_COLORS.tide
              : SPECKLE_COLORS.bloom;
      for (const dx of [-TEX_W, 0, TEX_W]) {
        ctx.beginPath();
        ctx.ellipse(s.x + dx, s.y, s.r * 1.2, s.r, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Grow all cracks together: segment k of every crack before segment k+1 of any.
    const lines: [{ x: number; y: number }, { x: number; y: number }][] = [];
    for (let k = 0; lines.length < shown; k++) {
      for (const c of this.cracks) {
        if (k + 1 < c.length && lines.length < shown) lines.push([c[k], c[k + 1]]);
      }
      if (k > 20) break;
    }
    for (const [ctx2, color, width] of [
      [emCtx, '#ffd36b', 7],
      [ctx, '#8a6a55', 3],
    ] as const) {
      ctx2.strokeStyle = color;
      ctx2.lineWidth = width;
      ctx2.lineCap = 'round';
      for (const [a, b] of lines) {
        for (const dx of [-TEX_W, 0, TEX_W]) {
          ctx2.beginPath();
          ctx2.moveTo(a.x + dx, a.y);
          ctx2.lineTo(b.x + dx, b.y);
          ctx2.stroke();
        }
      }
    }
    this.mesh.material.color.set(look.failed ? '#a7a3b4' : '#ffffff');
    this.tex.needsUpdate = true;
    this.emTex.needsUpdate = true;
  }

  /** Knock the egg; direction in radians around the vertical axis. */
  nudge(strength: number, dir = Math.random() * Math.PI * 2): void {
    this.tiltVel.x += Math.cos(dir) * strength;
    this.tiltVel.y += Math.sin(dir) * strength;
  }

  jump(strength: number): void {
    this.hopVel += strength;
  }

  /** Visibly roll the egg half a turn in the swipe direction. */
  roll(direction: 1 | -1): void {
    this.spinTarget += Math.PI * direction;
    this.nudge(2.5, direction > 0 ? 0 : Math.PI);
  }

  flashCracks(): void {
    this.glowPulse = 1;
  }

  setHatched(hatched: boolean): void {
    this.pivot.visible = !hatched;
    this.shellBottom.visible = hatched;
    this.glow.visible = !hatched;
  }

  /** Tuck the old shell away so it doesn't stand between two battling creatures. */
  setShellVisible(visible: boolean): void {
    this.shellBottom.visible = visible && !this.pivot.visible;
  }

  /** World position of the egg's middle, for particle effects. */
  center(target = new THREE.Vector3()): THREE.Vector3 {
    return this.mesh.getWorldPosition(target).setY(this.group.position.y + 0.65);
  }

  update(dt: number, opts: { warmth: number; ready: boolean }): void {
    // Damped spring back to upright.
    const k = 55;
    const damp = 5;
    this.tiltVel.x += (-k * this.tilt.x - damp * this.tiltVel.x) * dt;
    this.tiltVel.y += (-k * this.tilt.y - damp * this.tiltVel.y) * dt;
    this.tilt.addScaledVector(this.tiltVel, dt);
    this.pivot.rotation.x = this.tilt.x * 0.25;
    this.pivot.rotation.z = this.tilt.y * 0.25;

    this.hopVel -= 9.8 * dt;
    this.hop += this.hopVel * dt;
    if (this.hop < 0) {
      this.hop = 0;
      this.hopVel = 0;
    }
    this.pivot.position.y = 0.06 + this.hop;

    this.spinner.rotation.y += (this.spinTarget - this.spinner.rotation.y) * Math.min(1, dt * 6);

    this.glowPulse = Math.max(0, this.glowPulse - dt * 2.5);
    const breathe = opts.ready ? 0.5 + 0.5 * Math.sin(performance.now() / 180) : 0;
    this.mesh.material.emissiveIntensity = Math.max(breathe * 0.9, this.glowPulse * 1.4);
    const glowMat = this.glow.material as THREE.SpriteMaterial;
    glowMat.opacity = 0.12 + (opts.warmth / 100) * 0.5 + breathe * 0.3 + this.glowPulse * 0.4;
  }
}
