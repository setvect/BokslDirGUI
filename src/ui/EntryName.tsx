import { filterMatchSegments, splitMiddleEllipsisParts } from './textLayout';

function HighlightedEntryName({ name, filter }: { name: string; filter: string | null }) {
  const segments = filterMatchSegments(name, filter);
  return (
    <>
      {segments.map((segment, index) => segment.matched ? (
        <mark className="filter-match" key={`${segment.text}-${index}`}>{segment.text}</mark>
      ) : (
        <span key={`${segment.text}-${index}`}>{segment.text}</span>
      ))}
    </>
  );
}

export function MiddleEllipsisEntryName({ name, filter }: { name: string; filter: string | null }) {
  const { start, end } = splitMiddleEllipsisParts(name);
  if (!end) {
    return (
      <span className="middle-ellipsis" aria-label={name}>
        <span className="middle-ellipsis-start">
          <HighlightedEntryName name={start} filter={filter} />
        </span>
      </span>
    );
  }
  return (
    <span className="middle-ellipsis" aria-label={name}>
      <span className="middle-ellipsis-start">
        <HighlightedEntryName name={start} filter={filter} />
      </span>
      <span className="middle-ellipsis-mark" aria-hidden="true">…</span>
      <span className="middle-ellipsis-end">
        <HighlightedEntryName name={end} filter={filter} />
      </span>
      <span className="sr-only">{name}</span>
    </span>
  );
}
