'use strict';

/**
 * 006-quickhelp-buttons.js
 *
 * J.4 (DEC-28): creates the quickhelpButtons collection and idempotently
 * seeds the 8-button set. Replaces the build-baked quickHelp block in the
 * frontend's genie-ai-config.json — buttons are admin-managed from here on.
 *
 * Seed text: EN prompts curated from the deployed Knowledge Hierarchy
 * (Maize stages); ST for buttons 1-4 reuses the existing st.js translations,
 * ST for the four new maize buttons is a DRAFT for Adem to refine in the
 * admin UI (spec-j4). Upsert by _key — re-running never duplicates and never
 * clobbers admin edits (seed only inserts missing keys).
 */

const BUTTONS = [
  {
    _key: 'just-chat',
    order: 1,
    enabled: true,
    isJustChat: true,
    title: { en: 'Just chat', st: 'Moqoqo Feela' },
    prompt: {
      en: "I'd like to chat about agriculture and farming in Lesotho",
      st: 'Ke rata ho qoqa ka temo le temo Lesotho',
    },
    icon: '/config/quickhelp/just-chat.svg',
  },
  {
    _key: 'crop-advice',
    order: 2,
    enabled: true,
    isJustChat: false,
    title: { en: 'Crop advice', st: 'Keletso ea lijalo' },
    prompt: {
      en: 'What crops grow best in my region of Lesotho this season?',
      st: 'Ke lijalo life tse holang hantle sebakeng sa ka sa Lesotho selemong sena?',
    },
    icon: '/config/quickhelp/crop-management.svg',
  },
  {
    _key: 'soil-fertilizers',
    order: 3,
    enabled: true,
    isJustChat: false,
    title: { en: 'Soil & fertilizers', st: 'Mobu le manyolo' },
    prompt: {
      en: 'How can I improve soil fertility on my farm?',
      st: 'Nka ntlafatsa joang mobu oa polasi ea ka?',
    },
    icon: '/config/quickhelp/soil-fertilizers.svg',
  },
  {
    _key: 'pest-control',
    order: 4,
    enabled: true,
    isJustChat: false,
    title: { en: 'Pest & disease control', st: 'Taolo ea likokoanyana le mafu' },
    prompt: {
      en: 'How do I identify and control pests affecting my crops?',
      st: 'Nka tseba le ho laola joang likokoanyana tse amang lijalo tsa ka?',
    },
    icon: '/config/quickhelp/pest-control.svg',
  },
  {
    _key: 'maize-in-lesotho',
    order: 5,
    enabled: true,
    isJustChat: false,
    title: { en: 'Maize in Lesotho', st: 'Koro Lesotho' }, // ST draft — refine in admin UI
    prompt: {
      en: 'What are the main constraints and best practices for growing maize in Lesotho?',
      st: 'Ke lithoko life tse kholo tse thibelang temo ea koro Lesotho, ke sebelise mekhoa efe e metle?',
    },
    icon: '/config/quickhelp/crop-management.svg',
  },
  {
    _key: 'pre-planting',
    order: 6,
    enabled: true,
    isJustChat: false,
    title: { en: 'Pre-planting', st: 'Pele u jala' }, // ST draft
    prompt: {
      en: 'How should I prepare before planting maize — land preparation, seed selection and planting time?',
      st: 'Nka ikokobetsa joang pele ka jala koro — ho lokisa mobu, ho khetha peo, le nako ea ho jala?',
    },
    icon: '/config/quickhelp/soil-fertilizers.svg',
  },
  {
    _key: 'crop-management',
    order: 7,
    enabled: true,
    isJustChat: false,
    title: { en: 'Crop management', st: 'Taolo ea lijalo' }, // ST draft
    prompt: {
      en: 'How do I manage my maize crop through the season — weeding, fertilising and monitoring?',
      st: 'Ke laola joang lijalo tsa ka nakong ea selemo — ho hlakola, manyolo le tlhokomelo?',
    },
    icon: '/config/quickhelp/crop-management.svg',
  },
  {
    _key: 'harvest-storage',
    order: 8,
    enabled: true,
    isJustChat: false,
    title: { en: 'Harvest & storage', st: 'Khotha le polokelo' }, // ST draft
    prompt: {
      en: 'How do I harvest, dry and store maize to reduce post-harvest losses?',
      st: 'Ke khotha, ke omisa le ke boloka joang koro ho fokotsa mashano a kamora khotho?',
    },
    icon: '/config/quickhelp/market-prices.svg',
  },
];

module.exports = {
  async up(db) {
    // Create the collection (001 pattern: exists-check, idempotent) — the API
    // never ensures collections at boot, migrations are the only creator.
    const coll = db.collection('quickhelpButtons');
    if (!(await coll.exists())) {
      await db.createCollection('quickhelpButtons', { type: 2 });
      console.log('[006] created collection quickhelpButtons');
    }
    for (const button of BUTTONS) {
      // Insert-only seed: an admin's edit to a seeded button is never
      // clobbered by a re-run (005 precedent: idempotent, non-destructive).
      const cursor = await db.query(
        'FOR b IN quickhelpButtons FILTER b._key == @key LIMIT 1 RETURN b._key',
        { key: button._key }
      );
      if (await cursor.next()) {
        continue;
      }
      await coll.save(button);
      console.log(`[006] seeded quick-help button '${button._key}'`);
    }
    console.log('[006] quick-help button seed complete');
  },
};
