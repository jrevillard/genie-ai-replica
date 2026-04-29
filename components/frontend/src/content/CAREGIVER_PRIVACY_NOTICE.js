/**
 * CAREGIVER_PRIVACY_NOTICE.js
 *
 * Single source of truth for the AMINA caregiver privacy notice
 * content. Imported by:
 *   - the registration wizard's privacy step  (Phase 3 + 4)
 *   - the standalone re-consent modal         (Phase 5)
 *   - the caregiver portal "View Privacy Notice" surface (Phase 6)
 *   - backend payload schema validation       (Phase 2 / 7 — version match)
 *
 * Pure content module — no React, no I/O. Safe to import from
 * anywhere (frontend, build tooling, eval scripts).
 *
 * ----------------------------------------------------------------
 * POLICY NOTES THAT SHAPE THE STRINGS BELOW (read before editing):
 *
 *   1. Age policy — AMINA does NOT impose a blanket age limit on
 *      receiving health education, public-health guidance, or
 *      emergency support. The age thresholds that DO appear refer
 *      ONLY to self-managed personal health records and self-consent
 *      to data processing. See `MINOR_HANDLING_POLICY` below.
 *      This is AMINA's conservative pending-legal-review policy and
 *      is NOT a claim about a confirmed Gambian social-media age.
 *
 *   2. Legal references cite The Gambia's Personal Data Protection
 *      and Privacy Act, 2025. Specific Article numbers are
 *      intentionally NOT inlined.
 *      // TODO: Confirm exact Article references with MOH legal counsel
 *
 *   3. Mandinka summary is drafted from the implementation spec and
 *      has NOT been native-speaker reviewed.
 *      // TODO: Mandinka native-speaker review before pilot
 *
 *   4. Cross-border processing is acknowledged in CROSS_BORDER_NOTICE.
 *      // TODO: Verify cross-border consent requirements with MOH legal
 *
 *   5. Consent withdrawal: the wording is final in Phase 1; the
 *      *withdrawal UI surface* in the caregiver portal lands in a
 *      later phase. The text already promises the user this exists.
 *
 *   6. Test fixtures use obviously-synthetic identities ONLY
 *      (Fatou Example, Lamin Testcase). No real +220 numbers, no
 *      real village/person combinations.
 * ----------------------------------------------------------------
 */

// Bumped whenever the substance of the notice changes. The wizard
// stores this version in CaregiverConsentRecord; the portal gates
// access on a match against this constant.
export const CAREGIVER_PRIVACY_NOTICE_VERSION = "1.0";


// ── Withdrawal text (verbatim per Phase 1 decisions) ─────────────────
//
// Required wording on every consent screen. The withdrawal SURFACE
// (a button in caregiver portal) is built in a later phase — but the
// text must be present from day 1 because the user is being asked to
// accept now.
export const CONSENT_WITHDRAWAL_NOTICE =
  "You may withdraw consent at any time through your AMINA settings. " +
  "Withdrawal does not affect processing carried out before withdrawal.";


// ── Cross-border processing notice ───────────────────────────────────
//
// AMINA's LLM cascade includes providers hosted outside The Gambia
// (OpenAI, Groq, Gemini, Mistral cloud). PHI de-identification runs
// before any external request — see haystack-stack/haystack-chatqna/
// src/services/phi_deid.py. This notice tells caregivers what crosses
// the border and what does not.
//
// TODO: Verify cross-border consent requirements with MOH legal counsel
export const CROSS_BORDER_NOTICE = [
  "Some AMINA features rely on services hosted outside The Gambia",
  "(for example, large-language-model providers and voice transcription).",
  "Before any request leaves The Gambia, AMINA strips personally-",
  "identifiable information — patient or caregiver name, phone number,",
  "national identification number, exact location — and sends only",
  "the minimum text needed to answer the question. We do NOT share",
  "your identity, the patient's identity, or full conversation",
  "history with external services.",
].join(" ");


