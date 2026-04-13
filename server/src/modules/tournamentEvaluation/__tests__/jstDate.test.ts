import { describe, expect, it } from 'vitest';
import { getJstDateString } from '../jstDate.js';

describe('getJstDateString', () => {
  it('returns YYYY-MM-DD for a known UTC instant', () => {
    // 2026-04-12 15:00 UTC = 2026-04-13 00:00 JST
    const d = new Date('2026-04-12T15:00:00.000Z');
    expect(getJstDateString(d)).toBe('2026-04-13');
  });
});
