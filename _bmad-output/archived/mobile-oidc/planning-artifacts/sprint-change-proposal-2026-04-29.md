# Sprint Change Proposal — 2026-04-29

## 1. Issue Summary

**Problem:** The architecture document (line 877) states that `SettingsComponent` password change and account deletion flows should be replaced by Keycloak's account console. However, no Epic 6 story acceptance criteria cover the cleanup of `SettingsComponent` when `password_proxy.dart` and legacy `UserService` methods are removed.

**Discovery:** Identified during attempted creation of story 5.3. Analysis revealed that `SettingsComponent` (line 27) imports `PasswordProxy`, which is deleted in Story 6.2. The "Change Password" button and account deletion flow would become dead code with no AC to remove them.

**Impact:** Without this correction, the developer implementing Epic 6 would leave `SettingsComponent` with broken references to deleted services.

## 2. Impact Analysis

- **Epic Impact:** Epic 6 only — Stories 6.2 and 6.3 need AC additions
- **Story Impact:** No new stories; 3 ACs added to 2 existing stories
- **Artifact Conflicts:** None — architecture already documents the intent
- **Technical Impact:** None — purely a planning gap

## 3. Recommended Approach

**Direct Adjustment** — Add acceptance criteria to existing stories.

- Effort: Low
- Risk: Low
- Timeline: No impact

## 4. Detailed Change Proposals

### Story 6.2: Legacy Auth Code Removal — 2 ACs added

After the existing AC for `components/auth/` deletion:

1. **SettingsComponent cleanup:** Remove "Change Password" button, account deletion flow, and `PasswordProxy` import from `settings_component.dart`
2. **Keycloak account console link:** Add "Manage Account" link that opens `{keycloakUrl}/realms/{realm}/account/` in system browser

### Story 6.3: LoginScreen Replacement — 1 AC added

After the existing AC for `settings_service.dart` comments:

3. **Orphaned i18n cleanup:** Clean up i18n keys from locale files for `password_reset_initiate_screen.dart` and `password_reset_confirm_screen.dart` removed in Story 6.2

## 5. Implementation Handoff

- **Scope:** Minor — Direct implementation by Developer agent
- **Handoff:** No action needed now — changes will be picked up when stories 6.2 and 6.3 are created via `create-story`
- **Success criteria:** Stories 6.2 and 6.3 files include the new ACs when generated
