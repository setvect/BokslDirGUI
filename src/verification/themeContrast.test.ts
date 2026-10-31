import { describe, expect, it } from 'vitest';
// vite.config.ts의 test.css.include로 이 파일만 원문을 읽음(기본값은 빈 문자열)
import stylesCss from '../styles.css?raw';

// 테마별 글자·배경 대비 회귀 시험(WCAG 2.1: 일반 글자 4.5:1, 비활성 항목 3:1 목표).
// 브라우저 없이 styles.css의 색 토큰을 테마마다 풀어 계산하므로, 새 화면이 토큰을 잘못 고르는 경우는
// 같은 규칙 안의 글자·배경 쌍과 아래 목록에 적은 쌍으로만 잡힌다.
const THEMES = ['dark', 'light', 'highContrast', 'mdir'] as const;
type Theme = (typeof THEMES)[number];

const stripComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, '');
const css = stripComments(stylesCss);

const declarations = (body: string) => Object.fromEntries(
  [...body.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)].map((match) => [match[1], match[2].trim()]),
);

const resolve = (value: string, tokens: Record<string, string>, depth = 0): string => {
  if (depth > 8) throw new Error(`token cycle: ${value}`);
  const reference = value.match(/^var\((--[a-z0-9-]+)(?:\s*,\s*(.+))?\)$/);
  if (!reference) return value;
  const next = tokens[reference[1]] ?? reference[2];
  if (next === undefined) throw new Error(`unknown token ${reference[1]}`);
  return resolve(next.trim(), tokens, depth + 1);
};

// CSS 상속 규칙 반영: :root(html)의 `var()`는 :root 값(다크)으로 계산된 채 물려 내려가고,
// 테마가 적용되는 요소(body, .commander-shell)에서 정의한 별칭만 그 테마 값으로 계산됨
const rootDeclared = declarations(css.match(/:root\s*\{([^{}]*)\}/)![1]);
const rootTokens = Object.fromEntries(Object.entries(rootDeclared).map(([name, value]) => [name, resolve(value, rootDeclared)]));
const aliasTokens = declarations(css.match(/(?:^|\})\s*body,\s*\.commander-shell\s*\{([^{}]*)\}/)?.[1] ?? '');
const themeTokens = (theme: Theme): Record<string, string> => {
  if (theme === 'dark') return { ...rootTokens, ...aliasTokens };
  const block = css.match(new RegExp(`body\\[data-theme="${theme}"\\]\\s*\\{([^{}]*)\\}`));
  if (!block) throw new Error(`theme block missing: ${theme}`);
  return { ...rootTokens, ...aliasTokens, ...declarations(block[1]) };
};

interface Rgb { r: number; g: number; b: number; a: number }
const parseColor = (value: string): Rgb | null => {
  const hex = value.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (hex) {
    const digits = hex[1].length === 3 ? [...hex[1]].map((digit) => digit + digit) : hex[1].match(/../g)!;
    const [r, g, b] = digits.map((pair) => parseInt(pair, 16));
    return { r, g, b, a: 1 };
  }
  const rgb = value.match(/^rgba?\(([^)]+)\)$/);
  if (rgb) {
    const [r, g, b, a = 1] = rgb[1].split(/[\s,/]+/).filter(Boolean).map(Number);
    return { r, g, b, a };
  }
  return null;
};

