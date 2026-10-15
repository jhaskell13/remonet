import { describe, expect, it } from 'vitest';
import { formatRelativeTime, formatTimestamp } from '../../../src/lib/time.ts';

const now = Date.parse('2026-10-13T12:00:00.000Z');
const before = (seconds: number) => new Date(now - seconds * 1000).toISOString();

describe('time formatting', () => {
  it.each([
    [null, 'never'],
    ['not a date', 'unknown'],
    [before(0), 'just now'],
    [before(44), 'just now'],
    [before(45), '1 min ago'],
    [before(150), '3 min ago'],
    [before(59 * 60), '59 min ago'],
    [before(60 * 60), '1 h ago'],
    [before(5 * 3600 + 1800), '6 h ago'],
    [before(24 * 3600), '1 d ago'],
    [before(30 * 24 * 3600), '30 d ago'],
  ])('describes %s as %s', (iso, expected) => {
    expect(formatRelativeTime(iso, now)).toBe(expected);
  });

  it('defaults to the current time', () => {
    expect(formatRelativeTime(new Date().toISOString())).toBe('just now');
  });

  it('renders absolute timestamps readably and leaves garbage untouched', () => {
    expect(formatTimestamp('2026-10-12T13:39:00.000Z')).toMatch(/2026/);
    expect(formatTimestamp('garbage')).toBe('garbage');
  });
});
