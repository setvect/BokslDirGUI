

export const testEntry = (parent: string, name: string) => ({
  path: `${parent}/${name}`,
  name,
  kind: 'file' as const,
  sizeBytes: 1,
  modifiedAt: null,
  createdAt: null,
  permissions: '-rw-r--r--',
  owner: 'boksl',
  group: 'staff',
  isHidden: false,
  isVirtual: false,
});