// ── Minor-handling policy (encoded as data so the wizard + tests can
//    branch on it without re-parsing free-text). ──────────────────────
//
// Data minimization for under-13 workflows follows Gambia PDPA 2025
// principles + ECOWAS Supplementary Act on Personal Data Protection.
//
// IMPORTANT: AMINA imposes NO age limit on receiving health education
// or emergency support. The thresholds below apply only to
// SELF-MANAGED accounts and SELF-CONSENT to data processing.
//
// TODO: Confirm wording with MOH legal counsel before pilot.
export const MINOR_HANDLING_POLICY = {
  // null = no general age limit on receiving health support.
  general_health_support_minimum_age: null,

  // Direct patient-facing account use + self-managed personal health
  // records.
  self_managed_account_minimum_age: 13,

  // Unaccompanied self-consent. Below this, an approved adult
  // (parent, guardian, caregiver, Scout, CHW, clinician, or
  // authorised health worker) must consent on the user's behalf.
  unaccompanied_self_consent_minimum_age: 18,

  policy_summary: [
    "AMINA imposes NO blanket age limit on receiving basic health",
    "education, public-health guidance, emergency guidance, or",
    "caregiver/CHW-mediated support. The thresholds below refer ONLY",
    "to self-managed personal health records and self-consent to data",
    "processing.",
    "",
    "- Self-managed accounts and self-managed personal health",
    "  records: intended for users 13 and older.",
    "- Users under 18 may use AMINA for personal health-data",
    "  workflows only with parent/guardian/caregiver consent or",
    "  through an approved Caregiver, Scout, CHW, clinician, or",
    "  authorised health-worker workflow.",
    "- Users under 13 may NOT self-register, self-consent, or",
    "  directly manage their own personal health record. An",
    "  approved adult (parent, guardian, caregiver, Scout, CHW,",
    "  clinician, or authorised health worker) creates and manages",
    "  the record on their behalf.",
    "- Emergency or public-health support is never blocked by age.",
    "  AMINA collects the minimum data needed and escalates to an",
    "  adult, caregiver, or health worker where appropriate.",
    "",
    "This is AMINA's conservative child-data and health-record",
    "privacy policy, pending Gambian legal review.",
  ].join("\n"),

  // Data minimization per Gambia PDPA 2025 / ECOWAS principles.
  // Under-13 workflows collect ONLY these fields:
  data_minimization_under_13_collect: [
    "name or alias",
    "age range (NOT exact date of birth)",
    "guardian contact",
    "role (e.g. patient, scout participant)",
    "village name (NOT GPS or street-level address)",
  ],
  // ...and explicitly do NOT collect these:
  data_minimization_under_13_exclude: [
    "personal phone number",
    "national identification number (NIN)",
    "exact date of birth",
    "GPS / street-level location",
    "biometric identifiers",
  ],
};


