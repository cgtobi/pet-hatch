// @vitest-environment node
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { sha256 } from './sha256';

describe('sha256', () => {
  it('matches the standard SHA-256, across block boundaries and for non-ASCII text', () => {
    for (const text of ['', 'abc', 'a'.repeat(55), 'a'.repeat(56), 'a'.repeat(64), 'x'.repeat(1000), '3:crush:k2j3', 'Mochi ✨ 🐣']) {
      expect(sha256(text)).toBe(createHash('sha256').update(text).digest('hex'));
    }
  });
});
