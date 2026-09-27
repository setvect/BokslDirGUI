export const APP_NAME = '복슬Dir';

export const FOUNDATION_DOCUMENTS = [
  'docs/implementation/README.md',
  'docs/implementation/action-registry.md',
  'docs/implementation/tauri-command-api.md',
  'docs/implementation/component-design.md',
] as const;

export const IMPLEMENTATION_BOUNDARY = {
  mockupUse: 'visual-reference-only',
  sourceOfTruth: 'docs/implementation',
  runtime: 'tauri-react-rust',
} as const;
