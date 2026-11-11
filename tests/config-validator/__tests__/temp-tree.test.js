// Copyright (C) 2026 International Telecommunication Union (ITU)
// SPDX-License-Identifier: Apache-2.0
const fs = require('fs');
const path = require('path');
const { withTree } = require('../validators/temp-tree');

/**
 * The throwaway tree the gates build their fixtures in.
 *
 * The tree lives while the case runs and is gone after it — and that
 * must hold for an ASYNC callback too: a tree removed when the callback
 * RETURNS its promise would disappear under the case, mid-run, and the
 * failure would look like the gate's own.
 */
describe('the throwaway tree', () => {
  test('it is there while the case runs, and gone after it', () => {
    const root = withTree('temp-tree-', { 'nested/file.txt': 'x' }, (tree) => {
      expect(fs.existsSync(path.join(tree, 'nested', 'file.txt'))).toBe(true);
      return tree;
    });
    expect(fs.existsSync(root)).toBe(false);
  });

  test('an async callback keeps the tree until its promise settles', async () => {
    let thereDuringTheCallback = null;
    const root = await withTree('temp-tree-', { 'file.txt': 'x' }, async (tree) => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      thereDuringTheCallback = fs.existsSync(path.join(tree, 'file.txt'));
      return tree;
    });
    // The tree was still there when the async callback ran.
    expect(thereDuringTheCallback).toBe(true);
    // And it is gone now that the promise settled.
    expect(fs.existsSync(root)).toBe(false);
  });

  test('a failing callback leaves no tree behind', () => {
    let root = null;
    expect(() =>
      withTree('temp-tree-', {}, (tree) => {
        root = tree;
        throw new Error('boom');
      })
    ).toThrow('boom');
    expect(fs.existsSync(root)).toBe(false);
  });
});
