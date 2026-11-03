// Extracts the shell embedded in .gitlab-ci.yml script blocks so a syntax
// gate can parse it (#1306, #1322). The pipeline lint (glab ci lint) only
// validates YAML structure — the contents of `script:` / `before_script:` /
// `after_script:` values are opaque to it, so a bash syntax error in an
// embedded block ships green until the first merge train (measured on
// !674: a stale duplicate block plus a stray `done` survived four review
// rounds and three pushed commits).
//
// Line-based parser, like the other validators in this directory. Shapes
// handled:
//   - a bare `script:` key followed by a list of items — plain scalars,
//     `|`/`>` block scalars (with explicit indentation indicators), or
//     `- *alias` items with or without a trailing comment (YAML requires
//     the alias target to be defined earlier in the file);
//   - a key-level value: block scalar (`script: |`), inline scalar
//     (`script: npm test`), alias (`script: *anchor`), or an anchor token
//     on the key (`script: &s |`) followed by any of those;
//   - a column-0 anchor definition whose body an alias splices into a
//     script list (`.net_setup: &net_setup` — the body is shell, so it is
//     extracted at its definition; the alias itself contributes the same
//     text and is not double-checked);
//   - data block scalars under OTHER keys (a variable holding shell text,
//   an embedded example) are skipped, not extracted — their content never
//   runs as shell.
// Any other shape (e.g. a flow sequence, an unknown YAML tag) is reported
// in `errors` instead of being silently skipped — a shape the extractor
// does not understand is shell the gate does not see, and it must fail
// loudly.

