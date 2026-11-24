// Copyright (C) 2026 International Telecommunication Union (ITU)
// SPDX-License-Identifier: Apache-2.0
//
// Real-markdown integration smoke for the agentic translation leg
// (services/translation/agentic-translation-leg.js). Runs on
// Node's built-in test runner:
//
//   node --test scripts/agentic-translation-markdown.node-test.js
//
// Why it exists: the jest suite mocks unified/remark-parse/remark-stringify/
// unist-util-visit (they are ESM-only and the jest VM cannot run the dynamic
// form), so a loading-shape regression in the leg's `loadMarkdownLibs` —
// `require('remark-parse').default` vs the namespace, a renamed export —
// would ship all-green and surface only as runtime failed translations when
// the routes wire the leg. This smoke loads the four packages EXACTLY as
// `loadMarkdownLibs` does (the requires below must stay in the same shape)
// and round-trips one markdown string through the leg's discipline: parse →
// visit text nodes → normalizeInlineSpacing → splitEdges → cores →
// reassemble → stringify. Node ≥ 22.12 resolves the ESM-only packages
// through require(esm) — the same contract the leg documents on its loader.

'use strict';

const { test } = require('node:test');
const assert = require('node:assert');

// The loading shape under test — keep identical to `loadMarkdownLibs` in
// services/translation/agentic-translation-leg.js.
const { unified } = require('unified');
const remarkParse = require('remark-parse').default;
const remarkStringify = require('remark-stringify').default;
const { visit } = require('unist-util-visit');

const { normalizeInlineSpacing } = require('../services/translation/markdown-normalize');
const { splitEdges } = require('../services/translation/text-edges');

test('the leg markdown pipeline loads the real packages and round-trips its discipline', () => {
  const input = 'First point. **Bold** tail';

  const tree = unified().use(remarkParse).parse(input);

  const textNodes = [];
  visit(tree, 'text', (node) => textNodes.push(node));

  // The text-node set: the two text leaves around the strong, plus the
  // strong's own inner text node (the cores the leg would translate).
  assert.deepEqual(
    textNodes.map((node) => node.value),
    ['First point. ', 'Bold', ' tail']
  );

  // The legacy normalization runs unchanged on a real tree.
  normalizeInlineSpacing(tree);

  // The cores: structural edges stripped, the translatable text left.
  const edges = textNodes.map((node) => splitEdges(node.value));
  assert.deepEqual(
    edges.map((e) => e.core),
    ['First point.', 'Bold', 'tail']
  );

  // Reassemble with identity "translations" and stringify: the skeleton
  // (whitespace, the strong markers) survives the round trip.
  textNodes.forEach((node, index) => {
    const e = edges[index];
    node.value = e.lead + e.core + e.trail;
  });
  // remark-stringify terminates the document with a trailing newline — the
  // same suffix the legacy translator's output carries.
  assert.strictEqual(unified().use(remarkStringify).stringify(tree), `${input}\n`);
});
