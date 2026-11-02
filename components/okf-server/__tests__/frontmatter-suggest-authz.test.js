// Copyright (C) 2026 International Telecommunication Union (ITU)
// SPDX-License-Identifier: Apache-2.0
// ROUND 23 (review 81272): the #80772 authz change — the two
// `/repos/:id/frontmatter/suggest` routes moved from the global
// `requireScope('admin')` to `requireRepoScope('id', 'admin')` — shipped
// with ZERO coverage at its boundary: no test imported okf-routes, so
// reverting both routes to the global admin gate left the whole okf-server
// suite green, re-opening the exact hole round 21 closed (an admin-scoped
// caller into a RESTRICTED repository). The pin is STRUCTURAL: the router
// must still load (registration errors surface), and both registrations
// must read `requireRepoScope('id', 'admin')` — with no global-admin
// spelling left on those paths. No HTTP round-trip, no controller mocks:
// the middleware unit is require-scope.test.js's job.

const fs = require('node:fs');

describe('frontmatter/suggest routes carry per-repo authz (#80772, review 81272)', () => {
  const routesPath = require.resolve('../routes/okf-routes');
  let src;
  beforeAll(() => {
    src = fs.readFileSync(routesPath, 'utf8');
  });

  test.each(['/repos/:id/frontmatter/suggest', '/repos/:id/frontmatter/suggest/jobs/:jobId'])(
    '%s is guarded by requireRepoScope(id, admin)',
    (routePath) => {
      // ROUND 25 (review 83374): `/` needs no escaping in a RegExp string
      // body — the old replace(/\//g, '/') was a no-op dressed as escaping.
      expect(src).toMatch(new RegExp(`router\\.(?:post|get)\\('${routePath}', requireRepoScope\\('id', 'admin'\\)`));
    }
  );

  test.each(['/repos/:id/frontmatter/suggest', '/repos/:id/frontmatter/suggest/jobs/:jobId'])(
    '%s has no global-admin spelling left',
    (routePath) => {
      expect(src).not.toMatch(new RegExp(`router\\.(?:post|get)\\('${routePath}', requireScope\\('admin'\\)`));
    }
  );
});
