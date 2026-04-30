/**
 * CaregiverPrivacyStepper — guided 6-step caregiver privacy notice flow.
 * =====================================================================
 *
 * AMINA caregiver app · The Gambia · Personal Data Protection and
 * Privacy Act, 2025.
 *
 * Modes:
 *   - readOnly={true}   → 5-step viewer (the user reads, no signature,
 *                          no POST). Used by the caregiver portal's
 *                          "View Privacy Notice" entry.
 *   - readOnly={false}  → full 6-step flow ending in a signature ack
 *                          step that POSTs to
 *                          /api/v1/caregiver/privacy/consent. Reserved
 *                          for future migration of the Phase 4 signup
 *                          wizard / Phase 5 re-consent modal — not
 *                          wired in this turn.
 *
 * Production defaults (hard-coded, no tweak-panel surface):
 *   theme   = "dark"
 *   accent  = "baobab"
 *   density = "comfortable"
 *   font    = sans for UI, serif for display titles
 *   progress strip visible
 *
 * Accent classes (.accent-terracotta / -indigo / -baobab / -ochre)
 * are kept available in the CSS so per-region brand switches stay
 * trivial.
 *
 * Content source of truth (THIS turn): NOTICE constant below, copied
 * verbatim from the design spec. The Mandinka strings are
 * placeholders flagged for native-speaker review before launch — do
 * NOT generate or edit them.
 *
 * Privacy posture:
 *   - No console.log of signature, name input, token, or PHI.
 *   - Analytics events emit through `_analytics()` which today
 *     defaults to `console.debug` with a stable shape; replace with
 *     a real sink when one lands.
 *   - The reference number rendered on the "done" view is the
 *     backend's `record_id` (signing mode); read-only mode never
 *     reaches that view.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import "./CaregiverPrivacyStepper.css";


// ── Operator-configurable law-source URLs ──────────────────────────
//
// Phase 9 v3 follow-up — make the three law chips on Step 02
// (Governing law) clickable so a caregiver can review the full
// official text of each cited law. URLs are deliberately left empty
// in this build because they must be verified by the legal team
// before the pilot ships:
//
//   - Personal Data Protection and Privacy Act, 2025 (The Gambia)
//   - Constitution of The Republic of The Gambia, Section 23
//   - ECOWAS Supplementary Act on Personal Data Protection
//
// To enable clickability, paste the verified canonical URLs here OR
// override at runtime by setting `window.AMINA_LAW_SOURCE_URLS = {…}`
// before this module loads (e.g. from index.html). When an entry is
// non-empty it becomes a real <a target="_blank" rel="noopener
// noreferrer"> link with an external-link icon; when empty the chip
// renders as plain text with a small "Source URL pending operator
// config" hint and is not clickable.
//
// The keys are matched against `id` on each law block in NOTICE.
const LAW_SOURCE_URLS_DEFAULT = {
  gambia_dpa_2025:     "",
  gambia_constitution: "",
  ecowas_pdp_act:      "",
};

function _resolveLawUrl(id) {
  if (!id) return "";
  try {
    if (typeof window !== "undefined" && window.AMINA_LAW_SOURCE_URLS) {
      const v = window.AMINA_LAW_SOURCE_URLS[id];
      if (typeof v === "string" && v.trim().length > 0) return v.trim();
    }
  } catch { /* noop */ }
  const v = LAW_SOURCE_URLS_DEFAULT[id];
  return (typeof v === "string" && v.trim().length > 0) ? v.trim() : "";
}


