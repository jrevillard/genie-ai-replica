---
validationTarget: '_bmad-output/planning-artifacts/prd-mobile-oidc.md'
validationDate: '2026-04-23'
inputDocuments:
  - '_bmad-output/planning-artifacts/prd-mobile-oidc.md'
  - '_bmad-output/planning-artifacts/prd.md'
  - 'GitLab Issue #613 - Migrate Flutter mobile app to Keycloak OIDC authentication'
  - '_bmad-output/planning-artifacts/research/technical-identity-provider-integration-research-2026-03-26.md'
  - '_bmad-output/project-context.md'
  - 'docs/architecture.md'
  - 'docs/keycloak-admin-guide.md'
  - 'docs/external-idp-integration-guide.md'
  - 'docs/roadmap-sprint-20-to-25.md'
validationStepsCompleted: ['step-v-01-discovery', 'step-v-02-format-detection', 'step-v-03-density-validation', 'step-v-04-brief-coverage', 'step-v-05-measurability', 'step-v-06-traceability', 'step-v-07-impl-leakage', 'step-v-08-domain-compliance', 'step-v-09-project-type', 'step-v-10-smart', 'step-v-11-holistic', 'step-v-12-completeness']
validationStatus: COMPLETE
holisticQualityRating: '4/5 - Strong with targeted improvements needed'
overallStatus: Warning
---

# PRD Validation Report

**PRD Being Validated:** `_bmad-output/planning-artifacts/prd-mobile-oidc.md`
**Validation Date:** 2026-04-23

## Input Documents

- PRD: `prd-mobile-oidc.md` (target) ✓
- PRD principal: `prd.md` ✓
- GitLab Issue #613 (référencé dans le frontmatter, non chargé en fichier) ✓
- Recherche technique: `technical-identity-provider-integration-research-2026-03-26.md` ✓
- Contexte projet: `project-context.md` ✓
- Architecture: `docs/architecture.md` ✓
- Guide admin Keycloak: `docs/keycloak-admin-guide.md` ✓
- Guide intégration IdP externe: `docs/external-idp-integration-guide.md` ✓
- Roadmap: `docs/roadmap-sprint-20-to-25.md` ✓

## Validation Findings

### Format Detection

