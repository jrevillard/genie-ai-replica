// Extracts the shell embedded in .gitlab-ci.yml script blocks so a syntax
// gate can parse it (#1306, #1322). The pipeline lint (glab ci lint) only
// validates YAML structure — the contents of `script:` / `before_script:` /
// `after_script:` lists are opaque to it, so a bash syntax error in an
// embedded block ships green until the first merge train (measured on
// !674: a stale duplicate block plus a stray `done` survived four review
// rounds and three pushed commits).
//
// Line-based parser, like the other validators in this directory: the file
// uses only two script shapes today (bare `script:` keys with a list of
// items, each item a plain scalar or a `|`/`>` block scalar). Any other
// shape is reported in `errors` instead of being silently skipped — a
// shape the extractor does not understand is shell the gate does not see,
// and it must fail loudly.

const SCRIPT_KEYS = 'script|before_script|after_script';

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
  let owner = null;
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    // Top-level key at column 0: the job (or hidden anchor) owning any
    // nested script blocks. A column-0 comment inside a job body is valid
    // YAML there and must not reset the owner — hence the [^\s#] guard.
    const topKey = line.match(/^([^\s#][^:]*):\s*(?:#.*)?$/);
    if (topKey) {
      owner = topKey[1].trim();
      i += 1;
      continue;
    }

    const keyMatch = line.match(new RegExp(`^(\\s+)(${SCRIPT_KEYS}):\\s*(.*)$`));
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

    if (rest !== '') {
      // Unhandled shape: an inline value, a key-level block scalar
      // (`script: |`), an alias (`script: *anchor`) — none exist today.
      // Loud error, never a silent coverage gap.
      errors.push({ line: i + 1, message: `unhandled ${key} value shape: "${rest}"` });
      i += 1;
      continue;
    }

    // List of script items below the bare key.
    i += 1;
    while (i < lines.length) {
      const line2 = lines[i];
      if (!line2.trim()) {
        i += 1;
        continue;
      }
      const indent2 = line2.match(/^ */)[0].length;
      if (indent2 <= keyIndent) {
        break; // next sibling key — the list is over
      }
      const itemMatch = line2.match(/^(\s*)-\s+(.*)$/);
      if (!itemMatch) {
        i += 1; // stray comment between items — not shell
        continue;
      }
      const dashIndent = itemMatch[1].length;
      let text;
      if (/^[|>][-++]?$/.test(itemMatch[2])) {
        // Block scalar item: the body is every following line indented
        // deeper than the dash (blank lines included).
        const bodyStart = i + 1;
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
        text = stripCommonIndent(body);
        i = j;
        blocks.push({ owner, key, startLine: bodyStart + 1, text });
      } else {
        // Plain scalar item: single line, plus any deeper-indented
        // continuation lines folded with spaces (YAML plain-scalar rule).
        const parts = [itemMatch[2]];
        i += 1;
        while (i < lines.length) {
          const cont = lines[i];
          if (!cont.trim() || cont.match(/^ */)[0].length <= dashIndent) {
            break;
          }
          parts.push(cont.trim());
          i += 1;
        }
        text = parts.join(' ');
        blocks.push({ owner, key, startLine: i - parts.length + 1, text });
      }
    }
  }
  return { blocks, errors };
}

module.exports = { extractCiShellBlocks };
