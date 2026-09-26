import { splitOperationProgressPath } from './progressPresentation';

export function ProgressPath({ path }: { path: string | null }) {
  const display = splitOperationProgressPath(path);
  if (!display.end) {
    return (
      <code className="operation-progress-path" title={display.full} aria-label={display.full}>
        <span className="operation-progress-path-single">{display.start}</span>
      </code>
    );
  }
  return (
    <code className="operation-progress-path" title={display.full} aria-label={display.full}>
      <span className="operation-progress-path-start">{display.start}</span>
      <span className="operation-progress-path-mark" aria-hidden="true">…</span>
      <span className="operation-progress-path-end">{display.end}</span>
    </code>
  );
}
