import { clampNumber } from './settingsModel';

export const splitMiddleEllipsisParts = (name: string): { start: string; end: string | null } => {
  const clusters = graphemeClusters(name);
  if (clusters.length <= 24) {
    return { start: name, end: null };
  }
  const extension = name.match(/(\.tar\.gz|\.tar\.bz2|\.tar\.xz|\.[^.]{1,8})$/i)?.[1] ?? '';
  const preserveEndLength = clampNumber(Math.max(12, graphemeClusters(extension).length + 8), 12, 18);
  if (clusters.length <= preserveEndLength + 8) {
    return { start: name, end: null };
  }
  return {
    start: clusters.slice(0, -preserveEndLength).join(''),
    end: clusters.slice(-preserveEndLength).join(''),
  };
};

type GraphemeSegmenter = {
  segment(value: string): Iterable<{ segment: string }>;
};

type GraphemeSegmenterConstructor = new (
  locales?: string | string[],
  options?: { granularity: 'grapheme' },
) => GraphemeSegmenter;

const graphemeClusters = (value: string) => {
  const Segmenter = (Intl as typeof Intl & { Segmenter?: GraphemeSegmenterConstructor }).Segmenter;
  if (Segmenter) {
    return [...new Segmenter(undefined, { granularity: 'grapheme' }).segment(value)].map((part) => part.segment);
  }
  return fallbackGraphemeClusters(value);
};

const fallbackGraphemeClusters = (value: string) => {
  const codePoints = Array.from(value);
  const clusters: string[] = [];

  for (const codePoint of codePoints) {
    const previous = clusters.at(-1);
    if (
      !previous
      || !(isCombiningMark(codePoint)
        || isVariationSelector(codePoint)
        || isEmojiModifier(codePoint)
        || codePoint === ZERO_WIDTH_JOINER
        || previous.endsWith(ZERO_WIDTH_JOINER))
    ) {
      clusters.push(codePoint);
      continue;
    }
    clusters[clusters.length - 1] = `${previous}${codePoint}`;
  }

  return clusters;
};

export const textDisplayWidth = (value: string) =>
  graphemeClusters(value).reduce((width, cluster) => width + graphemeDisplayWidth(cluster), 0);

const graphemeDisplayWidth = (cluster: string) => {
  if (!cluster || [...cluster].every((codePoint) => isCombiningMark(codePoint) || isVariationSelector(codePoint))) {
    return 0;
  }
  return /[\p{Script=Hangul}\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Emoji_Presentation}\p{Extended_Pictographic}]/u.test(cluster)
    ? 2
    : 1;
};

const ZERO_WIDTH_JOINER = '\u200d';
const isCombiningMark = (value: string) => /^\p{Mark}$/u.test(value);
const isVariationSelector = (value: string) => /^[\u{fe00}-\u{fe0f}\u{e0100}-\u{e01ef}]$/u.test(value);
const isEmojiModifier = (value: string) => /^\p{Emoji_Modifier}$/u.test(value);

// Presentation only: keep the original path in navigation state and backend requests.
export const displayPath = (path: string) => {
  if (!path.startsWith('\\\\?\\')) return path;
  const tail = path.slice(4);
  if (/^[a-z]:\\/i.test(tail)) return tail;
  if (/^UNC\\/i.test(tail)) return `\\\\${tail.slice(4)}`;
  return path;
};

export const shortenPath = (path: string) => {
  const normalized = path.replace(/\\/g, '/');
  const parts = normalized.split('/').filter(Boolean);
  if (parts.length <= 4) {
    return normalized.startsWith('/') ? `/${parts.join('/')}` : parts.join('/');
  }
  return `/${parts.slice(0, 2).join('/')}/…/${parts.slice(-2).join('/')}`;
};

export const filterMatchSegments = (name: string, filter: string | null): Array<{ text: string; matched: boolean }> => {
  const pattern = filter?.trim();
  if (!pattern) {
    return [{ text: name, matched: false }];
  }
  const matchStart = name.toLowerCase().indexOf(pattern.toLowerCase());
  if (matchStart < 0) {
    return [{ text: name, matched: false }];
  }
  const matchEnd = matchStart + pattern.length;
  return [
    { text: name.slice(0, matchStart), matched: false },
    { text: name.slice(matchStart, matchEnd), matched: true },
    { text: name.slice(matchEnd), matched: false },
  ].filter((segment) => segment.text.length > 0);
};
