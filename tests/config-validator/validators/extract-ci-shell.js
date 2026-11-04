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
//   - a bare `script:` key (with or without a space before the colon)
//     followed by a list of items — plain scalars, `|`/`>` block scalars
//     (literal verbatim, folded folded like the runtime shell receives),
//     with optional indentation indicators, header comments, and anchor
//     tokens — or `- *alias` items (YAML requires the alias target to be
//     defined earlier in the file);
//   - a key-level value: block scalar, inline scalar, alias, anchor token
//     followed by any of those, or an empty flow collection (the legal
//     "no shell" no-op);
//   - anchors defined anywhere a script value accepts one (column-0 keys,
//     script keys, script items) and aliased into a script: list bodies
//     are parsed as lists, scalar bodies extracted as one block, mapping
//     bodies are a loud error;
//   - data block scalars under OTHER keys (a variable holding shell text,
//   an embedded example) are skipped, not extracted — their content never
//   runs as shell.
// Any other shape (a non-empty flow collection, an unknown YAML tag, a
// flow-style job definition) is reported in `errors` instead of being
// silently skipped — a shape the extractor does not understand is shell
// the gate does not see, and it must fail loudly. Errors carry the same
// shape the checker produces ({owner, key, startLine, message}).

// Script keys sit directly under a top-level job, at indent 1-2 — never
// deeper. A deeper `script:` line is a custom variable or example text
// (legal GitLab, data, never a job script), and must not be extracted.
const KEY_RE = new RegExp('^( {1,2})(script|before_script|after_script)\\s*:\\s*(.*)$');
// Column-0 key, optionally carrying a YAML anchor token: `.name: &anchor`.
// The key may itself contain colons (namespaced jobs: `config:validate:`),
// so the class is only bounded by whitespace and comments — a valueless
// (or comment/anchor-suffixed) line is what makes the match. A line with
// an inline value fails the match and is handled by DATA_SCALAR_RE.
const TOP_KEY_RE = /^([^\s#][^#]*):\s*(?:&(\S+)\s*)?(?:#.*)?$/;
const ITEM_RE = /^(\s*)-\s+(.*)$/;
// The block scalar header grammar after the `|`/`>` style char: optional
// indentation indicator and chomping modifier in either order, then an
// optional comment. One shared fragment — BLOCK_SCALAR_RE and
// DATA_SCALAR_RE must not drift.
const BLOCK_SCALAR_TAIL = '(?:\\d[+-]?|[+-]?\\d?)';
const BLOCK_SCALAR_RE = new RegExp(`^[|>]${BLOCK_SCALAR_TAIL}(?:\\s+#.*)?$`);
const ALIAS_RE = /^\*(\S+)(?:\s+#.*)?$/;
// A key of any indent opening a block scalar value — data, never shell,
// unless the key is a script key (handled first). Quoted single-line
// values are not matched: they have no body to skip.
const DATA_SCALAR_RE = new RegExp(`^(\\s*)([^#\\s][^:]*):\\s*(?:&\\S+\\s+)?[|>]${BLOCK_SCALAR_TAIL}\\s*(?:#.*)?$`);
const ANCHOR_TOKEN_RE = /^&(\S+)\s*/;
const FLOW_VALUE_RE = /^[[{]/;
// An empty flow collection (`script: []`, `before_script: []`) is a legal
// GitLab value meaning "no shell" — a no-op, not an unhandled shape.
const EMPTY_FLOW_SEQ_RE = /^\[\s*\]$/;
const EMPTY_FLOW_MAP_RE = /^\{\s*\}$/;
// The first line of a column-0 anchor body: a mapping entry (a template
// aliased into a script makes no sense as shell) — identifier-style key,
// colon, value.
const MAPPING_LINE_RE = /^\s+[\w.-]+:\s*(\S|$)/;
// A top-level (column-0) key whose value is a flow collection — a
// flow-style job definition. Its script keys are invisible to a line
// parser; loud error, never a silent coverage gap.
const FLOW_KEY_RE = /^([^\s#][^#]*):\s*[[{]/;

// YAML strips a block scalar's indentation relative to its first non-blank
// line before handing the text to bash, so the gate strips the same amount
// (the minimum indent of the body's non-blank lines) — otherwise an indented
// heredoc terminator would be a syntax error here but not in the real run.
const stripCommonIndent = (bodyLines) => {
  const indents = bodyLines.filter((l) => l.trim()).map((l) => l.match(/^ */)[0].length);
  const cut = Math.min(...indents);
  return bodyLines.map((l) => l.slice(cut)).join('\n');
};

// Folded scalar (`>`) semantics: a line break between two non-blank lines
// at the base indent becomes a space, blank lines become newlines, and a
// MORE-indented line keeps its literal break (and so do the breaks around
// it). Literal scalars (`|`) keep every line as-is.
const renderScalar = (headerChar, bodyLines) => {
  const stripped = stripCommonIndent(bodyLines).split('\n');
  if (headerChar !== '>') {
    return stripped.join('\n');
  }
  let out = '';
  let started = false;
  let pendingBlanks = 0;
  let literalZone = false;
  for (const line of stripped) {
    if (!line.trim()) {
      pendingBlanks += 1;
      continue;
    }
    const moreIndented = line.match(/^ */)[0].length > 0;
    if (!started) {
      out = line;
      started = true;
    } else if (moreIndented || literalZone) {
      out += '\n' + '\n'.repeat(pendingBlanks) + line;
      literalZone = moreIndented;
    } else if (pendingBlanks > 0) {
      out += '\n'.repeat(pendingBlanks) + line;
    } else {
      out += ' ' + line;
    }
    pendingBlanks = 0;
  }
  return out;
};

function extractCiShellBlocks(content) {
  const lines = content.split('\n');
  const blocks = [];
  const errors = [];
  // Anchor definitions, recorded as the scan reaches them (YAML requires
  // a definition to precede the aliases that reference it). The value is
  // a descriptor: {kind: 'block'|'list'|'col0'|'none'|'error', ...}.
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

  const pushError = (error) => {
    errors.push(error);
  };

  // Materialize an alias target into blocks/errors, once per anchor.
  const checkedAnchors = new Set();
  const resolveAlias = (name, lineNo) => {
    if (!anchors.has(name)) {
      // Unknown target — loud error, never a silent skip.
      pushError({ owner: null, key: null, startLine: lineNo, message: `alias to unknown anchor: *${name}` });
      return;
    }
    if (checkedAnchors.has(name)) {
      return;
    }
    checkedAnchors.add(name);
    const def = anchors.get(name);
    if (def.kind === 'block') {
      blocks.push(def.block);
    } else if (def.kind === 'list') {
      parseList(def.startIdx, def.keyIndent, def.owner, 'anchor');
    } else if (def.kind === 'col0') {
      // Shape unknown until resolved: a list body parses as a list, a
      // scalar body extracts as one block, a mapping body is a loud error
      // (a template aliased into a script makes no sense as shell).
      let k = def.bodyStart;
      while (k < lines.length && (!lines[k].trim() || lines[k].trimStart().startsWith('#'))) {
        k += 1;
      }
      if (k >= lines.length || lines[k].match(/^ */)[0].length === 0) {
        return; // empty body
      }
      if (lines[k].match(ITEM_RE)) {
        parseList(k, 0, def.owner, 'anchor');
      } else if (lines[k].match(MAPPING_LINE_RE)) {
        pushError({
          owner: def.owner,
          key: 'anchor',
          startLine: k + 1,
          message: `anchor *${name} has a mapping body — not shell it can be aliased into`
        });
      } else {
        const { body } = collectBlockBody(k, 0);
        blocks.push({ owner: def.owner, key: 'anchor', startLine: k + 1, text: renderScalar('|', body) });
      }
    } else if (def.kind === 'error') {
      pushError(def.error);
    }
    // kind 'none': the empty flow collection — no shell, nothing to check.
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
      let itemText = itemMatch[2];
      if (itemText.startsWith('!')) {
        // YAML tag (e.g. `- !reference [...]`): not shell, and not a shape
        // this parser models — loud error, never a silent coverage gap.
        pushError({ owner, key, startLine: i + 1, message: `unhandled ${key} item shape (YAML tag): "${itemText}"` });
        i += 1;
        continue;
      }
      // An anchor token on the item (`- &first echo hi`): record the item
      // as an alias target, then parse what follows.
      let itemName = null;
      const anchorToken = itemText.match(ANCHOR_TOKEN_RE);
      if (anchorToken) {
        itemName = anchorToken[1];
        itemText = itemText.slice(anchorToken[0].length).trim();
      }
      const alias = itemText.match(ALIAS_RE);
      if (alias) {
        // Alias item: the shell lives at the anchor's definition. Only
        // anchors referenced FROM a script value are shell-checked this
        // way; a column-0 anchor used elsewhere (changes filters, rules)
        // never runs under bash and its body (`- if: ...`, `- path/...`)
        // is not shell.
        resolveAlias(alias[1], i + 1);
        if (itemName) {
          anchors.set(itemName, {
            kind: 'error',
            error: {
              owner,
              key,
              startLine: i + 1,
              message: `anchor on an alias item (&${itemName} *${alias[1]}) is not a supported shape`
            }
          });
        }
        i += 1;
        continue;
      }
      if (BLOCK_SCALAR_RE.test(itemText)) {
        const bodyStart = i + 2; // 1-based line of the body's first line
        const { body, next } = collectBlockBody(i + 1, dashIndent);
        i = next;
        const block = { owner, key, startLine: bodyStart, text: renderScalar(itemText[0], body) };
        blocks.push(block);
        if (itemName) {
          anchors.set(itemName, { kind: 'block', block });
        }
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
        const block = { owner, key, startLine: i - parts.length + 1, text: parts.join(' ') };
        blocks.push(block);
        if (itemName) {
          anchors.set(itemName, { kind: 'block', block });
        }
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
    // resolve to it (its body shape is only known at resolve time).
    const topKey = line.match(TOP_KEY_RE);
    if (topKey) {
      owner = topKey[1].trim();
      if (topKey[2]) {
        anchors.set(topKey[2], { kind: 'col0', owner, bodyStart: i + 1 });
      }
      i += 1;
      continue;
    }

    const keyMatch = line.match(KEY_RE);
    if (!keyMatch) {
      // A flow-style job definition (`job: {script: [...]}`) hides its
      // script keys from a line parser — loud error, never a silent gap.
      const flowKey = line.match(FLOW_KEY_RE);
      if (flowKey) {
        pushError({
          owner: flowKey[1].trim(),
          key: null,
          startLine: i + 1,
          message: `flow-style value on top-level key "${flowKey[1].trim()}" — its script blocks cannot be shell-gated by this parser`
        });
      }
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
    // YAML — record the value that follows as an alias target and parse
    // it here as usual.
    let itemName = null;
    const anchorToken = rest.match(ANCHOR_TOKEN_RE);
    if (anchorToken) {
      itemName = anchorToken[1];
      rest = rest.slice(anchorToken[0].length).trim();
    }

    const keyAlias = rest.match(ALIAS_RE);
    if (BLOCK_SCALAR_RE.test(rest)) {
      // Key-level block scalar (`script: |`): the shell is every line
      // indented deeper than the key, extracted as one block.
      const bodyStart = i + 2; // 1-based line of the body's first line
      const { body, next } = collectBlockBody(i + 1, keyIndent);
      i = next;
      const block = { owner, key, startLine: bodyStart, text: renderScalar(rest[0], body) };
      blocks.push(block);
      if (itemName) {
        anchors.set(itemName, { kind: 'block', block });
      }
    } else if (keyAlias) {
      // Key-level alias (`script: *anchor`): the shell lives at the
      // anchor's definition.
      resolveAlias(keyAlias[1], i + 1);
      if (itemName) {
        anchors.set(itemName, {
          kind: 'error',
          error: {
            owner,
            key,
            startLine: i + 1,
            message: `anchor on an alias value (&${itemName} *${keyAlias[1]}) is not a supported shape`
          }
        });
      }
      i += 1;
    } else if (EMPTY_FLOW_SEQ_RE.test(rest) || EMPTY_FLOW_MAP_RE.test(rest)) {
      // `script: []` / `before_script: []` — a legal no-op (the documented
      // idiom to cancel an inherited default): no shell, nothing to check.
      if (itemName) {
        anchors.set(itemName, { kind: 'none' });
      }
      i += 1;
    } else if (FLOW_VALUE_RE.test(rest)) {
      // A non-empty flow sequence/mapping (`script: ["echo a", "done"]`):
      // items the parser does not model — loud error, never a silent
      // coverage gap.
      pushError({
        owner,
        key,
        startLine: i + 1,
        message: `unhandled ${key} value shape (flow collection): "${rest}"`
      });
      i += 1;
    } else if (rest.startsWith('!')) {
      // YAML tag (e.g. `script: !reference [...]`): not shell, and not a
      // shape this parser models — loud error, never a silent coverage gap.
      pushError({ owner, key, startLine: i + 1, message: `unhandled ${key} value shape (YAML tag): "${rest}"` });
      i += 1;
    } else if (rest !== '') {
      // Inline scalar (`script: npm test`): one line of shell.
      const block = { owner, key, startLine: i + 1, text: rest };
      blocks.push(block);
      if (itemName) {
        anchors.set(itemName, { kind: 'block', block });
      }
      i += 1;
    } else {
      // Bare key: the list of script items below it (aliases inside
      // resolve to their anchor definitions, which resolveAlias checks
      // there).
      if (itemName) {
        anchors.set(itemName, { kind: 'list', owner, keyIndent, startIdx: i + 1 });
      }
      i = parseList(i + 1, keyIndent, owner, key);
    }
  }
  return { blocks, errors };
}

module.exports = { extractCiShellBlocks };