// ── Content (verbatim from design spec; Mandinka = PLACEHOLDER) ─────
const NOTICE = {
  meta: {
    title: {
      en:  "Caregiver Privacy Notice & Data Responsibility",
      mnk: "Topatoolaa la Sutuyaa Kibaaroo & Kuwo Lafita",
    },
    // Phase 9 v4 — bumped 1.0 → 1.1 for the explicit no-sale /
    // no-unauthorized-disclosure clause + 6th acknowledgement.
    // TODO: confirm v1.1 effective date with MOH legal counsel before pilot.
    version:      "1.1",
    effective:    "2026-05-01",
    jurisdiction: "The Gambia",
  },
  steps: [
    {
      id: "scope",
      label: { en: "Scope & age", mnk: "Naatoo & Sanji" },
      icon:  "scope",
      title: { en: "Who this applies to", mnk: "Jumaa la kuu mu" },
      body:  {
        en: [
          { kind: "rule", text: "Users under 18 may use AMINA for personal health-data workflows only with parent, guardian, or caregiver consent — or through an approved Caregiver, Scout, CHW, clinician, or authorised health-worker workflow." },
          { kind: "rule", text: "Users under 13 may NOT self-register, self-consent, or directly manage their own personal health record. An approved adult creates and manages the record on their behalf." },
          { kind: "rule", text: "Emergency or public-health support is never blocked by age. AMINA collects the minimum data needed and escalates to an adult, caregiver, or health worker where appropriate." },
          { kind: "note", text: "This is AMINA's conservative child-data and health-record privacy policy, pending Gambian legal review." },
        ],
        mnk: [
          { kind: "rule", text: "Moolu mennu sanjoo dasata 18 ti, wolu si AMINA taa noo le ñaameŋ ka a fo ka bo wuluulaa, topatoolaa, walaa CHW dookuulaa la sookoo le kaŋ." },
          { kind: "rule", text: "Moolu mennu sanjoo dasata 13 ti, wolu te ì faŋo too safee noo, sako ì faŋo lafoo dii fanaa. Moo baa kiliŋ ne ñanta wo kuwolu topatoo la." },
          { kind: "rule", text: "Maakoyiroo te bali la moo la sanji kaŋ. AMINA ka kibaaroo dantanmaalu doroŋ ne taa." },
          { kind: "note", text: "Ñiŋ mu AMINA la sutuyaa kuwo le ti, m̀ be lulaa la Gambia tiŋ-tiŋ-tiyolu kotobola le kunna." },
        ],
      },
    },
    {
      id: "law",
      label: { en: "Governing law", mnk: "Tiŋ-tiŋ-tiyo" },
      icon:  "law",
      title: { en: "What law governs this notice", mnk: "Tiŋ-tiŋ-tiyo meŋ ka ñiŋ mara" },
      body:  {
        en: [
          { kind: "law", id: "gambia_dpa_2025",     text: "Personal Data Protection and Privacy Act, 2025 (The Gambia)" },
          { kind: "law", id: "gambia_constitution", text: "Constitution of The Republic of The Gambia, Section 23" },
          { kind: "law", id: "ecowas_pdp_act",      text: "ECOWAS Supplementary Act on Personal Data Protection" },
        ],
        mnk: [
          { kind: "law", id: "gambia_dpa_2025",     text: "Personal Data Protection and Privacy Act, 2025 (Gambia)" },
          { kind: "law", id: "gambia_constitution", text: "Gambia Bankoo la Tiŋ-tiŋ-tiyo, Karandaa 23" },
          { kind: "law", id: "ecowas_pdp_act",      text: "ECOWAS la Sutuyaa Kuwo Lafa-Lafaroo" },
        ],
      },
    },
    {
      id: "crossborder",
      label: { en: "Cross-border", mnk: "Banko Koteŋ" },
      icon:  "globe",
      highlight: "warning",
      title: { en: "When data leaves The Gambia", mnk: "Niŋ kibaaroo ka bo Gambia" },
      body:  {
        en: [
          { kind: "para", text: "Some AMINA features rely on services hosted outside The Gambia — for example, large-language-model providers and voice transcription." },
          { kind: "para", text: "Before any request leaves The Gambia, AMINA strips personally-identifiable information: patient or caregiver name, phone number, national identification number, and exact location." },
          { kind: "para", text: "We send only the minimum text needed to answer the question. We do NOT share your identity, the patient's identity, or full conversation history with external services." },
        ],
        mnk: [
          { kind: "para", text: "AMINA dookuu doolu ka bo banko koteŋ na — misaaloo, AI dookuulaalu ning kumakaŋ-safeerilaa." },
          { kind: "para", text: "Janniŋ feŋ-wo-feŋ ka bo Gambia, AMINA ka too, telefoŋ-nomboroo, ID nomboroo ning dulaa bondi a kono." },
          { kind: "para", text: "Ǹ ka safeeroo dantanmaa doroŋ ne kii. Ǹ buka i too, kuuranta-too, walaa diyaamoo bee dii." },
        ],
      },
    },
    {
      // Phase 9 v4 — explicit "no sale / no unauthorised disclosure"
      // step. Inserted between cross-border and withdraw so the
      // narrative reads: data leaves the country (warning) → here is
      // what you must NEVER do with it (warning) → here is how YOU
      // can control consent (positive). Wording is the spec's
      // verbatim text framed under "applicable Gambian law" — no
      // specific Article numbers inlined. The matching ack lives in
      // NOTICE.acks under id `acknowledge_no_unauthorized_disclosure`.
      // TODO: MOH/legal counsel review the exact enforcement language
      //       before pilot.
      id: "confidentiality",
      label: { en: "Confidentiality", mnk: "Sutuyaa Kuwo" },
      icon:  "shield",
      highlight: "warning",
      title: {
        en:  "No sale or unauthorised disclosure of patient information",
        mnk: "I kana saatewo too ke kuranta-too la",
      },
      body:  {
        en: [
          { kind: "rule", text: "Caregivers must not sell, trade, publish, screenshot, export, copy, retain, or share patient information from AMINA except for the patient's care and only when authorised." },
          { kind: "rule", text: "Unauthorised use or disclosure may result in immediate removal from AMINA caregiver access, notification to the patient or guardian, reporting to the relevant health authority or data-protection authority, and disciplinary, civil, or criminal consequences under applicable Gambian law." },
          { kind: "note", text: "This applies during your engagement with AMINA and after your access ends. Patient information you have already seen, copied, or retained outside AMINA stays subject to this obligation." },
        ],
        mnk: [
          { kind: "rule", text: "Topatoolaa kana kuuranta-too waafi, kana a dii moo wo moo la, kana a foto taa, kana a safee, kana a maabo. Niŋ a maŋ ke kuuranta la topatoo doroŋ na, a buka jaayi." },
          { kind: "rule", text: "Niŋ moo ye ñiŋ tiñaa, a si tara ke la a la AMINA semboo bondi la, kuuranta walaa a la moo baa ñinkali la, ka a kibaari kuuranta-kuwolu kuntiyolu walaa data tankandiroo kuntiyo ye, aniŋ kuluuroo si tara sotota Gambia tiŋ-tiŋ-tiyo kotobola." },
          { kind: "note", text: "Ñiŋ ka taa baŋ janniŋ i be AMINA dookuwo ke kaŋ, aniŋ niŋ i ye a baŋ. I ye meŋ feŋ-wo-feŋ ñaa la nuŋ, wo fanaa be ñiŋ luwaalu kotoo le." },
        ],
      },
    },
    {
      id: "withdraw",
      label: { en: "Your control", mnk: "I la Semboo" },
      icon:  "withdraw",
      highlight: "positive",
      title: { en: "You can withdraw consent at any time", mnk: "I si i la sookoo bondi noo waati-wo-waati" },
      body:  {
        en: [
          { kind: "para", text: "You may withdraw consent at any time through your AMINA settings." },
          { kind: "para", text: "Withdrawal does not affect processing carried out before the withdrawal." },
          { kind: "para", text: "After withdrawal, AMINA will retain only what Gambian law requires us to keep — for example, audit logs of access to patient records." },
        ],
        mnk: [
          { kind: "para", text: "I si i la sookoo bondi noo waati-wo-waati AMINA settings to." },
          { kind: "para", text: "I la sookoo bondoo te kuwolu mennu kewunta foloo wolu yelemandi la." },
          { kind: "para", text: "Niŋ i ye sookoo bondi, AMINA be kibaaroo doroŋ ne maabo la, Gambia tiŋ-tiŋ-tiyo ye meŋ kaniŋ." },
        ],
      },
    },
    {
      id: "minors",
      label: { en: "Children & minors", mnk: "Dindiŋolu" },
      icon:  "minors",
      highlight: "feature",
      title: { en: "Children and minors", mnk: "Dindiŋolu la kuwo" },
      body:  {
        en: [
          { kind: "para", text: "AMINA does not impose an age limit on receiving health support. Anyone in need can ask for help." },
          { kind: "para", text: "Self-managed accounts are intended for users aged 13 and over. Users under 18 require an approved adult, caregiver, or health-worker workflow." },
          { kind: "para", text: "Pending Gambian legal review, AMINA applies a conservative interpretation: when in doubt, escalate to an adult and minimise data collection." },
        ],
        mnk: [
          { kind: "para", text: "AMINA buka moo bali sanjoo kaŋ. Moo-wo-moo si maakoyiroo ñini noo." },
          { kind: "para", text: "Faŋ-tiyo la account, wo dadaata moolu le ye, mennu sanjoo siita 13 ma. 18 koto, moo baa ñanta nuŋ." },
          { kind: "para", text: "Ka tara lulaa la Gambia tiŋ-tiŋ-tiyo kotobola, AMINA ka taarinkaŋ doo le taa: niŋ sika sotota, a moo baa kili, kibaaroo dantanmaa taa." },
        ],
      },
    },
  ],
  // Acknowledgement ids match the backend's EXPECTED_CHECKBOX_IDS
  // tuple in caregiver_privacy_consent.py — that's the contract the
  // POST /api/v1/caregiver/privacy/consent route validates against.
  // Phase 9 v4 — added the 6th ack `acknowledge_no_unauthorized_disclosure`
  // alongside the v1.1 notice version bump. The order here mirrors
  // the order on the backend so an auditor reading both files sees
  // the same numbering.
  acks: [
    { id: "understand_confidential",   text: "I understand that patient health information I access through AMINA is CONFIDENTIAL and protected by Gambian law." },
    { id: "accept_responsibility",     text: "I accept FULL RESPONSIBILITY for protecting patient data while I have access to it, including securing my device and never sharing information with unauthorised persons." },
    { id: "understand_consequences",   text: "I understand that violating this agreement may result in loss of access, reporting to the Data Protection Commission, and potential legal consequences under The Gambia's Personal Data Protection and Privacy Act, 2025." },
    { id: "agree_delete_on_removal",   text: "I agree to immediately delete any patient health information I have saved outside of AMINA if a patient removes me as their caregiver or if my access is revoked." },
    { id: "acknowledge_audit",         text: "I understand that all my access to patient data is logged and auditable, and that unusual access patterns will be flagged for review." },
    { id: "acknowledge_no_unauthorized_disclosure", text: "I understand that I must not sell, trade, publish, screenshot, export, copy, retain, or share patient information for any unauthorised purpose, and that misuse may lead to removal of AMINA access, reporting to the relevant authority, and legal or disciplinary consequences under applicable Gambian law." },
  ],
};


