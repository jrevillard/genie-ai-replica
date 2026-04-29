/**
 * AdminShell — the new admin console frame.
 * =============================================
 *
 * Renders a sidebar (6 sections), a topbar (search + cmd-K + role chip),
 * and a content pane that hosts either new admin widgets (Command
 * Center, Agent Lab, Patient 360) or the ORIGINAL existing panels
 * (Patients table, Consultations, DHIS2 sync/tracker, Literacy queue,
 * Transfers, etc.) completely unchanged — they slot into the section
 * that makes sense for each.
 *
 * Zero features removed. Every tab that used to exist is reachable.
 */

import { useMemo, useState } from "react";
import {
  Gauge, Users, ClipboardList, Cpu, Plug, Shield,
  Search, LogOut, Keyboard, Command, UserCircle, ExternalLink,
} from "lucide-react";

import "../styles/admin-tokens.css";
import { Button, Pill, Input, ToastHost } from "./primitives/index.jsx";
import CommandPalette, { usePaletteHotkeys } from "./CommandPalette.jsx";
import GovPortalModal from "./GovPortalModal.jsx";
import ConsentGate, {
  getStoredConsentId, verifyConsent, clearStoredConsent,
} from "./ConsentGate.jsx";

import CommandCenter  from "./sections/CommandCenter.jsx";
import PeopleSection  from "./sections/PeopleSection.jsx";
import CareSection    from "./sections/CareSection.jsx";
import AgentLab       from "./sections/AgentLab.jsx";
import Integrations   from "./sections/Integrations.jsx";
import Governance     from "./sections/Governance.jsx";


// ── Layout stylesheet (scoped to .amina-admin-scope) ─────────────