**PRD Structure (## Level 2 headers):**
1. Executive Summary
2. Project Classification
3. Success Criteria
4. User Journeys
5. Domain-Specific Requirements
6. Platform & Deployment Requirements
7. Project Scoping & Phased Development
8. Functional Requirements
9. Key Architectural Decisions
10. Non-Functional Requirements

**BMAD Core Sections Present:**
- Executive Summary: Present ✓
- Success Criteria: Present ✓
- Product Scope: Present ✓ (as "Project Scoping & Phased Development")
- User Journeys: Present ✓
- Functional Requirements: Present ✓
- Non-Functional Requirements: Present ✓

**Format Classification:** BMAD Standard
**Core Sections Present:** 6/6

### Information Density Validation

**Anti-Pattern Violations:**

**Conversational Filler:** 0 occurrences
No filler phrases detected ("The system will allow users to...", "It is important to note that...", "In order to", etc.)

**Wordy Phrases:** 1 occurrence
- Line 413: "The following decisions were made during this PRD and differ from the initial technical specification..." — meta-documentation framing, could be tightened.

**Redundant Phrases:** 1 occurrence
- Line 82: "works identically... using the same flutter_appauth abstraction" — double-emphasis.

**Total Violations:** 2

**Severity Assessment:** Pass (<5)

**Recommendation:** PRD demonstrates good information density with minimal violations. The 2 minor issues are in non-critical sections and do not impact signal-to-noise ratio.

### Product Brief Coverage

**Status:** N/A - No Product Brief was provided as input (frontmatter: `briefs: 0`)

### Measurability Validation

#### Functional Requirements

**Total FRs Analyzed:** 31

**Format Violations:** 0 — All 31 FRs follow `[Actor] can [capability]` format.

**Subjective Adjectives Found:** 1
- FR12 (L369): "clear" — "displays a **clear** 'No internet connection' message"

**Vague Quantifiers Found:** 0

**Implementation Leakage:** 13
- FR1 (L349): "ASWebAuthenticationSession on iOS, Chrome Custom Tabs on Android" — platform mechanism names
- FR4 (L352): "`end_session_endpoint`" — OIDC protocol detail
- FR5 (L356): "refresh token rotation" — OIDC protocol mechanism (borderline)
- FR9 (L363): "iOS Keychain, Android EncryptedSharedPreferences" — platform implementation
- FR10 (L364): "(sub, iss, roles)" — OIDC claim data structure names
- FR17 (L380): "Flutter build", "Flutter flavors" — technology name
- FR18 (L381): "public client", "PKCE mandatory" — OIDC protocol terminology
- FR20 (L386): "`com.itu.genieai:/callback`" — specific example value (borderline)
- FR21 (L387): "Universal Links (iOS) and App Links (Android)" — platform mechanism names
- FR22 (L391): "`.well-known/openid-configuration`" — OIDC protocol endpoint
- FR24 (L396): "`auth_proxy.dart`, `password_proxy.dart`, `register_screen.dart`, SHA-256" — specific filenames
- FR26 (L401): "flavor configuration" — Flutter-specific term
- FR29 (L407): "platform-agnostic Dart" — implementation language

> **Note:** Several violations are borderline — Flutter/OIDC terms may be acceptable domain vocabulary in a migration-specific PRD. The strongest violations are FR1, FR9, FR21, FR24, FR29.

**FR Violations Total:** 14

#### Non-Functional Requirements

**Total NFRs Analyzed:** 9

**Missing Metrics:** 6 (NFR4-NFR9 — no numeric thresholds)
- NFR4: "handled gracefully" — subjective, no metric
- NFR5: "recovers to a known state" — undefined "known state"
- NFR6: "always returns a consistent state" — "consistent" undefined
- NFR7: "minimal" binary size increase — no numeric threshold
- NFR8: "preserves all" data — no pass/fail criterion
- NFR9: "sufficient context" — subjective, no specific fields listed

**Incomplete Template:** 9/9 — None specify a measurement method. Only 3 (NFR1-NFR3) have numeric metrics.

**Missing Context:** 8 (NFR1-NFR8 — no "why this matters" context; NFR9 partially present)

**NFR Violations Total:** 9

#### Overall Assessment

**Total Requirements:** 40 (31 FRs + 9 NFRs)
**Total Violations:** 23 (14 FR + 9 NFR)

**Severity:** Critical (>10 violations)

**Recommendation:**
- **FRs:** Clean up implementation leakage in 13 FRs — move platform mechanism names and protocol details to ADR/architecture section. The strongest violations are FR1, FR4, FR9, FR10, FR21, FR24, FR29.
- **NFRs:** All 9 NFRs need measurement methods. 6 need numeric metrics. 8 need context. NFR4, NFR5, NFR6, NFR7 are the weakest — they contain subjective language ("gracefully", "known state", "consistent", "minimal") without any way to test compliance.

### Traceability Validation

#### Chain Validation

**Executive Summary → Success Criteria:** Intact
All vision elements (restore mobile auth, PKCE, per-deployment isolation, token passthrough, sovereignty, cross-platform) align directly with defined success criteria.

**Success Criteria → User Journeys:** Intact (1 minor gap)
- BS3 (Issue #597 SSE streaming unblocked) has no dedicated user journey — FR10 provides the technical enabler, but no journey illustrates SSE consumption. Acceptable as a business dependency.

**User Journeys → Functional Requirements:** Intact
All 8 user journeys are fully covered by FRs. No journey lacks supporting requirements.

**Scope → FR Alignment:** Intact
All 16 MVP scope items map to specific FRs. All 31 FRs are within MVP scope. No out-of-scope FRs.

#### Orphan Elements

**Orphan Functional Requirements:** 0 — All 31 FRs trace to at least one user journey, business objective, or technical success criterion.
- FR10 traces to BS3 (business objective, no dedicated journey)
- FR23-FR25 trace to technical success criteria (TS1, TS2, TS4)
- FR28 traces to Platform Requirements section

**Unsupported Success Criteria:** 1 (minor)
- BS3 (Issue #597 SSE streaming unblocked) — no dedicated user journey. FR10 provides the enabler. Acceptable.

**User Journeys Without FRs:** 0

#### Traceability Matrix Summary

| Chain | Status | Details |
|-------|--------|---------|
| Executive Summary → Success Criteria | STRONG | All vision elements aligned |
| Success Criteria → User Journeys | STRONG | 1 minor gap (BS3) |
| User Journeys → FRs | STRONG | All 8 journeys fully covered |
| Scope → FRs | STRONG | 16/16 scope items mapped, 31/31 FRs in scope |

**Total Traceability Issues:** 1 (minor — BS3 gap)

**Severity:** Pass

**Recommendation:** Traceability chain is intact with complete bidirectional coverage. The single minor gap (BS3 lacking a dedicated journey) is acceptable given FR10 provides the technical enabler for SSE streaming.

### Implementation Leakage Validation

#### Leakage by Category

**Technology/Framework Names:** 4 violations
- FR1 (L349): `ASWebAuthenticationSession`, `Chrome Custom Tabs` — platform API names, capability already stated as "system browser"
- FR17 (L380): `Flutter flavors` — build mechanism, capability already stated as "configured at build-time"
- FR29 (L407): `Dart` — programming language, should say "platform-agnostic unit tests"

**Platform-Specific APIs:** 4 violations (same instances as above)
- FR1 (L349): `ASWebAuthenticationSession`, `Chrome Custom Tabs`
- FR9 (L363): `iOS Keychain`, `Android EncryptedSharedPreferences` — capability already stated as "platform secure storage"

**Protocol Internals:** 2 violations
- FR4 (L352): `end_session_endpoint` — OIDC endpoint name
- FR22 (L391): `.well-known/openid-configuration` — OIDC discovery endpoint path

**Data Structures:** 2 violations
- FR10 (L364): `sub`, `iss` — OIDC claim names

**Library Names:** 0 violations — No library names in FR/NFR sections (properly placed in ADR/Platform sections)

**File/Code Names:** 0 violations — No filenames in FR/NFR sections

**Other Implementation Details:** 0 violations

#### Summary

**Total Implementation Leakage Violations:** 12

**Severity:** Critical (>5 violations)

**Recommendation:** The leakage is primarily redundant parenthetical additions that duplicate already-stated capabilities with platform-specific names. A single editing pass removing 12 specific terms would eliminate all leakage. The strongest violations are FR1 (platform APIs), FR9 (platform storage APIs), FR4 (endpoint name), FR22 (endpoint path), FR10 (claim names), and FR29 (language name).

### Domain Compliance Validation

**Domain:** GovTech — Digital Public Infrastructure (DPI)
**Complexity:** High (regulated)

#### Required Special Sections

**Procurement Compliance:** Met (inherited from parent PRD)
No new vendor or procurement surface introduced by mobile OIDC migration. Parent PRD covers open-source license, IdP-agnostic architecture.

**Security Clearance:** Met
OWASP Mobile Top 10 section present (token storage, certificate validation, obfuscation threat model, log sanitization). Adequate for mobile auth migration scope.

**Accessibility Standards:** Partial gap
Keycloak browser login inherits WCAG 2.1 AA from institution's Keycloak theme. However, native Flutter UI accessibility (login screen, error states, session expired messages) is not addressed — should document VoiceOver/TalkBack compliance as Growth consideration.

**Transparency Requirements:** Met (inherited from parent PRD)
NFR9 covers auth failure logging. Parent PRD provides full audit infrastructure (timestamps, user identity, retention, erasure).

#### Additional GovTech/DPI Checks

| Requirement | Status | Notes |
|---|---|---|
| Data Residency / Sovereignty | Met | Explicit section + air-gapped journey (J8) |
| NIST Framework | Met (implicit) | OWASP Mobile Top 10 cited; NIST-aligned practices via PKCE, keystore, TLS |
| FedRAMP | N/A | On-premises deployment model |
| Privacy / GDPR | Met (inherited) | Parent PRD covers; no new mobile privacy surface |
| Open Data / Interoperability | Met | Standard OIDC (RFC 8252), IdP-agnostic libraries |

#### Compliance Matrix Summary

**Required Sections Present:** 3.5/4
**Compliance Gaps:** 1 (accessibility — native Flutter UI)

**Severity:** Warning

**Recommendation:** Add a brief accessibility note under Domain-Specific Requirements: (1) Keycloak browser login inherits WCAG 2.1 AA from institution's theme, (2) native Flutter UI should follow platform accessibility guidelines (VoiceOver/TalkBack) — document as Growth consideration. All other GovTech compliance areas are well-covered.

### Project-Type Compliance Validation

**Project Type:** Mobile App (Flutter)

#### Required Sections

**Platform Requirements:** Present ✓
Framework (Flutter 3.10+), minimum iOS (13+), minimum Android (API 23+), target platforms, build system (flavors), auth library, token storage — all documented (L200-209). iOS Development Constraints subsection covers CI/testing limitations (L212-228).

**Device Permissions:** Present ✓
Network access, Keychain/Keystore, system browser access, biometric (future), push notifications (future) — documented with purpose, required status, and user prompt expectation (L242-249).

**Offline Mode:** Present ✓
Explicitly scoped out of MVP with documented behavior for each offline scenario (login, refresh, API calls) and Vision roadmap (L252-260).

**Push Strategy:** Present ✓
Explicitly scoped out of MVP with documented current approach (foreground/background resume) and Vision roadmap (L264-265).

**Store Compliance:** Present ✓
App Store Compliance subsection covers Apple Developer Enterprise Program, provisioning profiles, App Store review considerations, minimum OS version targets (L170-176).

#### Excluded Sections (Should Not Be Present)

**Desktop Features:** Absent ✓
**CLI Commands:** Absent ✓

#### Compliance Summary

**Required Sections:** 5/5 present
**Excluded Sections Present:** 0 (none)
**Compliance Score:** 100%

**Severity:** Pass

**Recommendation:** All required mobile app sections are present and adequately documented. Offline mode and push notifications are properly scoped out of MVP with clear behavior documentation.

### SMART Requirements Validation

**Total Functional Requirements:** 31

#### Scoring Summary

**All scores ≥ 3:** 100% (31/31)
**All scores ≥ 4:** 64.5% (20/31)
**Overall Average Score:** 4.68/5.0

| Criterion | Average |
|-----------|---------|
| Specific | 4.77 |
| Measurable | 4.39 |
| Attainable | 4.97 |
| Relevant | 5.00 |
| Traceable | 5.00 |

#### Scoring Table

| FR | S | M | A | R | T | Avg | Flag |
|----|---|---|---|---|---|-----|------|
| FR1 | 5 | 5 | 5 | 5 | 5 | 5.0 | |
| FR2 | 5 | 4 | 5 | 5 | 5 | 4.8 | |
| FR3 | 5 | 5 | 5 | 5 | 5 | 5.0 | |
| FR4 | 5 | 5 | 5 | 5 | 5 | 5.0 | |
| FR5 | 5 | 5 | 5 | 5 | 5 | 5.0 | |
| FR6 | 5 | 4 | 5 | 5 | 5 | 4.8 | |
| FR7 | 5 | 4 | 5 | 5 | 5 | 4.8 | |
| FR8 | 5 | 5 | 5 | 5 | 5 | 5.0 | |
| FR9 | 5 | 5 | 5 | 5 | 5 | 5.0 | |
| FR10 | 4 | 4 | 5 | 5 | 5 | 4.6 | |
| FR11 | 5 | 5 | 5 | 5 | 5 | 5.0 | |
| FR12 | 5 | 5 | 5 | 5 | 5 | 5.0 | |
| FR13 | 4 | 4 | 5 | 5 | 5 | 4.6 | |
| FR14 | 4 | 3 | 5 | 4 | 5 | 4.2 | X |
| FR15 | 5 | 5 | 5 | 5 | 5 | 5.0 | |
| FR16 | 5 | 5 | 5 | 5 | 5 | 5.0 | |
| FR17 | 5 | 5 | 5 | 5 | 5 | 5.0 | |
| FR18 | 5 | 5 | 5 | 5 | 5 | 5.0 | |
| FR19 | 4 | 3 | 4 | 5 | 5 | 4.2 | X |
| FR20 | 5 | 5 | 5 | 5 | 5 | 5.0 | |
| FR21 | 5 | 4 | 5 | 5 | 5 | 4.8 | |
| FR22 | 5 | 5 | 5 | 5 | 5 | 5.0 | |
| FR23 | 5 | 5 | 5 | 5 | 5 | 5.0 | |
| FR24 | 5 | 5 | 5 | 5 | 5 | 5.0 | |
| FR25 | 4 | 3 | 5 | 5 | 5 | 4.4 | X |
| FR26 | 5 | 4 | 5 | 5 | 5 | 4.8 | |
| FR27 | 5 | 5 | 5 | 5 | 5 | 5.0 | |
| FR28 | 5 | 4 | 5 | 5 | 5 | 4.8 | |
| FR29 | 4 | 4 | 5 | 5 | 5 | 4.6 | |
| FR30 | 4 | 4 | 5 | 5 | 5 | 4.6 | |
| FR31 | 5 | 5 | 5 | 5 | 5 | 5.0 | |

**Legend:** 1=Poor, 3=Acceptable, 5=Excellent | **Flag X:** Score < 3 in any category

#### Improvement Suggestions

**FR14 (M=3):** Rewrite as positive requirement — "For every authentication error state, the app displays an error message and a recovery action within N seconds." Add specific message categories.

**FR19 (M=3):** Add measurable success criteria — "A deployment operator can complete a new deployment in under 4 hours following only the deployment guide."

**FR25 (M=3):** Define PII scope (email, name, profile attributes) and add verification mechanism (unit test + code review checklist).

#### Overall Assessment

**Severity:** Pass (<10% flagged — 3/31 = 9.7%)

**Recommendation:** Functional Requirements demonstrate excellent SMART quality overall (4.68/5.0 average). The 3 flagged FRs use negative phrasing or lack quantifiable targets. Focus improvements on FR14, FR19, and FR25.

### Holistic Quality Assessment

#### Document Flow & Coherence

**Assessment:** Excellent

**Strengths:**
- Exceptional narrative arc from problem statement (broken mobile app) through vision, journeys, requirements, to ADRs
- Consistent terminology and perspective throughout (Maria/Amadou personas maintained)
- "What Makes This Special" section effectively prevents dismissive reading
- ADRs document decisions that differ from GitLab Issue #613, preventing re-litigation
- Smooth transitions between journeys → domain → platform → scoping → requirements

**Areas for Improvement:**
- Document ends abruptly at NFR9 — no closing summary or explicit "Out of Scope" section
- Innovation Analysis section absent (defensible for migration, but should note "N/A — brownfield migration")

#### Dual Audience Effectiveness

**For Humans:**
- Executive-friendly: 8/10 — excellent Executive Summary, quantifiable targets, clear differentiators
- Developer clarity: 9/10 — ADRs, test matrix, platform constraints, specific legacy files to remove
- Designer clarity: 7/10 — vivid journeys but no explicit screen inventory or flow diagram
- Stakeholder decision-making: 8/10 — measurable outcomes, phased plan, honest iOS constraints

**For LLMs:**
- Machine-readable structure: 9/10 — consistent headers, numbered requirements, YAML frontmatter
- UX readiness: 7/10 — journeys provide scenarios but lack wireframe-level screen specifications
- Architecture readiness: 9/10 — ADRs, platform requirements, deep link architecture, OIDC config
- Epic/Story readiness: 8/10 — well-categorized FRs with MVP/Growth/Vision phasing

**Dual Audience Score:** 4/5

#### BMAD PRD Principles Compliance

| Principle | Status | Notes |
|-----------|--------|-------|
| Information Density | Met | 2 minor violations only, exceptional density |
| Measurability | Partial | 23 violations (14 FR impl leakage, 9 NFR missing metrics) |
| Traceability | Met | 1 minor gap (BS3), all 31 FRs traced |
| Domain Awareness | Partial | 1 gap (native accessibility) |
| Zero Anti-Patterns | Met | Minimal filler, no vague quantifiers |
| Dual Audience | Met | Effective for both humans and LLMs |
| Markdown Format | Met | Clean, consistent formatting |

**Principles Met:** 5/7 (2 partial)

#### Overall Quality Rating

**Rating:** 4/5 - Strong with targeted improvements needed

#### Top 3 Improvements

1. **Fix NFR Measurability** — Add specific metrics, measurement methods, and context to all 9 NFRs. Every NFR should follow the template: "The system shall [metric] [condition] [measurement method]." NFR4 (error handling), NFR5 (recovery state), NFR6 (consistency), NFR7 (binary size "minimal") are the weakest.

2. **Strip Implementation Leakage from FRs** — Refactor 14 FRs to describe capabilities, not mechanisms. Remove platform API names (ASWebAuthenticationSession, Keychain, EncryptedSharedPreferences), OIDC endpoint paths (.well-known/openid-configuration, end_session_endpoint), and protocol terminology from FRs — these belong in ADRs/Platform sections which already document them.

3. **Add Native Accessibility Requirements** — Add an accessibility NFR requiring VoiceOver/TalkBack support for all auth screens, accessibility labels on interactive elements, minimum touch targets (44x44pt iOS / 48x48dp Android), and color-independent state indicators. This closes the domain compliance gap for a govtech product.

#### Summary

**This PRD is:** A well-crafted, coherent migration document with excellent narrative flow, strong traceability, and exemplary stakeholder communication — held back from excellence by systematic NFR measurability gaps and FR implementation leakage.

**To make it great:** Focus on the top 3 improvements above. A single focused editing pass on NFRs and FRs would elevate this to 5/5.

### Completeness Validation

#### Template Completeness

**Template Variables Found:** 0 — No template variables remaining ✓
**TODO/TBD/FIXME markers:** 0 ✓
**Document termination:** Warning — file ends abruptly after NFR9 with no closing section

#### Content Completeness by Section

**Executive Summary:** Complete ✓ — vision, problem statement, differentiators all present
**Success Criteria:** Complete ✓ — user, business, technical success + measurable outcomes table
**Product Scope:** Complete ✓ — MVP (15 items), Growth (6 items), Vision (5 items) with phased plan
**User Journeys:** Complete ✓ — 8 journeys, 3 user types, edge cases, requirements summary table
**Functional Requirements:** Complete ✓ — 31 FRs across 11 categories, proper format
**Non-Functional Requirements:** Complete (with warnings) ✓ — 9 NFRs across 4 categories

#### Section-Specific Completeness

**Success Criteria Measurability:** Some — 4/5 metrics quantified, test coverage lacks percentage target
**User Journeys Coverage:** Yes — covers end user (Maria), operator (Amadou); admin coverage partial (acceptable for scope)
**FRs Cover MVP Scope:** Yes — all 15 MVP capabilities have direct FR coverage
**NFRs Have Specific Criteria:** Some — 3/9 have metrics (NFR1-3), 0/9 have measurement methods

#### Frontmatter Completeness

**stepsCompleted:** Present ✓
**classification:** Present ✓ (domain, projectType, complexity)
**inputDocuments:** Present ✓ (7 documents)
**date:** Present ✓

**Frontmatter Completeness:** 4/4

#### Completeness Summary

**Overall Completeness:** 92% — all major sections complete, minor gaps in NFR specificity and document termination

**Critical Gaps:** 0
**Minor Gaps:** 3
1. Document ends abruptly after NFR9 — no closing section
2. 6 NFRs lack specific acceptance criteria and measurement methods
3. Test coverage metric in Measurable Outcomes lacks percentage target

**Severity:** Warning

**Recommendation:** The PRD is substantially complete. Address the 3 minor gaps: (1) add a brief closing/summary section, (2) strengthen NFR measurability (already flagged in step 5), (3) add a coverage percentage to the test coverage metric.
