// `jose` is NOT a dependency of document-repository. Only the shared
// verifier (components/shared/lib/keycloak-auth-service.js) requires it,
// and jest.config.js resolves that verifier to the REAL file so a
// middleware bound to it works.
//
// A suite that loads the auth middleware (directly or transitively through
// src/app) WITHOUT standing in for the verifier at its module boundary
// therefore loads the real verifier — and, in a clean CI install, dies with
// MODULE_NOT_FOUND for `jose`. That failure is environment-dependent: a
// developer machine may carry a hoisted stray `jose` that masks it, so the
// same suite is green locally and red in CI.
//
// jest.config.js maps `^jose$` here so the failure is deterministic and
// local, and says what to do about it. See issue #1707.
throw new Error(
  'jose is not a dependency of document-repository: only the shared verifier ' +
    '(components/shared/lib/keycloak-auth-service.js) requires it. A suite that loads ' +
    'the auth middleware must stand in for the verifier at its module boundary: ' +
    "jest.mock('../../shared-lib/keycloak-auth-service', () => mockVerifier)."
);
