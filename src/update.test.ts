import { describe, expect, it } from 'vitest';
import { isUpdate } from './update';

const current = { version: '0.3.8', entry: 'index-abc.js' };

describe('update check', () => {
  it('spots a new version or a rebuild of the same version', () => {
    expect(isUpdate(current, { version: '0.3.9', entry: 'index-def.js' })).toBe(true);
    expect(isUpdate(current, { version: '0.3.8', entry: 'index-def.js' })).toBe(true);
  });

  it('stays quiet for the same build', () => {
    expect(isUpdate(current, { version: '0.3.8', entry: 'index-abc.js' })).toBe(false);
    expect(isUpdate(current, { version: '0.3.8' })).toBe(false);
  });

  it('ignores anything that is not a version file', () => {
    for (const reply of [null, undefined, 'oops', 42, {}, { version: '' }, { version: 3 }, ['0.3.9']]) {
      expect(isUpdate(current, reply)).toBe(false);
    }
  });
});