// ── Inline-SVG icon dispatcher (ported from design spec) ────────────
function Icon({ name, size = 20, stroke = 1.6 }) {
  const p = {
    width: size, height: size, viewBox: "0 0 24 24",
    fill: "none", stroke: "currentColor", strokeWidth: stroke,
    strokeLinecap: "round", strokeLinejoin: "round",
    "aria-hidden": "true", focusable: "false",
  };
  switch (name) {
    case "scope":    return <svg {...p}><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" /></svg>;
    case "law":      return <svg {...p}><path d="M12 3v18M5 8h14M5 8l-2 7a4 4 0 0 0 8 0L9 8M19 8l-2 7a4 4 0 0 0 8 0L23 8" transform="translate(-2 0)" /></svg>;
    case "globe":    return <svg {...p}><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" /></svg>;
    case "withdraw": return <svg {...p}><path d="M9 12l2 2 4-4" /><circle cx="12" cy="12" r="9" /></svg>;
    case "minors":   return <svg {...p}><path d="M12 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" /><path d="M5 21v-1a5 5 0 0 1 5-5h4a5 5 0 0 1 5 5v1" /><path d="M17 8.5a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z" /></svg>;
    case "check":    return <svg {...p}><path d="M5 12l4 4 10-10" /></svg>;
    case "lock":     return <svg {...p}><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></svg>;
    case "shield":   return <svg {...p}><path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6l8-3Z" /></svg>;
    case "info":     return <svg {...p}><circle cx="12" cy="12" r="9" /><path d="M12 8v.01M12 11v5" /></svg>;
    case "arrowR":   return <svg {...p}><path d="M5 12h14M13 6l6 6-6 6" /></svg>;
    case "arrowL":   return <svg {...p}><path d="M19 12H5M11 18l-6-6 6-6" /></svg>;
    case "translate":return <svg {...p}><path d="M4 5h7M7.5 5v2M5 9c1.5 3 3.5 4 5 4M9 9c-1.5 3-3.5 4-5 4M13 19l4-10 4 10M14.5 16h5" /></svg>;
    case "x":        return <svg {...p}><path d="M6 6l12 12M18 6L6 18" /></svg>;
    case "doc":      return <svg {...p}><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5Z" /><path d="M14 3v5h5M9 13h6M9 17h6" /></svg>;
    case "clock":    return <svg {...p}><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>;
    case "external": return <svg {...p}><path d="M15 3h6v6M21 3l-9 9M10 5H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-5" /></svg>;
    default: return null;
  }
}


