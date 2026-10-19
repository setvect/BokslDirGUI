// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { OPERATION_DIALOG_TEXT } from '../i18n-resources';
import { testEntry } from '../ui/testing/fileEntryFixture';
import { ConflictComparison } from './ConflictResolutionView';
import { OperationResultView } from './OperationResultView';
import { ProgressPath } from './ProgressPath';

const path = String.raw`\\?\C:\한글 폴더\파일.txt`;
const label = String.raw`C:\한글 폴더\파일.txt`;
const source = { ...testEntry('/tmp', '파일.txt'), path };
const text = OPERATION_DIALOG_TEXT.ko;
afterEach(cleanup);

it('formats both conflict paths and their tooltips without modifying the conflict records', () => {
  const destination = { ...source, path: String.raw`\\?\UNC\server\share\파일.txt` };
  const prompt = { operationId: 'conflict', source, destination, defaultDecision: 'skip' as const,
    availableDecisions: ['skip' as const, 'cancel' as const] };
  render(<ConflictComparison prompt={prompt} text={text} />);
  expect(screen.getByTitle(label).textContent).toBe(label);
  expect(screen.getByTitle(String.raw`\\server\share\파일.txt`).textContent).toBe(String.raw`\\server\share\파일.txt`);
  expect(prompt.source.path).toBe(path);
});

it('formats file metadata and archive location results', () => {
  const { rerender } = render(<OperationResultView language="ko" text={text} value={{ ...source,
    absolutePath: path, extension: 'txt', mimeType: 'text/plain', readonly: false, directoryStats: null }} />);
  expect(screen.getByTitle(label).textContent).toBe(label);
  rerender(<OperationResultView language="ko" text={text} value={{ archivePath: path, encrypted: false, entries: [] }} />);
  expect(screen.getByTitle(label).textContent).toBe(label);
});

it('formats command working directories while preserving actual command output verbatim', () => {
  render(<OperationResultView language="ko" text={text} value={{ workingDir: path, stdout: path, stderr: '',
    exitCode: 0, timedOut: false, truncated: false }} />);
  expect(screen.getByText(label).tagName).toBe('CODE');
  expect(screen.getByText(path).tagName).toBe('PRE');
});

it('uses the normal path for progress text, tooltip and accessibility label', () => {
  render(<ProgressPath path={path} />);
  const progress = screen.getByTitle(label);
  expect(progress.textContent).toBe(label);
  expect(progress.getAttribute('aria-label')).toBe(label);
});
