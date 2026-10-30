// 원격 패널 경로 `sftp://사용자@호스트:포트/절대/경로`. Rust `remote::path`와 같은 규칙,
// 양쪽 테스트가 `src/tauri/fixtures/remote-paths.json`과 대조.
const SCHEME = 'sftp://';
export const DEFAULT_SFTP_PORT = 22;

export interface RemoteLocation {
  user: string;
  host: string;
  port: number;
}

export interface RemotePath extends RemoteLocation {
  // 항상 `/`로 시작, `.`·`..` 정리, 끝 `/` 없음(루트 제외)
  path: string;
}

export const isRemotePath = (text: string) => text.slice(0, SCHEME.length).toLowerCase() === SCHEME;

const normalize = (path: string) => {
  const parts: string[] = [];
  for (const part of path.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') parts.pop();
    else parts.push(part);
  }
  return `/${parts.join('/')}`;
};

const decode = (text: string) => {
  if (/%(?![0-9A-Fa-f]{2})/.test(text)) return null;
  try {
    return decodeURIComponent(text.replace(/%(?![0-9A-Fa-f]{2})/g, ''));
  } catch {
    return null;
  }
};

const encode = (text: string, reserved: string) =>
  [...text].map((ch) => (reserved.includes(ch) ? `%${ch.codePointAt(0)!.toString(16).toUpperCase().padStart(2, '0')}` : ch)).join('');

const splitHostPort = (text: string): { host: string; port: number } | null => {
  const parsePort = (value: string) => (/^\d+$/.test(value) && Number(value) > 0 && Number(value) < 65536 ? Number(value) : null);
  if (text.startsWith('[')) {
    const close = text.indexOf(']');
    if (close < 0) return null;
    const after = text.slice(close + 1);
    const port = after === '' ? DEFAULT_SFTP_PORT : after.startsWith(':') ? parsePort(after.slice(1)) : null;
    return port === null ? null : { host: text.slice(1, close), port };
  }
  const colon = text.lastIndexOf(':');
  if (colon < 0) return { host: text, port: DEFAULT_SFTP_PORT };
  const host = text.slice(0, colon);
  const port = parsePort(text.slice(colon + 1));
  return host.includes(':') || port === null ? null : { host, port };
};

export const parseRemotePath = (text: string): RemotePath | null => {
  if (!isRemotePath(text) || text.includes('\0')) return null;
  const rest = text.slice(SCHEME.length);
  const slash = rest.indexOf('/');
  const authority = slash < 0 ? rest : rest.slice(0, slash);
  const rawPath = slash < 0 ? '/' : rest.slice(slash);
  const at = authority.lastIndexOf('@');
  if (at < 0) return null;
  const user = decode(authority.slice(0, at));
  const hostPort = splitHostPort(authority.slice(at + 1));
  const path = decode(rawPath);
  if (!user || !hostPort || !hostPort.host || path === null) return null;
  return { user, host: hostPort.host, port: hostPort.port, path: normalize(path) };
};

export const remoteUrl = (location: RemoteLocation, path: string) => {
  const host = location.host.includes(':') ? `[${location.host}]` : location.host;
  const port = location.port === DEFAULT_SFTP_PORT ? '' : `:${location.port}`;
  return `${SCHEME}${encode(location.user, '@:/%')}@${host}${port}${encode(normalize(path), '%')}`;
};

export const remoteLocationKey = (location: RemoteLocation) => remoteUrl(location, '/');

export const remotePathJoin = (base: RemotePath, name: string) => remoteUrl(base, `${base.path.replace(/\/+$/, '')}/${name}`);

export const remotePathParent = (remote: RemotePath) =>
  remote.path === '/' ? null : remoteUrl(remote, remote.path.slice(0, Math.max(remote.path.lastIndexOf('/'), 0)) || '/');