// ── Analytics helper ────────────────────────────────────────────────
// PHI-safe by construction: only emits the structured event names +
// step ids + dwell durations. Never the signature, name input, ack
// text, or backend payloads. Default sink is console.debug; swap in
// a real analytics SDK when one lands.
function _analytics(eventType, payload) {
  try {
    if (typeof window !== "undefined" && typeof window.aminaAnalytics === "function") {
      window.aminaAnalytics(eventType, payload);
      return;
    }
    console.debug("[amina.privacy]", eventType, payload || {});
  } catch { /* noop */ }
}


// ── Block renderer (rule / law / para / note) ───────────────────────
function Block({ block }) {
  if (block.kind === "rule") {
    return (
      <div className="aps-blk aps-blk-rule">
        <span className="aps-blk-bullet" aria-hidden="true" />
        {block.text}
      </div>
    );
  }
  if (block.kind === "law") {
    // Phase 9 v3 follow-up — clickable variant when an operator has
    // configured an official source URL for this law id. Otherwise
    // the chip stays as plain (non-clickable) text with a small
    // "Source URL pending" hint so caregivers know the link will
    // arrive later. Always opens in a new tab + uses noopener to
    // prevent the destination from gaining a window.opener handle
    // back to AMINA. The text content is identical between the two
    // variants — single source of truth.
    const url = block.id ? _resolveLawUrl(block.id) : "";
    if (url) {
      return (
        <a
          className="aps-blk aps-blk-law aps-blk-law-link"
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={`${block.text} (opens in a new tab)`}
        >
          <Icon name="doc" size={16} stroke={1.8} />
          <span className="aps-blk-law-text">{block.text}</span>
          <Icon name="external" size={13} stroke={1.8} />
        </a>
      );
    }
    return (
      <div className="aps-blk aps-blk-law" title="Source URL pending operator config">
        <Icon name="doc" size={16} stroke={1.8} />
        <span className="aps-blk-law-text">{block.text}</span>
        <span className="aps-blk-law-pending" aria-hidden="true">·  source pending</span>
      </div>
    );
  }
  if (block.kind === "para") {
    return <p className="aps-blk aps-blk-para">{block.text}</p>;
  }
  if (block.kind === "note") {
    return (
      <div className="aps-blk aps-blk-note">
        <Icon name="info" size={14} stroke={1.8} />
        <span>{block.text}</span>
      </div>
    );
  }
  return null;
}


// ── Stepper rail (sidebar) ──────────────────────────────────────────
function StepperRail({ steps, current, completed, onJump, lang }) {
  return (
    <ol className="aps-rail" role="list">
      {steps.map((s, i) => {
        const done   = completed.has(s.id);
        const active = i === current;
        const cls    = ["aps-rail-item"];
        if (active) cls.push("active");
        if (done)   cls.push("done");
        return (
          <li
            key={s.id}
            className={cls.join(" ")}
            role="button"
            tabIndex={0}
            aria-current={active ? "step" : undefined}
            onClick={() => onJump(i)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onJump(i);
              }
            }}
          >
            <div className="aps-rail-marker">
              {done
                ? <Icon name="check" size={14} stroke={2.2} />
                : <span>{String(i + 1).padStart(2, "0")}</span>}
            </div>
            <div className="aps-rail-text">
              <div className="aps-rail-label">{s.label[lang] || s.label.en}</div>
              <div className="aps-rail-sub">
                {done   ? (lang === "mnk" ? "A bee karanta" : "Read")
                 : active ? (lang === "mnk" ? "Saayiŋ"      : "In progress")
                 : "—"}
              </div>
            </div>
            {i < steps.length - 1 && <span className="aps-rail-line" aria-hidden="true" />}
          </li>
        );
      })}
    </ol>
  );
}


