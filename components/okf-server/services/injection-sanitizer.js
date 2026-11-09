// Copyright (C) 2026 International Telecommunication Union (ITU)
// SPDX-License-Identifier: Apache-2.0
/**
 * services/injection-sanitizer.js — the #914 bounded sanitizer (David's
 * 2026-11-05 disposition, deliverable (b)).
 *
 * SCOPE (the story's boundaries, verbatim):
 *  - NEVER rewrites steward-visible content. The concept body a curator
 *    reads in the editor is untouched; only LLM-PROMPT slices and the
 *    LLM-written summary pass through here.
 *  - A FIXED, versioned pattern list — no ML, no dynamic pattern loading,
 *    no over-blocking. Imperative-instruction TEXT ("ignore previous
 *    instructions" prose) is FLAGGED, never stripped from prompt slices: a
 *    crawled document legitimately DISCUSSING prompt injection (this very
 *    repository's docs) must not be mangled. The system prompt's
 *    bounded-vocabulary contract is the real defense against prose.
 *  - What IS stripped from prompt slices: the invisible channels
 *    (zero-width / bidi control chars — content the reader never sees and
 *    the model does) and the delimiter-impersonation tokens (ChatML /
 *    Llama / common fake "SYSTEM:" line prefixes) that attempt to end the
 *    user turn and start a fake system turn.
 *
 * Consumers (the only two wire-in points, per the story):
 *  - llm-curation-service buildCurationPrompt — the 1200-char body slice.
 *  - llm-curation-service proposeLinks — the 4000-char body slice.
 *  - boundSummary — the LLM-written summary field (fm.description path).
 *
 * Fixture corpus (single source of truth for tests AND eval rows):
 *   data/okf/injection-eval/fixtures.json
 */

// The pattern list. VERSIONED — bump INJECTION_PATTERNS_VERSION whenever a
// family or a pattern changes, so a deployed container's behavior can be
// pinned against the fixture corpus it shipped with.
const INJECTION_PATTERNS_VERSION = '2026-11-09.1';

// Zero-width and bidirectional control characters: invisible in every editor
// and terminal, fully visible to the model. U+200B-U+200D, U+2060, U+FEFF
// (zero-width family); U+202A-U+202E, U+2066-U+2069 (bidi overrides). Built
// from a string so the class travels as data (the no-irregular-whitespace
// rule does not skip regex literals; the escapes in a string are fine).
const INVISIBLE_CHARS_SOURCE = '[\\u200B-\\u200D\\u2060\\uFEFF\\u202A-\\u202E\\u2066-\\u2069]';
const INVISIBLE_CHARS = new RegExp(INVISIBLE_CHARS_SOURCE, 'g');
// HTML comments: an invisible channel in rendered markdown, plain text to
// the model. The WHOLE span goes (markers + content) — content hidden from
// the reader is by definition not display prose.
const HTML_COMMENT = /<!--[\s\S]*?-->/g;
// Delimiter-impersonation tokens: the chat-template control sequences of the
// common open-weight families (ChatML <|im_start|>/<|im_end|>/<|endoftext|>,
// Llama <<SYS>>/[INST], and bare end-of-text markers), plus fake
// role-prefix LINES at line start ("SYSTEM:"/"ASSISTANT:" standing alone on
// a line mid-document — the fake-turn pattern). Prose that merely MENTIONS
// these (this repo's own docs) matches the SCAN families and is flagged;
// only the literal TOKEN is neutralized in prompt slices, so the prose stays
// readable.
const DELIMITER_TOKENS = [
  { family: 'delimiter_impersonation', re: /<\|(?:im_start|im_end|endoftext|system|user|assistant)\|>/gi },
  { family: 'delimiter_impersonation', re: /<<\s*(?:SYS|SYSTEM)\s*>>|<<\/\s*(?:SYS|SYSTEM)\s*>>/gi },
  { family: 'delimiter_impersonation', re: /\[(?:INST|\/INST)\]/g },
  { family: 'delimiter_impersonation', re: /<(?:\|?\s*(?:system|endoftext)\s*\|?)>/gi },
  { family: 'delimiter_impersonation', re: /<endoftext\s*\/?>(?![a-z])/gi }
];
const FAKE_ROLE_LINE = /^\s*(?:SYSTEM|ASSISTANT|USER|DEVELOPER)\s*(?:PROMPT)?\s*:\s*$/im;
// Imperative-instruction PROSE families — flag-only, never stripped (the
// story's explicit rule). These are advisory signals for the curation
// counters, not rewriters.
const IMPERATIVE_PATTERNS = [
  {
    family: 'instruction_override',
    re: /\bignore\b[^.\n]{0,40}\b(?:previous|prior|above|earlier|all)\b[^.\n]{0,20}\b(?:instruction|prompt|rule)/i
  },
  { family: 'instruction_override', re: /\bdisregard\b[^.\n]{0,40}\b(?:previous|prior|above|earlier|all)\b/i },
  {
    family: 'instruction_override',
    re: /\bforget\b[^.\n]{0,30}\b(?:everything|all|your)\b[^.\n]{0,30}\b(?:above|before|instructions)/i
  },
  { family: 'role_overwrite', re: /\byou are now\b/i },
  { family: 'role_overwrite', re: /\byou are no longer\b/i },
  { family: 'role_overwrite', re: /\bnew (?:system )?instructions?\s*:/i },
  { family: 'role_overwrite', re: /\bfrom now on,?\s+you\b/i },
  {
    family: 'data_exfiltration_ask',
    re: /\b(?:reveal|print|output|repeat)\b[^.\n]{0,40}\b(?:your )?(?:system prompt|instructions|rules)\b/i
  }
];

