import * as THREE from 'three';
import type { SunState } from '../sim/sun';
import type { Dropping, ElementType, FormId } from '../sim/types';
import { Effects } from './effects';
import { Egg3D } from './egg3d';
import { Fireflies } from './fireflies';
import { GROUND_Y, Island } from './island';
import { Pet3D, SHELL } from './pet3d';
import { Sky, skyAt } from './sky';
import { toon } from './toon';

const PITCH = 0.3;
/** Radians of island turn per pixel dragged. */
const ORBIT_SPEED = 0.006;
/** How long after a drag a battle starts turning the view back to the front. */
const BATTLE_RECENTER_MS = 1500;
/** Where the sun shines from, relative to the camera: it turns with the view so every side is lit alike. */
const SUN_OFFSET = new THREE.Vector3(4, 7, 5);
/** The island's light hangs above the front of the island and turns with the view like the sun. */
const LAMP_OFFSET = new THREE.Vector3(0.6, 3.2, 1.6);
const LAMP_INTENSITY = 22;
/** With the light off once it's dark, the island only gets this share of the (already dim) outside light. */
const DARK_ROOM = 0.55;
const UP = new THREE.Vector3(0, 1, 0);
/** Where the two sides of a battle stand (x, z, facing): your pet on the left, the opponent on the right. */
const BATTLE_SPOTS = {
  pet: [-1.35, 0.55, Math.PI / 2],
  foe: [1.35, 0.55, -Math.PI / 2],
} as const;
const TARGET = new THREE.Vector3(0, -0.1, 0);
/** During a battle the camera looks at the island top and fighters, letting the rock below go off-screen. */
const BATTLE_TARGET = new THREE.Vector3(0, 0.75, 0);
const BATTLE_HALF_HEIGHT = 1.9;
const VERTICAL_FOV = 34;
/** World-space half extents the camera keeps in view. */
const HALF_WIDTH = 3.7;
const HALF_HEIGHT = 2.8;
/**
 * How quickly the camera eases to a new framing (zoom, pan and look point), per second: opening a sheet, a
 * battle or turning the phone glides there in about half a second instead of jumping.
 */
const FRAMING_RATE = 9;
const STILL = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/** What lights the island besides the sky. */
export interface Lighting {
  /** Evening or night with the light off: the island sits in the dark. */
  dark: boolean;
  /** The light is on while it's dark outside: a warm glow over the island. */
  lamp: boolean;
}

export interface Insets {
  top: number;
  bottom: number;
  /** A sheet is open over the island: step back a little so the whole island shows in the smaller space. */
  sheet?: boolean;
}

/** How much wider the view is while a sheet is open (the camera eases back as the sheet rises). */
const SHEET_ZOOM_OUT = 1.18;

/** Owns the renderer, camera, lights and all scene objects. */
export class World {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(VERTICAL_FOV, 1, 0.1, 200);
  readonly egg: Egg3D;
  readonly effects = new Effects();
  pet: Pet3D | null = null;
  /** The opponent during a battle. */
  foe: Pet3D | null = null;
  private droppings = new Map<number, THREE.Group>();
  private droppingMats = [toon('#9a6b4c'), toon('#a87756'), toon('#b5845f')];

  private sky = new Sky();
  private island: Island;
  private hemi = new THREE.HemisphereLight('#ffffff', '#c9a27e', 1.6);
  private sun = new THREE.DirectionalLight('#fff3e0', 2.2);
  private lamp = new THREE.PointLight('#ffc27a', 0, 0, 2);
  private fireflies: Fireflies;
  private raycaster = new THREE.Raycaster();
  private yaw = 0;
  private yawVel = 0;
  /** When the player last dragged the island (ms), so a battle only re-centres the view after they let go. */
  private lastOrbit = 0;
  /** The framing resize() asks for, and the one on screen, which eases towards it. */
  private distance = 20;
  private shift = 0;
  private shown: { distance: number; shift: number; target: THREE.Vector3 } | null = null;
  private size = { w: 0, h: 0 };
  private insets: Insets = { top: 0, bottom: 0 };

