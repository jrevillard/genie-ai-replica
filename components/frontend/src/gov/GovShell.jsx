/**
 * GovShell — the National Health Observatory frame.
 *
 * Institutional daylight palette (paper-white with deep-navy shell).
 * One humanist sans for all text; monospace for tabular data —
 * no decorative serifs. Aggregate-only — no PII in any request or
 * response. Print-friendly. Scoped to .amina-gov-scope so the dark
 * admin shell does not bleed in.
 */

import { useMemo, useState } from "react";
import {
  BarChart3, Map, Activity, Target, Network, FileText,
  Command, LogOut, ShieldCheck, Lock, Printer, Clock,
  FileSignature,
} from "lucide-react";

import "../styles/admin-tokens.css";
import "../styles/gov-observatory.css";
import { signOutAdminAndGov } from "../auth/signOut.js";
import CommandPalette, { usePaletteHotkeys } from "../admin/CommandPalette.jsx";
import { ToastHost } from "../admin/primitives/index.jsx";
import { SyntheticBanner, SyntheticFooter } from "../admin/SyntheticIndicators.jsx";
import { useScreenshotReminder } from "../admin/DisclaimerPage.jsx";

import NationalPulse      from "./sections/NationalPulse.jsx";
import RegionalMap        from "./sections/RegionalMap.jsx";
import Surveillance       from "./sections/Surveillance.jsx";
import Indicators         from "./sections/Indicators.jsx";
import NetworkHealth      from "./sections/NetworkHealth.jsx";
import Reports            from "./sections/Reports.jsx";
import GovReportDocument  from "./GovReportDocument.jsx";


const SECTIONS = [
  { id: "national",     label: "National pulse", icon: BarChart3, hint: "gn",
    kicker: "Aggregate indicators",
    sub: "Month-to-date reach across every facility and CHW in the network. No personally identifying information is included in any view." },
  { id: "regional",     label: "Regions",        icon: Map,        hint: "gm",
    kicker: "Geographic distribution",
    sub: "Per-region coverage, density and consultation trends across The Gambia's seven administrative regions." },
  { id: "surveillance", label: "Surveillance",   icon: Activity,   hint: "gs",
    kicker: "Early-warning signals",
    sub: "Condition-level anomaly detection on an 8-week rolling baseline with 2σ threshold. Investigate before resource reallocation." },
  { id: "indicators",   label: "Indicators",     icon: Target,     hint: "gi",
    kicker: "WHO PEN · HEARTS · SDG3",
    sub: "Compliance against the WHO HEARTS technical package and Gambia NCD Strategy 2023-2027. Values firm up on the first of each month." },
  { id: "network",      label: "Network health", icon: Network,    hint: "gw",
    kicker: "CHW capacity & disparity",
    sub: "Certified CHW density, dropout risk and response-time variance by region. Shows where the field network needs support." },
  { id: "reports",      label: "Reports",        icon: FileText,   hint: "gr",
    kicker: "Monthly digest · agent replay",
    sub: "Printable monthly digest, natural-language query, and decision replay for any completed session. Aggregate-only throughout." },
];


function fmtNow() {
  return new Date().toLocaleString(undefined, {
    weekday: "short", day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit", hour12: false,
  });
}


