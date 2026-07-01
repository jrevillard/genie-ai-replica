---
title: "External Idp Integration Guide"
description: "Integrating external identity providers (Microsoft, Google, etc.) with Keycloak for GENIE.AI."
weight: 2
section: "configuration"
---

This guide explains how to connect an external identity provider (IdP) to GENIE.AI through Keycloak. Once configured, users can authenticate via the external IdP without any GENIE.AI code or configuration changes.

## How It Works

GENIE.AI uses Keycloak as its sole identity boundary. When an external IdP is configured in Keycloak, the authentication flow is:

```
Browser -> GENIE.AI Frontend -> Keycloak Login Page
                                      |
                                      +-- [Local Credentials] -> Keycloak Token -> GENIE.AI
                                      |
                                      +-- [External IdP Button] -> External IdP Login
                                                                    |
                                                              Keycloak Broker
                                                              (issues own token)
                                                                    |
                                                              Keycloak Token -> GENIE.AI
```

GENIE.AI always receives a standard Keycloak-issued OIDC token, regardless of which external IdP was used. The backend middleware, JIT provisioning, and frontend auth flow are completely unaware of the external IdP.

## Prerequisites

- Keycloak admin console access (`https://<your-domain>/auth/admin`)
- Admin credentials (set via `KEYCLOAK_ADMIN_PASSWORD` in `.env`)
- An account with the external IdP provider (Google, Microsoft, etc.)
- Network connectivity from the Keycloak container to the external IdP endpoints

## Option 1: Google

### Step 1: Create a Google OAuth 2.0 Client

