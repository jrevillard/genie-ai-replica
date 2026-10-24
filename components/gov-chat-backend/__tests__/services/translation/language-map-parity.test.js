'use strict';

const fs = require('fs');
const path = require('path');

const MAPS_DIR = path.resolve(__dirname, '../../../services/translation/language-maps');

/**
 * Every shipped language map, read from the directory rather than from a
 * hand-written list. A list kept by hand is a list that goes out of date:
 * a map added to the directory would ship without being checked here, and
 * the checks below are the ones that catch a map that drifted from the
 * chatqna language list or that named a fallback.
 */
const MAPS = fs
  .readdirSync(MAPS_DIR)
  .filter((file) => file.endsWith('-map.js'))
  .reduce((maps, file) => {
    maps[file.replace(/-map\.js$/, '')] = require(path.join(MAPS_DIR, file));
    return maps;
  }, {});

/**
 * The chatqna service keeps its own copy of the language list: it names the
 * language in the translation prompt. The backend keeps one per model, and
 * refuses a language its map does not know.
 *
 * The two lists have to agree. When they drift, a language chatqna translates
 * into is refused by the backend: the streaming path writes the English chunk
 * and the post-stream path answers 400, while the same request in
 * non-streaming mode comes back translated. The user sees a different answer
 * depending on the transport.
 *
 * The names have to agree too: the same language reaches two translation
 * prompts, and a prompt that calls one language "Swahili" and another
 * "Kiswahili" is a prompt that was edited on one side only.
 */

/**
 * The root of the repository, five levels up from this file: the overlay tree
 * the chatqna language tables live in is a sibling of the components.
 */
const REPO_ROOT = path.resolve(__dirname, '../../../../..');

/**
 * Read a JSON file from the repository.
 *
 * The read happens where it is called, not at import time: a file that is not
 * reachable has to fail the test that needs it, with a message that says
 * which file is missing — not abort the whole suite before a single test ran.
 */
function readRepoJson(relativePath) {
  const file = path.join(REPO_ROOT, relativePath);
  if (!fs.existsSync(file)) {
    throw new Error(`Could not locate ${file}. The parity tests need the whole repository checked out.`);
  }
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

const chatqnaCodes = () => readRepoJson('genie-ai-overlay/chatqna/language_codes.json');
const chatqnaLanguages = () => Object.keys(chatqnaCodes()).sort();
const chatqnaScripts = () => readRepoJson('genie-ai-overlay/chatqna/language_scripts.json');

describe('the backend language maps and the chatqna language map agree', () => {
  it.each(Object.keys(MAPS))('%s accepts exactly the languages chatqna accepts', (name) => {
    const map = MAPS[name];
    expect(Object.keys(map.languageMap).sort()).toEqual(chatqnaLanguages());
  });

  it('every language maps to a code the model can be asked for', () => {
    for (const map of Object.values(MAPS)) {
      for (const modelCode of Object.values(map.languageMap)) {
        expect(typeof modelCode).toBe('string');
        expect(modelCode.length).toBeGreaterThan(0);
      }
    }
  });

  it('the gemma-3 map names every model code it hands to the prompt builder', () => {
    // The prompt builder is given the MODEL code, not the canonical one, and
    // it looks the name up by that code. The two coincide only while the map
    // is an identity mapping: the day it stops being one, a name that is
    // missing under the model code is a translation that throws for every
    // request.
    const map = MAPS['gemma-3'];
    for (const modelCode of Object.values(map.languageMap)) {
      expect(typeof map.languageNames[modelCode]).toBe('string');
      expect(map.languageNames[modelCode].length).toBeGreaterThan(0);
    }
  });

  it('both sides call every language the same thing', () => {
    const map = MAPS['gemma-3'];
    const codes = chatqnaCodes();
    for (const code of Object.keys(codes)) {
      expect(map.languageNames[code]).toBe(codes[code]);
    }
  });

  it('the chatqna script table covers exactly the languages chatqna accepts', () => {
    const scripts = chatqnaScripts();
    expect(Object.keys(scripts).sort()).toEqual(chatqnaLanguages());
  });

  it('the chatqna script table agrees with the scripts the NLLB map asks for', () => {
    // The chatqna prompt asks for the script a language is written in. The
    // NLLB map carries that script in its model codes ("hin_Deva"), so the
    // two tables have to agree: a target the prompt calls Latin while the
    // model is asked for Devanagari is a prompt that contradicts itself.
    const scripts = chatqnaScripts();
    const nllb = MAPS['nllb-200'];
    for (const [code, modelCode] of Object.entries(nllb.languageMap)) {
      const expected = modelCode.includes('_') ? modelCode.split('_')[1] : null;
      expect(`${code}:${scripts[code]}`).toBe(`${code}:${expected}`);
    }
  });
});
