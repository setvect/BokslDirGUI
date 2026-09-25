import { describe, expect, it } from 'vitest';
import { formatDateTime } from './format';

describe('formatDateTime', () => {
  it('shows a timestamp in local time through seconds without a timezone or fractional seconds', () => {
    const timestamp = new Date(2026, 8, 25, 14, 7, 6).toISOString().replace('.000Z', '.695328764+00:00');

    expect(formatDateTime(timestamp)).toBe('2026-09-25 14:07:06');
  });

  it('leaves missing or invalid timestamps blank', () => {
    expect(formatDateTime(null)).toBe('');
    expect(formatDateTime('invalid')).toBe('');
  });
});
