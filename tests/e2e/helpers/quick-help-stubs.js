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
  stubQuickHelpConfiguration,
  stubQuickHelpHierarchy,
  CIVIL_REGISTRY_HIERARCHY
};
