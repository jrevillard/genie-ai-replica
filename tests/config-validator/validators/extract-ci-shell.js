// Extracts the shell embedded in .gitlab-ci.yml script blocks so a syntax
// gate can parse it (#1306, #1322). The pipeline lint (glab ci lint) only
// validates YAML structure — the contents of `script:` / `before_script:` /
// `after_script:` lists are opaque to it, so a bash syntax error in an
// embedded block ships green until the first merge train (measured on
// !674: a stale duplicate block plus a stray `done` survived four review
// rounds and three pushed commits).
//
// Line-based parser, like the other validators in this directory. Shapes
// handled:
//   - a bare `script:` key followed by a list of items — plain scalars,
//     `|`/`>` block scalars, or `- *alias` items (YAML requires the alias
//     target to be defined earlier in the file);
//   - a key-level block scalar (`script: |` with the shell under the key);
//   - a column-0 anchor definition whose body the alias splices into a
//     script list (`.net_setup: &net_setup` — the body is shell, so it is
//     extracted at its definition; the alias item itself contributes the
//     same text and is not double-checked).
// Any other shape is reported in `errors` instead of being silently
// skipped — a shape the extractor does not understand is shell the gate
// does not see, and it must fail loudly.

const KEY_RE = new RegExp('^(\\s+)(script|before_script|after_script):\\s*(.*)$');
// Column-0 key, optionally carrying a YAML anchor token: `.name: &anchor`.
const TOP_KEY_RE = /^([^\s#][^:]*):\s*(?:&(\S+)\s*)?(?:#.*)?$/;
const ITEM_RE = /^(\s*)-\s+(.*)$/;
const BLOCK_SCALAR_RE = /^[|>][-+]?$/;

// YAML strips a block scalar's indentation relative to its first non-blank
// line before handing the text to bash, so the gate strips the same amount
// (the minimum indent of the body's non-blank lines) — otherwise an indented
// heredoc terminator would be a syntax error here but not in the real run.
const stripCommonIndent = (bodyLines) => {
  const indents = bodyLines.filter((l) => l.trim()).map((l) => l.match(/^ */)[0].length);
  const cut = Math.min(...indents);
  return bodyLines.map((l) => l.slice(cut)).join('\n');
};

function extractCiShellBlocks(content) {
  const lines = content.split('\n');
  const blocks = [];
  const errors = [];

  // First pass: locate every column-0 anchor definition, so a `- *alias`
  // item inside a script list can point at its body regardless of the
  // order the single scan reaches the two lines.
  const anchors = new Map();
  lines.forEach((line, idx) => {
    const topKey = line.match(TOP_KEY_RE);
    if (topKey && topKey[2]) {
      anchors.set(topKey[2], { key: topKey[1].trim(), bodyStart: idx + 1 });
    }
  });

  // Parse the list of items below a bare key (or an anchor body) — items
  // may sit at any indent >= keyIndent, including exactly at it (a legal
  // YAML sequence style). The list ends at the first non-dash line at or
  // above keyIndent: the next sibling key.
  const parseList = (i, keyIndent, owner, key) => {
    while (i < lines.length) {
      const line = lines[i];
      if (!line.trim()) {
        i += 1;
        continue;
      }
      const indent = line.match(/^ */)[0].length;
      if (indent < keyIndent) {
        break;
      }
      const itemMatch = line.match(ITEM_RE);
      if (!itemMatch) {
        if (indent <= keyIndent) {
          break; // next sibling key — the list is over
        }
        i += 1; // stray comment between items — not shell
        continue;
      }
      const dashIndent = itemMatch[1].length;
      const itemText = itemMatch[2];
      const alias = itemText.match(/^\*(\S+)$/);
      if (alias) {
        // Alias item: the shell lives at the anchor's definition — extract
        // it there, once. An unknown target is a loud error, never a
        // silent skip. Only anchors referenced FROM a script list are
        // shell-checked this way; a column-0 anchor used elsewhere
        // (changes filters, rules) never runs under bash and its body
        // (`- if: ...`, `- path/...`) is not shell.
        if (!anchors.has(alias[1])) {
          errors.push({ line: i + 1, message: `alias to unknown anchor: *${alias[1]}` });
        } else {
          parseAnchor(alias[1]);
        }
        i += 1;
        continue;
      }
      if (BLOCK_SCALAR_RE.test(itemText)) {
        // Block scalar item: the body is every following line indented
        // deeper than the dash (blank lines included).
        const bodyStart = i + 2;
        const body = [];
        let j = i + 1;
        while (j < lines.length) {
          const bodyLine = lines[j];
          if (!bodyLine.trim() || bodyLine.match(/^ */)[0].length > dashIndent) {
            body.push(bodyLine);
            j += 1;
          } else {
            break;
          }
        }
        // Trailing blank lines inside the scalar are not shell.
        while (body.length && !body[body.length - 1].trim()) {
          body.pop();
        }
        i = j;
        blocks.push({ owner, key, startLine: bodyStart, text: stripCommonIndent(body) });
      } else {
        // Plain scalar item: single line, plus any deeper-indented
        // continuation lines folded with spaces (YAML plain-scalar rule).
        const parts = [itemText];
        i += 1;
        while (i < lines.length) {
          const cont = lines[i];
          if (!cont.trim() || cont.match(/^ */)[0].length <= dashIndent) {
            break;
          }
          parts.push(cont.trim());
          i += 1;
        }
        blocks.push({ owner, key, startLine: i - parts.length + 1, text: parts.join(' ') });
      }
    }
    return i;
  };

  // Extract an anchor body as a shell list (the `- *alias` splices it into
  // a script list, so its lines run under bash exactly as written here).
  const checkedAnchors = new Set();
  const parseAnchor = (name) => {
    if (checkedAnchors.has(name)) {
      return;
    }
    checkedAnchors.add(name); // also guards against (illegal) alias cycles
    const def = anchors.get(name);
    if (!def) {
      return;
    }
    parseList(def.bodyStart, 0, def.key, 'anchor');
  };

  let owner = null;
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    // Top-level key at column 0: the job (or hidden anchor) owning any
    // nested script blocks. A column-0 comment inside a job body is valid
    // YAML there and must not reset the owner — hence the [^\s#] guard.
    const topKey = line.match(TOP_KEY_RE);
    if (topKey) {
      owner = topKey[1].trim();
      i += 1;
      continue;
    }

    const keyMatch = line.match(KEY_RE);
    if (!keyMatch) {
      i += 1;
      continue;
    }
    const keyIndent = keyMatch[1].length;
    const key = keyMatch[2];
    // `script:  # note` reads as an empty key followed by a comment.
    let rest = keyMatch[3].trim();
    if (rest.startsWith('#')) {
      rest = '';
    }

    if (BLOCK_SCALAR_RE.test(rest)) {
      // Key-level block scalar (`script: |`): the shell is every line
      // indented deeper than the key, extracted as one block.
      const bodyStart = i + 2;
      const body = [];
      let j = i + 1;
      while (j < lines.length) {
        const bodyLine = lines[j];
        if (!bodyLine.trim() || bodyLine.match(/^ */)[0].length > keyIndent) {
          body.push(bodyLine);
          j += 1;
        } else {
          break;
        }
      }
      while (body.length && !body[body.length - 1].trim()) {
        body.pop();
      }
      i = j;
      blocks.push({ owner, key, startLine: bodyStart, text: stripCommonIndent(body) });
      continue;
    }

    if (rest !== '') {
      // Unhandled shape: an inline value (`script: npm test`), an alias
      // value (`script: *anchor`) — none exist today. Loud error, never
      // a silent coverage gap.
      errors.push({ line: i + 1, message: `unhandled ${key} value shape: "${rest}"` });
      i += 1;
      continue;
    }

    // Bare key: the list of script items below it (aliases inside resolve
    // to their anchor definitions, which parseAnchor checks there).
    i = parseList(i + 1, keyIndent, owner, key);
  }
  return { blocks, errors };
}

module.exports = { extractCiShellBlocks };
