---
title: "Configuration"
description: "Operator-facing configuration guides for Keycloak and external identity providers."
weight: 40
section: "configure"
aliases:
  - /docs/configuration/
---

The configuration section covers the identity and access-management surface of GENIE.AI — everything related to who can sign in, how they authenticate, and what they can do once they are in.

GENIE.AI delegates **all** identity management to Keycloak: users, roles, sessions, password reset, social login. No GENIE.AI-specific UI exists for user administration; the Keycloak admin console is the operator's only interface.

## Documents in this section

1. [Keycloak Admin Guide](/docs/configure/keycloak-admin-guide/) — manage users, assign roles, audit activity, understand the end-to-end auth flow, map external IdP attributes to Keycloak realm roles.
2. [External IdP Integration Guide](/docs/configure/external-idp-integration-guide/) — federate sign-in through Google, Microsoft Entra, generic OIDC, or SAML.
3. [Local development with self-signed certificates](/docs/configure/local-dev-self-signed/) — bypass or trust the self-signed NGINX/GPU certs on a local dev stack: which env vars, which services, security implications.
4. [CORS, CSP & Public Domain](/docs/configure/cors-csp/) — wire the browser-facing CORS allow-list, the nginx Content-Security-Policy, and the public-domain variable that drives every redirect URL.

## Where to go next

- **New to Keycloak?** Start with the [Keycloak Admin Guide → §1 Accessing the admin console](/docs/configure/keycloak-admin-guide/#1-accessing-the-admin-console).
- **Wiring up Google or Microsoft sign-in?** Jump to [External IdP Integration Guide → Option 1: Google](/docs/configure/external-idp-integration-guide/#1-option-1-google) or [Option 2: Microsoft Entra ID](/docs/configure/external-idp-integration-guide/#2-option-2-microsoft-entra-id).
- **Running a local stack against a private IP or self-signed cert?** Read [Local development with self-signed certificates](/docs/configure/local-dev-self-signed/).
- **Need to understand the authentication architecture?** See [Architecture Overview → Authentication](/docs/architecture/architecture/).

## Related configuration in other sections

- [Frontend Configuration → Authentication & Session](/docs/frontend/auth-flow/) — Vue-side OIDC client settings, token refresh, login UX.
- [Backend Configuration → Auth Middleware](/docs/backend/api-contracts-backend/) — backend JWT verification and `requireAdmin`.
- [Deployment → Mobile Deployment Guide](/docs/mobile/mobile-deployment-guide/) — Flutter app OIDC client configuration (per-institution `KC_MOBILE_CLIENT_ID`).
- [External IdP Integration → §5 automated IdP configuration via keycloak-config-cli](/docs/configure/external-idp-integration-guide/) — Grafana SSO is wired the same way (Grafana is another confidential OIDC client of Keycloak).
