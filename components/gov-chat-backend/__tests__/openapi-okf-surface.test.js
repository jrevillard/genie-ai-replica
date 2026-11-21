'use strict';

// The citizen OKF surface in the CLIENT-GENERATION spec (#1939): the mobile
// app's Dart models are generated from the NAMED schemas below, so this test
// pins the spec shape (paths + named components + the security posture), not
// handler behavior — handler contracts have their own suites. It lives in the
// backend suite because swagger-jsdoc (the spec builder's extractor) is a
// backend production dependency: a broken or drifted annotation fails the
// ordinary backend test job, not only the api-client drift gate.

process.env.API_URL = 'https://localhost';
process.env.KEYCLOAK_URL = 'https://keycloak.example.com/auth';
process.env.KEYCLOAK_REALM = 'genie';

const { buildSpec } = require('../../../scripts/build-openapi-spec');

const TREE_PATH = '/api/okf/repos/{repo_id}/concept-tree';
const CARD_PATH = '/api/okf/repos/{repo_id}/concepts/{concept_id}';
const RESOLVE_PATH = '/api/okf/concepts/resolve-repo';

describe('the client-generation spec carries the citizen OKF surface', () => {
  const spec = buildSpec();

  test('the three citizen routes are paths in the spec, tagged Okf', () => {
    for (const path of [TREE_PATH, CARD_PATH, RESOLVE_PATH]) {
      expect(spec.paths[path]?.get).toBeDefined();
      expect(spec.paths[path]?.get?.tags).toEqual(['Okf']);
    }
  });

  test('the citizen card schema is the CAP-2 projection — no steward fields', () => {
    const schema = spec.components?.schemas?.ConceptCard;
    expect(schema?.properties).toBeDefined();
    expect(Object.keys(schema.properties)).toEqual(
      expect.arrayContaining([
        'repo_id',
        'concept_id',
        'graph_name',
        'bundle_version',
        'title',
        'labels',
        'summary',
        'body',
        'links',
        'sources'
      ])
    );
    // The fence: the steward read ({...concept, max_doc_chars}) exists
    // server-side, but the citizen card is what the mobile consumes — no
    // steward-only field may enter the generated Dart model.
    expect(Object.keys(schema.properties)).not.toContain('max_doc_chars');
    expect(Object.keys(schema.properties)).not.toContain('meta');
    expect(schema.properties.sources?.items?.$ref).toBe('#/components/schemas/ConceptCardSource');
    const sourceProps = Object.keys(spec.components?.schemas?.ConceptCardSource?.properties ?? {});
    expect(sourceProps).toEqual(expect.arrayContaining(['kind', 'file_id', 'file_name', 'resource', 'missing']));
  });

  test('the tree page schema carries paging + the projected row shape', () => {
    const schema = spec.components?.schemas?.ConceptTreePage;
    expect(schema?.properties).toBeDefined();
    expect(Object.keys(schema.properties)).toEqual(expect.arrayContaining(['total', 'offset', 'limit', 'concepts']));
    expect(schema.properties.concepts?.items?.$ref).toBe('#/components/schemas/ConceptTreeRow');
    const rowProps = Object.keys(spec.components?.schemas?.ConceptTreeRow?.properties ?? {});
    expect(rowProps).toEqual(expect.arrayContaining(['concept_id', 'title', 'is_index', 'index_status', 'links']));
  });

  test('the resolve response carries the CAP-1 identity pair', () => {
    const schema = spec.components?.schemas?.ResolveRepoResponse;
    expect(schema?.properties).toBeDefined();
    expect(Object.keys(schema.properties)).toEqual(expect.arrayContaining(['repo_id', 'bundle_version']));
  });

  test('the operations reference the named schemas', () => {
    const card = spec.paths[CARD_PATH]?.get?.responses?.['200']?.content?.['application/json']?.schema;
    expect(card?.$ref).toBe('#/components/schemas/ConceptCard');
    const tree = spec.paths[TREE_PATH]?.get?.responses?.['200']?.content?.['application/json']?.schema;
    expect(tree?.$ref).toBe('#/components/schemas/ConceptTreePage');
    const resolved = spec.paths[RESOLVE_PATH]?.get?.responses?.['200']?.content?.['application/json']?.schema;
    expect(resolved?.$ref).toBe('#/components/schemas/ResolveRepoResponse');
  });

  test('the citizen reads declare no security requirement (default-open posture)', () => {
    // The routes serve scopeless callers while OKF_SCOPE_MODE is open
    // (allowScopelessWhenOpen); the mode dependence is in the descriptions —
    // the spec must not inherit the global KeycloakOAuth2 requirement.
    for (const path of [TREE_PATH, CARD_PATH, RESOLVE_PATH]) {
      expect(spec.paths[path]?.get?.security).toEqual([]);
    }
  });

  test('the operations document the citizen error envelope', () => {
    expect(spec.paths[CARD_PATH]?.get?.responses?.['404']).toBeDefined();
    expect(spec.paths[TREE_PATH]?.get?.responses?.['404']).toBeDefined();
    expect(spec.paths[RESOLVE_PATH]?.get?.responses?.['400']).toBeDefined();
    expect(spec.paths[RESOLVE_PATH]?.get?.responses?.['404']).toBeDefined();
  });
});