export default function GovShell() {
  const [section, setSection] = useState("national");
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [period, setPeriod] = useState("mtd");

  // Polite screenshot reminder for synthetic-data labeling
  useScreenshotReminder();

  const commands = useMemo(() => {
    const nav = SECTIONS.map((s) => ({
      id: `nav:${s.id}`, title: `Go to ${s.label}`, hint: s.hint,
      section: "Navigate", icon: s.icon, run: () => setSection(s.id),
    }));
    const actions = [
      { id: "generate:report", title: "Generate signed summary report (PDF)", section: "Reports",
        icon: FileSignature, run: () => setReportOpen(true) },
      { id: "print:report", title: "Print current view", section: "Reports",
        icon: Printer, run: () => window.print() },
      { id: "switch:admin", title: "Switch to Platform Admin view", section: "Account",
        icon: Command, run: () => { window.location.hash = "#/admin"; } },
    ];
    return [...nav, ...actions];
  }, []);

  usePaletteHotkeys(
    () => setPaletteOpen(true),
    Object.fromEntries(SECTIONS.map((s) => [s.hint[1], () => setSection(s.id)]))
  );

  const cur = SECTIONS.find((s) => s.id === section) || SECTIONS[0];

  return (
    <div className="amina-gov-scope">
      <SyntheticBanner />
      {/* ── Sidebar ────────────────────────────────── */}
      <aside className="gv-side" aria-label="Primary navigation">
        <div className="gv-brand">
          <div className="gv-brand-pad" aria-hidden="true" />
          <div className="gv-brand-title">
            Amina Observatory
          </div>
          <div className="gv-brand-sub">Ministry of Health · The Gambia</div>
        </div>

        <div className="gv-nav-label">Workspace</div>
        <nav className="gv-nav">
          {SECTIONS.map((s) => (
            <button key={s.id}
                    type="button"
                    className="gv-nav-item"
                    aria-current={s.id === section ? "page" : undefined}
                    onClick={() => setSection(s.id)}>
              <span className="gv-nav-icon"><s.icon size={16} strokeWidth={1.8} /></span>
              <span>{s.label}</span>
              <span className="gv-nav-hint">{s.hint}</span>
            </button>
          ))}
        </nav>

        <div className="gv-clearance">
          <div className="gv-clearance-label">
            <ShieldCheck size={11} strokeWidth={2.4} />
            Clearance
          </div>
          <div className="gv-clearance-body">
            <strong>MoH · Tier 3</strong><br />
            Session expires 17:00 UTC · reauth on role change
          </div>
        </div>

        <div className="gv-side-foot">
          <button type="button"
                  className="gv-side-btn"
                  onClick={() => setPaletteOpen(true)}>
            <Command size={14} strokeWidth={1.8} />
            <span>Quick actions</span>
            <span className="gv-nav-hint">⌘K</span>
          </button>
          <button type="button"
                  className="gv-side-btn"
                  onClick={() => {
                    // Hard sign-out: clears admin/gov tokens +
                    // observatory consent + popup-seen flag, then
                    // dispatches amina:auth-changed so the
                    // PrivacyPolicyBootstrap immediately sees the
                    // transition and re-prompts the policy gate on
                    // the next sign-in. Bug fix 2026-04-30: the old
                    // handler only navigated, leaving every token in
                    // localStorage so the user was effectively still
                    // signed in.
                    signOutAdminAndGov();
                    window.location.hash = "#/login";
                  }}>
            <LogOut size={14} strokeWidth={1.8} />
            <span>Sign out</span>
          </button>
        </div>
      </aside>

      {/* ── Topbar ────────────────────────────────── */}
      <header className="gv-topbar">
        <div className="gv-topbar-crumbs">
          <span>Observatory</span>
          <span className="sep">/</span>
          <span className="cur">{cur.label}</span>
        </div>
        <div className="gv-topbar-meta">
          <span><span className="dot" />Live · refreshed {fmtNow()}</span>
          <div className="gv-period-toggle" role="group" aria-label="Reporting period">
            <button type="button"
                    aria-pressed={period === "wtd"}
                    onClick={() => setPeriod("wtd")}>WTD</button>
            <button type="button"
                    aria-pressed={period === "mtd"}
                    onClick={() => setPeriod("mtd")}>MTD</button>
            <button type="button"
                    aria-pressed={period === "qtd"}
                    onClick={() => setPeriod("qtd")}>QTD</button>
            <button type="button"
                    aria-pressed={period === "ytd"}
                    onClick={() => setPeriod("ytd")}>YTD</button>
          </div>
        </div>
        <div className="gv-topbar-actions">
          <button type="button" className="gv-btn" onClick={() => window.print()}>
            <Printer size={13} strokeWidth={2} /> Print
          </button>
          <button type="button" className="gv-btn primary"
                  onClick={() => setReportOpen(true)}
                  title="Generate a signed summary report for the reporting period">
            <FileSignature size={13} strokeWidth={2} /> Generate report
          </button>
        </div>
      </header>

      {/* ── Main canvas ──────────────────────────── */}
      <main className="gv-main">
        <div className="gv-main-inner">
          {/* Hero section header */}
          <div className="gv-hero">
            <div>
              <div className="gv-hero-kicker">
                <span className="rule" />
                <span>{cur.kicker}</span>
              </div>
              <h1>{cur.label}</h1>
              <p className="gv-hero-sub">{cur.sub}</p>
            </div>
            <div className="gv-hero-meta">
              <span className="gv-pill crimson">
                <Lock size={10} strokeWidth={2.4} />
                Restricted · Tier 3
              </span>
              <span className="gv-pill blue">
                <ShieldCheck size={10} strokeWidth={2.4} />
                Aggregate only · No PII
              </span>
            </div>
          </div>

          {/* Section body */}
          {section === "national"     && <NationalPulse period={period} />}
          {section === "regional"     && <RegionalMap period={period} />}
          {section === "surveillance" && <Surveillance period={period} />}
          {section === "indicators"   && <Indicators period={period} />}
          {section === "network"      && <NetworkHealth period={period} />}
          {section === "reports"      && <Reports period={period} />}
        </div>
      </main>

      <CommandPalette open={paletteOpen} commands={commands}
                      onClose={() => setPaletteOpen(false)} />
      <GovReportDocument open={reportOpen}
                         period={period}
                         onClose={() => setReportOpen(false)} />
      <ToastHost />
      <SyntheticFooter />
    </div>
  );
}
