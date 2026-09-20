---
title: "External IdP Integration Guide"
description: "Federate GENIE.AI sign-in through Google, Microsoft Entra, generic OIDC, or SAML — Keycloak brokers all identity, no GENIE.AI code changes required."
weight: 2
section: "configure"
aliases:
  - /docs/configuration/external-idp-integration-guide/
mode: how-to
persona: deployer
owner: "docs-stewards"
last_reviewed: 2026-09-18
---

This guide explains how to connect an external identity provider (Google, Microsoft Entra, generic OIDC, SAML) to GENIE.AI through Keycloak. Once configured, users can sign in via the external IdP without any GENIE.AI code or configuration changes — Keycloak brokers the entire flow and issues a standard OIDC token to GENIE.AI.

## Before you start

Before configuring an external IdP, make sure:

1. **GENIE.AI is deployed** with HTTPS reachable at `https://<NGINX_PUBLIC_DOMAIN>/`. See [Installation & Configuration Guide](/docs/deploy/install-guide/). The placeholder `<your-domain>` used throughout this guide is the value of `NGINX_PUBLIC_DOMAIN` in your `.env`.
2. **Keycloak is reachable** at `https://<your-domain>/auth/admin` (NGINX proxies `/auth/*` to Keycloak).
3. **The `genie` realm exists** (it is created automatically by the `keycloak-config` service during the standard install).
4. **You have admin access** to your Google Workspace / Microsoft Entra / generic OIDC / SAML IdP tenant, and the authority to register a new OAuth client or SAML relying party in it.
5. **Outbound HTTPS from the Keycloak container to the IdP** is allowed by your network/firewall. If your network uses an HTTP proxy, see [§6 Network requirements](#6-network-requirements) below.

## Key terms

| Term | Meaning |
|---|---|
| **OIDC (OpenID Connect)** | The identity layer on top of OAuth 2.0 used by Google, Microsoft Entra, and most modern IdPs. Issues ID tokens (JWTs) that Keycloak can verify. |
| **Broker (Keycloak)** | The Keycloak feature that mediates between your app and an external IdP. The user signs in at the IdP, Keycloak translates the result, and issues its own token to GENIE.AI. |
| **JWKS (JSON Web Key Set)** | Public keys the IdP publishes; Keycloak uses them to verify the IdP's ID token. |
| **`{iss}#{sub}`** | Composite key for a federated user. `iss` is the Keycloak realm's issuer URL; `sub` is the user ID Keycloak assigned to the local account (not the IdP's `sub`). |
| **JIT (Just-In-Time) provisioning** | The act of creating or updating the user record in ArangoDB on first authenticated request, using JWT claims as source of truth. See [Keycloak Admin Guide → §5](/docs/configure/keycloak-admin-guide/#5-end-to-end-data-flow). |
| **Identity Provider Mapper** | A Keycloak transformation that runs during the broker flow to map an IdP claim (e.g., `groups`) to a Keycloak realm role. See [Keycloak Admin Guide → §6](/docs/configure/keycloak-admin-guide/#6-external-idp-attribute-role-mapping). |
| **Federated user** | A user authenticated by an external IdP, as opposed to a user authenticated directly against Keycloak's local database. |

## How it works

```
Browser -> GENIE.AI Frontend (Vue)
            |
            v
   Keycloak Login Page
            |
            +-- [Local Keycloak account] ----> Keycloak JWT --> GENIE.AI
            |
            +-- [External IdP button (Google, Microsoft, …)]
                            |
                            v
                  External IdP authorization endpoint
                            |
                            v
                  External IdP authentication + consent
                            |
                            v
                  IdP redirects browser back to Keycloak broker endpoint
                  (https://<your-domain>/auth/realms/<realm>/broker/<alias>/endpoint)
                            |
                            v
                  Keycloak exchanges code with IdP, validates token,
                  applies Identity Provider Mappers (role assignment)
                            |
                            v
                  Keycloak issues its own JWT to GENIE.AI
                            |
                            v
                  Frontend stores JWT and sends it on every API request
```

GENIE.AI always receives a standard Keycloak-issued OIDC token. The backend's auth middleware (`keycloak-auth-middleware.js`) is completely unaware of which external IdP was used — the JWT signature, claims, and roles look identical regardless.

The frontend uses `oidc-client-ts` (`components/gov-chat-frontend/src/services/keycloakAuthService.js`) to perform the OIDC redirect dance. Its `/callback` route processes the authorization code. The backend has no equivalent callback endpoint; the `/api/auth/callback` path is reserved as a public-route opt-out for future use.

## 1. Option 1: Google

### Step 1 — Create a Google OAuth 2.0 client

1. Go to the [Google Cloud Console](https://console.cloud.google.com/).
2. Create a new project or select an existing one.
3. **APIs & Services → OAuth consent screen**:
   - User type: **External** for public apps, **Internal** for Google Workspace.
   - Fill in the app information (name, support email, developer contact email).
   - If the app is in "Testing" mode, add the test users who will sign in.
4. **APIs & Services → Credentials** → **Create credentials → OAuth client ID**.
5. Application type: **Web application**.
6. **Authorized redirect URIs** — add exactly:
   ```
   https://<your-domain>/auth/realms/genie/broker/google/endpoint
   ```
   - Replace `<your-domain>` with the value of `NGINX_PUBLIC_DOMAIN` from your `.env`. This must match exactly (HTTPS, no trailing slash, correct host).
   - The realm segment is `genie` unless you set `KEYCLOAK_REALM` to something else (the realm name is also used by the rest of GENIE.AI — see [Keycloak Admin Guide → §1](/docs/configure/keycloak-admin-guide/#1-accessing-the-admin-console)).
   - The path segment `google` is the IdP alias in Keycloak; it must match what you set in Step 2.
7. Note the **Client ID** and **Client Secret** that Google displays. The client secret is shown only once — store it in your password manager.

### Step 2 — Configure Google in Keycloak

1. Open the Keycloak admin console: `https://<your-domain>/auth/admin` → select the `genie` realm.
2. **Identity Providers** (left menu) → **Add provider** → select **Google**.
3. Fill in:
   - **Alias**: `google` (lowercase, unique within the realm; appears in the broker URL).
   - **Client ID**: from Step 1.
   - **Client Secret**: from Step 1.
   - **Hosted Domain** (optional): restrict to a specific Google Workspace domain (e.g., `example.com`).
4. **Save**.

By default, Keycloak adds three mappers for Google: `email`, `first name`, `last name`. These import the corresponding IdP claims into Keycloak user attributes. You can review them under **Identity Providers → Google → Mappers**.

### Step 3 — Verify

1. Open `https://<your-domain>` in a private browser window (to bypass any existing session).
2. Click **Sign in**.
3. The Keycloak login page should show a **Sign in with Google** button below the local credentials form.
4. Click it and complete the Google sign-in flow.
5. You should land back on GENIE.AI, signed in.
6. Verify the user was provisioned: in another tab, `curl https://<your-domain>/api/me -H "Authorization: Bearer <the JWT>"` returns the user's profile. Confirm `roles` is non-empty if you want admin access — see [Keycloak Admin Guide → §6.3](/docs/configure/keycloak-admin-guide/#6-3-configuring-an-identity-provider-mapper-admin-console) for role mapping.

### Failure modes (Google)

- **"Invalid redirect URI" on Google's side** — the URI in Google's OAuth client does not match the Keycloak broker URL exactly. Re-check the protocol (`https`), host (no port), `/auth` prefix, realm name (`genie`), alias (`google`), and trailing `/endpoint`. See [§7 Troubleshooting → Invalid redirect URI](#invalid-redirect-uri-error-at-the-external-idp).
- **No Google button on the Keycloak login page** — the IdP is disabled, or it was added in a different realm. Check **Identity Providers** in the `genie` realm.
- **Sign-in succeeds but `roles: []` in the JWT** — Keycloak has no Identity Provider Mapper granting a baseline role. Externally-authenticated users have **no** realm role by default; see [Keycloak Admin Guide → §6.2](/docs/configure/keycloak-admin-guide/#6-2-identity-provider-mapper-types-for-role-assignment) for `hardcoded-role-idp-mapper`.

## 2. Option 2: Microsoft Entra ID

### Step 1 — Register an application in Entra ID

1. Go to the [Microsoft Entra admin center](https://entra.microsoft.com/).
2. **Applications → App registrations** → **New registration**.
3. Fill in:
   - **Name**: `GENIE.AI - Keycloak` (or your own descriptive name).
   - **Supported account types**:
     - **Single tenant** — only users in your organization. The right default for government / sovereign deployments.
     - **Multi-tenant** — users in any organization. Useful for partner collaborations.
     - **Personal accounts** — consumer Microsoft accounts (Skype, Xbox). Rarely appropriate for sovereign deployments.
4. **Redirect URI**:
   - Platform: **Web**.
   - URI: `https://<your-domain>/auth/realms/genie/broker/microsoft/endpoint`
5. Click **Register**. Note the **Application (client) ID** on the overview page.
6. **Certificates & secrets** → **New client secret** → set expiry → **Add**.
7. Copy the **Value** of the secret immediately — Microsoft does not show it again.

### Step 2 — Configure Microsoft in Keycloak

1. Open the Keycloak admin console: `https://<your-domain>/auth/admin` → `genie` realm.
2. **Identity Providers** → **Add provider** → **Microsoft**.
3. Fill in:
   - **Alias**: `microsoft`.
   - **Client ID**: the **Application (client) ID** from Step 1.
   - **Client Secret**: the secret value from Step 1.
4. **Save**.

Default mappers (`email`, `first name`, `last name`) are created automatically.

### Step 3 — Verify

Same flow as Google: open the GENIE.AI login page, click **Sign in with Microsoft**, complete Entra authentication, and confirm you land in GENIE.AI.

### Failure modes (Microsoft)

- **AADSTS50011: The reply URL specified in the request does not match** — the redirect URI in Entra does not match Keycloak's broker URL. Check the protocol, host, `/auth` prefix, realm name, and alias.
- **AADSTS700016: Application not found in the directory** — wrong tenant, or the app registration was deleted.
- **AADSTS7000215: Invalid client secret** — secret was rotated in Entra; update the IdP config in Keycloak.

## 3. Option 3: Generic OpenID Connect IdP

Any standards-compliant OIDC provider can be connected (Okta, Auth0, Keycloak-on-itself, FranceConnect, etc.).

### Step 1 — Gather IdP configuration

You need:

- **Client ID** and **Client Secret** issued by the IdP.
- **Authorization URL** — where Keycloak redirects the user to sign in.
- **Token URL** — where Keycloak exchanges the authorization code.
- **User Info URL** (optional) — for fetching profile claims.
- **JWKS URL** (optional) — for IdP token validation.
- **Logout URL** (optional) — for single logout.

> **Where to find these values:** Most OIDC providers publish them as a JSON document at `/.well-known/openid-configuration`. Fetch that URL and copy the `authorization_endpoint`, `token_endpoint`, `userinfo_endpoint`, and `jwks_uri` into the matching Keycloak fields.

### Step 2 — Configure the OIDC IdP in Keycloak

1. **Identity Providers** → **Add provider** → **OpenID Connect v1.0**.
2. Fill in:
   - **Alias**: a unique identifier (e.g., `my-idp`).
   - **Display Name**: a human-readable name shown on the login page.
   - **Authorization URL**: the provider's authorization endpoint.
   - **Token URL**: the provider's token endpoint.
   - **Client ID**: your client identifier at the IdP.
   - **Client Secret**: your client secret at the IdP.
   - **Client Authentication**: **Client secret sent as post** is the most common mode. If your IdP requires Basic auth header or private key JWT instead, pick the matching option.
   - **User Info URL**: the provider's userinfo endpoint (leave blank if your IdP doesn't expose one).
   - **Default Scopes**: `openid email profile` (request the basics; add `groups` or other custom scopes as needed).
3. **Save**.

### Step 3 — Configure the redirect URI at the external IdP

Set the redirect URI at your external IdP to:

```
https://<your-domain>/auth/realms/genie/broker/<alias>/endpoint
```

Replace `<alias>` with the alias you set in Step 2 (e.g., `my-idp`).

### Step 4 — Configure claim mappers

Navigate to **Identity Providers → <alias> → Mappers** and create mappers to import external claims into Keycloak user attributes. At minimum:

| Mapper Type | External Claim | Keycloak Attribute |
|---|---|---|
| Attribute Importer | `email` | `email` |
| Attribute Importer | `given_name` | `firstName` |
| Attribute Importer | `family_name` | `lastName` |

### Step 5 — Verify

Same as Google/Microsoft: open the GENIE.AI login page → click the IdP button → complete the external sign-in → land in GENIE.AI. Confirm `GET /api/me` returns the user with the expected `email`.

### Failure modes (generic OIDC)

- **`invalid_client` during token exchange** — wrong Client ID / Client Secret, or wrong Client Authentication mode.
- **User signed in but `email` is empty in Keycloak** — no `email` mapper configured (Step 4), or the IdP returns `email` only with the `email` scope and that scope is missing from **Default Scopes**.
- **Token validation fails in Keycloak logs** — JWKS URL wrong or unreachable, or the IdP's signing algorithm is not supported by Keycloak (check the algorithm dropdown in the IdP config).

## 4. Option 4: SAML identity providers

Keycloak also supports SAML 2.0 identity providers (Shibboleth, Active Directory Federation Services, institutional SAML federations, eIDAS). The wiring is similar to OIDC but uses different fields and has a much different failure profile.

> **Recommendation:** Prefer OIDC over SAML when the IdP offers both. SAML has more moving parts (Entity IDs, signing certificates, ACS URLs, clock skew, signature validation) and the failure modes are harder to diagnose. If you must integrate with a SAML-only IdP, see the [Keycloak Server Administration Guide → SAML Identity Providers](https://www.keycloak.org/docs/latest/server_admin/#_identity_broker_saml) for the canonical field reference.

### Step 1 — Gather SAML IdP configuration

You need from your SAML IdP administrator:

- **Entity ID** — the IdP's unique identifier (often a URL).
- **SSO Service URL** — where Keycloak sends the SAML request.
- **SLO Service URL** (optional) — for single logout.
- **Signing Certificate** (X.509) — used by Keycloak to validate IdP responses.

Many SAML IdPs publish these as a metadata XML file. If available, use it: Keycloak can import it directly.

### Step 2 — Configure SAML in Keycloak

1. **Identity Providers** → **Add provider** → **SAML v2.0**.
2. Fill in:
   - **Alias**: a unique identifier (e.g., `institutional-idp`).
   - **Display Name**: a human-readable name shown on the login page.
   - **SAML Entity ID**: the IdP's entity ID.
   - **Single Sign-On Service URL**: the IdP's SSO endpoint.
   - Optionally, paste the **SAML Metadata URL** or upload the **Metadata XML** to auto-fill most fields.
3. **Save**.

### Step 3 — Configure the relying party (assertion consumer service)

The SAML IdP needs to know where to send the SAML response. Set the **ACS URL** to:

```
https://<your-domain>/auth/realms/genie/broker/<alias>/endpoint
```

The SAML IdP may also require the Keycloak realm's entity ID:

```
https://<your-domain>/auth/realms/genie
```

### Step 4 — Verify

1. Open the GENIE.AI login page and click the IdP button.
2. Complete the SAML sign-in flow at the IdP.
3. Confirm the user lands in GENIE.AI.

To diagnose SAML failures, use the **Keycloak admin console → Identity Providers → <alias>** to inspect last-login attempts and signature validation errors. Common failure modes in the Keycloak server log:

```
Signature validation failed   → wrong signing certificate in Keycloak
Issuer not found              → Entity ID mismatch
Assertion expired             → clock skew between IdP and Keycloak (more than 60s)
Audience restriction          → wrong ACS URL or wrong relying-party entity ID
```

## 5. Optional: automated IdP configuration via keycloak-config-cli

Instead of using the admin console, you can declare IdPs and their mappers in `configs/keycloak/genie-realm.yaml` for repeatable, version-controlled configuration. The `keycloak-config` service picks up changes on restart and applies them via `keycloak-config-cli`.

### Step 1 — Declare the IdP in `genie-realm.yaml`

Add an `identityProviders:` block. **You must include the parent IdP entry alongside any mappers** — adding a mapper without its parent IdP entry is silently ignored.

```yaml
identityProviders:
  - alias: google
    providerId: google
    enabled: true
    config:
      clientId: $(env:KEYCLOAK_GOOGLE_CLIENT_ID)
      clientSecret: $(env:KEYCLOAK_GOOGLE_CLIENT_SECRET)
    mappers:
      - name: google-email
        identityProviderAlias: google
        identityProviderMapper: oidc-user-attribute-idp-mapper
        config:
          claim: email
          userAttribute: email
      - name: google-first-name
        identityProviderAlias: google
        identityProviderMapper: oidc-user-attribute-idp-mapper
        config:
          claim: given_name
          userAttribute: firstName
      - name: google-last-name
        identityProviderAlias: google
        identityProviderMapper: oidc-user-attribute-idp-mapper
        config:
          claim: family_name
        userAttribute: lastName
      - name: google-default-role
        identityProviderAlias: google
        identityProviderMapper: hardcoded-role-idp-mapper
        config:
          role: admin                    # grant every Google user the admin realm role
      - name: google-groups-to-admin
        identityProviderAlias: google
        identityProviderMapper: attribute-to-role-idp-mapper
        config:
          attribute: groups
          role: admin
          claimValue: "genie-admin"
```

### Step 2 — Inject the secrets

The `keycloak-config` service (`docker-compose.yaml` around line 1565) already runs with `IMPORT_VARSUBSTITUTION_ENABLED=true`, so the `$(env:…)` references resolve at import time. Pass the env vars in two places:

1. Add to the `keycloak-config` service environment in `docker-compose.yaml`:
   ```yaml
   keycloak-config:
     environment:
       - KEYCLOAK_GOOGLE_CLIENT_ID=${KEYCLOAK_GOOGLE_CLIENT_ID}
       - KEYCLOAK_GOOGLE_CLIENT_SECRET=${KEYCLOAK_GOOGLE_CLIENT_SECRET}
   ```
2. Set the actual values in `.env` (the `env` template contains commented placeholders — search the file for `KEYCLOAK_GOOGLE_CLIENT_ID`).

### Step 3 — Apply the config

```bash
docker compose up -d --force-recreate keycloak-config   # Compose
docker service update --force genieai_keycloak-config   # Swarm
```

Wait for the healthcheck (`test -f /tmp/config-done`) to pass. Confirm the IdP appears in **Identity Providers** in the admin console.

> **Heads-up:** the YAML-managed IdP path is supported by `keycloak-config-cli`, but no GENIE.AI deployment currently uses it for a federated IdP. The admin-console path has been verified end-to-end. Prefer the admin-console path unless you need version-controlled, repeatable configuration.

### Trade-offs: admin console vs YAML

| | Admin console | YAML (`genie-realm.yaml`) |
|---|---|---|
| Setup effort | One-off, click-driven | Edit YAML + redeploy |
| Configuration source of truth | Keycloak database | Git |
| Visible in `git diff` | No | Yes |
| Survives `keycloak-config` redeploy | Yes (DB) | Yes (re-applied) |
| Risk of accidental deletion via admin console | Possible | Avoided |
| Supported for IdPs in production today | Yes (verified) | Supported by `keycloak-config-cli`, not verified end-to-end for federated IdPs |

For most deployments, the admin-console approach is simpler and avoids the secret-handling complexity of the YAML path. Use the YAML path only when you need GitOps-style configuration management.

## 6. Network requirements

### Outbound connectivity from Keycloak

The Keycloak container makes outbound HTTPS directly to the external IdP. NGINX does **not** proxy this traffic. Specifically, Keycloak contacts:

- Google's authorization, token, and userinfo endpoints (`https://accounts.google.com/...`).
- Microsoft's login endpoint (`https://login.microsoftonline.com/...`).
- Your generic OIDC or SAML IdP's published endpoints.

If your network blocks outbound HTTPS or requires a corporate HTTP proxy:

1. Edit `docker-compose.yaml`, find the `keycloak` service (around line 1507).
2. Add the proxy env vars to its `environment:` block:
   ```yaml
   keycloak:
     environment:
       - HTTP_PROXY=http://proxy.example.com:3128
       - HTTPS_PROXY=http://proxy.example.com:3128
       - NO_PROXY=keycloak,postgres,kong,nginx,...
   ```
3. Redeploy: `docker compose up -d --force-recreate keycloak` (Compose) or `docker service update --force genieai_keycloak` (Swarm).

> **Air-gapped deployments:** External IdPs require internet connectivity. In an air-gapped deployment, only local Keycloak credentials work. Skip this section entirely if your deployment has no outbound network access.

### Verifying connectivity from the Keycloak container

```bash
docker ps --filter "name=keycloak" -q | head -1 | xargs -I {} docker exec {} \
  curl -v https://accounts.google.com/.well-known/openid-configuration
```

The command works in both Compose (`docker compose ps` shows `keycloak`) and Swarm (`docker service ps genieai_keycloak` shows `<stack>_keycloak.<n>`). Replace `accounts.google.com` with your IdP's discovery URL.

## 7. First-login flow and role assignment

When a user signs in via an external IdP for the first time, Keycloak may prompt them to confirm or update their profile (email, first name, last name). This is configured under **Realm settings → Authentication → First Broker Login Flow** (Realm settings → Authentication → Flows → select "First Broker Login Flow").

Externally-authenticated users have **no** realm role by default. To grant them one:

1. Open the Keycloak admin console.
2. **Identity Providers → <alias> → Mappers**.
3. **Add mapper** → **Hardcoded Role**:
   - **Name**: `<alias>-default-role`
   - **Role**: `admin` (or whatever baseline role you want — today only `admin` and `dataprep-service` exist).
4. **Save**.

Or add **Attribute to Role** mappers to grant roles conditionally based on IdP claims (e.g., `groups` containing `genie-admin`).

For full details, see [Keycloak Admin Guide → §6 External IdP attribute → role mapping](/docs/configure/keycloak-admin-guide/#6-external-idp-attribute-role-mapping).

## 8. Disabling an external IdP

To temporarily disable an IdP without losing its configuration:

1. Open the Keycloak admin console.
2. **Identity Providers**.
3. Click the IdP alias.
4. Toggle **Enabled** to **Off**.
5. **Save**.

Users no longer see the IdP button on the login page. To re-enable, toggle back on.

## 9. Account linking

A user who first registered with local Keycloak credentials and later signs in via an external IdP (same email) ends up with **two distinct accounts** in Keycloak. GENIE.AI's JIT provisioning uses `{iss}#{sub}` as the key, so two separate ArangoDB user records are created (one per Keycloak user).

To merge them:

1. Open the Keycloak admin console.
2. **Users → <local user> → Identity Provider Links → Link account**.
3. Authenticate the user via the IdP from the same browser session (Keycloak needs proof that the IdP account is theirs).
4. Keycloak merges the accounts into one.

After linking, the next sign-in (via either method) provisions a single ArangoDB user with the merged identity.

## 10. Troubleshooting

### Invalid redirect URI error at the external IdP

The redirect URI configured at the external IdP must exactly match Keycloak's broker endpoint:

```
https://<your-domain>/auth/realms/genie/broker/<alias>/endpoint
```

Action checklist:

- Is the protocol `https` (not `http`)?
- Does the host match `NGINX_PUBLIC_DOMAIN` from your `.env` (no port number unless you actually expose a non-standard one)?
- Is the path `/auth/realms/<realm>/broker/<alias>/endpoint`? (NGINX forwards
  the full URI including `/auth` to Kong as-is via `proxy_pass http://$kong_addr`;
  Kong then strips the `/auth` prefix before proxying to Keycloak.)
- Does the realm name match `KEYCLOAK_REALM` in `.env`? Default is `genie`.
- Does `<alias>` match the IdP's alias in Keycloak?
- No trailing slash — the path ends in `/endpoint`.

### External IdP button does not appear on the login page

- Verify the IdP is **Enabled** (toggle on its detail page).
- Verify the IdP is in the correct realm (the realm dropdown in the top-left must show `genie`).
- Check the Keycloak log for IdP import errors:
  ```bash
  docker service logs genieai_keycloak --tail 100    # Swarm
  docker compose logs keycloak --tail 100            # Compose
  ```

### User signed in via IdP but `roles` is empty in `/api/me`

This is **expected** for IdP-only users — Keycloak does not grant a default realm role on first federation. Add a `hardcoded-role-idp-mapper` or `attribute-to-role-idp-mapper` to the IdP. See [Keycloak Admin Guide → §6](/docs/configure/keycloak-admin-guide/#6-external-idp-attribute-role-mapping).

### User signed in but the JWT is rejected by the backend (`401 TOKEN_INVALID`)

- The IdP's clock and Keycloak's clock may be skewed. The backend's JWT verifier (`components/gov-chat-backend/services/keycloak-auth-service.js`) calls `jose.jwtVerify` **without a `clockTolerance`** — the jose default is `0` seconds, so even small skew produces an `iAT` / `nBF` / `exp` rejection. Check NTP sync on the gateway node and on the IdP host.
- Keycloak may have rotated its signing keys. The backend caches the JWKS for 5 minutes (`JWKS_CACHE_TTL` in `keycloak-auth-service.js`); wait one cache cycle, or restart the backend (`docker service update --force genieai_backend`) to force an immediate re-fetch from `<issuer>/protocol/openid-connect/certs`.
- The IdP token's signature algorithm may not be supported by Keycloak. Keycloak's default is `RS256`. Change the realm's token signature algorithm under **Realm settings → Tokens → Access token signature algorithm** in the admin console.

### User not created in ArangoDB after external IdP login

- Verify the JIT provisioning service is reachable: `docker service logs genieai_backend --tail 100` (look for `[KeycloakAuth Middleware] Provisioning failed: ...`).
- Confirm the Keycloak token contains the expected claims (`email`, `sub`, `iss`). The `sub` must be Keycloak's internal user ID, not the IdP's `sub`.
- For brand-new federated users with no email, provisioning still creates the user; check the `users` collection for a document with `iss_sub = "<your-issuer>#<keycloak-user-id>"`.

### Network connectivity issues

Verify the Keycloak container can reach the IdP:

```bash
docker ps --filter "name=keycloak" -q | head -1 | xargs -I {} \
  docker exec {} curl -v https://accounts.google.com/.well-known/openid-configuration
```

Replace the URL with your IdP's discovery endpoint. If this fails:

- Check the host's outbound firewall.
- If using a corporate proxy, ensure `HTTP_PROXY` and `HTTPS_PROXY` are set on the `keycloak` service (see [§6](#6-network-requirements)).
- For air-gapped deployments, external IdPs are unavailable.

## Next steps

- **Map IdP attributes to realm roles** — see [Keycloak Admin Guide → §6 External IdP attribute → role mapping](/docs/configure/keycloak-admin-guide/#6-external-idp-attribute-role-mapping).
- **Understand the full authentication architecture** — see [Architecture Overview → Authentication](/docs/architecture/architecture/).
- **Manage users, roles, and disable / delete accounts** — see [Keycloak Admin Guide](/docs/configure/keycloak-admin-guide/).
- **Configure Grafana SSO** — see [Observability → Grafana access](/docs/observe/configuration/#grafana-access) (Grafana also uses Keycloak via its own confidential client).
- **Deploy a mobile client** that signs in via Keycloak — see [Mobile Deployment Guide](/docs/mobile/mobile-deployment-guide/).
