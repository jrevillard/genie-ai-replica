'use strict';

/**
 * URL rules for the Swagger UI OAuth2 flow URLs (authorizationUrl /
 * tokenUrl, served in /api-docs.json) and for the spec's server base.
 *
 * ONE implementation, several consumers: the runtime spec
 * (swagger-definition.js — the flow-URL base and the servers[0].url base)
 * and the client-generation pin guard (scripts/build-openapi-spec.js, which
 * runs the extraction under `env -i` and must judge the served URLs against
 * the same rules) — a duplicated predicate drifted between them once
 * already, and the guard then aborted the generation on a served URL the
 * runtime had legitimately produced.
 *
 * The rules:
 *   - the Authorize round-trip runs IN THE BROWSER, so the flow-URL base
 *     must be browser-reachable: on split-URL deployments (the k8s venue,
 *     #1889) KEYCLOAK_URL carries the cluster-internal issuer. The base
 *     prefers KEYCLOAK_PUBLIC_URL — the browser-facing alias the shared
 *     verifier already accepts (shared/lib/keycloak-auth-service.js) —
 *     and falls back to KEYCLOAK_URL (the compose deployment, where
 *     KEYCLOAK_URL is already browser-reachable);
 *   - a URL is usable only when it is an ABSOLUTE http(s) URL free of
 *     whitespace, control characters and fragment/query punctuation — the
 *     last class breaks the flow outright, because a fragment or query in
 *     the base swallows the appended '/realms/...' path. The public value
 *     is REFUSED, not trimmed: the verifier does not trim its alias
 *     either, so a trimmed base here would point the browser at an issuer
 *     the verifier never accepts;
 *   - trailing slashes: the public value loses exactly ONE (the
 *     verifier's public-issuer rule), the KEYCLOAK_URL fallback loses ALL
 *     of them (the verifier's discovery-base rule) — the served URL and
 *     the accepted issuer cannot drift apart;
 *   - with no usable base the result is undefined: the served URL keeps
 *     its visibly-broken 'undefined' shape. A same-origin relative URL
 *     would open the Authorize popup on the docs origin itself — a silent
 *     misconfiguration.
 *
 * The servers[0].url base (API_URL) uses the same acceptance test but is
 * TRIMMED by its caller (swagger-definition.js) and falls back to '/'; a
 * padded API_URL is therefore accepted there, while a padded flow-URL base
 * is refused. The difference is deliberate: API_URL is a deployment
 * operator's own value with a relative fallback, the flow-URL base must
 * name an origin or nothing.
 *
 * The narrative (the #1889 story, the deployment leg) lives in
 * CHANGELOG.md and in the `env` template.
 */

/**
 * Is this value an absolute http(s) URL usable in the served spec — as the
 * base of the flow URLs, or as a served URL itself?
 *
 * @param {string} value
 * @returns {boolean}
 */
function isAbsoluteHttpUrl(value) {
  if (!value) return false;
  // eslint-disable-next-line no-control-regex -- intentional: the C0 control range is exactly what WHATWG strips
  if (/[\s\u0000-\u001F"#<>?`{}]/.test(value)) return false;
  try {
    // WHATWG parsing is the exact validator: it rejects scheme-only and
    // scheme-less values, and it lowercases the scheme (so 'HTTP://x' is
    // an http URL).
    return /^https?:$/.test(new URL(value).protocol);
  } catch {
    return false;
  }
}

/**
 * Resolve the base URL of the Swagger UI OAuth2 flow URLs.
 *
 * @param {NodeJS.ProcessEnv} env - the environment to read
 * @returns {string|undefined} the base URL, or undefined when none is usable
 */
function resolveOAuth2BaseUrl(env) {
  const publicBase = (env.KEYCLOAK_PUBLIC_URL || '').replace(/\/$/, '');
  if (isAbsoluteHttpUrl(publicBase)) return publicBase;
  const internalBase = (env.KEYCLOAK_URL || '').replace(/\/+$/, '');
  return isAbsoluteHttpUrl(internalBase) ? internalBase : undefined;
}

module.exports = { resolveOAuth2BaseUrl, isAbsoluteHttpUrl };
