# Story 3.4: External IdP Attribute to Role Mapping via Keycloak

Status: done

## Story

As a functional administrator,
I want to map external IdP attributes (e.g. group, department) to Keycloak realm roles via protocol mappers,
so that users from external IdPs automatically receive the correct GENIE.AI roles based on their organizational attributes.

## Acceptance Criteria

1. **AC1 — Attribute to role mapping via Keycloak Identity Provider Mapper (FR21):**
   **Given** an external IdP is configured in Keycloak
   **When** a functional administrator configures a Keycloak Identity Provider Mapper to map an IdP attribute (e.g. `groups`) to a realm role
   **Then** users authenticating via that IdP automatically receive the mapped role in their JWT
   **And** no GENIE.AI code changes are required to support new attribute mappings
   **Note on FR21 terminology:** FR21 in the PRD uses "protocol mappers" but the correct Keycloak mechanism for this use case is **Identity Provider Mappers** (configured per IdP, not per client). Protocol Mappers control JWT claims output and are already configured via the built-in `roles` client scope.

2. **AC2 — Mapped roles correctly extracted and propagated:**
   **Given** a user authenticates via an external IdP with attribute-to-role mapping configured
   **When** the JWT is processed by the backend middleware
   **Then** the mapped roles are correctly extracted from `realm_access.roles`
   **And** the roles are included in the `X-User-Roles` header to downstream services
   **And** the roles are stored in ArangoDB via JIT provisioning

3. **AC3 — No GENIE.AI code changes required:**
   **Given** the attribute mapping is configured in Keycloak
   **Then** no changes to backend middleware, provisioning service, or frontend are needed
   **And** the existing role extraction and propagation logic handles mapped roles identically to manually-assigned roles

4. **AC4 — Documentation for attribute mapping configuration:**
   **Given** a functional administrator wants to configure attribute mapping
   **Then** a clear guide exists in `site/content/en/docs/configuration/keycloak-admin-guide.md` explaining how to:
   - Add a Keycloak Identity Provider Mapper for a specific IdP attribute
   - Map the attribute to an existing realm role
   - Add a new realm role if the mapped attribute requires one that doesn't exist yet
   - Verify the mapping works via curl commands
   **And** the guide references the existing Keycloak admin documentation created in Story 3.3

5. **AC5 — YAML example mapper documented (not in YAML):**
   **Given** the `genie-realm.yaml` configuration file
   **Then** an example Identity Provider Mapper is documented in the admin guide showing the YAML syntax
   **And** the example demonstrates mapping a `groups` claim to realm roles
   **Note** The mapper is documented in the guide, not added to `genie-realm.yaml` — the external IdP was configured via Keycloak admin console (Story 1.9), not via realm YAML. Adding a mapper without its parent IdP entry would be orphaned.

## Tasks / Subtasks

