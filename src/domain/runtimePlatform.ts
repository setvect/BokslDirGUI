import type { PlatformInfo } from './types';

// 프론트의 실행 플랫폼 판정 단일 원천. 백엔드 PlatformInfo가 있으면 그 값 우선.
export type FileShortcutPlatform = 'mac' | 'other';
export type PlatformFeature = keyof PlatformInfo['features'];

export const runtimeUserAgent = () => (typeof navigator === 'undefined' ? '' : navigator.userAgent);

export const isWindowsRuntime = (userAgent = runtimeUserAgent()) => /Windows/i.test(userAgent);

// 단축키 표기·실행 키 기준: Windows·Linux는 'other', 판정할 수 없으면 macOS 기준.
export const fileShortcutPlatform = (userAgent = runtimeUserAgent()): FileShortcutPlatform =>
  /Windows|Linux/i.test(userAgent) ? 'other' : 'mac';

export const shortcutPlatformForInfo = (info: PlatformInfo | undefined, fallback: FileShortcutPlatform): FileShortcutPlatform =>
  info && info.os !== 'unknown' ? (info.os === 'macos' ? 'mac' : 'other') : fallback;

// 백엔드 기능 정보를 받기 전에는 macOS 기능 기준.
export const platformSupports = (feature: PlatformFeature, info: PlatformInfo | undefined, platform: FileShortcutPlatform) =>
  info ? info.features[feature] : platform === 'mac';
