import { describe, expect, it } from 'vitest';
import { skyAt } from './sky';

const at = (fromHorizon: number) => skyAt({ fromHorizon, sun: 0.5, moon: -1, phase: 0.5 });

describe('sky colours', () => {
  it('is plain day long after sunrise, glowing at the horizon, and night long after sunset', () => {
    for (const s of [1.5, 3, 7]) {
      const day = at(s);
      expect(day.light).toBe(1);
      expect(day.glow).toBe(0);
      expect(day.night).toBe(0);
      expect(day.top.getHexString()).toBe('a9daf5');
    }
    expect(at(0).glow).toBe(1);
    const night = at(-5);
    expect(night.light).toBeCloseTo(0.28);
    expect(night.night).toBe(1);
    expect(night.glow).toBe(0);
  });

  it('brightens steadily through dawn', () => {
    const light = [-1.5, -1, -0.5, 0, 0.5, 1, 1.5].map((s) => at(s).light);
    for (let i = 1; i < light.length; i++) expect(light[i]).toBeGreaterThan(light[i - 1]);
  });
});
