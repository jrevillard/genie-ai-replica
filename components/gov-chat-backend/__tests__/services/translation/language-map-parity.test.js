'use strict';

const fs = require('fs');
const path = require('path');

const MAPS = {
  'gemma-3': require('../../../services/translation/language-maps/gemma-3-map'),
  'nllb-200': require('../../../services/translation/language-maps/nllb-200-map'),
  translategemma: require('../../../services/translation/language-maps/translategemma-map')
};

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
function findRepoFile(relativePath) {
  let dir = __dirname;
  for (let depth = 0; depth < 8; depth += 1) {
    const candidate = path.join(dir, relativePath);
    if (fs.existsSync(candidate)) return candidate;
    dir = path.dirname(dir);
  }
  throw new Error(`Could not locate ${relativePath} from ${__dirname}`);
}

const chatqnaCodes = JSON.parse(fs.readFileSync(findRepoFile('genie-ai-overlay/chatqna/language_codes.json'), 'utf8'));
const chatqnaLanguages = Object.keys(chatqnaCodes).sort();

describe('the backend language maps and the chatqna language map agree', () => {
  it.each(Object.keys(MAPS))('%s accepts exactly the languages chatqna accepts', (name) => {
    const map = MAPS[name];
    expect(Object.keys(map.languageMap).sort()).toEqual(chatqnaLanguages);
  });

  it('every backend map covers the same languages', () => {
    const [first, ...others] = Object.values(MAPS).map((map) => Object.keys(map.languageMap).sort());
    for (const languages of others) {
      expect(languages).toEqual(first);
    }
  });

  it('every language maps to a code the model can be asked for', () => {
    for (const [name, map] of Object.entries(MAPS)) {
      for (const [code, modelCode] of Object.entries(map.languageMap)) {
        expect(typeof modelCode).toBe('string');
        expect(modelCode.length).toBeGreaterThan(0);
        expect(`${name}:${code}`).toBeTruthy();
      }
    }
  });

  it('the gemma-3 map names every language it maps', () => {
    // The prompt is built from the name, not from the code: a code without a
    // name would either break the prompt or put the code in it.
    const map = MAPS['gemma-3'];
    for (const code of Object.keys(map.languageMap)) {
      expect(typeof map.languageNames[code]).toBe('string');
      expect(map.languageNames[code].length).toBeGreaterThan(0);
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
    for (const code of chatqnaLanguages) {
      expect(map.languageNames[code]).toBe(chatqnaCodes[code]);
    }
  });
});
