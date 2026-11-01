import { describe, expect, it } from 'vitest';
import { formatDate, formatDateTime } from './format';

describe('formatDate', () => {
  const now = new Date(2026, 10, 1, 9, 0);
  const at = (...parts: [number, number, number, number, number]) => new Date(...parts).toISOString();

  it('omits the year in the narrow list only for this year and shows the year instead of the time otherwise', () => {
    expect(formatDate(at(2026, 0, 30, 22, 6), 'short', now)).toBe('01-30 22:06');
    // 연말·연초 경계: 6개월 이내여도 작년 항목은 연도를 표시(연도 없는 날짜는 항상 올해)
    expect(formatDate(at(2025, 11, 31, 23, 59), 'short', new Date(2026, 0, 2))).toBe('2025-12-31');
    expect(formatDate(at(2022, 0, 30, 22, 6), 'short', now)).toBe('2022-01-30');
    expect(formatDate(at(2027, 2, 1, 8, 0), 'short', now)).toBe('2027-03-01');
    // 연도를 표시한 날짜도 같은 열 폭(11자) 안
    expect(formatDate(at(2022, 0, 30, 22, 6), 'short', now).length).toBeLessThanOrEqual('01-30 22:06'.length);
  });

  it('keeps the full date and time in the wide list', () => {
    expect(formatDate(at(2022, 0, 30, 22, 6), 'long', now)).toBe('2022-01-30 22:06');
    expect(formatDate(at(2026, 0, 30, 22, 6), 'long', now)).toBe('2026-01-30 22:06');
  });

  it('leaves missing or invalid timestamps blank', () => {
    expect(formatDate(null)).toBe('');
    expect(formatDate('invalid')).toBe('');
  });
});

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
