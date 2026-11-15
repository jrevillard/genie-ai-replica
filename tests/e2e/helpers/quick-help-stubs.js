// tests/e2e/helpers/quick-help-stubs.js
//
// The Quick Help fixture stubs, written once.
//
// A spec that asserts a Quick Help behaviour must decide WHICH cards exist
// and what each of them DECLARES — a venue's runtime config carries
// whatever its deployment seeded, and a spec bound to that content fails
// on a differently-seeded venue (#1826). BOTH sources are therefore
// stubbed: the configuration (the cards) and the hierarchy (the scopes a
// card's category must name). The stubbed configuration keeps the served
// document's own schema, so the frontend's Ajv validation still runs on
// it — a stub that bypassed validation would prove nothing about the real
// thing.
//
// These were copied twice before they lived here (quick-help-scope.spec.js
// and chat-conversation.spec.js carried verbatim copies); the copies are
// exactly the drift the welcome.js module was extracted to end.

const { runRouteHandler } = require('./route');

/**
 * One builder for the fixture cards the Quick Help specs serve — the
 * same shape fields (icon, styles, the null-category default) written
 * once, with each spec passing only what makes ITS fixture distinct
 * (id, title, scope, action). These literals were copied across three
 * specs before this factory existed, which is exactly the drift this
 * module's own header records; a shape change is now a one-file edit.
 * The stubbed configuration still runs the frontend's Ajv validation,
 * so a shape drift fails loud here instead of rendering somewhere.
 *
 * [overrides.title] is a display string (wrapped as { en }) or a
 * locale map; every other override lands on the card verbatim.
 */
function quickHelpButton(overrides = {}) {
  const { id, title, icon, ...rest } = overrides;
  // [id] is the one schema-required field with no derivable default —
  // each fixture names its own so a leaked deployment card can never be
  // mistaken for a spec's. A missing or non-string id would ride the
  // card verbatim and the app would refuse the whole served document at
  // boot (the config-error screen): fail HERE, at the factory.
  if (typeof id !== 'string' || !id.trim()) {
    throw new TypeError(
      `quickHelpButton: id must be a non-blank string (got ${id === undefined ? 'undefined' : JSON.stringify(id)})`
    );
  }
  const titleMap = title === undefined ? { en: 'Just Chat' } : typeof title === 'string' ? { en: title } : title;
  const titleIsMap = titleMap !== null && typeof titleMap === 'object' && !Array.isArray(titleMap);
  if (!titleIsMap) {
    // A malformed title lands on the card verbatim and the app refuses
    // the whole served document at boot — a six-spec blast radius with
    // the failure far from the fixture. Fail HERE, at the factory. (A
    // string title never reaches this guard: it was wrapped above.)
    const got = titleMap === null ? 'null' : Array.isArray(titleMap) ? 'array' : typeof titleMap;
    throw new TypeError(`quickHelpButton: title must be a string or a locale map (got ${got})`);
  }
  // [icon] is a path (the file-type icon every shipped card uses) or a
  // full icon object — never a bare string on the CARD: the served
  // schema requires the object, and the app refuses a document that
  // violates it at boot (the config-error screen).
  const iconMap =
    icon === undefined
      ? { type: 'file', value: '/config/quickhelp/just-chat.svg' }
      : typeof icon === 'string'
        ? { type: 'file', value: icon }
        : icon;
  if (iconMap === null || typeof iconMap !== 'object' || !('type' in iconMap) || !('value' in iconMap)) {
    // Same contract-guard as the title: a schema-invalid icon is a boot
    // refusal at the app, not a fixture error. Fail HERE (null first —
    // typeof null is 'object', and 'type' in null throws a bare V8
    // TypeError instead of this named one).
    throw new TypeError(
      `quickHelpButton: icon must be a path string or an object carrying type and value (got ${JSON.stringify(icon)})`
    );
  }
  return {
    id,
    title: titleMap,
    icon: iconMap,
    category: null,
    styles: { backgroundColor: '#fff', hoverColor: '#eee', outlineColor: '#ccc' },
    ...rest
  };
}

/**
 * The hierarchy both Quick Help specs serve: one category ('Civil
 * Registry', naming itself in ENGLISH — the spelling a configuration
 * writes) carrying the 'Births' label the scoped cards declare. The two
 * specs' fixtures assert against the same names, so the tree lives here
 * beside the stubs that serve it rather than as two synchronized copies.
 */
const CIVIL_REGISTRY_HIERARCHY = [
  {
    catKey: '2',
    name: 'Civil Registry',
    nameEN: 'Civil Registry',
    children: [{ name: 'Births', nameEN: 'Births' }]
  }
];

/**
 * Serves the configuration, with the Quick Help cards replaced by [buttons]
 * — the spec's own. The rest of the served document — including its own
 * schema — is the deployment's, untouched.
 */
async function stubQuickHelpConfiguration(page, buttons) {
  await page.route(
    '**/config/genie-ai-config.json',
    runRouteHandler(page, async (route) => {
      const response = await route.fetch();
      const body = await response.json();
      body.features = body.features || {};
      body.features.chat = body.features.chat || {};
      body.features.chat.quickHelp = body.features.chat.quickHelp || {};
      body.features.chat.quickHelp.buttons = buttons;
      // Fulfil WITHOUT `response`: passing it would inherit the served
      // document's `Content-Length` — a length that no longer matches the
      // modified body, and Chromium's handling of the stale one is not
      // ours to bet the spec on. `json` alone sets the status (200), the
      // content type and a recomputed length.
      await route.fulfill({ json: body });
    })
  );
}

/**
 * Serves the hierarchy. When [gate] is given, the answer is HELD until the
 * gate opens — the window in which the hierarchy is "still on its way" is
 * then real and observable, instead of a race against a fast stub.
 */
async function stubQuickHelpHierarchy(page, hierarchy, gate = null) {
  await page.route(
    '**/api/service-categories/categories*',
    runRouteHandler(page, async (route) => {
      if (gate) {
        await gate;
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(hierarchy)
      });
    })
  );
}

module.exports = {
  quickHelpButton,
  stubQuickHelpConfiguration,
  stubQuickHelpHierarchy,
  CIVIL_REGISTRY_HIERARCHY
};
