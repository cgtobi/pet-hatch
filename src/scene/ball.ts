import * as THREE from 'three';
import { GROUND_Y } from './island';
import { toon } from './toon';

const RADIUS = 0.13;
/** A ball landing further from the middle than this is off the island and falls away. */
export const ISLAND_EDGE = 2.8;

type BallState =
  | { kind: 'hidden' }
  | { kind: 'ready' }
  | { kind: 'flying'; from: THREE.Vector3; to: THREE.Vector3; t: number; dur: number; height: number; onLand: (inside: boolean) => void }
  | { kind: 'bouncing'; t: number }
  | { kind: 'falling'; vy: number; vel: THREE.Vector3 }
  | { kind: 'resting' }
  | { kind: 'carried' };

/** The toy ball for Play: thrown by a swipe, it flies in an arc, bounces, and can be carried in the pet's mouth. */
export class Ball3D {
  readonly group = new THREE.Group();
  private state: BallState = { kind: 'hidden' };
  private spin = 0;

  constructor() {
    const ball = new THREE.Mesh(new THREE.SphereGeometry(RADIUS, 16, 12), toon('#ff6f61'));
    const stripe = new THREE.Mesh(new THREE.TorusGeometry(RADIUS * 1.001, RADIUS * 0.22, 6, 24), toon('#fff3d6'));
    this.group.add(ball, stripe);
    this.group.visible = false;
  }

  get kind(): BallState['kind'] {
    return this.state.kind;
  }

  /** Lay the ball ready to throw at this spot on the island. */
  placeReady(x: number, z: number): void {
    this.state = { kind: 'ready' };
    this.group.visible = true;
    this.group.position.set(x, GROUND_Y + RADIUS, z);
  }

  /** Throw it from where it lies to a landing spot; says on landing whether it stayed on the island. */
  fly(to: THREE.Vector3, onLand: (inside: boolean) => void): void {
    const from = this.group.position.clone();
    const dist = from.distanceTo(to);
    this.state = { kind: 'flying', from, to, t: 0, dur: 0.45 + 0.12 * dist, height: 0.6 + 0.25 * dist, onLand };
  }

  carry(): void {
    this.state = { kind: 'carried' };
  }

  /** Put it down where it is (after being carried). */
  drop(x: number, z: number): void {
    this.placeReady(x, z);
  }

  hide(): void {
    this.state = { kind: 'hidden' };
    this.group.visible = false;
  }

  /** `mouth`: where the pet holds it while carrying. */
  update(dt: number, mouth: THREE.Vector3 | null): void {
    const s = this.state;
    const pos = this.group.position;
    if (s.kind === 'flying') {
      s.t += dt;
      const p = Math.min(1, s.t / s.dur);
      pos.lerpVectors(s.from, s.to, p);
      pos.y = THREE.MathUtils.lerp(s.from.y, s.to.y, p) + Math.sin(p * Math.PI) * s.height;
      this.spin += dt * 12;
      if (p >= 1) {
        const inside = Math.hypot(s.to.x, s.to.z) <= ISLAND_EDGE;
        if (inside) this.state = { kind: 'bouncing', t: 0 };
        else {
          const dir = new THREE.Vector3(s.to.x - s.from.x, 0, s.to.z - s.from.z).normalize().multiplyScalar(1.5);
          this.state = { kind: 'falling', vy: -1, vel: dir };
        }
        s.onLand(inside);
      }
    } else if (s.kind === 'bouncing') {
      s.t += dt;
      // Two small bounces, each lower than the last.
      const b = s.t < 0.35 ? Math.sin((s.t / 0.35) * Math.PI) * 0.25 : s.t < 0.6 ? Math.sin(((s.t - 0.35) / 0.25) * Math.PI) * 0.08 : 0;
      pos.y = GROUND_Y + RADIUS + b;
      this.spin += dt * 6;
      if (s.t >= 0.6) this.state = { kind: 'resting' };
    } else if (s.kind === 'falling') {
      s.vy -= 9 * dt;
      pos.addScaledVector(s.vel, dt);
      pos.y += s.vy * dt;
      this.spin += dt * 8;
      if (pos.y < -8) this.hide();
    } else if (s.kind === 'carried' && mouth) {
      pos.copy(mouth);
    } else if (s.kind === 'ready') {
      // A little wobble, inviting a throw.
      this.spin = Math.sin(performance.now() / 300) * 0.3;
    }
    this.group.rotation.set(this.spin, 0, this.spin * 0.6);
  }
}