// ── One reading step (steps 1–5) ────────────────────────────────────
function StepView({
  step, lang, onLang, onAdvance, onBack,
  isFirst, isLast, idx, total, dwellOk, readOnly,
}) {
  const heroClass = step.highlight
    ? `aps-hero aps-hero-${step.highlight}`
    : "aps-hero";

  // Continue label changes for read-only (no ack step) vs signing flow.
  const continueLabel = isLast
    ? (readOnly
         ? (lang === "mnk" ? "Pareyaata" : "Finish review")
         : (lang === "mnk" ? "Sookoo to" : "Continue to acknowledgements"))
    : (lang === "mnk" ? "Ñaato" : "Continue");

  return (
    <article className="aps-step">
      <header className={heroClass}>
        <div className="aps-hero-top">
          <span className="aps-step-counter">
            {String(idx + 1).padStart(2, "0")}{" "}
            <span className="aps-muted">/ {String(total).padStart(2, "0")}</span>
          </span>
          <button
            type="button"
            className="aps-lang-toggle"
            onClick={() => onLang(lang === "en" ? "mnk" : "en")}
            aria-label={lang === "en" ? "Switch to Mandinka" : "Switch to English"}
          >
            <Icon name="translate" size={14} stroke={1.8} />
            <span>{lang === "en" ? "Mandinka" : "English"}</span>
          </button>
        </div>
        <div className="aps-hero-icon">
          <Icon name={step.icon} size={28} stroke={1.4} />
        </div>
        <h2 className="aps-step-title">
          {step.title[lang] || step.title.en}
        </h2>
        <div className="aps-step-tag">
          {step.label[lang] || step.label.en}
        </div>
      </header>

      <div className="aps-step-body">
        {(step.body[lang] || step.body.en).map((b, i) => (
          <Block key={i} block={b} />
        ))}
      </div>

      <footer className="aps-step-foot">
        <button
          type="button"
          className="aps-btn aps-btn-ghost"
          onClick={onBack}
          disabled={isFirst}
        >
          <Icon name="arrowL" size={16} stroke={2} />
          <span>{lang === "mnk" ? "Kooma" : "Back"}</span>
        </button>
        <div
          className="aps-dwell"
          role="status"
          aria-live="polite"
        >
          {dwellOk ? (
            <span className="aps-dwell-ok">
              <Icon name="check" size={14} stroke={2.2} />
              {lang === "mnk" ? "A karanta" : "Ready to continue"}
            </span>
          ) : (
            <span className="aps-dwell-wait">
              <Icon name="clock" size={14} stroke={1.8} />
              {lang === "mnk" ? "Karaŋ jee…" : "Take a moment to read"}
            </span>
          )}
        </div>
        <button
          type="button"
          className="aps-btn aps-btn-primary"
          onClick={(e) => {
            // Dwell extension only for click/tap (mouse / touch). Keyboard
            // Enter/Space falls through to the default click event but the
            // button onKeyDown override below short-circuits that to
            // bypass dwell — required for screen-reader users per a11y
            // spec.
            if (!dwellOk && e.detail !== 0) {
              // detail===0 → keyboard activation; detail>0 → mouse/touch
              return;
            }
            onAdvance();
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              onAdvance();
            }
          }}
          aria-disabled={!dwellOk}
        >
          <span>{continueLabel}</span>
          <Icon name="arrowR" size={16} stroke={2} />
        </button>
      </footer>
    </article>
  );
}


// ── Acknowledgement step (signing mode only) ────────────────────────
function AckStep({
  acks, checked, onCheck, name, onName, onSubmit, onBack, lang, busy, error,
  totalSteps,
}) {
  const allChecked = acks.every((a) => checked[a.id]);
  const nameOk     = (name || "").trim().length >= 2;
  const ready      = allChecked && nameOk && !busy;
  const remaining  = acks.filter((a) => !checked[a.id]).length;
  // Phase 9 v4 — counter now derives from totalSteps (reading steps
  // + 1 ack step) so adding a reading step doesn't require touching
  // this number. Fallback to "06 / 06" preserves the old shape if a
  // caller forgets to thread the prop.
  const totalLabel = String(totalSteps != null ? totalSteps : 6).padStart(2, "0");

  return (
    <article className="aps-step aps-ack-step">
      <header className="aps-hero aps-hero-final">
        <div className="aps-hero-top">
          <span className="aps-step-counter">
            {totalLabel} <span className="aps-muted">/ {totalLabel}</span>
          </span>
          <span className="aps-hero-required">
            {lang === "mnk" ? "A ñanta" : "Required"}
          </span>
        </div>
        <div className="aps-hero-icon">
          <Icon name="shield" size={28} stroke={1.4} />
        </div>
        <h2 className="aps-step-title">
          {lang === "mnk" ? "Sookoo dii" : "Your acknowledgements"}
        </h2>
        <p className="aps-hero-sub">
          {lang === "mnk"
            ? "Ñiŋ kuwolu bee ñanta tomboŋ na"
            : `All ${acks.length} must be checked. This is a binding agreement under Gambian law.`}
        </p>
      </header>

      <div className="aps-step-body">
        <ol className="aps-ack-list">
          {acks.map((a, i) => {
            const on = !!checked[a.id];
            return (
              <li
                key={a.id}
                className={on ? "aps-ack-item on" : "aps-ack-item"}
                role="checkbox"
                aria-checked={on}
                tabIndex={0}
                onClick={() => onCheck(a.id, !on)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onCheck(a.id, !on);
                  }
                }}
              >
                <div className="aps-ack-num" aria-hidden="true">{i + 1}</div>
                <div className="aps-ack-box" aria-hidden="true">
                  {on && <Icon name="check" size={14} stroke={2.6} />}
                </div>
                <div className="aps-ack-text">{a.text}</div>
              </li>
            );
          })}
        </ol>

        <div className="aps-signature">
          <label
            className="aps-sig-label"
            htmlFor="aps-sig-input"
          >
            {lang === "mnk" ? "I too safee jaŋ" : "Type your full legal name to sign"}
          </label>
          <input
            id="aps-sig-input"
            className="aps-sig-input"
            type="text"
            value={name}
            onChange={(e) => onName(e.target.value)}
            placeholder={lang === "mnk" ? "Misaaloo: Aminata Jallow" : "e.g. Aminata Jallow"}
            autoComplete="off"
            spellCheck={false}
            disabled={busy}
          />
          <div className="aps-sig-help">
            {lang === "mnk"
              ? "A ñanta ke la i too la le, hartoo te jee"
              : "Must match your registration name (case-insensitive)."}
          </div>
        </div>

        {error && (
          <div className="aps-ack-error" role="alert">
            {error}
          </div>
        )}
      </div>

      <footer className="aps-step-foot">
        <button
          type="button"
          className="aps-btn aps-btn-ghost"
          onClick={onBack}
          disabled={busy}
        >
          <Icon name="arrowL" size={16} stroke={2} />
          <span>{lang === "mnk" ? "Kooma" : "Back"}</span>
        </button>
        <div className="aps-dwell" role="status" aria-live="polite">
          {ready ? (
            <span className="aps-dwell-ok">
              <Icon name="check" size={14} stroke={2.2} />
              {lang === "mnk" ? "A pareeta" : "Ready to sign"}
            </span>
          ) : (
            <span className="aps-dwell-wait">
              {!allChecked
                ? `${remaining} ${remaining === 1 ? "acknowledgement remaining" : "acknowledgements remaining"}`
                : (lang === "mnk" ? "I too safee" : "Please type your name")}
            </span>
          )}
        </div>
        <button
          type="button"
          className="aps-btn aps-btn-primary"
          onClick={onSubmit}
          disabled={!ready}
        >
          <Icon name="lock" size={16} stroke={2} />
          <span>
            {busy
              ? (lang === "mnk" ? "A ka safee…" : "Signing…")
              : (lang === "mnk" ? "Sookoo dii" : "Sign & Continue")}
          </span>
        </button>
      </footer>
    </article>
  );
}


