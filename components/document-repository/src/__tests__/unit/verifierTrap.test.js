// The auth middleware's verification core is the REAL shared verifier, and
// the real verifier requires `jose` — which this component does NOT declare.
// jest.config.js maps `^jose$` to a stub whose message names the remedy; this
// suite pins both halves of that contract (see the stub for the full story):
// the middleware must keep reaching the verifier at LOAD time (moving the
// require inside the request handler would make the middleware load cleanly
// and fail this suite), and the stub must keep explaining the trap.
describe('the shared-verifier trap', () => {
  it('fails with an actionable message when a suite forgets to mock the verifier', () => {
    // Jest does not cache a module whose evaluation threw, so ONE load is
    // both the assertion subject and the cheaper path.
    let err;
    try {
      jest.requireActual('../../middlewares/keycloak-auth-middleware');
    } catch (e) {
      err = e;
    }
    expect(err).toBeDefined();
    expect(err.message).toMatch(/jest\.mock/);
    expect(err.message).toMatch(/must stand in for the verifier at its module boundary/);
  });
});
