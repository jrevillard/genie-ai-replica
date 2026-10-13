---
title: "Configuration"
description: "Operator-facing configuration guides for Keycloak and external identity providers."
weight: 50
section: "configure"
aliases:
  - /docs/configuration/
---

The configuration section covers the identity and access-management surface of GENIE.AI — everything related to who can sign in, how they authenticate, what they can do once they are in, how to rebrand the platform for a specific institution, and how to package that rebrand as a reusable deployment flavor.

GENIE.AI delegates **all** identity management to Keycloak: users, roles, sessions, password reset, social login. No GENIE.AI-specific UI exists for user administration; the Keycloak admin console is the operator's only interface. Branding and the admin dashboard layout, on the other hand, are configured through the deployment's `flavors/` directory and the frontend's `AdminDashboard.vue` configuration surface.

## Documents in this section

1. [Keycloak Admin Guide](/docs/configure/keycloak-admin-guide/) — manage users, assign roles, audit activity, understand the end-to-end auth flow, map external IdP attributes to Keycloak realm roles.
2. [External IdP Integration Guide](/docs/configure/external-idp-integration-guide/) — federate sign-in through Google, Microsoft Entra, generic OIDC, or SAML.
3. [Branding Customization](/docs/configure/branding-customization/) — replace the GENIE.AI logo, app name, favicon, brand color, and Keycloak login screen with your institution's identity.
4. [Admin dashboard customization](/docs/configure/dashboard-customization/) — add, remove, and customize tabs and action cards in the GENIE.AI admin dashboard.
5. [Local development with self-signed certificates](/docs/configure/local-dev-self-signed/) — bypass or trust the self-signed NGINX/GPU certs on a local dev stack: which env vars, which services, security implications.
6. [CORS, CSP & Public Domain](/docs/configure/cors-csp/) — wire the browser-facing CORS allow-list, the nginx Content-Security-Policy, and the public-domain variable that drives every redirect URL.
7. [Restrict active locales on a deployment](/docs/configure/locale-whitelist/) — restrict which languages the web UI, Keycloak login, and Flutter mobile app expose. Covers `VUE_APP_AVAILABLE_LOCALES`, `KEYCLOAK_SUPPORTED_LOCALES`, and `KeycloakConfig.supportedLocaleCodes`.
8. [Deployment flavors](/docs/configure/deployment-flavors/) — what makes a deployment look like a particular institution (the `flavors/<name>/` directory, splash image, branding overrides, locale whitelist, mobile OIDC client).

## Where to go next

- **New to Keycloak?** Start with the [Keycloak Admin Guide → §1 Accessing the admin console](/docs/configure/keycloak-admin-guide/#1-accessing-the-admin-console).
- **Wiring up Google or Microsoft sign-in?** Jump to [External IdP Integration Guide → Option 1: Google](/docs/configure/external-idp-integration-guide/#1-option-1-google) or [Option 2: Microsoft Entra ID](/docs/configure/external-idp-integration-guide/#2-option-2-microsoft-entra-id).
- **Running a local stack against a private IP or self-signed cert?** Read [Local development with self-signed certificates](/docs/configure/local-dev-self-signed/).
- **Need to understand the authentication architecture?** See [Architecture Overview → Authentication](/docs/architecture/architecture/).

## Related configuration in other sections

- [Frontend Configuration → Authentication & Session](/docs/frontend/auth-flow/) — Vue-side OIDC client settings, token refresh, login UX.
- [Backend Configuration → Auth Middleware](/docs/reference/api-contracts/) — backend JWT verification and `requireAdmin`.
- [Deployment → Mobile Deployment Guide](/docs/mobile/mobile-deployment-guide/) — Flutter app OIDC client configuration (per-institution `KC_MOBILE_CLIENT_ID`).
- [External IdP Integration → §5 automated IdP configuration via keycloak-config-cli](/docs/configure/external-idp-integration-guide/) — Grafana SSO is wired the same way (Grafana is another confidential OIDC client of Keycloak).