  constructor(
    private canvas: HTMLCanvasElement,
    seed: number,
  ) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'low-power' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.island = new Island(seed);
    this.egg = new Egg3D(seed);
    this.fireflies = new Fireflies(seed);
    this.sun.position.copy(SUN_OFFSET);
    this.scene.add(
      this.sky.group,
      this.island.group,
      this.egg.group,
      this.effects.group,
      this.fireflies.points,
      this.hemi,
      this.sun,
      this.lamp,
    );
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
    // Battles keep their close framing; the training and battle menus step back.
    const zoomOut = this.insets.sheet && !this.foe ? SHEET_ZOOM_OUT : 1;
    const fitWidth = (HALF_WIDTH * zoomOut) / (tanV * this.camera.aspect);
    const fitHeight = (this.foe ? BATTLE_HALF_HEIGHT : HALF_HEIGHT) / (tanV * (freeH / h));
    this.distance = Math.max(fitWidth, fitHeight, 9);
    const freeCenter = this.insets.top + freeH / 2;
    this.shift = h / 2 - freeCenter;
    this.size = { w, h };
    // The aspect applies at once; zoom and pan ease there in render().
    this.applyShift(this.shown?.shift ?? this.shift);
  }

  /** Pan the view vertically so the island sits in the free space between the HUD and the dock or sheet. */
  private applyShift(shift: number): void {
    const { w, h } = this.size;
    if (w && h) this.camera.setViewOffset(w, h, 0, shift, w, h);
    this.camera.updateProjectionMatrix();
  }

  /** Dragging turns the island with the finger: moving right spins its front to the right. */
  orbit(dxPixels: number): void {
    this.yawVel = 0;
    this.yaw -= dxPixels * ORBIT_SPEED;
    this.lastOrbit = performance.now();
  }

  release(vxPixelsPerSec: number): void {
    this.yawVel = -vxPixelsPerSec * ORBIT_SPEED;
    this.lastOrbit = performance.now();
  }

  /** Returns what is under a screen point. */
  pick(clientX: number, clientY: number): 'egg' | 'pet' | 'shell' | null {
    const rect = this.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    if (this.pet && this.raycaster.intersectObject(this.pet.group, true).length) return 'pet';
    const shell = this.egg.shellTarget;
    if (shell && this.raycaster.intersectObject(shell, false).length) return 'shell';
    if (this.egg.group.visible && this.raycaster.intersectObjects(this.egg.hitTargets, true).length) return 'egg';
    return null;
  }

  showPet(type: ElementType, seed: number, stage: number, form: FormId, animate: boolean): Pet3D {
    if (this.pet) this.scene.remove(this.pet.group);
    this.pet = new Pet3D(type, seed, form);
    this.pet.obstacles.push(...this.island.obstacles);
    this.pet.setForm(form, stage, false);
    if (animate) this.pet.pop();
    this.scene.add(this.pet.group);
    this.egg.setHatched(true);
    return this.pet;
  }

  /** Bring in an opponent and line both creatures up for a battle. */
  startBattle(type: ElementType, seed: number, form: FormId, stage: number): Pet3D {
    this.endBattle();
    const [x, z, heading] = BATTLE_SPOTS.foe;
    this.foe = new Pet3D(type, seed, form);
    this.foe.setForm(form, stage, false);
    this.foe.placeAt(x, z, heading);
    this.foe.hold(x, z, heading);
    this.foe.pop();
    this.scene.add(this.foe.group);
    this.pet?.hold(...BATTLE_SPOTS.pet);
    this.egg.setShellVisible(false);
    this.resize();
    return this.foe;
  }

  endBattle(): void {
    if (this.foe) this.scene.remove(this.foe.group);
    this.foe = null;
    this.pet?.release();
    this.egg.setShellVisible(true);
    this.resize();
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
      g.position.copy(this.clearSpot(Math.cos(d.angle) * d.dist, Math.sin(d.angle) * d.dist));
      this.scene.add(g);
      this.droppings.set(d.at, g);
    }
    return removed;
  }

  /** Nudge a spot out of any pond, tree or bush it landed in (droppings are placed by the simulation). */
  private clearSpot(x: number, z: number): THREE.Vector3 {
    for (const [ox, oz, r] of this.island.obstacles) {
      const dx = x - ox;
      const dz = z - oz;
      const d = Math.hypot(dx, dz);
      if (d >= r) continue;
      const k = d > 0.001 ? r / d : 1;
      x = ox + (d > 0.001 ? dx : r) * k;
      z = oz + (d > 0.001 ? dz : 0) * k;
    }
    return new THREE.Vector3(x, GROUND_Y, z);
  }

  /** Age the hatched shell (0 … 1 = gone) or sweep it away; once gone, the pet may walk on that spot. */
  updateShell(age: number, swept: boolean): void {
    this.egg.setShellAge(age, swept);
    if (this.pet && !this.egg.shellPresent) this.pet.obstacles = this.pet.obstacles.filter((o) => o !== SHELL);
  }

  droppingPositions(): THREE.Vector3[] {
    return [...this.droppings.values()].map((g) => g.position.clone().setY(GROUND_Y + 0.35));
  }

  render(dt: number, time: number, sun: SunState, lighting: Lighting): void {
    if (Math.abs(this.yawVel) > 0.001) {
      this.yaw += this.yawVel * dt;
      this.yawVel *= Math.pow(0.04, dt);
    }
    // The island turns freely all the way round; keep the angle within one turn.
    this.yaw = THREE.MathUtils.euclideanModulo(this.yaw + Math.PI, Math.PI * 2) - Math.PI;
    // In a battle, drift back to the front view (where the two fighters stand side by side) once the player lets go.
    if (this.foe && performance.now() - this.lastOrbit > BATTLE_RECENTER_MS) {
      this.yawVel = 0;
      this.yaw -= this.yaw * Math.min(1, dt * 2);
    }
    // Ease zoom, pan and look point towards what the layout asks for.
    const goal = this.foe ? BATTLE_TARGET : TARGET;
    if (!this.shown) this.shown = { distance: this.distance, shift: this.shift, target: goal.clone() };
    const shown = this.shown;
    const k = STILL ? 1 : 1 - Math.exp(-dt * FRAMING_RATE);
    shown.distance += (this.distance - shown.distance) * k;
    shown.target.lerp(goal, k);
    // Within half a pixel, settle exactly, so the projection stops being rebuilt every frame.
    const shift = Math.abs(this.shift - shown.shift) < 0.5 ? this.shift : shown.shift + (this.shift - shown.shift) * k;
    if (shift !== shown.shift) {
      shown.shift = shift;
      this.applyShift(shift);
    }
    const d = shown.distance;
    const target = shown.target;
    this.camera.position.set(
      target.x + Math.sin(this.yaw) * Math.cos(PITCH) * d,
      target.y + Math.sin(PITCH) * d,
      target.z + Math.cos(this.yaw) * Math.cos(PITCH) * d,
    );
    this.camera.lookAt(target);
    this.sun.position.copy(SUN_OFFSET).applyAxisAngle(UP, this.yaw);
    this.lamp.position.copy(LAMP_OFFSET).applyAxisAngle(UP, this.yaw);
    if (this.pet) this.pet.viewYaw = this.yaw;

    // The sky follows the time of day only; the island's own light just changes how the island is lit.
    const look = skyAt(sun);
    const halfWidth = Math.atan(Math.tan(THREE.MathUtils.degToRad(VERTICAL_FOV / 2)) * this.camera.aspect);
    this.sky.update(sun, look, this.yaw, halfWidth, time, dt);
    const dim = lighting.dark ? DARK_ROOM : 1;
    this.hemi.intensity = 1.6 * look.light * dim;
    this.sun.intensity = 2.2 * look.light * dim;
    this.sun.color.copy(look.sunColor);
    this.hemi.color.set('#ffffff').lerp(new THREE.Color('#b9c2ff'), look.night);
    this.lamp.intensity = lighting.lamp ? LAMP_INTENSITY * (1 - look.light) : 0;
    this.fireflies.update(time, 1 - look.light);

    this.island.update(time, dt);
    this.effects.update(dt);
    this.pet?.update(dt, time);
    this.foe?.update(dt, time);
    this.renderer.render(this.scene, this.camera);
  }
}
