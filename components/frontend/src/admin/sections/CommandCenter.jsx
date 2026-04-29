/**
 * CommandCenter — the new default admin view.
 *
 * Composition:
 *   - Row of 4 KPI stats (patients total, consults today, active sessions, open emergencies)
 *   - Triage donut + recent consult trend sparkline
 *   - Service health strip (9 services × status + latency + 7-day uptime %)
 *   - Top alerts needing attention
 *
 * Data from /api/v1/admin/mv/command-center (5s refresh) and
 * /api/v1/admin/mv/service-health (15s refresh).
 */

import { Users, Activity, Radio, AlertOctagon, Info, ArrowRight } from "lucide-react";

import {
  Card, Stat, Pill, Badge, Button, Donut, Sparkline, HBar,
} from "../primitives/index.jsx";
import { useAdminApi } from "../hooks/useAdminApi.js";


function fmtInt(n) {
  if (n == null) return "—";
  return Number(n).toLocaleString();
}


/* Clickable-card hover affordance — injected once at module load. */
const CC_CLICKABLE_CSS = `
@keyframes cc-urgent-pulse {
  0%, 100% { box-shadow: 0 0 0 0 rgba(248, 113, 113, 0.0); }
  50%      { box-shadow: 0 0 0 6px rgba(248, 113, 113, 0.10); }
}
.a-card-clickable {
  display: block;
  border-radius: 14px;
  transition: transform 180ms ease, box-shadow 180ms ease;
  outline: none;
}
.a-card-clickable:hover .a-card,
.a-card-clickable:focus-visible .a-card {
  border-color: var(--a-border-2) !important;
  background: color-mix(in oklab, var(--a-bg-elev-1, #161c27), var(--a-accent) 4%);
  transform: translateY(-1px);
}
.a-card-clickable:focus-visible {
  box-shadow: 0 0 0 3px rgba(129, 140, 248, 0.30);
}
.a-card-clickable-urgent .a-card {
  border-color: rgba(248, 113, 113, 0.40) !important;
  animation: cc-urgent-pulse 2.4s ease-in-out infinite;
}
.a-card-clickable-urgent:hover .a-card {
  border-color: rgba(248, 113, 113, 0.65) !important;
}
`;
if (typeof document !== "undefined" && !document.getElementById("amina-cc-clickable-css")) {
  const _s = document.createElement("style");
  _s.id = "amina-cc-clickable-css";
  _s.textContent = CC_CLICKABLE_CSS;
  document.head.appendChild(_s);
}