- [x] Task 1: Document attribute-to-role mapping in Keycloak admin guide (AC: #1, #2, #3, #4)
  - [x] 1.1 Add a new section to `site/content/en/docs/configuration/keycloak-admin-guide.md` covering external IdP attribute mapping
  - [x] 1.2 Explain the difference between **Protocol Mappers** (client-level, control JWT content — already configured via `roles` client scope) and **Identity Provider Mappers** (IdP-level, transform claims during brokering — this is what FR21 needs)
  - [x] 1.3 Provide step-by-step instructions for configuring an IdP mapper to map an attribute (e.g. `groups`) to a realm role
  - [x] 1.4 Include an example for mapping a custom attribute (e.g. `department`) to a realm role
  - [x] 1.5 Document how to add new realm roles in `genie-realm.yaml` if the mapped attribute requires roles that don't exist yet
  - [x] 1.6 Add curl-based verification commands: authenticate via external IdP, decode JWT, verify `realm_access.roles` contains mapped roles
  - [x] 1.7 Cross-reference Story 3.3's sections on role assignment and data flow

- [x] Task 2: Document YAML example mapper in admin guide (AC: #5)
  - [x] 2.1 Add a complete YAML example showing an Identity Provider Mapper with its parent IdP entry in the admin guide (not in `genie-realm.yaml`)
  - [x] 2.2 Document the YAML syntax for `mappers[]` section nested under `identityProviders[]`
  - [x] 2.3 Ensure the example uses `$(env:...)` variable substitution syntax (per project-context.md rules)
  - [x] 2.4 Add a note explaining why the mapper is documented in the guide rather than added to `genie-realm.yaml` — the external IdP was configured via Keycloak admin console (Story 1.9), not via realm YAML. Adding a mapper without its parent IdP entry would be orphaned and confusing.

- [x] Task 3: Verify existing role propagation handles mapped roles (AC: #2, #3)
  - [x] 3.1 Verify `keycloak-auth-middleware.js` extracts `realm_access.roles` regardless of role assignment method (manual vs mapper)
  - [x] 3.2 Verify `user-provisioning-service.js` persists mapped roles to ArangoDB via JIT provisioning
  - [x] 3.3 Verify `X-User-Roles` header includes mapped roles
  - [x] 3.4 Document verification in the admin guide — no code changes expected

## Dev Notes

### Story Nature: Documentation + Verification

This is primarily a **documentation-only story** — no code changes are expected. The existing implementation already handles roles identically whether they are manually assigned or mapped via protocol mappers:

| Capability | Implementation | Works with mapped roles? |
|---|---|---|
| Role extraction from JWT | `realm_access.roles` extraction | Yes — source-agnostic |
| X-User-Roles header | Comma-separated roles | Yes — source-agnostic |
| ArangoDB role persistence | `roles` field in UPSERT | Yes — source-agnostic |
| Role-based access control | `requireAdmin` middleware | Yes — source-agnostic |
| User provisioning on login | Atomic UPSERT on each auth | Yes — source-agnostic |

### Key Technical Concepts

**⚠️ Terminology note (FR21 vs Keycloak reality):** FR21 in the PRD uses "protocol mappers" but the correct Keycloak mechanism for attribute-to-role mapping is **Identity Provider Mappers**. Protocol Mappers control JWT claims output (and are already configured via the built-in `roles` client scope). Identity Provider Mappers transform claims during the external IdP brokering flow. The Dev Notes and Tasks in this story use the correct Keycloak terminology. When referencing FR21, note that "protocol mappers" in the PRD means "Identity Provider Mappers" in Keycloak terms.

**Protocol Mapper vs Identity Provider Mapper:**

| Feature | Protocol Mapper | Identity Provider Mapper |
|---|---|---|
| Scope | Client-level (controls JWT content) | IdP-level (transforms claims during brokering) |
| Use case | Add/remove claims from JWT | Map external IdP attributes to Keycloak roles/groups |
| Configuration | Client → Protocol Mappers tab | Identity Provider → Mappers tab |
| Relevant for this story | Indirectly (roles client scope includes mapper output) | **Directly** — this is the mechanism for FR21 |

**For FR21 (attribute-to-role mapping), Identity Provider Mappers are the correct mechanism.** They run during the authentication flow when Keycloak brokers to the external IdP, and can map incoming claims to Keycloak realm roles before the JWT is issued.

### Keycloak Mapper Types for Role Mapping

| Mapper Type | Purpose | Key Config Fields |
|---|---|---|
| `hardcoded-role-idp-mapper` | Assigns a **fixed** realm role to ALL users from this IdP (baseline role) | `role` |
| `attribute-to-role-idp-mapper` | Assigns a realm role when an attribute **matches** a value (contains check, not exact) | `attribute`, `role`, `claimValue` |
| `oidc-user-attribute-idp-mapper` | Imports an attribute from the external IdP token into a Keycloak user attribute (no role assignment — preliminary step) | `claim`, `userAttribute` |

**Important:** `attribute-to-role-idp-mapper` performs a **substring/contains check** on the attribute value, not an exact match. This means a single mapper can detect `"genie-admin"` within a multi-value `groups` attribute like `["staff", "genie-admin", "finance"]`.

### Data Flow: External IdP → Keycloak → GENIE.AI

```
1. External IdP token (has "groups" claim)
   └── Keycloak Identity Provider Mapper (attribute-to-role-idp-mapper)
       └── Keycloak assigns realm role to local user

2. Keycloak issues JWT
   └── Protocol Mapper (user-realm-roles, already configured via "roles" client scope)
       └── JWT realm_access.roles includes the mapped role

3. GENIE.AI backend processes JWT
   └── keycloak-auth-middleware.js → extract realm_access.roles
   └── user-provisioning-service.js → persist roles to ArangoDB
   └── X-User-Roles header → downstream services
```

**No client or protocol mapper changes needed** — the existing `roles` client scope (line 49-54 of `genie-realm.yaml`) already includes the `user-realm-roles` protocol mapper that puts all assigned realm roles into `realm_access.roles`.

### YAML Configuration for keycloak-config-cli

Mappers are nested under each identity provider entry in `genie-realm.yaml`. Example with Google:

```yaml
identityProviders:
  - alias: google
    providerId: google
    enabled: true
    config:
      clientId: $(env:KEYCLOAK_GOOGLE_CLIENT_ID)
      clientSecret: $(env:KEYCLOAK_GOOGLE_CLIENT_SECRET)
    mappers:
      # Standard attribute import (already configured via Story 1.9)
      - name: google-email
        identityProviderAlias: google
        identityProviderMapper: oidc-user-attribute-idp-mapper
        config:
          claim: email
          userAttribute: email

      # NEW: Baseline role for ALL Google users
      - name: google-default-user-role
        identityProviderAlias: google
        identityProviderMapper: hardcoded-role-idp-mapper
        config:
          role: user

      # NEW: Map specific group to admin role
      - name: google-groups-to-admin
        identityProviderAlias: google
        identityProviderMapper: attribute-to-role-idp-mapper
        config:
          attribute: groups
          role: admin
          claimValue: "genie-admin"
```

Example with Microsoft Entra ID (department-based mapping):

```yaml
  - alias: microsoft
    providerId: microsoft
    enabled: true
    config:
      clientId: $(env:KEYCLOAK_MICROSOFT_CLIENT_ID)
      clientSecret: $(env:KEYCLOAK_MICROSOFT_CLIENT_SECRET)
    mappers:
      - name: ms-default-user-role
        identityProviderAlias: microsoft
        identityProviderMapper: hardcoded-role-idp-mapper
        config:
          role: user

      - name: ms-department-to-admin
        identityProviderAlias: microsoft
        identityProviderMapper: attribute-to-role-idp-mapper
        config:
          attribute: department
          role: admin
          claimValue: "IT"

      - name: ms-department-to-analyst
        identityProviderAlias: microsoft
        identityProviderMapper: attribute-to-role-idp-mapper
        config:
          attribute: department
          role: analyst
          claimValue: "Research"
```

### Keycloak-config-cli Mapper Config Fields

For `attribute-to-role-idp-mapper`:

| Field | Required | Description |
|---|---|---|
| `name` | Yes | Unique mapper name within this IdP |
| `identityProviderAlias` | Yes | Must match the parent IdP alias |
| `identityProviderMapper` | Yes | `attribute-to-role-idp-mapper` |
| `config.attribute` | Yes | Claim name from the external IdP token (e.g. `groups`, `department`) |
| `config.role` | Yes | Keycloak realm role name to assign |
| `config.claimValue` | Yes | Value to match in the attribute (contains check) |

For `hardcoded-role-idp-mapper`:

| Field | Required | Description |
|---|---|---|
| `name` | Yes | Unique mapper name |
| `identityProviderAlias` | Yes | Must match the parent IdP alias |
| `identityProviderMapper` | Yes | `hardcoded-role-idp-mapper` |
| `config.role` | Yes | Keycloak realm role to assign to ALL users from this IdP |

### Important Notes

- **Mapper evaluation order matters** — `hardcoded-role-idp-mapper` first (baseline), then conditional `attribute-to-role-idp-mapper` entries
- **Roles must be defined** in `roles.realm[]` before any mapper references them
- **Google's `groups` claim** requires Google Workspace configuration to return the `groups` claim — not available by default
- **Microsoft Entra ID** returns `groups` as a standard claim when the `groups` permission is requested in app registration
- **No GENIE.AI code changes required** — the entire mapping happens transparently within Keycloak
- **Environment variables** for IdP secrets: `$(env:KEYCLOAK_GOOGLE_CLIENT_ID)` syntax works because `IMPORT_VARSUBSTITUTION_ENABLED=true` is set in docker-compose

### Existing Keycloak Configuration

The current `config/keycloak/genie-realm.yaml` contains:
- Realm roles: `admin`, `user` (lines 8-12)
- OIDC client: `genie-app` (public, lines 31-58)
- Default admin user with `admin` + `user` roles (lines 15-27)
- **No identity providers configured** — external IdP was configured via Keycloak admin console (Story 1.9), not via realm YAML
- **No protocol mappers or IdP mappers configured**

### Worktree Assignment

- **Worktree:** `epic3-keycloak`
- **Branch:** `feature/epic3-keycloak` (current)
- **Parallel with:** 3-1, 3-2 (epic3-sessions worktree — no file overlap)
- **After:** 3-3 (done — created admin guide this story extends)
- **Before:** 3-5 (Keycloak Admin API Proxy — no dependency, but same worktree means sequential)

### Project Structure Notes

- Documentation files in `docs/` directory at project root
- Keycloak configuration in `config/keycloak/` (realm YAML, Dockerfile)
- No new files needed in `components/` — this story is documentation only
- Variable substitution syntax in YAML: `$(env:VARIABLE)` (NOT `${env:VARIABLE}`) — see project-context.md

### E2E Testing

- **Existing infrastructure:** Playwright-based E2E tests in `docs/e2e-tests/` with Phase 0 setup
- **Verification commands:** Include curl-based verification in the admin guide
- **Note:** Full E2E verification requires an active external IdP (Google, Microsoft, etc.) — document the steps but note that actual verification requires IdP configuration

### Cross-Story Dependencies

- **Story 1.9** (External IdP connection) — already done. External IdP is connected via Keycloak admin console. This story adds the attribute mapping layer on top.
- **Story 3.3** (Role & Group Management) — done. Created `site/content/en/docs/configuration/keycloak-admin-guide.md` that this story extends with a new section on protocol/IdP mappers.
- **Story 3.5** (Keycloak Admin API Proxy) — will benefit from documented mapper patterns if admin API needs to configure mappers programmatically in the future.

### References

- [Source: config/keycloak/genie-realm.yaml] — Current realm configuration (no mappers yet)
- [Source: site/content/en/docs/configuration/keycloak-admin-guide.md] — Admin guide created in Story 3.3, to be extended
- [Source: components/gov-chat-backend/middleware/keycloak-auth-middleware.js:70] — Role extraction (source-agnostic)
- [Source: components/gov-chat-backend/services/user-provisioning-service.js:49] — JIT role persistence (source-agnostic)
- [Source: _bmad-output/planning-artifacts/architecture.md#D6] — Keycloak realm initialization approach
- [Source: _bmad-output/planning-artifacts/architecture.md#D7] — Multi-tenancy approach
- [Source: _bmad-output/planning-artifacts/prd.md#FR21] — External IdP attribute to role mapping
- [Source: _bmad-output/planning-artifacts/prd.md#Journey3] — Chen persona (functional admin workflow)
- [Source: _bmad-output/project-context.md] — Keycloak config CLI variable substitution syntax

## Dev Agent Record

### Agent Model Used

glm-5-turbo

### Debug Log References

(none — documentation-only story, no code changes)

### Completion Notes List

- Added Section 8 "External IdP Attribute to Role Mapping" to `site/content/en/docs/configuration/keycloak-admin-guide.md` with 9 subsections (8.1-8.9)
- Section 8.1 clarifies Protocol Mappers vs Identity Provider Mappers (FR21 terminology correction)
- Section 8.2 documents the three mapper types: hardcoded-role, attribute-to-role, oidc-user-attribute
- Section 8.3 provides step-by-step admin console instructions for groups-to-role and baseline role mapping
- Section 8.4 provides a custom attribute example (department-based mapping for Microsoft Entra ID)
- Section 8.5 documents how to add new realm roles in genie-realm.yaml
- Section 8.6 documents the data flow and confirms no GENIE.AI code changes needed (source-agnostic)
- Section 8.7 provides complete YAML examples with parent IdP entry, `$(env:...)` syntax, and field reference tables
- Section 8.8 provides curl-based verification commands for federated users
- Section 8.9 cross-references Story 3.3 sections (role assignment, propagation flow, data flow, groups)
- Verified `keycloak-auth-middleware.js:70` extracts `realm_access?.roles || []` — source-agnostic ✅
- Verified `user-provisioning-service.js:49` persists `realm_access?.roles || []` — source-agnostic ✅
- Verified `keycloak-auth-middleware.js:73` builds `X-User-Roles` from extracted roles — source-agnostic ✅
- No code changes required — existing implementation handles mapped roles identically to manually-assigned roles

### Change Log

| Date | Change |
|------|--------|
| 2026-04-06 | Added Section 8 (External IdP Attribute to Role Mapping) to keycloak-admin-guide.md — 9 subsections covering mapper types, admin console instructions, YAML examples, verification commands, and cross-references |

### File List

| File | Action |
|------|--------|
| `site/content/en/docs/configuration/keycloak-admin-guide.md` | Modified — added Section 8 (External IdP Attribute to Role Mapping) |
| `_bmad-output/implementation-artifacts/3-4-external-idp-attribute-to-role-mapping-via-keycloak.md` | Created — story file with tasks, completion notes, and review fixes |
| `_bmad-output/implementation-artifacts/sprint-status.yaml` | Modified — status updated to done |
| `_bmad-output/planning-artifacts/epics.md` | Modified — story renumbering, new Story 3.5 |
