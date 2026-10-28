import * as THREE from 'three';
import type { ElementType } from '../sim/types';
import { Baby } from './baby';
import { Effects } from './effects';
import { Egg3D } from './egg3d';
import { Island } from './island';
import { Sky, skyAt } from './sky';

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
  baby: Baby | null = null;

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
  pick(clientX: number, clientY: number): 'egg' | 'baby' | null {
    const rect = this.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    if (this.baby && this.raycaster.intersectObject(this.baby.group, true).length) return 'baby';
    if (this.egg.group.visible && this.raycaster.intersectObjects(this.egg.hitTargets, true).length) return 'egg';
    return null;
  }

  showBaby(type: ElementType, animate: boolean): void {
    if (this.baby) this.scene.remove(this.baby.group);
    this.baby = new Baby(type);
    if (animate) this.baby.pop();
    this.scene.add(this.baby.group);
    this.egg.setHatched(true);
  }

  removeBaby(): void {
    if (this.baby) this.scene.remove(this.baby.group);
    this.baby = null;
    this.egg.setHatched(false);
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
    this.baby?.update(dt, time);
    this.renderer.render(this.scene, this.camera);
  }
}