// ── Done state (signing mode only) ──────────────────────────────────
function DoneView({ onClose, lang, recordId, acceptedAt }) {
  return (
    <article className="aps-step aps-done-step">
      <div className="aps-done-icon">
        <Icon name="check" size={42} stroke={2.2} />
      </div>
      <h2 className="aps-done-title">
        {lang === "mnk" ? "I sookoota" : "Signed and recorded"}
      </h2>
      <p className="aps-done-sub">
        {lang === "mnk"
          ? "I la sookoo safeeta. I si tenteŋ AMINA dookuwo la."
          : "Your acknowledgement has been logged. You can return to your AMINA work."}
      </p>
      <div className="aps-done-meta">
        <div className="aps-dm">
          <span className="aps-dm-k">Reference</span>
          <span className="aps-dm-v">{recordId || "—"}</span>
        </div>
        <div className="aps-dm">
          <span className="aps-dm-k">Recorded</span>
          <span className="aps-dm-v">
            {acceptedAt
              ? new Date(acceptedAt).toLocaleString("en-GB", {
                  day: "2-digit", month: "short", year: "numeric",
                  hour: "2-digit", minute: "2-digit",
                })
              : "—"}
          </span>
        </div>
        <div className="aps-dm">
          <span className="aps-dm-k">Jurisdiction</span>
          <span className="aps-dm-v">The Gambia</span>
        </div>
      </div>
      <button type="button" className="aps-btn aps-btn-ghost" onClick={onClose}>
        {lang === "mnk" ? "Pareyaata" : "Close"}
      </button>
    </article>
  );
}