const EXCERPT_MAX = 100;
const firstExcerpt = (text, match) => {
  const start = Math.max(0, match.index - 20);
  return (
    (start > 0 ? '…' : '') +
    text.slice(start, match.index + (match[0] || '').length + 20).replace(/\s+/g, ' ') +
    (start + 140 < text.length ? '…' : '')
  ).slice(0, EXCERPT_MAX + 2);
};

/**
 * Detect known injection patterns. Flag-only — no transformation.
 * @param {string} text
 * @returns {{hits: Array<{family: string, excerpt: string, count: number}>, flagged: boolean}}
 */
function scanInjections(text) {
  const s = String(text || '');
  const hits = [];
  const push = (family, excerpt) => {
    const hit = hits.find((h) => h.family === family);
    if (hit) {
      hit.count += 1;
    } else {
      hits.push({ family, excerpt, count: 1 });
    }
  };
  if (new RegExp(INVISIBLE_CHARS.source).test(s)) {
    push('invisible_channel', 'zero-width / bidi control characters present');
  }
  let m;
  const commentRe = new RegExp(HTML_COMMENT.source, 'g');
  if ((m = commentRe.exec(s))) push('invisible_channel', firstExcerpt(s, m));
  for (const { family, re } of DELIMITER_TOKENS) {
    const r = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g');
    if ((m = r.exec(s))) push(family, firstExcerpt(s, m));
  }
  const roleRe = new RegExp(FAKE_ROLE_LINE.source, 'gm');
  if ((m = roleRe.exec(s))) push('delimiter_impersonation', firstExcerpt(s, m));
  for (const { family, re } of IMPERATIVE_PATTERNS) {
    const r = new RegExp(re.source, 'i');
    if ((m = r.exec(s))) push(family, firstExcerpt(s, m));
  }
  return { hits, flagged: hits.length > 0 };
}

/**
 * Sanitize a PROMPT slice: strips the invisible channels entirely, removes
 * whole HTML-comment spans, and neutralizes the delimiter-impersonation
 * TOKENS (the control markup goes, the inner word stays visible). Imperative
 * prose is NOT touched — flagged only (scanInjections carries the verdict).
 * @param {string} text
 * @returns {{text: string, flagged: boolean}}
 */
function sanitizeForPrompt(text) {
  const s = String(text || '');
  let out = s.replace(HTML_COMMENT, ' ');
  out = out.replace(INVISIBLE_CHARS, '');
  for (const { re } of DELIMITER_TOKENS) {
    out = out.replace(new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g'), (tok) =>
      tok.replace(/[<>|[\]{}]/g, '')
    );
  }
  out = out.replace(new RegExp(FAKE_ROLE_LINE.source, 'gm'), (line) => line.replace(/:/, ' —'));
  const { flagged } = scanInjections(s);
  return { text: out, flagged };
}

// The LLM-written summary display contract: one or two factual sentences.
const SUMMARY_MAX_CHARS = 500;

/**
 * Bound an LLM-WRITTEN summary (the fm.description path): hard 500-char cap,
 * control/zero-width/bidi chars stripped, delimiter tokens neutralized. A
 * flagged summary is still returned — the steward gate reviews it; refusing
 * here would silently degrade curation. `flagged` records that it carried
 * patterns; `truncated` records the cap fired.
 * @param {string} text
 * @returns {{text: string, flagged: boolean, truncated: boolean}}
 */
function boundSummary(text) {
  const s = String(text || '');
  let out = s.replace(INVISIBLE_CHARS, '');
  for (const { re } of DELIMITER_TOKENS) {
    out = out.replace(new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g'), (tok) =>
      tok.replace(/[<>|[\]{}]/g, '')
    );
  }
  out = out
    .replace(new RegExp(FAKE_ROLE_LINE.source, 'gm'), (line) => line.replace(/:/, ' —'))
    // Control chars (C0 except \n, plus C1) — a summary is prose. DELIBERATE:
    // this is the strip that removes them; eslint's no-control-regex flags
    // any control range in a pattern, which is exactly what we want here.
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0009\u000B-\u001F\u007F-\u009F]/g, ' ')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
  const truncated = out.length > SUMMARY_MAX_CHARS;
  if (truncated) out = out.slice(0, SUMMARY_MAX_CHARS).trimEnd();
  const { flagged } = scanInjections(s);
  return { text: out, flagged, truncated };
}

module.exports = {
  INJECTION_PATTERNS_VERSION,
  SUMMARY_MAX_CHARS,
  INVISIBLE_CHARS_SOURCE,
  INVISIBLE_CHARS,
  scanInjections,
  sanitizeForPrompt,
  boundSummary
};