const SHELL_CSS = `
.amina-admin-scope {
  position: fixed; inset: 0;
  display: grid;
  grid-template-columns: 248px 1fr;
  grid-template-rows: 56px 1fr;
  grid-template-areas:
    "side topbar"
    "side main";
  background: #060814;
}
.amina-admin-scope .a-side {
  grid-area: side;
  border-right: 1px solid rgba(148, 163, 184, 0.12);
  background: linear-gradient(180deg, #0a0d1d 0%, #060814 100%);
  display: flex; flex-direction: column;
  overflow: hidden;
}
.amina-admin-scope .a-brand {
  display: flex; align-items: center; gap: 10px;
  padding: 18px 18px 16px;
  border-bottom: 1px solid rgba(148, 163, 184, 0.10);
}
.amina-admin-scope .a-brand-mark {
  width: 28px; height: 28px;
  border-radius: 8px;
  background:
    radial-gradient(circle at 30% 30%, rgba(255, 255, 255, 0.30), transparent 60%),
    linear-gradient(135deg, #6366f1, #4338ca);
  box-shadow: 0 0 14px rgba(99, 102, 241, 0.45);
  flex-shrink: 0;
}
.amina-admin-scope .a-brand-name {
  font-family: var(--a-font-disp), "Fraunces", serif;
  font-weight: 500;
  font-size: 16px;
  letter-spacing: 0.14em;
  color: #f1f5f9;
}
.amina-admin-scope .a-brand-sub {
  font-size: 10px;
  color: rgba(232, 237, 245, 0.42);
  letter-spacing: 0.22em;
  text-transform: uppercase;
  margin-left: auto;
  font-weight: 700;
}

.amina-admin-scope .a-nav {
  flex: 1;
  padding: 14px 12px;
  overflow: auto;
  display: flex; flex-direction: column;
  gap: 6px;                        /* clear space between buttons */
}

/* CRITICAL: reset any inherited button defaults + set explicit dark styling.
   Specificity chain beats global button resets. */
.amina-admin-scope button.a-nav-item,
.amina-admin-scope .a-nav-item {
  appearance: none !important;
  -webkit-appearance: none !important;
  display: flex !important;
  align-items: center;
  gap: 12px;
  width: 100%;
  padding: 11px 12px;
  border: 1px solid transparent;
  border-radius: 10px;
  background: transparent !important;
  color: rgba(232, 237, 245, 0.68);
  cursor: pointer;
  font-family: inherit;
  font-size: 13px;
  font-weight: 600;
  letter-spacing: 0.01em;
  text-align: left;
  position: relative;
  transition:
    background-color 160ms cubic-bezier(0.16, 1, 0.3, 1),
    border-color     160ms cubic-bezier(0.16, 1, 0.3, 1),
    color            160ms cubic-bezier(0.16, 1, 0.3, 1);
  outline: none;
  box-shadow: none;
}
.amina-admin-scope .a-nav-item:hover {
  background: rgba(148, 163, 184, 0.06) !important;
  border-color: rgba(148, 163, 184, 0.14);
  color: #f1f5f9;
}
.amina-admin-scope .a-nav-item:focus-visible {
  box-shadow: 0 0 0 2px rgba(34, 211, 238, 0.55), 0 0 16px rgba(34, 211, 238, 0.20);
}
.amina-admin-scope .a-nav-item[aria-current="true"] {
  background: linear-gradient(135deg,
    rgba(99, 102, 241, 0.22),
    rgba(79, 70, 229, 0.14)) !important;
  border-color: rgba(129, 140, 248, 0.35);
  color: #f1f5f9;
  box-shadow: 0 2px 8px rgba(79, 70, 229, 0.18);
}
.amina-admin-scope .a-nav-item[aria-current="true"]::before {
  content: "";
  position: absolute;
  left: -12px; top: 9px; bottom: 9px;
  width: 3px;
  background: #818cf8;
  border-radius: 2px;
  box-shadow: 0 0 8px rgba(129, 140, 248, 0.55);
}
.amina-admin-scope .a-nav-icon {
  display: inline-flex;
  align-items: center; justify-content: center;
  flex-shrink: 0;
  color: rgba(148, 163, 184, 0.75);
}
.amina-admin-scope .a-nav-item[aria-current="true"] .a-nav-icon {
  color: #a5b4fc;
}
.amina-admin-scope .a-nav-label {
  flex: 1;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.amina-admin-scope .a-nav-hint {
  margin-left: auto;
  flex-shrink: 0;
  font-family: "JetBrains Mono", ui-monospace, "SF Mono", Menlo, monospace;
  font-size: 10px;
  letter-spacing: 0.04em;
  color: rgba(148, 163, 184, 0.55);
  padding: 2px 6px;
  border-radius: 4px;
  background: rgba(255, 255, 255, 0.025);
  border: 1px solid rgba(148, 163, 184, 0.10);
}

.amina-admin-scope .a-side-foot {
  padding: 12px;
  border-top: 1px solid rgba(148, 163, 184, 0.10);
  display: flex; flex-direction: column; gap: 6px;
}

.amina-admin-scope .a-topbar {
  grid-area: topbar;
  display: flex; align-items: center; gap: 12px;
  padding: 0 18px;
  border-bottom: 1px solid var(--a-border-1);
  background: color-mix(in oklab, var(--a-bg), black 10%);
  z-index: var(--a-z-topbar);
}
.amina-admin-scope .a-topbar-search {
  flex: 0 1 420px;
}
.amina-admin-scope .a-topbar-spacer { flex: 1; }
.amina-admin-scope .a-topbar-chip {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 4px 10px;
  border-radius: var(--a-r-pill);
  background: var(--a-bg-inset);
  border: 1px solid var(--a-border-1);
  font-size: var(--a-text-11);
  font-weight: 700;
  letter-spacing: 0.14em;
  color: var(--a-fg-mute);
  text-transform: uppercase;
}
.amina-admin-scope .a-topbar-dot {
  width: 6px; height: 6px; border-radius: 50%;
  background: var(--a-success);
  box-shadow: 0 0 6px var(--a-success);
}

.amina-admin-scope .a-main {
  grid-area: main;
  overflow: auto;
  padding: 24px;
  position: relative;
}
.amina-admin-scope .a-section-head {
  display: flex; align-items: flex-end; justify-content: space-between;
  gap: 16px; margin-bottom: 20px;
}
.amina-admin-scope .a-section-title {
  font-family: var(--a-font-disp);
  font-variation-settings: "opsz" 144;
  font-weight: 500;
  font-size: var(--a-text-36);
  line-height: 1.02;
  letter-spacing: -0.02em;
  color: var(--a-fg);
  margin: 0;
}
.amina-admin-scope .a-section-sub {
  font-size: var(--a-text-13);
  color: var(--a-fg-mute);
  max-width: 60ch;
  margin-top: 4px;
}
.amina-admin-scope .a-section-actions {
  display: inline-flex; gap: 8px; flex-shrink: 0;
}
`;