1. Go to the [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project or select an existing one
3. Navigate to **APIs & Services > OAuth consent screen**
   - Select **External** user type
   - Fill in the required app information (name, support email, developer contact)
   - Add test users if in "Testing" mode
4. Navigate to **APIs & Services > Credentials**
5. Click **Create Credentials > OAuth client ID**
6. Select **Web application** as the application type
7. Set **Authorized redirect URIs** to:
   ```
   https://<your-domain>/auth/realms/<realm>/broker/google/endpoint
   ```
   Replace `<your-domain>` with your public domain (e.g., `gateway.example.com`) and `<realm>` with your Keycloak realm name (default: `genie`).
8. Note the **Client ID** and **Client Secret** from the credentials page

### Step 2: Configure Google in Keycloak

1. Open the Keycloak admin console: `https://<your-domain>/auth/admin`
2. Select your realm (e.g., `genie`)
3. Navigate to **Identity Providers** in the left menu
4. Click **Add provider** and select **Google**
5. Fill in the configuration:
   - **Alias**: `google` (used in URLs, must be unique)
   - **Client ID**: The Google OAuth client ID from Step 1
   - **Client Secret**: The Google OAuth client secret from Step 1
   - **Hosted Domain** (optional): Restrict to a specific Google Workspace domain
6. Click **Save**
7. (Optional) Navigate to **Identity Providers > Google > Mappers** to configure claim mapping:
   - **email**: Map Google email to Keycloak email
   - **first name**: Map Google given name to Keycloak first name
   - **last name**: Map Google family name to Keycloak last name
   - These mappers are created by default when adding Google

### Step 3: Verify

1. Navigate to the GENIE.AI login page
2. Click **Sign in** to reach the Keycloak login page
3. The Google button should appear below the local credentials form
4. Click the Google button and complete the Google sign-in flow
5. After successful authentication, you should be redirected back to GENIE.AI

## Option 2: Microsoft Entra ID

### Step 1: Register an Application in Microsoft Entra ID

1. Go to the [Microsoft Entra admin center](https://entra.microsoft.com/)
2. Navigate to **Applications > App registrations**
3. Click **New registration**
4. Fill in:
   - **Name**: `GENIE.AI - Keycloak` (or any descriptive name)
   - **Supported account types**: Select based on your organization's needs
     - *Single tenant*: Only users in your organization
     - *Multi-tenant*: Users in any organization
     - *Personal accounts*: Microsoft personal accounts (Skype, Xbox, etc.)
5. Under **Redirect URI**:
   - Select **Web** platform
   - Set the URI to:
     ```
     https://<your-domain>/auth/realms/<realm>/broker/microsoft/endpoint
     ```
6. Click **Register**
7. Note the **Application (client) ID** on the overview page
8. Navigate to **Certificates & secrets**
9. Click **New client secret**
10. Note the **Value** of the client secret (this is shown only once)

### Step 2: Configure Microsoft in Keycloak

1. Open the Keycloak admin console: `https://<your-domain>/auth/admin`
2. Select your realm (e.g., `genie`)
3. Navigate to **Identity Providers** in the left menu
4. Click **Add provider** and select **Microsoft**
5. Fill in the configuration:
   - **Alias**: `microsoft` (must be unique)
   - **Client ID**: The Application (client) ID from Step 1
   - **Client Secret**: The client secret value from Step 1
6. Click **Save**
7. (Optional) Configure mappers under **Identity Providers > Microsoft > Mappers**:
   - **email**: Map Microsoft email to Keycloak email
   - **first name**: Map Microsoft given name
   - **last name**: Map Microsoft surname

### Step 3: Verify

1. Navigate to the GENIE.AI login page
2. Click **Sign in** to reach the Keycloak login page
3. The Microsoft button should appear below the local credentials form
4. Click the Microsoft button and complete the Microsoft sign-in flow
5. After successful authentication, you should be redirected back to GENIE.AI

## Option 3: Generic OpenID Connect IdP

Any standard-compliant OIDC provider can be connected to Keycloak.

### Step 1: Gather IdP Configuration

Obtain the following from your OIDC provider:
- **Client ID** and **Client Secret**
- **Authorization URL** (e.g., `https://idp.example.com/authorize`)
- **Token URL** (e.g., `https://idp.example.com/token`)
- **User Info URL** (e.g., `https://idp.example.com/userinfo`)
- **Logout URL** (optional, e.g., `https://idp.example.com/logout`)
- **JWKS URL** (for token validation, if required)

Many OIDC providers publish these values as a `.well-known/openid-configuration` JSON document.

### Step 2: Configure the OIDC IdP in Keycloak

1. Open the Keycloak admin console: `https://<your-domain>/auth/admin`
2. Select your realm (e.g., `genie`)
3. Navigate to **Identity Providers** in the left menu
4. Click **Add provider** and select **OpenID Connect v1.0**
5. Fill in the configuration:
   - **Alias**: A unique identifier (e.g., `my-idp`)
   - **Display Name**: A human-readable name shown on the login page
   - **Authorization URL**: The provider's authorization endpoint
   - **Token URL**: The provider's token endpoint
   - **Client ID**: Your client identifier at the IdP
   - **Client Secret**: Your client secret at the IdP
   - **Client Authentication**: Set to **Client secret sent as post** (or match your IdP's requirements)
   - **User Info URL**: The provider's userinfo endpoint
   - **Default Scopes**: `openid email profile` (adjust based on what the IdP supports)
6. Click **Save**

### Step 3: Configure Redirect URI at the External IdP

Set the redirect URI at your external IdP to:
```
https://<your-domain>/auth/realms/<realm>/broker/<alias>/endpoint
```
Replace `<alias>` with the alias you chose in Step 2 (e.g., `my-idp`).

### Step 4: Configure Claim Mappers

Navigate to **Identity Providers > <your-alias> > Mappers** and create mappers to map external claims to Keycloak user attributes:

| Mapper Type | External Claim | Keycloak Attribute |
|-------------|---------------|-------------------|
| Attribute Importer | `email` | `email` |
| Attribute Importer | `given_name` | `firstName` |
| Attribute Importer | `family_name` | `lastName` |

### Step 5: Verify

1. Navigate to the GENIE.AI login page
2. Click **Sign in** to reach the Keycloak login page
3. The IdP button (with your display name) should appear on the login page
4. Click the button and complete the external IdP sign-in flow
5. After successful authentication, you should be redirected back to GENIE.AI

## Option 4: SAML Identity Providers

Keycloak also supports SAML 2.0 identity providers (e.g., Shibboleth, Active Directory Federation Services, institutional SAML IdPs). The configuration flow is similar to OIDC but uses different fields.

### Step 1: Gather SAML IdP Configuration

Obtain the following from your SAML IdP administrator:
- **Entity ID** (the IdP's unique identifier)
- **SSO Service URL** (where Keycloak redirects users for login)
- **SLO Service URL** (optional, for single logout)
- **Signing Certificate** (X.509 certificate to validate IdP responses)

Many SAML IdPs provide these as a metadata XML file.

### Step 2: Configure SAML in Keycloak

1. Open the Keycloak admin console: `https://<your-domain>/auth/admin`
2. Select your realm (e.g., `genie`)
3. Navigate to **Identity Providers** in the left menu
4. Click **Add provider** and select **SAML v2.0**
5. Fill in the configuration:
   - **Alias**: A unique identifier (e.g., `institutional-idp`)
   - **Display Name**: A human-readable name shown on the login page
   - **SAML Entity ID**: The provider's entity ID
   - **Single Sign-On Service URL**: The provider's SSO endpoint
   - You can also paste the **SAML Metadata URL** or upload the **Metadata XML file**, which auto-fills most fields
6. Click **Save**

### Step 3: Configure Redirect URI

Set the relying party / service provider assertion consumer service (ACS) URL at the SAML IdP to:
```
https://<your-domain>/auth/realms/<realm>/broker/<alias>/endpoint
```

SAML IdPs may also need the **Entity ID** of Keycloak's broker endpoint:
```
https://<your-domain>/auth/realms/<realm>
```

### Step 4: Verify

Follow the same verification steps as for OIDC providers (navigate to login page, click the IdP button, complete the flow).

## Optional: Automated IdP Configuration via keycloak-config-cli

Instead of using the Keycloak admin console, you can define identity providers in `configs/keycloak/genie-realm.yaml` for automated provisioning.

### Example: Adding Google via YAML

Add the following section to `genie-realm.yaml`:

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
```

Then inject the secrets via environment variables in the Keycloak config service:

```yaml
# In docker-compose.yaml, under keycloak-config environment:
- KEYCLOAK_GOOGLE_CLIENT_ID=${KEYCLOAK_GOOGLE_CLIENT_ID}
- KEYCLOAK_GOOGLE_CLIENT_SECRET=${KEYCLOAK_GOOGLE_CLIENT_SECRET}
```

And add the variables to your `.env` file:

```bash
KEYCLOAK_GOOGLE_CLIENT_ID=<google-oauth-client-id>
KEYCLOAK_GOOGLE_CLIENT_SECRET=<google-oauth-client-secret>
```

**Note:** This approach is optional. The Keycloak admin console method is recommended for most deployments. The choice of method is an administrative decision and does not affect GENIE.AI in any way. Be aware that adding identity providers to `genie-realm.yaml` modifies a version-controlled file — changes will be tracked in git and applied on every deployment. The admin console approach stores configuration in Keycloak's database instead.

## What Happens After Authentication

When a user authenticates via an external IdP:

1. The user clicks the external IdP button on Keycloak's login page
2. Keycloak redirects to the external IdP's authorization endpoint
3. The user authenticates and authorizes the application at the external IdP
4. The external IdP redirects back to Keycloak's broker callback endpoint
5. Keycloak exchanges the external token for a Keycloak session
6. Keycloak issues its own standard OIDC token to GENIE.AI
7. GENIE.AI's frontend receives the token via the standard `/api/auth/callback` flow
8. The backend validates the Keycloak token via JWKS, completely unaware of the external IdP
9. JIT provisioning creates or updates the user in ArangoDB using the Keycloak token claims

## Important Notes

### Network Requirements

- The Keycloak container must be able to reach the external IdP's authorization, token, and userinfo endpoints
- NGINX does not proxy external IdP traffic; Keycloak makes direct outbound connections
- If your deployment uses a corporate proxy, configure the `HTTP_PROXY` and `HTTPS_PROXY` environment variables on the Keycloak service

### Air-Gapped Deployments

External identity providers are **not available** in air-gapped deployments (no internet connectivity). Only local Keycloak credentials work in air-gapped environments. See the deployment guide for air-gapped details.

### Role and Attribute Mapping

This guide covers basic authentication only. Advanced role and attribute mapping from external IdP attributes to Keycloak roles is not covered in this guide. By default, externally-authenticated users receive the default realm roles configured in Keycloak.

### First Login Flow

On first login via an external IdP, Keycloak may prompt the user to confirm their account details (email, name). This behavior can be configured in the Keycloak realm settings under **Authentication > First Login Flow**.

### Disabling an External IdP

To temporarily disable an external IdP without removing its configuration:

1. Open the Keycloak admin console
2. Navigate to **Identity Providers**
3. Select the provider and toggle **Enabled** to **Off**

Users will no longer see the IdP button on the login page, but the configuration is preserved for re-enabling later.

### Account Linking

When a user first registers with local Keycloak credentials and later logs in via an external IdP (same email address), Keycloak creates a **separate account**. GENIE.AI's JIT provisioning uses the `{iss}#{sub}` composite key — the `sub` from Keycloak differs between local and brokered accounts, resulting in two distinct ArangoDB user records.

To link accounts, use the Keycloak admin console: **Users > [select user] > Identity Provider Links > Link account**. This is an administrative action and does not affect GENIE.AI code.

## Troubleshooting

### "Invalid redirect URI" error at the external IdP

The redirect URI configured at the external IdP must exactly match Keycloak's broker endpoint:
```
https://<your-domain>/auth/realms/<realm>/broker/<alias>/endpoint
```
Common mistakes:
- Missing `/auth` prefix (NGINX routes `/auth` to Keycloak)
- Wrong realm name
- Wrong alias
- HTTP instead of HTTPS

### External IdP button does not appear on login page

- Verify the identity provider is **enabled** in Keycloak
- Verify the provider is configured in the correct **realm**
- Check Keycloak logs for errors: `docker service logs genieai_keycloak --tail 50`

### User not created in ArangoDB after external IdP login

- Verify the JIT provisioning service is running: `docker service logs genieai_backend --tail 50`
- Check that the Keycloak token contains the expected claims (`email`, `sub`, `iss`)
- Verify the `sub` claim in the Keycloak token is Keycloak's internal user ID (not the external IdP's)

### Network connectivity issues

From the Keycloak container, test connectivity to the external IdP:
```bash
docker exec -it $(docker ps --filter "name=genieai_keycloak" -q | head -1) bash
curl -v https://accounts.google.com/.well-known/openid-configuration
```
If this fails, check network/firewall rules between the Keycloak container and the external IdP.
