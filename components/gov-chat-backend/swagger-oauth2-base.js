'use strict';

/**
 * Resolver for the base URL of the Swagger UI OAuth2 flow URLs
 * (authorizationUrl / tokenUrl, served in /api-docs.json).
 *
 * ONE implementation, two consumers: the runtime spec
 * (swagger-definition.js) and the client-generation pin guard
 * (scripts/build-openapi-spec.js, which runs the spec extraction under
 * `env -i` and must judge the served URLs against the same rules). A
 * duplicated predicate drifted between them — the guard then aborted the
 * generation on a served URL the runtime had legitimately produced.
 *
 * Why the resolution exists (#1889): the Authorize round-trip runs IN THE
 * BROWSER, so the served URLs must be browser-reachable. On split-URL
 * deployments (the k8s venue) KEYCLOAK_URL carries the cluster-internal
 * issuer — a browser popup dies on DNS, and the HTTPS docs page +
 * plain-HTTP token endpoint is mixed content, hard-blocked by Chromium.
 * KEYCLOAK_PUBLIC_URL is the browser-facing alias the shared verifier
 * already accepts (shared/lib/keycloak-auth-service.js); unset =
 * KEYCLOAK_URL, the historical compose behaviour (there KEYCLOAK_URL is
 * already browser-reachable).
 *
 * A base is usable only when it is an ABSOLUTE http(s) URL free of
 * whitespace, control characters and the URL-fragment/query punctuation
 * (" # <> ? ` { }) — the last class breaks the flow outright, because a
 * fragment or query in the base swallows the appended '/realms/...' path.
 * The public value is refused (not trimmed — the verifier does not trim
 * its alias either, so a trimmed base here would point the browser at an
 * issuer the verifier never accepts); the KEYCLOAK_URL fallback is refused
 * the same way, so no unusable base is ever served verbatim.
 *
 * Trailing slashes: the public value loses exactly ONE — the verifier's
 * public-issuer rule, so the served URL and the accepted issuer cannot
 * drift apart. The KEYCLOAK_URL fallback loses ALL of them — the
 * verifier's discovery-base rule, so the served URL never carries a
 * doubled path segment.
 *
 * With no usable base at all, the result is undefined: the served URL
 * keeps its historical visibly-broken 'undefined' shape. A same-origin
 * relative URL would open the Authorize popup on the docs origin itself —
 * a silent misconfiguration.
 */

/**
 * Is this value usable as the base of the flow URLs? Absolute http(s)
 * only, free of whitespace, control characters and fragment/query
 * punctuation.
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