if (typeof document !== "undefined" && !document.getElementById("amina-admin-shell-css")) {
  const s = document.createElement("style");
  s.id = "amina-admin-shell-css";
  s.textContent = SHELL_CSS;
  document.head.appendChild(s);
}


// ── The 6 sections ──────────────────────────────────────────────

const SECTIONS = [
  { id: "command",    label: "Command",      icon: Gauge,         hint: "gc",
    sub: "Live operations + agent + service health" },
  { id: "people",     label: "People",       icon: Users,         hint: "gp",
    sub: "Patients · CHW/caregivers · literacy verification · care transfers" },
  { id: "care",       label: "Care Records", icon: ClipboardList, hint: "gr",
    sub: "Consultations · community records · knowledge base" },
  { id: "agentlab",   label: "Agent Lab",    icon: Cpu,           hint: "ga",
    sub: "Model switch rates · safety flags · latency · training pipeline" },
  { id: "integrations", label: "Integrations", icon: Plug,        hint: "gi",
    sub: "DHIS2 sync + tracker · outbound channels" },
  { id: "governance", label: "Governance",   icon: Shield,        hint: "gg",
    sub: "Audit · RBAC · broadcast · cost + usage" },
];


// ── The Shell ────────────────────────────────────────────────────

export default function AdminShell({ token, onLogout, refreshStats }) {
  const [section, setSection] = useState("command");
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [govPortalOpen, setGovPortalOpen] = useState(false);
  const [consentGateOpen, setConsentGateOpen] = useState(false);
  const [consentVerified, setConsentVerified] = useState(false);
  const [search, setSearch] = useState("");

  // Open the gov portal — if no valid consent in this session, show
  // the ConsentGate first; only after acceptance does the GovPortalModal mount.
  const openGovPortal = async () => {
    if (consentVerified) {
      setGovPortalOpen(true);
      return;
    }
    const stored = getStoredConsentId();
    if (stored) {
      const ok = await verifyConsent(stored);
      if (ok) {
        setConsentVerified(true);
        setGovPortalOpen(true);
        return;
      }
      clearStoredConsent();
    }
    setConsentGateOpen(true);
  };

  // Commands registered with the palette
  const commands = useMemo(() => {
    const nav = SECTIONS.map((s) => ({
      id: `nav:${s.id}`, title: `Go to ${s.label}`, hint: s.hint,
      section: "Navigate", icon: s.icon, run: () => setSection(s.id),
    }));
    const actions = [
      { id: "action:gov-portal", title: "Open Government portal (MoH officer sign-in)",
        section: "Navigate", icon: ExternalLink, hint: "g v",
        run: () => openGovPortal() },
      { id: "action:logout", title: "Sign out", section: "Account",
        icon: LogOut, run: () => onLogout && onLogout() },
      { id: "action:shortcuts", title: "Show keyboard shortcuts", section: "Help",
        icon: Keyboard, run: () => alert("g c · Command\ng p · People\ng r · Care\ng a · Agent Lab\ng i · Integrations\ng g · Governance\ng v · Government portal\n⌘/Ctrl+K · Palette\n/ · Search") },
      { id: "action:refresh", title: "Refresh data", section: "Account",
        icon: Command, run: () => refreshStats && refreshStats() },
    ];
    return [...nav, ...actions];
  }, [onLogout, refreshStats]);

  // Hotkeys — ⌘K / Ctrl+K / "/" open palette; g+letter quick-nav
  usePaletteHotkeys(
    () => setPaletteOpen(true),
    {
      ...Object.fromEntries(SECTIONS.map((s) => [s.hint[1], () => setSection(s.id)])),
      v: () => openGovPortal(),   // g v → open Government portal
    }
  );

  const cur = SECTIONS.find((s) => s.id === section) || SECTIONS[0];

  // Props passed down to sections so they can render original panels
  const sectionProps = { token, search };

  return (
    <div className="amina-admin-scope">
      {/* Sidebar */}
      <aside className="a-side" aria-label="Primary navigation">
        <div className="a-brand">
          <div className="a-brand-mark" aria-hidden="true" />
          <div className="a-brand-name">AMINA</div>
          <div className="a-brand-sub">Admin</div>
        </div>
        <nav className="a-nav">
          {SECTIONS.map((s) => (
            <button
              key={s.id}
              aria-current={s.id === section}
              onClick={() => setSection(s.id)}
              className="a-nav-item"
              type="button"
            >
              <span className="a-nav-icon"><s.icon size={16} strokeWidth={s.id === section ? 2.4 : 1.9} /></span>
              <span className="a-nav-label">{s.label}</span>
              <span className="a-nav-hint">{s.hint}</span>
            </button>
          ))}
        </nav>
        <div className="a-side-foot">
          <Button variant="ghost" size="sm" leadIcon={Command}
                  onClick={() => setPaletteOpen(true)}
                  style={{ justifyContent: "flex-start" }}>
            <span style={{ flex: 1, textAlign: "left" }}>Quick actions</span>
            <span className="a-nav-hint" style={{ fontFamily: "var(--a-font-mono)" }}>⌘K</span>
          </Button>
          <Button variant="ghost" size="sm" leadIcon={LogOut} onClick={onLogout}
                  style={{ justifyContent: "flex-start" }}>
            Sign out
          </Button>
        </div>
      </aside>

      {/* Topbar */}
      <header className="a-topbar">
        <div className="a-topbar-search">
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={`Search in ${cur.label.toLowerCase()}… (press / to focus)`}
            leadIcon={Search}
            ariaLabel="Search"
          />
        </div>
        <div className="a-topbar-spacer" />
        <span className="a-topbar-chip">
          <span className="a-topbar-dot" aria-hidden="true" />
          <span>All systems</span>
        </span>
        <Pill leadIcon={UserCircle}>admin</Pill>
        <Button variant="secondary" size="sm" leadIcon={ExternalLink}
                onClick={() => openGovPortal()}>
          Government portal
        </Button>
      </header>

      {/* Main */}
      <main className="a-main" role="main">
        <div className="a-section-head">
          <div>
            <h1 className="a-section-title">{cur.label}</h1>
            <div className="a-section-sub">{cur.sub}</div>
          </div>
          <div className="a-section-actions">
            <Pill>{new Date().toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}</Pill>
          </div>
        </div>

        {section === "command"     && <CommandCenter  {...sectionProps} onNavigate={setSection} />}
        {section === "people"      && <PeopleSection  {...sectionProps} />}
        {section === "care"        && <CareSection    {...sectionProps} />}
        {section === "agentlab"    && <AgentLab       {...sectionProps} />}
        {section === "integrations" && <Integrations  {...sectionProps} />}
        {section === "governance"  && <Governance     {...sectionProps} />}
      </main>

      <CommandPalette
        open={paletteOpen}
        commands={commands}
        onClose={() => setPaletteOpen(false)}
      />
      <ConsentGate
        open={consentGateOpen}
        onAccept={() => {
          setConsentVerified(true);
          setConsentGateOpen(false);
          setGovPortalOpen(true);
        }}
        onCancel={() => setConsentGateOpen(false)}
        onShowDisclaimer={() => { window.location.hash = "#/disclaimer"; }}
      />
      <GovPortalModal
        open={govPortalOpen}
        onClose={() => setGovPortalOpen(false)}
      />
      <ToastHost />
    </div>
  );
}