export default function CommandCenter({ onNavigate }) {
  const { data: cc, loading: ccLoading } = useAdminApi(
    "/api/v1/admin/mv/command-center", { refreshMs: 5000 }
  );
  const { data: svc } = useAdminApi(
    "/api/v1/admin/mv/service-health", { refreshMs: 15000 }
  );

  const kpis    = cc?.kpis    || {};
  const deltas  = cc?.deltas  || {};
  const triage  = cc?.triage  || [];
  const alerts  = cc?.alerts  || [];
  const trend   = cc?.consult_trend_30d
                 || Array.from({ length: 30 }, (_, i) => 40 + ((i * 3) % 80));
  const total = triage.reduce((s, x) => s + x.value, 0);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {/* Row 1: KPIs */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16 }}>
        <Card>
          <Stat
            icon={Users} label="Active patients"
            value={fmtInt(kpis.patients_total)}
            delta={deltas.patients}
            sub="vs. yesterday"
          />
        </Card>
        <Card>
          <Stat
            icon={Activity} label="Consultations · today"
            value={fmtInt(kpis.consultations_today)}
            delta={deltas.consultations}
            sub="vs. yesterday"
          />
        </Card>
        <Card>
          <Stat
            icon={Radio} label="Active sessions"
            value={fmtInt(kpis.active_sessions)}
            delta={deltas.sessions}
            sub="live now"
          />
        </Card>
        <div
          role="button"
          tabIndex={0}
          aria-label="Open emergencies — click to view emergency queue"
          onClick={() => { window.location.hash = "#/admin/emergencies"; }}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              window.location.hash = "#/admin/emergencies";
            }
          }}
          className={`a-card-clickable${kpis.open_emergencies > 0 ? " a-card-clickable-urgent" : ""}`}
          style={{ cursor: "pointer" }}
        >
          <Card>
            <Stat
              icon={AlertOctagon} label="Open emergencies"
              value={fmtInt(kpis.open_emergencies)}
              delta={deltas.emergencies}
              sub={
                <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                  {kpis.open_emergencies > 0 ? "awaiting response" : "no open cases"}
                  <ArrowRight size={11} style={{ opacity: 0.6 }} />
                </span>
              }
            />
          </Card>
        </div>
      </div>

      {/* Row 2: Triage donut + trend + alerts */}
      <div style={{ display: "grid", gridTemplateColumns: "1.1fr 1.6fr 1.3fr", gap: 16 }}>
        <Card title="Triage · last 24h"
              actions={cc?.synthetic && <Badge tone="neutral">Demo data</Badge>}>
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            <Donut
              segments={triage.length ? triage : [{ value: 1, color: "var(--a-border-2)" }]}
              size={124} thickness={14}
              center={
                <>
                  <span style={{ fontSize: 24, fontWeight: 500, fontVariationSettings: "'opsz' 144", color: "var(--a-fg)" }}>
                    {total}
                  </span>
                  <span style={{ fontSize: 10, color: "var(--a-fg-dim)", letterSpacing: "0.18em", textTransform: "uppercase", marginTop: 2 }}>
                    total
                  </span>
                </>
              }
            />
            <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 8 }}>
              {triage.map((s) => (
                <div key={s.label}
                     style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, color: "var(--a-fg-mute)" }}>
                  <span style={{ width: 8, height: 8, borderRadius: 2, background: s.color }} />
                  <span style={{ flex: 1 }}>{s.label}</span>
                  <span style={{ color: "var(--a-fg)", fontVariantNumeric: "tabular-nums" }}>{s.value}</span>
                </div>
              ))}
            </div>
          </div>
        </Card>

        <Card title="Consultations · 30-day trend"
              actions={cc?.synthetic && <Badge tone="neutral">Demo data</Badge>}>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <div style={{ fontFamily: "var(--a-font-disp)", fontSize: 32, fontWeight: 500,
                          fontVariationSettings: "'opsz' 144", color: "var(--a-fg)",
                          letterSpacing: "-0.02em" }}>
              {fmtInt(trend.reduce((s, v) => s + v, 0))}
            </div>
            <div style={{ fontSize: 11, color: "var(--a-fg-dim)", letterSpacing: "0.16em",
                          textTransform: "uppercase" }}>
              total · last 30 days
            </div>
            <div style={{ marginTop: 6 }}>
              <Sparkline data={trend} width={420} height={60} />
            </div>
          </div>
        </Card>

        <Card title="Alerts"
              actions={
                <Button variant="ghost" size="sm" tailIcon={ArrowRight}
                        onClick={() => onNavigate?.("governance")}>All</Button>
              }>
          {alerts.length === 0 ? (
            <div style={{ padding: "24px 4px", textAlign: "center", color: "var(--a-fg-dim)", fontSize: 13 }}>
              <Info size={18} style={{ marginBottom: 6, opacity: 0.7 }} />
              <div>All clear. Nothing needs your attention right now.</div>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {alerts.map((a) => (
                <div key={a.id}
                     style={{
                       display: "flex", gap: 10, alignItems: "flex-start",
                       padding: 10, borderRadius: 10,
                       border: "1px solid var(--a-border-1)",
                       background: "var(--a-bg-inset)",
                     }}>
                  <Badge tone={a.tone || "info"}>{a.tone || "info"}</Badge>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13, color: "var(--a-fg)", fontWeight: 600 }}>{a.title}</div>
                    {a.hint && (
                      <div style={{ fontSize: 11.5, color: "var(--a-fg-mute)", marginTop: 2 }}>
                        {a.hint}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      {/* Row 3: Service health strip */}
      <Card title="Service health"
            actions={
              <Pill>{svc?.services?.filter((x) => x.status === "up").length || 0}/{svc?.services?.length || 0} up</Pill>
            }>
        <div style={{
          display: "grid", gap: 10,
          gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))",
        }}>
          {(svc?.services || []).map((s) => {
            const tone = s.status === "up" ? "success" : "danger";
            return (
              <div key={s.id}
                   style={{
                     padding: 12,
                     borderRadius: 10,
                     border: "1px solid var(--a-border-1)",
                     background: "var(--a-bg-inset)",
                     display: "flex", flexDirection: "column", gap: 6,
                   }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 700, color: "var(--a-fg)" }}>
                  <span style={{
                    width: 6, height: 6, borderRadius: "50%",
                    background: s.status === "up" ? "var(--a-success)" : "var(--a-danger)",
                    boxShadow: s.status === "up" ? "0 0 6px var(--a-success)" : "0 0 6px var(--a-danger)",
                  }} />
                  {s.label}
                </div>
                <div style={{ fontSize: 11, color: "var(--a-fg-mute)", letterSpacing: "0.08em", textTransform: "uppercase" }}>
                  {s.kind}
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11.5, color: "var(--a-fg-mute)" }}>
                  <span>{s.latency_ms != null ? `${s.latency_ms}ms` : "—"}</span>
                  <span style={{ fontVariantNumeric: "tabular-nums", color: "var(--a-fg)" }}>
                    {s.uptime_7d ? `${s.uptime_7d}%` : "—"}
                  </span>
                </div>
              </div>
            );
          })}
          {(!svc || svc.services?.length === 0) && (
            <div style={{ gridColumn: "1 / -1", padding: 20, textAlign: "center",
                          color: "var(--a-fg-dim)", fontSize: 13 }}>
              {ccLoading ? "Loading service health…" : "No health data yet."}
            </div>
          )}
        </div>
      </Card>

      {/* Row 4: empty slot for future quick-insights — removed intentionally to keep the overview minimal */}
    </div>
  );
}
