// The auth middleware's verification core is the REAL shared verifier
// (jest.config.js resolves it to the real file so a middleware bound to it
// works), and the real verifier requires `jose` — which this component does
// NOT declare.
//
// A suite that loads the middleware without standing in for the verifier at
// its module boundary therefore loads the real verifier, whose `require('jose')`
// lands on the stub jest.config.js maps `^jose$` to. Before that mapping, the
// same path died with a CI-only MODULE_NOT_FOUND for `jose`; now it fails
// everywhere, with a message that names the remedy.
//
// This suite pins that behaviour: the stub must keep explaining the trap, and
// the middleware must keep reaching the verifier at load time (moving the
// require inside the request handler would make the middleware load cleanly
// and fail this suite).
describe('the shared-verifier trap', () => {
  it('fails with an actionable message when a suite forgets to mock the verifier', () => {
    expect(() => jest.requireActual('../../middlewares/keycloak-auth-middleware')).toThrow(/jest\.mock/);
    expect(() => jest.requireActual('../../middlewares/keycloak-auth-middleware')).toThrow(
      /must stand in for the verifier at its module boundary/
    );
  });
});
