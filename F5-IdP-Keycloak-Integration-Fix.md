# Keycloak F5 Identity Provider (IdP) Integration Fix

## The Problem: Identity Cross-Contamination

When integrating Keycloak with an external F5 OAuth/OIDC Identity Provider, you may encounter a critical issue where multiple distinct users are logged into the exact same Keycloak account. 

For example:
1. User A (Alice) logs in. Keycloak creates a new account for Alice.
2. User B (Bob) logs in. Keycloak identifies Bob as Alice, and logs Bob into Alice's account.

### Root Cause
According to the OpenID Connect (OIDC) specification, Keycloak uses the `sub` (subject) claim from the IdP's token to uniquely identify a user and link their federated login to a local Keycloak account (known as the `BROKER_ID`).

The F5 IdP is misconfigured and sends a **static string** (e.g., `/Common/access-prod-oauth-orange.`) as the `sub` claim for *every single user*, rather than a unique identifier (like a UUID or an email address). 

Because the `sub` claim is identical for everyone, whoever logs in first binds that static ID to their Keycloak account. All subsequent logins from any user present the exact same ID, causing Keycloak to log them into the first user's account.

## The Solution: Override the Broker ID

To fix this, we must instruct Keycloak to ignore the static `sub` claim sent by the F5 IdP and instead use a truly unique claim—such as the user's `email` address—as the Federated Broker ID.

This is achieved by creating a specific Identity Provider Mapper in Keycloak.

### Fix via Keycloak Admin UI

If you have access to the Keycloak Admin Console:

1. Navigate to **Identity Providers** and select your F5 provider (e.g., `itu-users`).
2. Go to the **Mappers** tab.
3. Click **Add mapper**.
4. Configure the mapper as follows:
   - **Name:** `override-broker-id` (or similar)
   - **Sync Mode Override:** `Inherit`
   - **Mapper Type:** `Username Template Importer`
   - **Template:** `${CLAIM.email}` *(Assuming the F5 IdP sends the `email` claim correctly)*
   - **Target:** `BROKER_ID` *(Crucial: This tells Keycloak to use this value for federated identity linking)*
5. Save the mapper.

*Note: It is also recommended to ensure your local `username` mapper uses `${CLAIM.email}` so that usernames are clean (e.g., `alice@example.com` instead of `itu-users.alice@example.com`).*

### Fix via Keycloak Admin CLI (`kcadm.sh`)

If you are managing Keycloak via a Docker container or terminal, you can apply this fix using the Keycloak Admin CLI.

1. **Create a JSON file for the mapper definition (e.g., `mapper.json`):**
   ```json
   {
     "name" : "override-broker-id",
     "identityProviderAlias" : "itu-users",
     "identityProviderMapper" : "oidc-username-idp-mapper",
     "config" : {
       "syncMode" : "INHERIT",
       "template" : "${CLAIM.email}",
       "target" : "BROKER_ID"
     }
   }
   ```

2. **Authenticate and apply the mapper:**
   ```bash
   # Authenticate
   /opt/keycloak/bin/kcadm.sh config credentials --server http://localhost:8080/auth --realm master --user admin --password <admin_password>
   
   # Create the mapper
   /opt/keycloak/bin/kcadm.sh create realms/<your_realm_name>/identity-provider/instances/itu-users/mappers -f mapper.json
   ```

### Important Remediation Step: Delete Corrupted Accounts

After applying this fix, **you must delete the corrupted user accounts** from Keycloak. Because the static `sub` claim is already bound to the first user who logged in, that binding must be destroyed.

1. Find the users who logged in while the configuration was broken.
2. Delete them from Keycloak.
3. Have them log in again. Keycloak will now cleanly create their accounts and link them using their `email` address as the unique `BROKER_ID`.

*If your application backend (e.g., Node.js / ArangoDB) also caches Keycloak IDs, you may need to clear those application-level user records as well to ensure a clean sync.*