const KEY_RE = new RegExp('^(\\s+)(script|before_script|after_script):\\s*(.*)$');
// Column-0 key, optionally carrying a YAML anchor token: `.name: &anchor`.
// The key may itself contain colons (namespaced jobs: `config:validate:`),
// so the class is only bounded by whitespace and comments — a valueless
// (or comment/anchor-suffixed) line is what makes the match. A line with
// an inline value fails the match and is handled by DATA_SCALAR_RE.
const TOP_KEY_RE = /^([^\s#][^#]*):\s*(?:&(\S+)\s*)?(?:#.*)?$/;
const ITEM_RE = /^(\s*)-\s+(.*)$/;
// `|`, `|-`, `|2`, `|2-`, `>-`, ... — the block scalar styles with their
// optional indentation indicator and chomping modifier, in either order.
const BLOCK_SCALAR_RE = /^[|>](?:\d[+-]?|[+-]?\d?)$/;
const ALIAS_RE = /^\*(\S+)(?:\s+#.*)?$/;
// A key of any indent opening a block scalar value — data, never shell,
// unless the key is a script key (handled first). Quoted single-line
// values are not matched: they have no body to skip.
const DATA_SCALAR_RE = /^(\s*)([^#\s][^:]*):\s*(?:&\S+\s+)?[|>](?:\d[+-]?|[+-]?\d?)\s*(?:#.*)?$/;
const ANCHOR_TOKEN_RE = /^&(\S+)\s*/;
const FLOW_VALUE_RE = /^[[{]/;

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
  // Column-0 anchor definitions, recorded as the scan reaches them (YAML
  // requires a definition to precede the aliases that reference it).
  const anchors = new Map();

  // Collect a block scalar's body starting at line `start`: every following
  // line blank or indented deeper than `indentFloor` (the dash or the key),
  // trailing blank lines excluded — they are layout, not shell. Returns the
  // body plus the index of the first line after it.
  const collectBlockBody = (start, indentFloor) => {
    const body = [];
    let j = start;
    while (j < lines.length) {
      const bodyLine = lines[j];
      if (!bodyLine.trim() || bodyLine.match(/^ */)[0].length > indentFloor) {
        body.push(bodyLine);
        j += 1;
      } else {
        break;
      }
    }
    while (body.length && !body[body.length - 1].trim()) {
      body.pop();
    }
    return { body, next: j };
  };

  // An alias (item-level or key-level) resolves to the anchor's definition:
  // extract it there, once per anchor. An unknown target is a loud error,
  // never a silent skip. Only anchors referenced FROM a script value are
  // shell-checked this way; a column-0 anchor used elsewhere (changes
  // filters, rules) never runs under bash and its body (`- if: ...`,
  // `- path/...`) is not shell.
  const checkedAnchors = new Set();
  const resolveAlias = (name, lineNo) => {
    if (!anchors.has(name)) {
      errors.push({ line: lineNo, message: `alias to unknown anchor: *${name}` });
      return;
    }
    if (checkedAnchors.has(name)) {
      return;
    }
    checkedAnchors.add(name);
    const def = anchors.get(name);
    parseList(def.bodyStart, 0, def.key, 'anchor');
  };

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
      if (itemText.startsWith('!')) {
        // YAML tag (e.g. `- !reference [...]`): not shell, and not a shape
        // this parser models — loud error, never a silent coverage gap.
        errors.push({ line: i + 1, message: `unhandled ${key} item shape (YAML tag): "${itemText}"` });
        i += 1;
        continue;
      }
      const alias = itemText.match(ALIAS_RE);
      if (alias) {
        resolveAlias(alias[1], i + 1);
        i += 1;
        continue;
      }
      if (BLOCK_SCALAR_RE.test(itemText)) {
        const bodyStart = i + 2; // 1-based line of the body's first line
        const { body, next } = collectBlockBody(i + 1, dashIndent);
        i = next;
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

  let owner = null;
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    // Top-level key at column 0: the job (or hidden anchor) owning any
    // nested script blocks. A column-0 comment inside a job body is valid
    // YAML there and must not reset the owner — hence the [^\s#] guard.
    // A key carrying a YAML anchor token is recorded so alias items can
    // resolve to it.
    const topKey = line.match(TOP_KEY_RE);
    if (topKey) {
      owner = topKey[1].trim();
      if (topKey[2]) {
        anchors.set(topKey[2], { key: owner, bodyStart: i + 1 });
      }
      i += 1;
      continue;
    }

    const keyMatch = line.match(KEY_RE);
    if (!keyMatch) {
      // A block scalar under a non-script key is data (a variable value, an
      // embedded example) — skip its body wholesale so shell-looking lines
      // inside it are not extracted.
      const dataScalar = line.match(DATA_SCALAR_RE);
      if (dataScalar) {
        const { next } = collectBlockBody(i + 1, dataScalar[1].length);
        i = next;
        continue;
      }
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
    // An anchor token on the script key itself (`script: &s |`): legal
    // YAML, irrelevant to what runs — strip it and parse the value that
    // follows (an empty remainder means the anchored bare-key list).
    const anchorToken = rest.match(ANCHOR_TOKEN_RE);
    if (anchorToken) {
      rest = rest.slice(anchorToken[0].length).trim();
    }

    const keyAlias = rest.match(ALIAS_RE);
    if (BLOCK_SCALAR_RE.test(rest)) {
      // Key-level block scalar (`script: |`): the shell is every line
      // indented deeper than the key, extracted as one block.
      const bodyStart = i + 2; // 1-based line of the body's first line
      const { body, next } = collectBlockBody(i + 1, keyIndent);
      i = next;
      blocks.push({ owner, key, startLine: bodyStart, text: stripCommonIndent(body) });
    } else if (keyAlias) {
      // Key-level alias (`script: *anchor`): the shell lives at the
      // anchor's definition.
      resolveAlias(keyAlias[1], i + 1);
      i += 1;
    } else if (FLOW_VALUE_RE.test(rest)) {
      // A flow sequence/mapping (`script: ["echo a", "done"]`): items the
      // parser does not model — loud error, never a silent coverage gap.
      errors.push({ line: i + 1, message: `unhandled ${key} value shape (flow collection): "${rest}"` });
      i += 1;
    } else if (rest.startsWith('!')) {
      // YAML tag (e.g. `script: !reference [...]`): not shell, and not a
      // shape this parser models — loud error, never a silent coverage gap.
      errors.push({ line: i + 1, message: `unhandled ${key} value shape (YAML tag): "${rest}"` });
      i += 1;
    } else if (rest !== '') {
      // Inline scalar (`script: npm test`): one line of shell.
      blocks.push({ owner, key, startLine: i + 1, text: rest });
      i += 1;
    } else {
      // Bare key: the list of script items below it (aliases inside
      // resolve to their anchor definitions, which resolveAlias checks
      // there).
      i = parseList(i + 1, keyIndent, owner, key);
    }
  }
  return { blocks, errors };
}

module.exports = { extractCiShellBlocks };
