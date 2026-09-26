import ts from 'typescript';
import { expect, it } from 'vitest';

const root = 'src';
const resolve = (...parts: string[]) => {
  const segments: string[] = [];
  for (const part of parts.join('/').split('/')) {
    if (part === '..') segments.pop();
    else if (part && part !== '.') segments.push(part);
  }
  return segments.join('/');
};
const dirname = (path: string) => path.slice(0, path.lastIndexOf('/'));
const rawSources = import.meta.glob('../**/*.{ts,tsx}', { query: '?raw', import: 'default', eager: true });
const sources = new Map(Object.entries(rawSources)
  .filter(([path]) => !path.includes('.test.') && !path.includes('/testing/'))
  .map(([path, text]) => {
    const file = resolve(root, 'verification', path);
    return [file, ts.createSourceFile(file, String(text), ts.ScriptTarget.Latest, true)];
  }));
const dependencies = (file: string) => sources.get(file)!.statements.flatMap((node) => {
  if (!(ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) || !node.moduleSpecifier || !ts.isStringLiteral(node.moduleSpecifier)) return [];
  const specifier = node.moduleSpecifier.text;
  if (!specifier.startsWith('.')) return [specifier];
  const path = resolve(dirname(file), specifier);
  return [[path + '.ts', path + '.tsx', path + '/index.ts'].find((candidate) => sources.has(candidate)) ?? path];
});

it('has no circular production module dependencies, including type-only imports', () => {
  const visited = new Set<string>();
  const visit = (file: string, stack: string[]) => {
    if (!sources.has(file)) return;
    if (stack.includes(file)) throw new Error([...stack, file].map((path) => path.replace(root, 'src')).join(' -> '));
    if (visited.has(file)) return;
    for (const target of dependencies(file)) visit(target, [...stack, file]);
    visited.add(file);
  };
  for (const file of sources.keys()) visit(file, []);
});

it('keeps presentation calculations independent of React, Tauri and operation state', () => {
  for (const name of ['textLayout', 'panelPresentation', 'directoryComparison', 'selectionModel', 'hotkeyStripLayout', 'settingsModel']) {
    const visited = new Set<string>();
    const visit = (file: string) => {
      if (visited.has(file)) return;
      visited.add(file);
      for (const target of dependencies(file)) {
        expect(target, `${name} depends on ${target}`).not.toMatch(/(^react$|@tauri|operationStore|CommanderShell|useCommander)/);
        if (sources.has(target)) visit(target);
      }
    };
    visit(resolve(root, 'ui', name + '.ts'));
  }
});

it('keeps Rust service imports explicit and acyclic', () => {
  const rust = new Map(Object.entries(import.meta.glob('../../src-tauri/src/**/*.rs', { query: '?raw', import: 'default', eager: true }))
    .filter(([path]) => !/(?:^|\/)(?:tests|contract_tests|test_support)\.rs$/.test(path))
    .map(([path, source]) => [path.replace('../../src-tauri/src/', '').replace(/\.rs$/, ''), String(source)]));
  const graph = new Map<string, string[]>();
  for (const [file, source] of rust) {
    expect(source, file).not.toContain('use super::*');
    const targets: string[] = [];
    for (const match of source.matchAll(/\buse\s+([\w:]+)(?:\{|;)/g)) {
      const parts = match[1].split('::').filter(Boolean);
      const scope = parts.shift();
      const base = scope === 'crate' ? '' : scope === 'super' ? dirname(file) : file;
      if (scope !== 'crate' && scope !== 'super' && scope !== 'self') parts.unshift(scope!);
      const path = base ? base + '/' + parts.join('/') : parts.join('/');
      const target = [...rust.keys()].filter((candidate) => path === candidate || path.startsWith(candidate + '/'))
        .sort((a, b) => b.length - a.length)[0];
      if (target && target !== file) targets.push(target);
    }
    graph.set(file, targets);
  }
  const visited = new Set<string>();
  const visit = (file: string, stack: string[]) => {
    if (stack.includes(file)) throw new Error([...stack, file].join(' -> '));
    if (visited.has(file)) return;
    for (const target of graph.get(file) ?? []) visit(target, [...stack, file]);
    visited.add(file);
  };
  for (const file of graph.keys()) visit(file, []);
});
