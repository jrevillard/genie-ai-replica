'use strict';

const fs = require('fs');
const path = require('path');

const MAPS_DIR = path.resolve(__dirname, '../../../services/translation/language-maps');
const REGISTRY_PATH = path.join(MAPS_DIR, 'language-registry.json');

/**
 * The language registry is the single source of the supported languages: the
 * canonical list with each language's name and script, plus the code every
 * model is asked for. The backend map modules and the chatqna service both
 * derive what they serve from it, so a language is added once, in one file,
 * and the two runtimes cannot drift apart — the drift this file used to need
 * a cross-tree parity test to catch is now a structural impossibility.
 *
 * What can still go wrong is a half-edit of the registry itself: a language
 * added to one model's table but not the others, a script changed without
 * the FLORES-200 code that encodes it. The checks below are the ones that
 * catch those.
 */
// Node loads JSON natively: a missing file fails with a module error naming
// this exact path — the file ships with the maps this suite also reads from
// the same directory, so its absence means a broken checkout.
const registry = require(REGISTRY_PATH);

/**
 * Every shipped language map, read from the directory rather than from a
 * hand-written list. A list kept by hand is a list that goes out of date:
 * a map added to the directory would ship without being checked here.
 */
const MAPS = fs
  .readdirSync(MAPS_DIR)
  .filter((file) => file.endsWith('-map.js'))
  .reduce((maps, file) => {
    maps[file.replace(/-map\.js$/, '')] = require(path.join(MAPS_DIR, file));
    return maps;
  }, {});

describe('the language registry is well-formed', () => {
  it('lists languages, each with a name and a script', () => {
    const codes = Object.keys(registry.languages);
    expect(codes.length).toBeGreaterThan(0);
    for (const [code, language] of Object.entries(registry.languages)) {
      expect(code).toMatch(/^[a-z]{2,3}$/);
      expect(typeof language.name).toBe('string');
      expect(language.name.length).toBeGreaterThan(0);
      expect(typeof language.script).toBe('string');
      expect(language.script.length).toBeGreaterThan(0);
    }
  });

  it.each(Object.keys(registry.modelCodes))('the %s table covers exactly the registry languages', (model) => {
    expect(Object.keys(registry.modelCodes[model]).sort()).toEqual(Object.keys(registry.languages).sort());
  });

  it('every model code is a code the model can be asked for', () => {
    for (const table of Object.values(registry.modelCodes)) {
      for (const modelCode of Object.values(table)) {
        expect(typeof modelCode).toBe('string');
        expect(modelCode.length).toBeGreaterThan(0);
      }
    }
  });

  it('the script of every language agrees with the FLORES-200 code nllb is asked for', () => {
    // The NLLB code carries the script in its second half ("hin_Deva"). The
    // chatqna prompt asks for the script the registry names, so a script
    // edited without the code that encodes it is a prompt that contradicts
    // the request the backend makes.
    for (const [code, modelCode] of Object.entries(registry.modelCodes['nllb-200'])) {
      const expected = modelCode.includes('_') ? modelCode.split('_')[1] : null;
      expect(`${code}:${registry.languages[code].script}`).toBe(`${code}:${expected}`);
    }
  });
});

describe('the shipped maps are the registry, not a private copy', () => {
  it.each(Object.keys(MAPS))('%s serves exactly the codes the registry holds for it', (name) => {
    const map = MAPS[name];
    expect(map.languageMap).toEqual(registry.modelCodes[name]);
  });

  it('the gemma-3 map names every language the registry names', () => {
    const map = MAPS['gemma-3'];
    for (const [code, language] of Object.entries(registry.languages)) {
      expect(map.languageNames[code]).toBe(language.name);
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
});
