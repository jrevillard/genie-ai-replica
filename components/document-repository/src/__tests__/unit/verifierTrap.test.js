// The auth middleware's verification core is the REAL shared verifier
// (jest.config.js resolves it to the real file so a middleware bound to it
// works), and the real verifier requires `jose` — which this component does
// NOT declare.
//
// A suite that loads the middleware without standing in for the verifier at
// its module boundary therefore loads the real verifier. In a clean CI
// install that dies with MODULE_NOT_FOUND for `jose`, and only there: a
// developer machine may carry a hoisted stray `jose` that masks it. The
// `^jose$` mapping turns that environment-dependent failure into a
// deterministic, self-explaining one — this suite pins that behaviour so the
// mapping cannot silently disappear (#1707).

describe('the shared-verifier trap', () => {
  it('fails with an actionable message when a suite forgets to mock the verifier', () => {
    expect(() => jest.requireActual('../../middlewares/keycloak-auth-middleware')).toThrow(/jest\.mock/);
    expect(() => jest.requireActual('../../middlewares/keycloak-auth-middleware')).toThrow(
      /must stand in for the verifier at its module boundary/
    );
  });
});