// ── Main caregiver notice ────────────────────────────────────────────
export const CAREGIVER_PRIVACY_NOTICE = {
  version:        CAREGIVER_PRIVACY_NOTICE_VERSION,
  effective_date: "2026-04-01",
  jurisdiction:   "The Gambia",

  title: "AMINA Caregiver Privacy Notice & Data Responsibility Agreement",

  governing_law: [
    // TODO: Confirm exact Article references with MOH legal counsel
    "Personal Data Protection and Privacy Act, 2025 (The Gambia)",
    "Constitution of The Republic of The Gambia, Section 23",
    "ECOWAS Supplementary Act on Personal Data Protection",
  ],

  // Required notices that travel with the body of the notice.
  withdrawal_notice:     CONSENT_WITHDRAWAL_NOTICE,
  cross_border_notice:   CROSS_BORDER_NOTICE,
  minor_handling_policy: MINOR_HANDLING_POLICY,

  sections: [
    {
      id: "what_you_access",
      title: "What Patient Information You Will Access",
      content: `As a caregiver on AMINA, you may be granted access to patient
health information including:

• Vital readings (blood pressure, blood sugar, weight)
• Care plans and dietary recommendations
• Medication reminders and adherence data
• Referral records and follow-up schedules
• Health alerts and emergency notifications

You will NOT have access to:
• The patient's full conversation history with AMINA
• Other patients' data (only patients linked to you)
• The patient's login credentials or PIN
• Data from patients who have not approved you`,
    },
    {
      id: "your_responsibilities",
      title: "Your Responsibilities",
      content: `By accepting this agreement, you commit to:

1. CONFIDENTIALITY: Keep all patient health information strictly
   private. Do not share it with anyone — not family members who
   are not approved caregivers, not neighbours, not community
   leaders — unless the patient has specifically authorised it
   or there is an immediate life-threatening emergency.

2. SECURITY: If you access AMINA on a shared phone, log out
   after every use. Do not leave health information visible on
   screen. Do not screenshot patient data. Do not write down
   readings where others can find them.

3. PURPOSE LIMITATION: Use patient information ONLY to help them
   manage their health. Never use it for gossip, family disputes,
   marriage negotiations, inheritance decisions, workplace
   decisions, or any non-health purpose.

4. REPORT BREACHES: If you believe patient data has been seen by
   unauthorised people — whether through your actions or
   otherwise — report it immediately through AMINA or to the
   MOH ICT Unit.

5. RESPECT WITHDRAWAL: If a patient removes you as caregiver,
   your access stops immediately. You must delete any health
   information you saved outside AMINA (notes, photos, forwarded
   messages, written records).`,
    },
    {
      id: "prohibited_actions",
      title: "What You Must Never Do",
      content: `• Share screenshots of patient health data with anyone
• Forward AMINA messages about a patient to anyone
• Discuss a patient's health conditions in public spaces
  (Bantaba, market, mosque, naming ceremonies, social media)
• Use health information to pressure or control a patient
• Access a patient's data after being removed as their caregiver
• Attempt to view data of patients not linked to you
• Share your AMINA login credentials with anyone else`,
    },
    {
      id: "consequences",
      title: "Consequences of Violation",
      content: `If you violate this agreement:

1. Your caregiver access will be immediately revoked.
2. The affected patient(s) will be notified.
3. The incident will be reported to the MOH Data Protection Officer.
4. Depending on severity, you may face:
   - Permanent ban from the AMINA caregiver system.
   - Report to The Gambia Data Protection Commission.
   - Legal action under the Personal Data Protection and
     Privacy Act, 2025.
   - If you are a registered health professional (VHW, CHN),
     report to your professional regulatory council.

Intentional misuse causing harm to a patient may result in
criminal penalties under Gambian law.`,
    },
    {
      id: "your_own_data",
      title: "How We Handle Your Data as a Caregiver",
      content: `AMINA also collects and stores information about you:

• Your name, phone number, village, and health region
• Your role and professional credentials
• Your activity log (when you accessed patient data, what you viewed)
• Your login history and device information

This information is used to:
• Verify your identity and authorisation
• Maintain an audit trail of all data access (required by law)
• Detect and investigate unauthorised access patterns
• Contact you about policy updates and account status

Your caregiver data is protected by the same encryption and access
controls as patient data. You have the same rights to access,
correct, and delete your own personal information.

CROSS-BORDER PROCESSING:
${CROSS_BORDER_NOTICE}

CONSENT WITHDRAWAL:
${CONSENT_WITHDRAWAL_NOTICE}

CHILDREN AND MINORS:
${MINOR_HANDLING_POLICY.policy_summary}`,
    },
    {
      id: "role_specific",
      title: "Additional Obligations by Role",
      // The wizard renders ONLY the entry matching the role chosen
      // in Step 1. Other entries are not shown to that user.
      role_content: {
        vhw:
          "As a Village Health Worker, you are additionally bound by " +
          "the ethical standards of your MoH training and the oversight " +
          "of your supervising Community Health Nurse.",
        cbc:
          "As a Community Birth Companion, you handle sensitive maternal " +
          "health information. Extra discretion is required regarding " +
          "pregnancy status and birth outcomes.",
        chn:
          "As a Community Health Nurse, you are bound by the Gambia " +
          "Nursing and Midwifery Council professional code of conduct " +
          "regarding patient confidentiality.",
        tba:
          "As a Traditional Birth Attendant, you handle sensitive " +
          "maternal health information. This agreement applies " +
          "alongside your existing community trust obligations.",
        family:
          "As a family caregiver, you are trusted by your family " +
          "member to protect their health information. This trust " +
          "carries legal weight under Gambian law.",
        scout:
          "As a Youth Health Scout, you may see health numbers like " +
          "blood pressure when helping elders. This is private " +
          "information. Do not share it with friends, at school, or " +
          "on social media. If you are under 18, your parent or " +
          "guardian must also consent before your account can be " +
          "activated. If you are under 13, the Scout role is opened " +
          "for you by an approved adult and managed jointly with " +
          "them — see AMINA's child-data policy for details.",
        alkalo:
          "As Alkalo, you receive only aggregate village health " +
          "statistics, not individual patient data. You must not " +
          "request or attempt to access individual patient records.",
      },
    },
  ],

  // Five required acknowledgments. ALL must be checked before the
  // wizard's Next becomes active. Order matters — the wizard renders
  // them in this order.
  consent_checkboxes: [
    {
      id: "understand_confidential",
      text:
        "I understand that patient health information I access through " +
        "AMINA is CONFIDENTIAL and protected by Gambian law.",
      required: true,
    },
    {
      id: "accept_responsibility",
      text:
        "I accept FULL RESPONSIBILITY for protecting patient data " +
        "while I have access to it, including securing my device and " +
        "never sharing information with unauthorised persons.",
      required: true,
    },
    {
      id: "understand_consequences",
      text:
        "I understand that violating this agreement may result in " +
        "loss of access, reporting to the Data Protection Commission, " +
        "and potential legal consequences under The Gambia's Personal " +
        "Data Protection and Privacy Act, 2025.",
      required: true,
    },
    {
      id: "agree_delete_on_removal",
      text:
        "I agree to immediately delete any patient health information " +
        "I have saved outside of AMINA if a patient removes me as " +
        "their caregiver or if my access is revoked.",
      required: true,
    },
    {
      id: "acknowledge_audit",
      text:
        "I understand that all my access to patient data is logged " +
        "and auditable, and that unusual access patterns will be " +
        "flagged for review.",
      required: true,
    },
  ],

  // Drafted from the Phase 1 implementation spec. Renders alongside
  // (not in place of) the English text when the user toggles
  // "Read in Mandinka / Mandinka la karaŋ" in the wizard.
  // TODO: Mandinka native-speaker review before pilot
  mandinka_summary: `I la diilaakao kunnafoni lakanoo:

Moo la kendeyaa kunnafoniolu — a mu gundoo le ti.
Kana a fo moo woo moo ye — kana bantabaa to, kana lumo to,
kana misidaa to, kana sosiyaal miidiyaa to.

Ni i ye AMINA siitoo telefonoo la miŋ moolu be a kee,
i ka looku awti bii bee.

Ni paasiyeŋ ye i boo diilaakao la,
i la siloo be dartoo joona. I ka kunnafoniolu bee boo
miŋ i ye a lakabendi AMINA kono kono.

Ni i ye nin kaaŋaandoo nafalaa — i la siloo be boolaa,
a be foo Data Protection Commission ye,
sariyaa fanaŋ be ke i la.`,
};


