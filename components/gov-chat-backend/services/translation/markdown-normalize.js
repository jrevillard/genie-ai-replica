/**
 * Normalize inline spacing in a remark markdown AST: ensure a space between an
 * inline strong/emphasis node and an immediately following word.
 *
 * chatqna sometimes emits run-in bold like "**Heading**Text" (no separator).
 * Inserting a leading space on the following text node fixes the rendering
 * ("**Heading** Text") while leaving "**Heading**: text" untouched (the text
 * starts with ":", not a letter).
 *
 * Gated to word-spaced scripts (Latin/Cyrillic/Greek) via
 * {@link startsWithWordSpacedScript}: CJK/Thai do not use inter-word spaces, so
 * "**标题**内容" is correct as-is and must not get a space.
 *
 * Pure / synchronous — no ESM `visit` dependency, so it is unit-testable. Walks
 * the tree recursively over `children`.
 *
 * @param {object} tree - remark AST root (mutated in place)
 * @returns {object} the same tree (for chaining)
 */
const { startsWithWordSpacedScript } = require('./text-edges');

function normalizeInlineSpacing(tree) {
  function walk(node) {
    const children = node && node.children;
    if (!Array.isArray(children)) return;
    for (let i = 0; i < children.length - 1; i++) {
      const cur = children[i];
      const next = children[i + 1];
      if (
        cur &&
        (cur.type === 'strong' || cur.type === 'emphasis') &&
        next &&
        next.type === 'text' &&
        next.value &&
        startsWithWordSpacedScript(next.value)
      ) {
        next.value = ` ${next.value}`;
      }
    }
    children.forEach(walk);
  }
  walk(tree);
  return tree;
}

module.exports = { normalizeInlineSpacing };
