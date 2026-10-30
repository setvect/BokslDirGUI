import { normalizeSavedTabs } from './sessionState';
import type { RemoteSettings, Settings } from '../domain/types';

export const DEFAULT_SETTINGS: Settings = {
  schemaVersion: 1,
  theme: 'dark',
  language: 'ko',
  sizeFormat: 'binary',
  external: {
    editorId: null,
    shellCommand: {
      enabled: false,
    },
  },
  bookmarks: [],
  layout: {
    singlePanel: false,
    ratio: '50:50',
  },
  session: {
    leftPath: null,
    rightPath: null,
    activePanel: 'right',
  },
  view: {
    zoomStep: 0,
    density: 'compact',
    showIcons: true,
  },
};

export const MIN_ZOOM_STEP = -3;
export const MAX_ZOOM_STEP = 5;
const BASE_FONT_SIZE_PX = 16;
const BASE_ROW_HEIGHT_PX = 27;
const ZOOM_PRESETS_BY_STEP: Record<number, number> = {
  [-3]: 0.75,
  [-2]: 0.8,
  [-1]: 0.9,
  0: 1,
  1: 1.1,
  2: 1.25,
  3: 1.5,
  4: 1.75,
  5: 2,
};

export type ZoomCommand = 'in' | 'out' | 'reset';

export const DEFAULT_REMOTE_SETTINGS: RemoteSettings = { sites: [], keepaliveSeconds: 30, connectTimeoutSeconds: 15 };

export const remoteSettingsOf = (settings: Settings): RemoteSettings => settings.remote ?? DEFAULT_REMOTE_SETTINGS;

export const mergeSettings = (current: Settings, patch: Partial<Settings>): Settings => ({
  ...current,
  ...patch,
  external: patch.external ? { ...current.external, ...patch.external } : current.external,
  layout: patch.layout ? { ...current.layout, ...patch.layout } : current.layout,
  session: patch.session ? { ...current.session, ...patch.session } : current.session,
  view: patch.view ? { ...current.view, ...patch.view } : current.view,
  remote: patch.remote ? { ...remoteSettingsOf(current), ...patch.remote } : current.remote,
});

export const normalizeSettings = (value: unknown): Settings => {
  const candidate = value && typeof value === 'object' ? value as Partial<Settings> : {};
  return {
    ...DEFAULT_SETTINGS,
    ...candidate,
    external: {
      ...DEFAULT_SETTINGS.external,
      ...(candidate.external ?? {}),
      shellCommand: {
        ...DEFAULT_SETTINGS.external.shellCommand,
        ...(candidate.external?.shellCommand ?? {}),
      },
    },
    bookmarks: Array.isArray(candidate.bookmarks) ? candidate.bookmarks : [],
    layout: {
      ...DEFAULT_SETTINGS.layout,
      ...(candidate.layout ?? {}),
    },
    session: {
      ...DEFAULT_SETTINGS.session,
      ...(candidate.session ?? {}),
      tabs: normalizeSavedTabs(candidate.session?.tabs),
      activePanel: candidate.session?.activePanel === 'left' ? 'left' : 'right',
      leftPath: typeof candidate.session?.leftPath === 'string' ? candidate.session.leftPath : null,
      rightPath: typeof candidate.session?.rightPath === 'string' ? candidate.session.rightPath : null,
    },
    view: {
      ...DEFAULT_SETTINGS.view,
      ...(candidate.view ?? {}),
      zoomStep: clampNumber(
        typeof candidate.view?.zoomStep === 'number' ? candidate.view.zoomStep : DEFAULT_SETTINGS.view.zoomStep,
        MIN_ZOOM_STEP,
        MAX_ZOOM_STEP,
      ),
      density: candidate.view?.density === 'comfortable' ? 'comfortable' : 'compact',
      showIcons: typeof candidate.view?.showIcons === 'boolean' ? candidate.view.showIcons : DEFAULT_SETTINGS.view.showIcons,
    },
  };
};

export const zoomScaleForStep = (step: number) =>
  ZOOM_PRESETS_BY_STEP[clampNumber(step, MIN_ZOOM_STEP, MAX_ZOOM_STEP)] ?? 1;

export const zoomPercentForStep = (step: number) => Math.round(zoomScaleForStep(step) * 100);

export const viewMetricsForSettings = (view: Settings['view']) => {
  const densityMultiplier = view.density === 'comfortable' ? 1.08 : 1;
  const scale = Number((zoomScaleForStep(view.zoomStep) * densityMultiplier).toFixed(3));
  return {
    scale,
    fontSizePx: Math.round(BASE_FONT_SIZE_PX * scale),
    rowHeightPx: Math.round(BASE_ROW_HEIGHT_PX * scale),
    topMenuHeightPx: Math.round(31 * scale),
    pathControlHeightPx: Math.round(30 * scale),
    statusHeightPx: Math.round(27 * scale),
    hotkeyStripHeightPx: Math.round(29 * scale),
    cellPaddingXPx: Math.round(10 * scale),
    controlGapPx: Math.max(3, Math.round(4 * scale)),
  };
};

export const clampNumber = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
