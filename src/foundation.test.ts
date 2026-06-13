import { describe, expect, it } from 'vitest';
import { APP_NAME, FOUNDATION_DOCUMENTS, IMPLEMENTATION_BOUNDARY } from './foundation';

describe('BokslDirGUI foundation contract', () => {
  it('names the Tauri app and implementation source of truth', () => {
    expect(APP_NAME).toBe('BokslDirGUI');
    expect(IMPLEMENTATION_BOUNDARY.runtime).toBe('tauri-react-rust');
    expect(IMPLEMENTATION_BOUNDARY.sourceOfTruth).toBe('docs/implementation');
  });

  it('keeps the clickable prototype as visual reference only', () => {
    expect(IMPLEMENTATION_BOUNDARY.mockupUse).toBe('visual-reference-only');
  });

  it('anchors the foundation to implementation design documents', () => {
    expect(FOUNDATION_DOCUMENTS).toContain('docs/implementation/README.md');
    expect(FOUNDATION_DOCUMENTS).toContain('docs/implementation/tauri-command-api.md');
    expect(FOUNDATION_DOCUMENTS).toHaveLength(4);
  });
});
