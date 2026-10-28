import * as THREE from 'three';
import type { Dropping, ElementType } from '../sim/types';
import { Effects } from './effects';
import { Egg3D } from './egg3d';
import { GROUND_Y, Island } from './island';
import { Pet3D } from './pet3d';
import { Sky, skyAt } from './sky';
import { toon } from './toon';

const PITCH = 0.3;
const TARGET = new THREE.Vector3(0, -0.1, 0);
const VERTICAL_FOV = 34;
/** World-space half extents the camera keeps in view. */
const HALF_WIDTH = 3.7;
const HALF_HEIGHT = 2.8;

export interface Insets {
  top: number;
  bottom: number;
}

/** Owns the renderer, camera, lights and all scene objects. */
export class World {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(VERTICAL_FOV, 1, 0.1, 200);
  readonly egg: Egg3D;
  readonly effects = new Effects();
  pet: Pet3D | null = null;
  private droppings = new Map<number, THREE.Group>();
  private droppingMats = [toon('#9a6b4c'), toon('#a87756'), toon('#b5845f')];

  private sky = new Sky();
  private island: Island;
  private hemi = new THREE.HemisphereLight('#ffffff', '#c9a27e', 1.6);
  private sun = new THREE.DirectionalLight('#fff3e0', 2.2);
  private raycaster = new THREE.Raycaster();
  private yaw = 0;
  private yawVel = 0;
  private distance = 20;
  private insets: Insets = { top: 0, bottom: 0 };

  constructor(
    private canvas: HTMLCanvasElement,
    seed: number,
  ) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'low-power' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.island = new Island(seed);
    this.egg = new Egg3D(seed);
    this.sun.position.set(4, 7, 5);
    this.scene.add(this.sky.group, this.island.group, this.egg.group, this.effects.group, this.hemi, this.sun);
    this.resize();
  }

  /** Keep the island centered in the free space between the HUD card and the dock. */
  setInsets(insets: Insets): void {
    this.insets = insets;
    this.resize();
  }

  resize(): void {
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    const freeH = Math.max(h * 0.35, h - this.insets.top - this.insets.bottom);
    const tanV = Math.tan(THREE.MathUtils.degToRad(VERTICAL_FOV / 2));
    const fitWidth = HALF_WIDTH / (tanV * this.camera.aspect);
    const fitHeight = HALF_HEIGHT / (tanV * (freeH / h));
    this.distance = Math.max(fitWidth, fitHeight, 9);
    const freeCenter = this.insets.top + freeH / 2;
    this.camera.setViewOffset(w, h, 0, h / 2 - freeCenter, w, h);
    this.camera.updateProjectionMatrix();
  }

  orbit(dxPixels: number): void {
    this.yawVel = 0;
    this.yaw += dxPixels * 0.006;
  }

  release(vxPixelsPerSec: number): void {
    this.yawVel = vxPixelsPerSec * 0.006;
  }

  /** Returns what is under a screen point. */
  pick(clientX: number, clientY: number): 'egg' | 'pet' | null {
    const rect = this.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    if (this.pet && this.raycaster.intersectObject(this.pet.group, true).length) return 'pet';
    if (this.egg.group.visible && this.raycaster.intersectObjects(this.egg.hitTargets, true).length) return 'egg';
    return null;
  }

  showPet(type: ElementType, seed: number, stage: number, animate: boolean): Pet3D {
    if (this.pet) this.scene.remove(this.pet.group);
    this.pet = new Pet3D(type, seed);
    this.pet.setStage(stage, false);
    if (animate) this.pet.pop();
    this.scene.add(this.pet.group);
    this.egg.setHatched(true);
    return this.pet;
  }

  removePet(): void {
    if (this.pet) this.scene.remove(this.pet.group);
    this.pet = null;
    this.egg.setHatched(false);
    this.setDroppings([]);
  }

  /** Keep the droppings on the island in sync with the simulation; returns positions of removed ones. */
  setDroppings(list: Dropping[]): THREE.Vector3[] {
    const removed: THREE.Vector3[] = [];
    const keep = new Set(list.map((d) => d.at));
    for (const [at, mesh] of this.droppings) {
      if (keep.has(at)) continue;
      removed.push(mesh.position.clone());
      this.scene.remove(mesh);
      this.droppings.delete(at);
    }
    for (const d of list) {
      if (this.droppings.has(d.at)) continue;
      const g = new THREE.Group();
      const sizes: [number, number, number][] = [
        [0.17, 0.09, 0.07],
        [0.12, 0.08, 0.17],
        [0.07, 0.07, 0.26],
      ];
      sizes.forEach(([r, h, y], i) => {
        const blob = new THREE.Mesh(new THREE.SphereGeometry(r, 12, 8), this.droppingMats[i]);
        blob.scale.y = h / r;
        blob.position.y = y;
        g.add(blob);
      });
      g.position.set(Math.cos(d.angle) * d.dist, GROUND_Y, Math.sin(d.angle) * d.dist);
      this.scene.add(g);
      this.droppings.set(d.at, g);
    }
    return removed;
  }

  droppingPositions(): THREE.Vector3[] {
    return [...this.droppings.values()].map((g) => g.position.clone().setY(GROUND_Y + 0.35));
  }

  render(dt: number, time: number, hour: number, lightsOff: boolean): void {
    if (Math.abs(this.yawVel) > 0.001) {
      this.yaw += this.yawVel * dt;
      this.yawVel *= Math.pow(0.04, dt);
    }
    this.yaw = THREE.MathUtils.clamp(this.yaw, -1.1, 1.1);
    const d = this.distance;
    this.camera.position.set(
      TARGET.x + Math.sin(this.yaw) * Math.cos(PITCH) * d,
      TARGET.y + Math.sin(PITCH) * d,
      TARGET.z + Math.cos(this.yaw) * Math.cos(PITCH) * d,
    );
    this.camera.lookAt(TARGET);

    const look = skyAt(hour);
    const dim = lightsOff ? 0.35 : 1;
    if (lightsOff) {
      look.top.lerp(new THREE.Color('#10132e'), 0.7);
      look.bottom.lerp(new THREE.Color('#1f2350'), 0.7);
      look.night = 1;
    }
    this.sky.update(hour, look, this.camera);
    this.hemi.intensity = 1.6 * look.light * dim;
    this.sun.intensity = 2.2 * look.light * dim;
    this.hemi.color.set(lightsOff || look.night > 0.5 ? '#b9c2ff' : '#ffffff');

    this.island.update(time, dt);
    this.effects.update(dt);
    this.pet?.update(dt, time);
    this.renderer.render(this.scene, this.camera);
  }
}
