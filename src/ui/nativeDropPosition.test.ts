import { expect, it } from 'vitest';
import { nativeDropPosition } from './nativeDropPosition';

it.each([1, 1.5, 2, 3])('preserves macOS logical positions at pixel ratio %s', (ratio) => {
  // x=900 belongs to the right panel. Dividing by 2 would incorrectly select the left.
  expect(nativeDropPosition({ x: 900, y: 200 }, ratio, 'MacIntel')).toEqual({ x: 900, y: 200 });
});
it.each(['Win32', 'Linux x86_64'])('converts physical pixels for %s', (platform) => {
  expect(nativeDropPosition({ x: 1800, y: 400 }, 2, platform)).toEqual({ x: 900, y: 200 });
});
