export type PickResult = 'egg' | 'pet' | null;

export interface GestureHandlers {
  pick(x: number, y: number): PickResult;
  /** Press-and-hold on the egg started (true) or ended (false). */
  onWarm(active: boolean): void;
  /** Back-and-forth stroking on the egg; distance in pixels since the last call. */
  onStroke(px: number): void;
  /** Quick upward swipe on the egg. */
  onMist(): void;
  /** Quick sideways swipe on the egg. */
  onTurn(direction: 1 | -1): void;
  onTap(target: Exclude<PickResult, null>): void;
  /** Dragging on empty space rotates the view. */
  onOrbit(dxPixels: number): void;
  onOrbitEnd(vxPixelsPerSec: number): void;
}

const HOLD_MS = 220;
const TAP_SLOP = 12;
const SWIPE_MIN = 40;
const SWIPE_MAX_MS = 600;
const STROKE_REVERSALS = 2;

/**
 * Turns raw pointer events into egg gestures:
 * hold = warm, swipe up = mist, swipe sideways = turn, back-and-forth = stroke, tap = tap.
 */
export function attachGestures(el: HTMLElement, h: GestureHandlers): void {
  let id: number | null = null;
  let mode: 'egg' | 'pet' | 'orbit' = 'orbit';
  let startX = 0;
  let startY = 0;
  let startT = 0;
  let lastX = 0;
  let lastY = 0;
  let lastT = 0;
  let vx = 0;
  let lastDir = 0;
  let reversals = 0;
  let warming = false;
  let holdTimer = 0;

  const moved = () => Math.hypot(lastX - startX, lastY - startY);

  const finish = (cancelled: boolean) => {
    clearTimeout(holdTimer);
    if (warming) {
      warming = false;
      h.onWarm(false);
    } else if (!cancelled && mode === 'egg' && reversals < STROKE_REVERSALS) {
      const dx = lastX - startX;
      const dy = lastY - startY;
      const quick = performance.now() - startT < SWIPE_MAX_MS;
      if (quick && -dy > SWIPE_MIN && Math.abs(dy) > Math.abs(dx)) h.onMist();
      else if (quick && Math.abs(dx) > SWIPE_MIN && Math.abs(dx) > Math.abs(dy)) h.onTurn(dx > 0 ? 1 : -1);
      else if (moved() < TAP_SLOP) h.onTap('egg');
    } else if (!cancelled && mode === 'pet' && moved() < TAP_SLOP) {
      h.onTap('pet');
    }
    if (mode === 'orbit') h.onOrbitEnd(cancelled ? 0 : vx);
    id = null;
  };

  el.addEventListener('pointerdown', (e) => {
    if (id !== null) return;
    id = e.pointerId;
    el.setPointerCapture(e.pointerId);
    startX = lastX = e.clientX;
    startY = lastY = e.clientY;
    startT = lastT = performance.now();
    vx = 0;
    lastDir = 0;
    reversals = 0;
    const hit = h.pick(e.clientX, e.clientY);
    mode = hit ?? 'orbit';
    if (mode === 'egg') {
      holdTimer = window.setTimeout(() => {
        if (moved() < TAP_SLOP && reversals === 0) {
          warming = true;
          h.onWarm(true);
        }
      }, HOLD_MS);
    }
  });

  el.addEventListener('pointermove', (e) => {
    if (e.pointerId !== id) return;
    const dx = e.clientX - lastX;
    const dy = e.clientY - lastY;
    const now = performance.now();
    const dt = Math.max(1, now - lastT);
    lastX = e.clientX;
    lastY = e.clientY;
    lastT = now;
    if (mode === 'orbit') {
      h.onOrbit(dx);
      vx = vx * 0.6 + (dx / dt) * 1000 * 0.4;
      return;
    }
    if (mode !== 'egg') return;
    if (moved() > TAP_SLOP) clearTimeout(holdTimer);
    if (Math.abs(dx) > 2) {
      const dir = Math.sign(dx);
      if (lastDir !== 0 && dir !== lastDir) reversals++;
      lastDir = dir;
    }
    if (reversals >= STROKE_REVERSALS) h.onStroke(Math.abs(dx) + Math.abs(dy));
  });

  el.addEventListener('pointerup', (e) => e.pointerId === id && finish(false));
  el.addEventListener('pointercancel', (e) => e.pointerId === id && finish(true));
  el.addEventListener('contextmenu', (e) => e.preventDefault());
}
