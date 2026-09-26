import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';
import { useOperationStore } from '../../operations/operationStore';

afterEach(() => {
  vi.useRealTimers();
  useOperationStore.setState({
    dialog: null,
    progress: null,
    conflictPrompt: null,
    summary: null,
    lastError: null,
    lastConflictDecision: null,
    applyAllConflictDecision: null,
    activeOperationController: null,
  });
  cleanup();
});