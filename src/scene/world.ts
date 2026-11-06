import * as THREE from 'three';
import type { SunState } from '../sim/sun';
import type { Dropping, ElementType, FormId } from '../sim/types';
import { Effects } from './effects';
import { Egg3D } from './egg3d';
import { Fireflies } from './fireflies';
import { GROUND_Y, Island, type Obstacle } from './island';
import { Ball3D } from './ball';
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
/** The egg in the nest, in the island's middle: creatures walk around it while it is there. */
const EGG_SPOT: Obstacle = [0, 0, 0.5];
const NEST = new THREE.Vector2(0, 0);
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

/** A ticklish spot on the pet, as seen from the camera. */
export type TickleSpot = 'left' | 'right' | 'top';

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
  /** The elder staying with its egg until it hatches (see handOver in game.ts). */
  elder: Pet3D | null = null;
  /** The toy ball for Play, and what to tell when the pet brought it back or it fell off the island. */
  private ball = new Ball3D();
  onBall: (result: 'fetched' | 'lost') => void = () => {};
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

  /** `islandSeed` lays out the island (a family keeps its island from one generation to the next). */
  constructor(
    private canvas: HTMLCanvasElement,
    islandSeed: number,
    eggSeed: number,
  ) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'low-power' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.island = new Island(islandSeed);
    this.egg = new Egg3D(eggSeed);
    this.fireflies = new Fireflies(islandSeed);
    this.sun.position.copy(SUN_OFFSET);
    this.scene.add(
      this.sky.group,
      this.island.group,
      this.egg.group,
      this.effects.group,
      this.ball.group,
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
  pick(clientX: number, clientY: number): 'egg' | 'pet' | 'elder' | 'shell' | null {
    const rect = this.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    if (this.pet && this.raycaster.intersectObject(this.pet.group, true).length) return 'pet';
    const shell = this.egg.shellTarget;
    if (shell && this.raycaster.intersectObject(shell, false).length) return 'shell';
    // The elder and its egg side by side: whichever is nearer gets the tap.
    const egg = this.egg.group.visible ? this.raycaster.intersectObjects(this.egg.hitTargets, true)[0] : undefined;
    const elder = this.elder ? this.raycaster.intersectObject(this.elder.group, true)[0] : undefined;
    if (elder && (!egg || elder.distance < egg.distance)) return 'elder';
    return egg ? 'egg' : null;
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

  // ---------- fetch ----------

  /** Where the ball waits to be thrown: on the island's edge nearest the player, which turns with the view. */
  private readySpot(distance = 2.0): THREE.Vector3 {
    return new THREE.Vector3(Math.sin(this.yaw) * distance, GROUND_Y, Math.cos(this.yaw) * distance);
  }

  /** Lay the ball out for a game of fetch. */
  playBall(): void {
    const at = this.readySpot();
    this.ball.placeReady(at.x, at.z);
  }

  /** Whether the ball lies ready for a throw. */
  get ballReady(): boolean {
    return this.ball.kind === 'ready';
  }

  /**
   * Throw the ball with a swipe, as shares of the screen's width and height, and how long it took: a longer swipe
   * throws further (about half the screen's height reaches the far edge), a quick one a little further still, and
   * a slanted one to the side. False if the ball isn't ready or the swipe wasn't upwards.
   */
  throwBall(dx: number, dy: number, ms: number): boolean {
    const up = -dy;
    if (this.ball.kind !== 'ready' || up < 0.04) return false;
    const speed = THREE.MathUtils.clamp(up / Math.max(0.1, ms / 1000) / 1.5, 0.85, 1.15);
    const distance = THREE.MathUtils.clamp((1 + 8 * up) * speed, 0.8, 6.5);
    const side = THREE.MathUtils.clamp((dx / Math.max(up, 0.05)) * distance * 0.8, -3, 3);
    const forward = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    const right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    const to = this.readySpot().addScaledVector(forward, distance).addScaledVector(right, side);
    to.y = GROUND_Y + 0.13;
    this.ball.fly(to, (inside) => {
      const pet = this.pet;
      if (!inside) {
        pet?.cower();
        setTimeout(() => {
          if (this.ball.kind === 'hidden' || this.ball.kind === 'falling') {
            const at = this.readySpot();
            this.ball.placeReady(at.x, at.z);
            this.onBall('lost');
          }
        }, 1300);
        return;
      }
      if (!pet) return this.onBall('fetched');
      // Run to the ball, pick it up, bring it back to the player and drop it there.
      pet.runTo(to.x, to.z, () => {
        this.ball.carry();
        const back = this.readySpot(1.7);
        pet.runTo(back.x, back.z, () => {
          const at = this.readySpot();
          this.ball.drop(at.x, at.z);
          pet.hop();
          this.onBall('fetched');
        });
      });
    });
    return true;
  }

  /** Put the ball away. */
  endBall(): void {
    this.ball.hide();
    this.pet?.stopRunning();
  }

  // ---------- the elder and its egg ----------

  /**
   * Elder week: the egg it found rests in the nest, plain until it wakes. The pet keeps around it and doesn't
   * walk through it.
   */
  setRestingEgg(on: boolean): void {
    if (on === this.restingEgg) return;
    this.restingEgg = on;
    this.egg.setHatched(!on);
    if (on) this.egg.draw({ crack: 0, mix: null, failed: false });
    if (this.pet) {
      this.pet.obstacles = this.pet.obstacles.filter((o) => o !== EGG_SPOT);
      if (on) this.pet.obstacles.push(EGG_SPOT);
      this.pet.near = on ? NEST : null;
      // Standing in the nest, it steps aside for the egg.
      const at = this.pet.group.position;
      if (on && Math.hypot(at.x, at.z) < EGG_SPOT[2]) this.pet.placeAt(0.85, -0.3, 0);
    }
  }
  private restingEgg = false;

  /** The elder beside its waking egg: it strolls about the nest and stays close to the egg. */
  showElder(type: ElementType, seed: number, form: FormId): Pet3D {
    if (this.elder) this.scene.remove(this.elder.group);
    const elder = new Pet3D(type, seed, form);
    elder.obstacles.push(...this.island.obstacles, EGG_SPOT);
    elder.setForm(form, 4, false);
    elder.near = NEST;
    elder.placeAt(0.85, -0.3, 0);
    this.scene.add(elder.group);
    this.elder = elder;
    return elder;
  }

  /** Goodbye: the elder walks to the far edge of the island, hops once and is gone in a sparkle. */
  elderLeaves(done: () => void): void {
    const elder = this.elder;
    if (!elder) return done();
    elder.near = null;
    const x = -Math.sin(this.yaw) * 1.85;
    const z = -Math.cos(this.yaw) * 1.85;
    elder.runTo(x, z, () => {
      elder.hop();
      setTimeout(() => {
        this.effects.emit('spark', elder.center(), 16);
        this.effects.emit('heart', elder.center(), 2);
        this.scene.remove(elder.group);
        if (this.elder === elder) this.elder = null;
        done();
      }, 600);
    });
  }

  // ---------- tickling ----------

  /**
   * Where the pet is ticklish: its left or right side or the top of its head as seen from the camera, a little
   * in front of the body so the glint isn't hidden by it.
   */
  tickleSpot(spot: TickleSpot, target = new THREE.Vector3()): THREE.Vector3 | null {
    if (!this.pet) return null;
    const size = this.pet.size;
    const center = this.pet.center(target);
    const right = new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld, 0).setY(0).normalize();
    const toward = this.camera.position.clone().sub(center).setY(0).normalize();
    if (spot === 'top') return center.addScaledVector(toward, 0.15 * size).setY(center.y + 0.38 * size);
    return center.addScaledVector(right, (spot === 'left' ? -0.36 : 0.36) * size).addScaledVector(toward, 0.22 * size);
  }

  /** A point in the scene as a position on the page, in CSS pixels. */
  toScreen(at: THREE.Vector3): { x: number; y: number } {
    const rect = this.canvas.getBoundingClientRect();
    const v = at.clone().project(this.camera);
    return { x: rect.left + ((v.x + 1) / 2) * rect.width, y: rect.top + ((1 - v.y) / 2) * rect.height };
  }

  /** About how big the pet looks on the page: the distance from its middle to its top, in CSS pixels. */
  petRadiusPx(): number {
    if (!this.pet) return 0;
    const center = this.pet.center();
    const a = this.toScreen(center);
    const b = this.toScreen(center.clone().setY(center.y + 0.45 * this.pet.size));
    return Math.hypot(a.x - b.x, a.y - b.y);
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
    if (this.elder) this.elder.viewYaw = this.yaw;

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
    this.elder?.update(dt, time);
    this.ball.update(dt, this.ball.kind === 'carried' && this.pet ? this.pet.mouth() : null);
    this.renderer.render(this.scene, this.camera);
  }
}