// ── Main component ──────────────────────────────────────────────────
export default function CaregiverPrivacyStepper({
  /** When true, hide the ack step + signature, show "Finish review"
   *  on step 5, and call `onClose` on finish. */
  readOnly = false,

  /** Always called when the user dismisses the modal. Required. */
  onClose,

  /** Required in signing mode. Bearer token used to POST consent. */
  authToken = "",

  /** Optional. Base URL for the consent endpoint. Defaults to "" (same origin). */
  apiBase = "",

  /** Optional. Callback fired after a successful POST. Receives the
   *  response body (record_id, accepted_at, etc.). Signing mode. */
  onSigned,

  /** Optional. Callback fired when the user picks "Remind me later"
   *  in signing mode. The container should flag the account for
   *  re-prompt on next session. */
  onRemindLater,

  /** Optional. Force a specific accent class. Defaults to baobab
   *  (production). Other options: terracotta, indigo, ochre. */
  accent = "baobab",
}) {
  const totalSteps   = NOTICE.steps.length;        // 5
  const finalIndex   = readOnly ? totalSteps - 1   // 4
                                : totalSteps;      // 5 (ack)

  const [stepIdx,    setStepIdx]    = useState(0);
  const [completed,  setCompleted]  = useState(() => new Set());
  const [acks,       setAcks]       = useState({});
  const [name,       setName]       = useState("");
  const [done,       setDone]       = useState(false);
  const [doneInfo,   setDoneInfo]   = useState({ recordId: "", acceptedAt: "" });
  const [lang,       setLang]       = useState("en");
  const [dwellTick,  setDwellTick]  = useState(0);
  const [busy,       setBusy]       = useState(false);
  const [error,      setError]      = useState("");

  const stepStartRef = useRef(Date.now());

  const isAckStep = !readOnly && stepIdx === totalSteps;
  const isDone    = done;

  // dwell timer — comfortable density = 4s.
  const dwellNeeded = 4;
  useEffect(() => {
    if (isAckStep || isDone) return undefined;
    setDwellTick(0);
    stepStartRef.current = Date.now();
    _analytics("privacy_step_viewed", {
      step_id: NOTICE.steps[stepIdx]?.id,
      idx:     stepIdx,
    });
    const t = setInterval(() => setDwellTick((x) => x + 1), 1000);
    return () => clearInterval(t);
  }, [stepIdx, isAckStep, isDone]);
  const dwellOk = dwellTick >= dwellNeeded;

  const advance = useCallback(() => {
    const cur = NOTICE.steps[stepIdx];
    if (cur) {
      setCompleted((prev) => {
        const next = new Set(prev);
        next.add(cur.id);
        return next;
      });
      _analytics("privacy_step_advanced", {
        step_id:        cur.id,
        idx:            stepIdx,
        dwell_seconds:  Math.round((Date.now() - stepStartRef.current) / 1000),
        lang,
      });
    }
    if (stepIdx < finalIndex) {
      setStepIdx(stepIdx + 1);
    } else {
      // readOnly path lands here on the last step's "Finish review".
      onClose && onClose();
    }
  }, [stepIdx, finalIndex, lang, onClose]);

  const back = useCallback(() => {
    if (stepIdx > 0) setStepIdx(stepIdx - 1);
  }, [stepIdx]);

  const jump = useCallback((i) => {
    setStepIdx(Math.max(0, Math.min(finalIndex, i)));
  }, [finalIndex]);

  const onLangChange = useCallback((next) => {
    setLang(next);
    _analytics("privacy_lang_switched", { lang: next });
  }, []);

  // ── Submit (signing mode only) ─────────────────────────────────────
  const submit = useCallback(async () => {
    if (readOnly) return;
    setBusy(true);
    setError("");
    try {
      const body = {
        notice_version: NOTICE.meta.version,
        consent_checkboxes: NOTICE.acks.reduce((m, a) => {
          m[a.id] = !!acks[a.id];
          return m;
        }, {}),
        digital_signature: (name || "").trim(),
        consent_timestamp: new Date().toISOString(),
        method: "app",
        scroll_completed: true,
        mandinka_viewed:  lang === "mnk",
      };
      const headers = { "Content-Type": "application/json" };
      if (authToken) headers["Authorization"] = `Bearer ${authToken}`;
      const resp = await fetch(
        `${apiBase}/api/v1/caregiver/privacy/consent`,
        { method: "POST", headers, body: JSON.stringify(body) },
      );
      if (!resp.ok) {
        // Surface a short, safe error. Never echo the response body
        // because the consent error shape may include `codes` arrays
        // that look noisy to a CHW.
        let msg = `Could not record acknowledgement (HTTP ${resp.status}).`;
        try {
          const j = await resp.json();
          if (j && j.detail && Array.isArray(j.detail.codes) && j.detail.codes.length) {
            msg = `Could not record acknowledgement: ${j.detail.codes.join(", ")}.`;
          }
        } catch { /* keep generic msg */ }
        throw new Error(msg);
      }
      const j = await resp.json();
      _analytics("privacy_acknowledged", {
        notice_version: NOTICE.meta.version,
        lang,
      });
      setDoneInfo({
        recordId:   j.record_id   || "",
        acceptedAt: j.accepted_at || new Date().toISOString(),
      });
      setDone(true);
      if (typeof onSigned === "function") {
        try { onSigned(j); } catch { /* never let a callback break UX */ }
      }
    } catch (e) {
      setError(e.message || "Could not record acknowledgement.");
    } finally {
      setBusy(false);
    }
  }, [readOnly, acks, name, lang, authToken, apiBase, onSigned]);

  const remindLater = useCallback(() => {
    try {
      if (typeof onRemindLater === "function") onRemindLater();
    } finally {
      onClose && onClose();
    }
  }, [onRemindLater, onClose]);

  // ── Progress percentage (rail header + strip) ──────────────────────
  const progressPct = useMemo(() => {
    const denom = readOnly ? totalSteps : (totalSteps + 1);
    const num   = completed.size + (isDone ? 1 : 0);
    return Math.round((num / denom) * 100);
  }, [completed, isDone, totalSteps, readOnly]);

  // ── Container className: theme + accent + density (production
  // defaults baked in; only `accent` is exposed as a prop). ──────────
  const containerClass = [
    "amina-privacy-stepper",
    "theme-dark",
    `accent-${accent}`,
    "density-comfortable",
    "font-serif",
  ].join(" ");

  const acksCheckedCount = useMemo(
    () => Object.values(acks).filter(Boolean).length,
    [acks],
  );

  return (
    <div
      className={containerClass}
      role="dialog"
      aria-modal="true"
      aria-label={NOTICE.meta.title.en}
    >
      <div className="aps-page">
        {/* Top bar */}
        <header className="aps-topbar">
          <div className="aps-brand">
            <div className="aps-brand-mark" aria-hidden="true">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
                <path d="M12 2L3 7v6c0 5 3.5 8.5 9 10 5.5-1.5 9-5 9-10V7l-9-5Z"
                      stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
                <path d="M8 12l3 3 5-6"
                      stroke="currentColor" strokeWidth="1.8"
                      strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
            <div className="aps-brand-text">
              <div className="aps-brand-name">AMINA</div>
              <div className="aps-brand-sub">Caregiver app</div>
            </div>
          </div>
          <div className="aps-topbar-meta">
            <div className="aps-meta-row">
              <span className="aps-meta-k">Version</span>
              <span className="aps-meta-v">{NOTICE.meta.version}</span>
            </div>
            <div className="aps-meta-row">
              <span className="aps-meta-k">Effective</span>
              <span className="aps-meta-v">{NOTICE.meta.effective}</span>
            </div>
            <div className="aps-meta-row">
              <span className="aps-meta-k">Jurisdiction</span>
              <span className="aps-meta-v">{NOTICE.meta.jurisdiction}</span>
            </div>
            <button
              type="button"
              className="aps-btn aps-btn-ghost aps-close-btn"
              onClick={onClose}
              aria-label="Close privacy notice"
            >
              <Icon name="x" size={14} stroke={2} />
              <span>Close</span>
            </button>
          </div>
        </header>

        {/* Progress strip */}
        <div className="aps-progress-strip">
          <div className="aps-progress-label">
            <span>{isDone ? "Complete" : `${progressPct}% reviewed`}</span>
            <span className="aps-muted">·</span>
            <span className="aps-muted">
              {NOTICE.meta.title[lang] || NOTICE.meta.title.en}
            </span>
          </div>
          <div className="aps-progress-bar">
            <div
              className="aps-progress-fill"
              style={{ width: `${progressPct}%` }}
              aria-hidden="true"
            />
          </div>
        </div>

        {/* Layout: rail + content */}
        <div className="aps-layout">
          <aside className="aps-sidebar" aria-label="Privacy review steps">
            <div className="aps-rail-head">
              <span className="aps-rail-eyebrow">Privacy review</span>
              <h1 className="aps-rail-title">
                {NOTICE.meta.title[lang] || NOTICE.meta.title.en}
              </h1>
            </div>

            <StepperRail
              steps={NOTICE.steps}
              current={stepIdx}
              completed={completed}
              onJump={jump}
              lang={lang}
            />

            {!readOnly && (
              <div
                className={[
                  "aps-rail-final",
                  isAckStep ? "active" : "",
                  isDone ? "done" : "",
                ].join(" ")}
                role="button"
                tabIndex={0}
                aria-current={isAckStep ? "step" : undefined}
                onClick={() => {
                  if (completed.size === totalSteps) setStepIdx(totalSteps);
                }}
                onKeyDown={(e) => {
                  if ((e.key === "Enter" || e.key === " ") &&
                      completed.size === totalSteps) {
                    e.preventDefault();
                    setStepIdx(totalSteps);
                  }
                }}
              >
                <div className="aps-rail-marker aps-rail-marker-final">
                  {isDone
                    ? <Icon name="check" size={14} stroke={2.2} />
                    : <Icon name="lock"  size={13} stroke={2}   />}
                </div>
                <div className="aps-rail-text">
                  <div className="aps-rail-label">
                    {lang === "mnk" ? "Sookoo dii" : "Sign & acknowledge"}
                  </div>
                  <div className="aps-rail-sub">
                    {isDone
                      ? (lang === "mnk" ? "A pareeta" : "Done")
                      : `${acksCheckedCount} / ${NOTICE.acks.length} checked`}
                  </div>
                </div>
              </div>
            )}

            <div className="aps-rail-help">
              <div className="aps-rail-help-title">
                <Icon name="info" size={14} stroke={1.8} />
                {readOnly
                  ? "Just reviewing?"
                  : "Need to come back later?"}
              </div>
              <p>
                {readOnly
                  ? "This view does not change your consent. Close any time."
                  : "Your account stays active. You can finish this review next time you open AMINA."}
              </p>
              {!readOnly && (
                <button
                  type="button"
                  className="aps-link-btn"
                  onClick={remindLater}
                >
                  Remind me later
                </button>
              )}
            </div>
          </aside>

          <main className="aps-main">
            {!isAckStep && !isDone && (
              <StepView
                step={NOTICE.steps[stepIdx]}
                lang={lang}
                onLang={onLangChange}
                onAdvance={advance}
                onBack={back}
                isFirst={stepIdx === 0}
                isLast={stepIdx === totalSteps - 1}
                idx={stepIdx}
                total={totalSteps}
                dwellOk={dwellOk}
                readOnly={readOnly}
              />
            )}
            {isAckStep && !isDone && (
              <AckStep
                acks={NOTICE.acks}
                checked={acks}
                onCheck={(id, v) =>
                  setAcks((prev) => ({ ...prev, [id]: v }))}
                name={name}
                onName={setName}
                onSubmit={submit}
                onBack={back}
                lang={lang}
                busy={busy}
                error={error}
                totalSteps={totalSteps + 1}
              />
            )}
            {isDone && (
              <DoneView
                onClose={onClose}
                lang={lang}
                recordId={doneInfo.recordId}
                acceptedAt={doneInfo.acceptedAt}
              />
            )}
          </main>
        </div>

        <footer className="aps-legal-foot">
          <span>AMINA · The Gambia</span>
          <span className="aps-muted">·</span>
          <span>Personal Data Protection and Privacy Act, 2025</span>
        </footer>
      </div>
    </div>
  );
}

// Re-export NOTICE so the container can render audit-relevant
// metadata (version etc.) without re-importing the design's
// content tree elsewhere.
export { NOTICE };
