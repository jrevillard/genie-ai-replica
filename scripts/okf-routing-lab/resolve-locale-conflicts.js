#!/usr/bin/env node
/**
 * One-shot merge resolver for the i18n locale conflicts produced by
 * `git merge origin/main` into feat/okf-server.
 *
 * Every conflicted locale file has exactly ONE hunk, in the `chatbot` block,
 * with this shape:
 *
 *   <<<<<<< HEAD
 *       <branch's aiGeneratedNoDocs>          (es: empty — the branch moved it)
 *   =======
 *       unsupportedLanguage: '<main's translation>',
 *       welcomeMessage: '<main's English text>',   (es only)
 *       aiGeneratedNoDocs: '<main's text>',
 *   >>>>>>> origin/main
 *
 * The two sides are ADDITIVE, not competing:
 *
 *   - main introduced a NEW key, `unsupportedLanguage` (the unsupported-language
 *     refusal). It must be kept — the backend/frontend refuse an untranslated
 *     language and the UI reads this key.
 *   - the branch re-translated `aiGeneratedNoDocs` (and, for es, `welcomeMessage`)
 *     into better wording / out of English. main still carries the older text
 *     (for es, the English `welcomeMessage` that the branch replaced with a
 *     real Spanish one).
 *
 * So the resolution keeps, in order: main's `unsupportedLanguage`, then the
 * branch's own lines. Where the branch's side is empty (es), main's duplicate
 * `welcomeMessage`/`aiGeneratedNoDocs` are DROPPED, because the branch's
 * translated versions already exist further down the block.
 *
 * The script asserts the result: one `unsupportedLanguage` and one
 * `aiGeneratedNoDocs` per file, and no conflict markers.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const LOCALES = ['ar', 'bn', 'es', 'id', 'man', 'pt', 'st', 'sw', 'th', 'zh'];
const LOCALES_DIR = path.resolve(__dirname, '..', '..', 'components', 'gov-chat-frontend', 'src', 'i18n', 'locales');

const CONFLICT_RE = /^(<<<<<<< HEAD\n)([\s\S]*?)(^=======\n)([\s\S]*?)(^>>>>>>> origin\/main\n)/m;

/** Keys main introduced or changed that must survive the resolution. */
const KEEP_FROM_MAIN = new Set(['unsupportedLanguage']);

function resolve(source) {
  const match = source.match(CONFLICT_RE);
  if (!match) return null;

  const [, headMarker, headSide, sepMarker, mainSide, endMarker] = match;

  const headLines = headSide.split('\n').filter((line) => line.trim() !== '');
  const mainLines = mainSide.split('\n').filter((line) => line.trim() !== '');

  const keptMain = mainLines.filter((line) => {
    const key = line.trim().split(':')[0];
    return KEEP_FROM_MAIN.has(key);
  });

  const resolved = [...keptMain, ...headLines].join('\n');
  const rebuilt = source.replace(CONFLICT_RE, () => resolved + '\n');

  return {
    text: rebuilt,
    keptMain,
    keptHead: headLines,
  };
}

let failures = 0;

for (const locale of LOCALES) {
  const file = path.join(LOCALES_DIR, `${locale}.js`);
  const source = fs.readFileSync(file, 'utf8');
  const result = resolve(source);

  if (!result) {
    console.log(`[skip] ${locale}.js — no conflict hunk found`);
    continue;
  }

  const counts = {
    unsupportedLanguage: (result.text.match(/^\s*unsupportedLanguage:/gm) || []).length,
    aiGeneratedNoDocs: (result.text.match(/^\s*aiGeneratedNoDocs:/gm) || []).length,
    welcomeMessage: (result.text.match(/^\s*welcomeMessage:/gm) || []).length,
  };
  const markers = /^(<<<<<<<|=======|>>>>>>>)/m.test(result.text);

  const bad =
    markers ||
    counts.unsupportedLanguage !== 1 ||
    counts.aiGeneratedNoDocs !== 1 ||
    counts.welcomeMessage !== 1;

  if (bad) {
    failures += 1;
    console.log(
      `[FAIL] ${locale}.js — markers=${markers} unsupportedLanguage=${counts.unsupportedLanguage} ` +
        `aiGeneratedNoDocs=${counts.aiGeneratedNoDocs} welcomeMessage=${counts.welcomeMessage}`
    );
    continue;
  }

  fs.writeFileSync(file, result.text, 'utf8');
  console.log(
    `[ok] ${locale}.js — kept ${result.keptMain.length} main line(s) ` +
      `(${result.keptMain.map((l) => l.trim().split(':')[0]).join(', ')}), ` +
      `${result.keptHead.length} branch line(s)`
  );
}

process.exit(failures === 0 ? 0 : 1);