// ── Scout simplified version ─────────────────────────────────────────
//
// Rendered IN PLACE of the full caregiver notice when the role chosen
// in Step 1 is `scout`. Designed for younger / lower-literacy readers.
// Under-18 scouts must additionally have a guardian acknowledgment;
// the wizard injects that block (Phase 4).
//
// Under-13 scouts: the Scout role is opened on the user's behalf by
// an approved adult (CHW / parent / guardian) per
// MINOR_HANDLING_POLICY; the under-13 user does NOT self-register.
export const SCOUT_PRIVACY_NOTICE = {
  version:        CAREGIVER_PRIVACY_NOTICE_VERSION,
  effective_date: "2026-04-01",
  jurisdiction:   "The Gambia",
  title:          "Youth Scout Data Promise",

  // Same governing law and notices as the main caregiver notice.
  governing_law:         CAREGIVER_PRIVACY_NOTICE.governing_law,
  withdrawal_notice:     CONSENT_WITHDRAWAL_NOTICE,
  cross_border_notice:   CROSS_BORDER_NOTICE,
  minor_handling_policy: MINOR_HANDLING_POLICY,

  content: `You are helping elders with their health — that is an
important job. When you check someone's blood pressure or blood
sugar, those numbers are PRIVATE.

Your promise:
• I will NOT tell my friends anyone's health numbers.
• I will NOT post health information on social media.
• I will NOT discuss anyone's health at school.
• I will tell an adult if I think someone's health data
  was shared by accident.

If you break this promise, you will lose your Scout status
and your badges.

You may withdraw your participation at any time through your
AMINA settings. Stopping does not change anything you helped
with before stopping.

Some AMINA features use computers outside The Gambia. AMINA
removes names and phone numbers before sending anything outside.`,

  consent_text:
    "I promise to keep all health information private.",

  guardian_consent_text:
    "I confirm that my child or ward understands their " +
    "responsibility to keep patient health information private as " +
    "a Youth Health Scout.",

  // Drafted from the Phase 1 implementation spec.
  // TODO: Mandinka native-speaker review before pilot
  mandinka_summary:
    "Moo la kendeyaa kunnafoniolu mu gundoo le ti. " +
    "Kana a fo i la teeroo ye, kana sosiyaal miidiyaa to.",
};


// ── Synthetic test fixtures ──────────────────────────────────────────
//
// Used by Phase 3-7 tests. NEVER use real names, real +220 phone
// numbers, or real village/person combinations. The names below are
// intentionally obvious test placeholders.
export const SYNTHETIC_FIXTURES = {
  caregiver: {
    name:      "Fatou Example",
    phone:     "+000-555-FAKE-01",
    village:   "Test Village (synthetic)",
    region:    "Greater Banjul",
    role:      "vhw",
    languages: ["English", "Mandinka"],
  },
  scout_under_18: {
    name:           "Lamin Testcase",
    age_range:      "14-17",
    guardian_name:  "Awa Example (guardian)",
    guardian_phone: "+000-555-FAKE-02",
    village:        "Test Village (synthetic)",
    role:           "scout",
  },
  scout_under_13: {
    // Per MINOR_HANDLING_POLICY: under-13 scouts do NOT self-register.
    // This fixture represents the record an approved adult would
    // create on their behalf.
    name_or_alias:        "Scout Testchild",
    age_range:            "10-12",
    guardian_name:        "Adam Example (guardian)",
    guardian_phone:       "+000-555-FAKE-03",
    village:              "Test Village (synthetic)",
    opened_by_adult_role: "chw",
  },
};


// ── Default export: the main caregiver notice ────────────────────────
// Convenience for the most common import. Named exports above are
// authoritative.
export default CAREGIVER_PRIVACY_NOTICE;
