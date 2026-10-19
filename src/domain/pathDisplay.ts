// Presentation only: keep the original path in navigation state and backend requests.
export const displayPath = (path: string) => {
  if (!path.startsWith('\\\\?\\')) return path;
  const tail = path.slice(4);
  if (/^[a-z]:\\/i.test(tail)) return tail;
  if (/^UNC\\/i.test(tail)) return `\\\\${tail.slice(4)}`;
  return path;
};
