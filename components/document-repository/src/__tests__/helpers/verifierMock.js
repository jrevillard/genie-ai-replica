'use strict';

// The single stand-in for the shared OIDC verifier at the middleware's
// module boundary. Every suite that loads the real keycloak-auth-middleware
// mocks '../../shared-lib/keycloak-auth-service' WITH THIS HELPER — the
// mock's shape must mirror the real verifier contract (verifyToken resolves
// to the claims payload itself; getConfiguredIssuers backs the DIAG failure
// log), and keeping it in one place is what stopped the drift that already
// happened when iss_sub was added to the real return.
module.exports = function makeVerifierMock() {
  const verifyToken = jest.fn();
  return {
    verifyToken,
    getConfiguredIssuers: () => ['https://localhost/auth/realms/genie']
  };
};
