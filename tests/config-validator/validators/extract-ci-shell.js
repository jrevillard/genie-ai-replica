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

// Script keys sit directly under a top-level job, at the job body's own
// indent (tracked per job as jobIndent — 2 in this repo, but any consistent
// YAML indent is legal). A deeper `script:` line belongs to a nested
// mapping (a custom variable, example text — data, never a job script).
// Quoted keys ("script":) are legal YAML spellings of the same key.
const KEY_RE = new RegExp('^(\\s+)(["\']?)(script|before_script|after_script)\\2\\s*:\\s*(.*)$');
// Column-0 key, optionally carrying a YAML anchor token: `.name: &anchor`.
// The key may itself contain colons (namespaced jobs: `config:validate:`),
// so the class is only bounded by whitespace and comments — a valueless
// (or comment/anchor-suffixed) line is what makes the match. A line with
// an inline value fails the match and is handled by TOP_KEY_ANCHOR_SCALAR_RE
// or DATA_SCALAR_RE.
const TOP_KEY_RE = /^([^\s#][^#]*):\s*(?:&(\S+)\s*)?(?:#.*)?$/;
// Column-0 key whose anchored value is an inline scalar (.common: &common
// echo hello) — aliasable shell, recorded as a one-line block.
const TOP_KEY_ANCHOR_SCALAR_RE = /^([^\s#][^#]*):\s*&(\S+)\s+([^#]*?)\s*(?:#.*)?$/;
const ITEM_RE = /^(\s*)-(?:\s+(.*))?$/;
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
// parser; loud error, never a silent coverage gap. Framework keys whose
// flow values can never hold scripts are exempt (a flow `workflow:` or
// `include:` is a legal one-liner, not a job).
const FLOW_KEY_RE = /^([^\s#][^#]*?):\s*[[{]/;
const NON_JOB_FLOW_KEYS = new Set([
  'workflow',
  'include',
  'stages',
  'variables',
  'before_script',
  'after_script',
  'script',
  'image',
  'services',
  'pages'
]);

// The runner executes the YAML VALUE, not the quoted source text. A
// single-quoted item is always a balanced bash word, so gating the source
// text would pass anything inside it — unquote first.
const unquoteYaml = (text) => {
  if (text.length >= 2 && text.startsWith("'") && text.endsWith("'")) {
    return text.slice(1, -1).replace(/''/g, "'");
  }
  if (text.length >= 2 && text.startsWith('"') && text.endsWith('"')) {
    const escapes = { b: '\b', f: '\f', n: '\n', r: '\r', t: '\t' };
    return text.slice(1, -1).replace(/\\(["\\/bfnrt])/g, (match, c) => escapes[c] || c);
  }
  return text;
};

// Fold a plain scalar body the way YAML does: a break between non-blank
// lines becomes a space, a blank line becomes a newline.
const foldPlainBody = (bodyLines) => {
  let out = '';
  let pendingBlanks = 0;
  for (const line of bodyLines) {
    if (!line.trim()) {
      pendingBlanks += 1;
      continue;
    }
    out += (pendingBlanks > 0 ? '\n'.repeat(pendingBlanks) : out ? ' ' : '') + line.trim();
    pendingBlanks = 0;
  }
  return out;
};

// Split a flow sequence body into its entries (`[.a, .b]` → ['.a', '.b']);
// a plain value is a one-entry list.
const splitFlowList = (value) => {
  if (!value.startsWith('[')) {
    return [value];
  }
  return value
    .slice(1, -1)
    .split(',')
    .map((s) => s.trim());
};

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

  // Plain scalar continuation folding shared by item-level and key-level
  // plain scalars: a break between non-blank lines folds to a space, a
  // blank line folds to a newline. Stops at the first non-blank line at
  // or above floorIndent. Returns the folded text and the index of the
  // first unconsumed line.
  const collectPlain = (firstText, floorIndent, startIdx) => {
    let text = firstText;
    let pendingBlanks = 0;
    let j = startIdx;
    while (j < lines.length) {
      const cont = lines[j];
      if (!cont.trim()) {
        pendingBlanks += 1;
        j += 1;
        continue;
      }
      if (cont.match(/^ */)[0].length <= floorIndent) {
        break;
      }
      text += (pendingBlanks > 0 ? '\n'.repeat(pendingBlanks) : ' ') + cont.trim();
      pendingBlanks = 0;
      j += 1;
    }
    return { text, next: j };
  };

  // Materialize an alias target into blocks/errors — once per alias SITE,
  // with the aliasing job's owner/key: the anchor shell runs in the
  // aliasing job, and a second copy inside the definition owner's group
  // would let duplicated text even out a quote parity (a false pass in
  // the !674 class).
  const resolveAlias = (name, lineNo, aliaserOwner, aliaserKey) => {
    if (!anchors.has(name)) {
      // Unknown target — loud error, never a silent skip.
      pushError({
        owner: aliaserOwner,
        key: aliaserKey,
        startLine: lineNo,
        message: `alias to unknown anchor: *${name}`
      });
      return;
    }
    const def = anchors.get(name);
    if (def.kind === 'block') {
      blocks.push({ ...def.block, owner: aliaserOwner, key: aliaserKey });
    } else if (def.kind === 'list') {
      parseList(def.startIdx, def.keyIndent, aliaserOwner, aliaserKey);
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
        parseList(k, 0, aliaserOwner, aliaserKey);
      } else if (lines[k].match(MAPPING_LINE_RE)) {
        pushError({
          owner: def.owner,
          key: aliaserKey,
          startLine: k + 1,
          message: `anchor *${name} has a mapping body — not shell it can be aliased into`
        });
      } else {
        // A scalar body is a plain multi-line scalar: YAML folds its
        // breaks into spaces.
        const { body } = collectBlockBody(k, 0);
        blocks.push({
          owner: aliaserOwner,
          key: aliaserKey,
          startLine: k + 1,
          text: foldPlainBody(body)
        });
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
        if (line.trimStart().startsWith('#')) {
          i += 1; // a comment between items is YAML layout, not the end of the list
          continue;
        }
        if (indent <= keyIndent) {
          break; // next sibling key — the list is over
        }
        i += 1; // stray line between items — not shell
        continue;
      }
      const dashIndent = itemMatch[1].length;
      let itemText = itemMatch[2];
      if (itemText === undefined || itemText === '') {
        i += 1; // a null item — no shell
        continue;
      }
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
        // Alias item: the shell lives at the anchor's definition, but it
        // RUNS in this job — materialize it here, under this owner. Only
        // anchors referenced FROM a script value are shell-checked this
        // way; a column-0 anchor used elsewhere (changes filters, rules)
        // never runs under bash and its body (`- if: ...`, `- path/...`)
        // is not shell.
        resolveAlias(alias[1], i + 1, owner, key);
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
        // Plain scalar item: a line, plus any deeper-indented continuation
        // lines folded YAML-style (space between lines, newline across a
        // blank line). A quoted item is a single scalar — unquote it and
        // take it as it stands.
        const itemLine = i + 1;
        const quoted = itemText.startsWith("'") || itemText.startsWith('"');
        const folded = quoted
          ? { text: unquoteYaml(itemText), next: i + 1 }
          : collectPlain(itemText, dashIndent, i + 1);
        i = folded.next;
        const block = { owner, key, startLine: itemLine, text: folded.text };
        blocks.push(block);
        if (itemName) {
          anchors.set(itemName, { kind: 'block', block });
        }
      }
    }
    return i;
  };

  let owner = null;
  let jobIndent = null; // the body indent of the current top-level mapping
  const mergeSites = []; // inherited script sources, resolved after the scan
  // Keys explicitly cancelled with an empty value (`script: []`): defined
  // for the owning job, producing no shell. Inheritance must treat them
  // as present-and-empty, not absent.
  const canceledKeys = new Map(); // job owner -> Set of keys
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
      jobIndent = null;
      if (topKey[2]) {
        anchors.set(topKey[2], { kind: 'col0', owner, bodyStart: i + 1 });
      }
      i += 1;
      if (owner === 'variables') {
        // The global variables block is data — a variable named `script`
        // is not a job script. Skip the whole mapping.
        while (i < lines.length && (lines[i].trim() === '' || lines[i].match(/^ */)[0].length > 0)) {
          i += 1;
        }
      }
      continue;
    }

    // Column-0 anchored inline scalar (.common: &common echo hello) —
    // aliasable shell.
    const anchorScalar = line.match(TOP_KEY_ANCHOR_SCALAR_RE);
    if (anchorScalar) {
      owner = anchorScalar[1].trim();
      jobIndent = null;
      const keyLine = i + 1;
      const folded = collectPlain(anchorScalar[3].trim(), 0, i + 1);
      i = folded.next;
      anchors.set(anchorScalar[2], {
        kind: 'block',
        block: { owner, key: 'scalar', startLine: keyLine, text: folded.text }
      });
      continue;
    }

    // Track the current top-level mapping's body indent from its first
    // nested line — script keys must sit exactly there.
    if (jobIndent === null && line.trim() && !line.trimStart().startsWith('#')) {
      jobIndent = line.match(/^ */)[0].length;
    }

    // Inherited scripts: a merged template (`<<: *tpl`) and an extended
    // base (`extends: .base`) run their script INSIDE the job that
    // inherits them. Recorded here, resolved after the scan.
    const mergeLine = line.match(/^(\s*)<<:\s*\*(\S+)\s*$/);
    if (mergeLine && jobIndent !== null && mergeLine[1].length === jobIndent) {
      mergeSites.push({ jobOwner: owner, anchorName: mergeLine[2], kind: 'merge', startLine: i + 1 });
      i += 1;
      continue;
    }
    const extendsLine = line.match(/^(\s*)extends:\s*(.*)$/);
    if (extendsLine && jobIndent !== null && extendsLine[1].length === jobIndent) {
      const targets = [];
      const inlineValue = extendsLine[2].trim();
      if (inlineValue) {
        const list = splitFlowList(inlineValue);
        for (const t of list) {
          const name = t.replace(/^['"]|['"]$/g, '');
          if (name) {
            targets.push(name);
          }
        }
      } else {
        let j = i + 1;
        while (j < lines.length) {
          const item = lines[j].match(/^(\s*)-\s*(.+)$/);
          if (!item || item[1].length <= jobIndent) {
            break;
          }
          targets.push(item[2].trim().replace(/^['"]|['"]$/g, ''));
          j += 1;
        }
        i = j;
      }
      for (const baseOwner of targets) {
        mergeSites.push({ jobOwner: owner, baseOwner, kind: 'extends', startLine: i + 1 });
      }
      if (inlineValue) {
        i += 1;
      }
      continue;
    }

    const keyMatch = jobIndent !== null ? line.match(KEY_RE) : null;
    if (!keyMatch || keyMatch[1].length !== jobIndent) {
      // A flow-style job definition (`job: {script: [...]}`) hides its
      // script keys from a line parser — loud error, never a silent gap.
      // Framework keys whose flow values can never hold scripts are exempt.
      const flowKey = line.match(FLOW_KEY_RE);
      if (flowKey && !NON_JOB_FLOW_KEYS.has(flowKey[1].trim())) {
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
    const key = keyMatch[3];
    // `script:  # note` reads as an empty key followed by a comment.
    let rest = keyMatch[4].trim();
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
      // anchor's definition but runs in this job.
      resolveAlias(keyAlias[1], i + 1, owner, key);
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
      // `script: []` / `before_script: []` — a legal no-op producing no
      // shell to check, but the KEY is defined: GitLab runs no script at
      // all for this job, cancelling any inherited one. Recorded so the
      // inheritance resolution does not credit a base's script to a job
      // that explicitly cancelled it.
      if (!canceledKeys.has(owner)) {
        canceledKeys.set(owner, new Set());
      }
      canceledKeys.get(owner).add(key);
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
      // Inline scalar (`script: npm test`) — one line of shell, plus any
      // deeper-indented plain-scalar continuation lines folded in. A
      // quoted value is unquoted first: the runner executes the value.
      const quoted = rest.startsWith("'") || rest.startsWith('"');
      const folded = quoted ? { text: unquoteYaml(rest), next: i + 1 } : collectPlain(rest, keyIndent, i + 1);
      const block = { owner, key, startLine: i + 1, text: folded.text };
      blocks.push(block);
      if (itemName) {
        anchors.set(itemName, { kind: 'block', block });
      }
      i = folded.next;
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

  // Resolve inherited scripts: a merged template or an extended base runs
  // its script inside the inheriting job. BOTH mechanisms are reverse
  // deep merges: the job's own keys — script included — replace the
  // base's (`<<:` by YAML merge-key semantics, `extends` by GitLab's —
  // which is why `!reference` exists to concatenate scripts). The base's
  // script therefore runs in the job only when the job defines none of
  // its own, and this extraction credits exactly the lines a job can
  // run for the single-base shapes the CI file uses today. (Approximation
  // kept from the original gate: a multi-base `extends: [.a, .b]` with
  // script-carrying bases credits both scripts, where GitLab runs one
  // array — no such job exists here; tightening it is a conscious future
  // decision, not a silent gap.)
  // The job -> inherited sources mapping (extends AND `<<:` merge — a
  // job can reach a template through either) is returned alongside the
  // blocks: a structural guard (which jobs inherit which template) must
  // read the SAME derivation the shell re-materialization used, or the
  // guard and the sweep can silently disagree about what inherits what.
  const extendsMap = new Map(); // job owner -> [source names]
  if (mergeSites.length > 0) {
    const inherited = new Map(); // job owner -> inherited blocks
    const droppedSources = new Set(); // templates/bases that never run alone
    for (const site of mergeSites) {
      const sourceOwner = site.kind === 'merge' ? (anchors.get(site.anchorName) || {}).owner : site.baseOwner;
      if (!sourceOwner) {
        pushError({
          owner: site.jobOwner,
          key: null,
          startLine: site.startLine,
          message: `unknown ${site.kind} source for job "${site.jobOwner}"`
        });
        continue;
      }
      const bases = extendsMap.get(site.jobOwner) || [];
      bases.push(sourceOwner);
      extendsMap.set(site.jobOwner, bases);
      const ownKeys = new Set(blocks.filter((b) => b.owner === site.jobOwner).map((b) => b.key));
      for (const key of canceledKeys.get(site.jobOwner) || []) {
        ownKeys.add(key);
      }
      const copies = inherited.get(site.jobOwner) || [];
      for (const sb of blocks.filter((b) => b.owner === sourceOwner)) {
        const include = !ownKeys.has(sb.key);
        if (include) {
          copies.push({ ...sb, owner: site.jobOwner });
        }
      }
      inherited.set(site.jobOwner, copies);
      droppedSources.add(sourceOwner);
    }
    const assembled = [];
    const emitted = new Set();
    for (const b of blocks) {
      const copies = inherited.get(b.owner);
      if (copies && !emitted.has(b.owner)) {
        emitted.add(b.owner);
        assembled.push(...copies);
      }
      assembled.push(b);
    }
    for (const [jobOwner, copies] of inherited) {
      if (!emitted.has(jobOwner)) {
        assembled.push(...copies);
      }
    }
    blocks.length = 0;
    blocks.push(...assembled.filter((b) => !droppedSources.has(b.owner)));
  }
  return { blocks, errors, extendsMap };
}

module.exports = { extractCiShellBlocks };