const luminance = ({ r, g, b }: Rgb) => {
  const channel = (value: number) => {
    const ratio = value / 255;
    return ratio <= 0.03928 ? ratio / 12.92 : ((ratio + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
};

const contrast = (foreground: Rgb, background: Rgb) => {
  const [light, dark] = [luminance(foreground), luminance(background)].sort((left, right) => right - left);
  return (light + 0.05) / (dark + 0.05);
};

/** 두 값을 테마에서 풀어 대비 계산. 반투명·키워드처럼 단색이 아니면 null(측정 제외). */
const ratioFor = (theme: Theme, foreground: string, background: string) => {
  const tokens = themeTokens(theme);
  const fg = parseColor(resolve(foreground, tokens));
  const bg = parseColor(resolve(background, tokens));
  if (!fg || !bg || fg.a < 1 || bg.a < 1) return null;
  return Math.round(contrast(fg, bg) * 100) / 100;
};

const token = (name: string) => `var(${name})`;

// 컨테이너 배경 위에 그려지는 글자: 같은 규칙에 함께 적히지 않아 직접 나열
const CONTAINER_PAIRS: Array<[foreground: string, background: string, minimum: number, where: string]> = [
  ['--text', '--dialog-bg', 4.5, '대화상자 본문'],
  ['--about-text', '--menu-bg', 4.5, '정보 창 본문(.overlay-dialog 배경)'],
  ['--muted', '--menu-bg', 4.5, '대화상자 보조 글자·빈 목록 안내'],
  ['--dialog-muted-text', '--dialog-bg', 4.5, '작업 창 보조 글자'],
  ['--menu-text', '--menu-bg', 4.5, '메뉴 항목'],
  ['--cyan', '--menu-bg', 4.5, '메뉴 단축키'],
  ['--menu-disabled-text', '--menu-bg', 3, '비활성 메뉴 항목(포커스 때도 같은 배경)'],
  ['--menu-disabled-kbd', '--menu-bg', 3, '비활성 메뉴 단축키'],
  ['--status-message-text', '--status-bg', 4.5, '하단 상태 줄 안내'],
  ['--hotkey-more-text', '--hotkey-bg', 4.5, '단축키 줄 "+N"'],
  ['--cyan', '--hotkey-bg', 4.5, '단축키 줄 키'],
  ['--path-text', '--path-controls-bg', 4.5, '경로 입력칸'],
  ['--control-disabled-text', '--control-bg', 3, '비활성 경로 이동 버튼'],
  ['--panel-header-muted', '--path-controls-bg', 4.5, '패널 머리글 탭 개수'],
  ['--remote-connected-text', '--path-controls-bg', 4.5, '원격 연결됨 표시'],
  ['--remote-lost-text', '--path-controls-bg', 4.5, '원격 끊김 표시'],
  ['--remote-disconnected-text', '--path-controls-bg', 4.5, '원격 연결 안 됨 표시'],
  ['--selection-text', '--selection-bg', 4.5, '목록에서 고른 항목'],
  ['--row-text', '--panel-bg', 4.5, '파일 목록 글자'],
  ['--row-meta-text', '--panel-bg', 4.5, '파일 목록 크기·날짜'],
  ['--table-heading-text', '--panel-bg', 4.5, '파일 목록 열 제목'],
  ['--row-focused-text', '--row-focused-bg', 4.5, '파일 목록 커서'],
];

// 같은 규칙 안에서 글자색과 배경을 함께 정한 쌍(테마 블록 제외). 비활성 규칙은 3:1
const RULE_PAIRS = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
  .map((match) => ({ selector: match[1].trim().replace(/\s+/g, ' '), body: match[2] }))
  .filter(({ selector }) => !/^(:root|body\[data-theme|\.commander-shell\[data-theme="[a-zA-Z]+"\],)/.test(selector))
  .flatMap(({ selector, body }) => {
    const color = body.match(/(?:^|;)\s*color\s*:\s*([^;]+);/)?.[1].trim();
    const background = body.match(/(?:^|;)\s*background(?:-color)?\s*:\s*([^;]+);/)?.[1].trim();
    if (!color || !background || !color.startsWith('var(') || !background.startsWith('var(')) return [];
    return [{ selector, color, background, minimum: selector.includes(':disabled') ? 3 : 4.5 }];
  });

// 글자색만 정한 규칙: 선택자의 첫 클래스가 속한 컨테이너 배경 위에 그려짐(상태별 배경이 따로 있는 규칙 제외)
const CONTAINER_BACKGROUNDS: Array<[prefix: RegExp, background: string]> = [
  [/^\.(about-dialog|overlay-title|filter-form|dialog-empty|shortcut-help-|remote-(chmod|info|site)|quick-preview-meta|file-info-view|context-label|menu-|navigation-path-)/, '--menu-bg'],
  [/^\.navigation-list-item/, '--nav-item-bg'],
  [/^\.(operation-|conflict-|dialog-button)/, '--dialog-bg'],
  [/^\.(file-row|file-table-|entry-row-kind-|file-panel)/, '--panel-bg'],
  [/^\.(panel-tabs|remote-chip|path-input)/, '--path-controls-bg'],
  [/^\.hotkey-more/, '--hotkey-bg'],
  [/^\.status-(message|filter)/, '--status-bg'],
  [/^\.clock/, '--top-menu-bg'],
];
const STATEFUL = /:hover|:focus|is-focused|is-selected|is-checkable|data-highlighted|:disabled|:is\(/;

/** 괄호 밖의 쉼표에서만 선택자 목록 분리(`:is(a, b)` 안의 쉼표는 유지). */
const splitSelectorList = (selector: string) => {
  const parts: string[] = [];
  let depth = 0;
  let current = '';
  for (const character of selector) {
    if (character === '(') depth += 1;
    if (character === ')') depth -= 1;
    if (character === ',' && depth === 0) {
      parts.push(current.trim());
      current = '';
    } else {
      current += character;
    }
  }
  return [...parts, current.trim()];
};

const COLOR_ONLY_PAIRS = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
  .map((match) => ({ selector: match[1].trim().replace(/\s+/g, ' '), body: match[2] }))
  .filter(({ selector }) => !/^(:root|body\[data-theme|\.commander-shell\[data-theme)/.test(selector))
  .flatMap(({ selector, body }) => {
    const color = body.match(/(?:^|;)\s*color\s*:\s*(var\([^;]+\))\s*;/)?.[1];
    if (!color || /(?:^|;)\s*background(?:-color)?\s*:/.test(body)) return [];
    return splitSelectorList(selector).filter((part) => !STATEFUL.test(part)).flatMap((part) => {
      const background = CONTAINER_BACKGROUNDS.find(([prefix]) => prefix.test(part))?.[1];
      return background ? [{ selector: part, color, background: token(background) }] : [];
    });
  });

describe('theme contrast', () => {
  it('finds every theme and enough same-rule text/background pairs to be meaningful', () => {
    for (const theme of THEMES) expect(Object.keys(themeTokens(theme)).length).toBeGreaterThan(80);
    expect(RULE_PAIRS.length).toBeGreaterThan(10);
  });

  it.each(THEMES)('keeps container text pairs readable in the %s theme', (theme) => {
    const failures = CONTAINER_PAIRS.flatMap(([foreground, background, minimum, where]) => {
      const ratio = ratioFor(theme, token(foreground), token(background));
      return ratio !== null && ratio < minimum ? [`${where}: ${foreground} on ${background} = ${ratio}:1 (< ${minimum})`] : [];
    });
    expect(failures).toEqual([]);
  });

  it.each(THEMES)('keeps text/background pairs declared together readable in the %s theme', (theme) => {
    const failures = RULE_PAIRS.flatMap(({ selector, color, background, minimum }) => {
      const ratio = ratioFor(theme, color, background);
      return ratio !== null && ratio < minimum ? [`${selector}: ${color} on ${background} = ${ratio}:1 (< ${minimum})`] : [];
    });
    expect(failures).toEqual([]);
  });

  it.each(THEMES)('keeps color-only text readable on its container background in the %s theme', (theme) => {
    expect(COLOR_ONLY_PAIRS.length).toBeGreaterThan(20);
    const failures = COLOR_ONLY_PAIRS.flatMap(({ selector, color, background }) => {
      const ratio = ratioFor(theme, color, background);
      return ratio !== null && ratio < 4.5 ? [`${selector}: ${color} on ${background} = ${ratio}:1`] : [];
    });
    expect(failures).toEqual([]);
  });

  it('keeps every Mdir file color readable as text and as the black-text cursor', () => {
    const tokens = themeTokens('mdir');
    const fileColors = Object.keys(tokens).filter((name) => /^--row-[a-z]+-text$/.test(name) && !/focused|selected|meta/.test(name));
    expect(fileColors.length).toBeGreaterThan(5);
    const failures = fileColors.flatMap((name) => {
      const onPanel = ratioFor('mdir', token(name), token('--panel-bg'));
      const asCursor = ratioFor('mdir', token('--row-focused-text'), token(name));
      return [
        ...(onPanel !== null && onPanel < 4.5 ? [`${name} on --panel-bg = ${onPanel}:1`] : []),
        ...(asCursor !== null && asCursor < 4.5 ? [`--row-focused-text on ${name} = ${asCursor}:1`] : []),
      ];
    });
    expect(failures).toEqual([]);
  });
});

describe('theme tokens', () => {
  it('defines only tokens that are referenced by styles or components', () => {
    const sources = Object.values(import.meta.glob('../**/*.{ts,tsx}', { query: '?raw', import: 'default', eager: true })).join('\n');
    const defined = new Set([...css.matchAll(/(--[a-z0-9-]+)\s*:/g)].map((match) => match[1]));
    const referenced = new Set([...css.matchAll(/var\((--[a-z0-9-]+)/g)].map((match) => match[1]));
    const unused = [...defined].filter((name) => !referenced.has(name) && !sources.includes(name));
    expect(unused).toEqual([]);
  });
});
