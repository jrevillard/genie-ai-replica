/**
 * AbuseDefensePanel — Phase E admin UI for the abuse-defense subsystem.
 * =====================================================================
 *
 * Lets an admin:
 *   - search a user by patient_id / session_id / user_id
 *   - view the user's cool-down state, ladder level, lifetime
 *     terminations, and recent admin actions
 *   - manually release the user from cool-down (POST /release) with a
 *     mandatory reason and optional "also clear session_terminate flag"
 *   - browse recent admin-flagged users (last 30d)
 *   - see roll-up stats over the last 7 days
 *
 * Backend endpoints (Phase E, all admin-JWT gated):
 *   GET  /api/v1/admin/abuse/status
 *   GET  /api/v1/admin/abuse/flagged?days_back=30
 *   GET  /api/v1/admin/abuse/recent?...
 *   GET  /api/v1/admin/abuse/user/{key}
 *   POST /api/v1/admin/abuse/user/{key}/release
 *   GET  /api/v1/admin/abuse/stats?days_back=7
 */

import { useEffect, useState } from "react";
import {
  Search, ShieldAlert, ShieldCheck, Clock, AlertTriangle,
  RefreshCw, Hash, History, Unlock,
} from "lucide-react";

import { useAdminApi, ADMIN_API, adminAuthHeaders, clearAdminCache } from "./hooks/useAdminApi.js";
import { Button, Badge, toast } from "./primitives/index.jsx";


// ── Helpers ────────────────────────────────────────────────────────

function fmtSeconds(s) {
  if (s == null || s <= 0) return "—";
  const n = Math.round(Number(s));
  if (n < 60) return `${n}s`;
  if (n < 3600) return `${Math.floor(n / 60)}m ${n % 60}s`;
  const h = Math.floor(n / 3600);
  const m = Math.floor((n % 3600) / 60);
  return `${h}h ${m}m`;
}

function fmtTs(iso) {
  if (!iso) return "—";
  try { return new Date(iso).toISOString().replace("T", " ").slice(0, 19) + "Z"; }
  catch { return iso; }
}

function fmtTsEpoch(epoch) {
  if (!epoch) return "—";
  try { return new Date(Number(epoch) * 1000).toISOString().replace("T", " ").slice(0, 19) + "Z"; }
  catch { return "—"; }
}


// ── Stats KPI strip ────────────────────────────────────────────────

function StatsStrip() {
  const { data, refresh } = useAdminApi("/api/v1/admin/abuse/stats?days_back=7", { refreshMs: 60000 });
  const total       = data?.total_messages    ?? 0;
  const abuseN      = data?.is_abuse_count    ?? 0;
  const distressN   = data?.is_distress_count ?? 0;
  const frustN      = data?.is_frustration_count ?? 0;

  return (
    <div className="ops-kpi-row">
      <div className="ops-kpi">
        <div className="ops-kpi-label"><Hash size={11} strokeWidth={2} />Messages classified · 7d</div>
        <div className="ops-kpi-value">{total}</div>
        <div className="ops-kpi-meta">all routes · including clean</div>
      </div>
      <div className="ops-kpi">
        <div className="ops-kpi-label"><ShieldAlert size={11} strokeWidth={2} />Abuse signals · 7d</div>
        <div className="ops-kpi-value" style={{ color: abuseN > 0 ? "var(--ops-rose, #be123c)" : undefined }}>
          {abuseN}
        </div>
        <div className="ops-kpi-meta">directed · coercive · dehumanising</div>
      </div>
      <div className="ops-kpi">
        <div className="ops-kpi-label"><AlertTriangle size={11} strokeWidth={2} />Distress · 7d</div>
        <div className="ops-kpi-value">{distressN}</div>
        <div className="ops-kpi-meta">always reach the user · never silenced</div>
      </div>
      <div className="ops-kpi">
        <div className="ops-kpi-label"><Clock size={11} strokeWidth={2} />Frustration · 7d</div>
        <div className="ops-kpi-value">{frustN}</div>
        <div className="ops-kpi-meta">health-context carve-out fired</div>
      </div>
    </div>
  );
}


// ── User detail (state + release) ─────────────────────────────────

function UserDetailCard({ userKey, onChanged }) {
  const url = `/api/v1/admin/abuse/user/${encodeURIComponent(userKey)}`;
  const { data, loading, error, refresh } = useAdminApi(url, { refreshMs: 0 });

  const [reason, setReason] = useState("");
  const [alsoClearST, setAlsoClearST] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  if (!userKey) return null;

  const cd        = data?.cooldown_record || {};
  const isLocked  = !!data?.is_locked;
  const remaining = Number(data?.cooldown_remaining_s || 0);
  const hadST     = !!data?.had_session_terminate;
  const lifetime  = Number(data?.lifetime_terminations || 0);
  const ladder    = data?.warning_ladder || {};
  const actions   = data?.recent_admin_actions || [];
  const flags     = data?.recent_admin_flags || [];

  async function release() {
    if (!reason.trim()) {
      toast("Reason is required for the audit trail.", "error");
      return;
    }
    setSubmitting(true);
    try {
      const r = await fetch(
        `${ADMIN_API}/api/v1/admin/abuse/user/${encodeURIComponent(userKey)}/release`,
        {
          method: "POST",
          headers: adminAuthHeaders(),
          body: JSON.stringify({
            reason: reason.trim(),
            also_clear_session_terminate: !!alsoClearST,
          }),
        },
      );
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        toast(`Release failed: ${j.detail || r.status}`, "error");
        return;
      }
      if (j.released) {
        toast(
          j.had_cooldown
            ? "Cool-down cleared. User can chat again."
            : "User had no active cool-down. Audit row written.",
          "success",
        );
        clearAdminCache("/api/v1/admin/abuse");
        setReason("");
        setAlsoClearST(false);
        refresh();
        onChanged && onChanged();
      } else {
        toast(`Release reported failure: ${j.error || "unknown"}`, "error");
      }
    } catch (e) {
      toast(`Release failed: ${e}`, "error");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="ops-panel" style={{ padding: 0 }}>
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "12px 16px", borderBottom: "1px solid var(--ops-rule)",
        gap: 10,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
          {isLocked
            ? <ShieldAlert size={16} strokeWidth={2} style={{ color: "#be123c", flexShrink: 0 }} />
            : <ShieldCheck size={16} strokeWidth={2} style={{ color: "#0f766e", flexShrink: 0 }} />}
          <div style={{ fontFamily: "var(--a-font-mono)", fontSize: 13, fontWeight: 600,
                        color: "var(--ops-ink)", overflow: "hidden", textOverflow: "ellipsis",
                        whiteSpace: "nowrap" }}>
            {userKey}
          </div>
          {isLocked
            ? <Badge tone="danger">LOCKED</Badge>
            : <Badge tone="success">CLEAR</Badge>}
          {hadST && <Badge tone="warn">had session_terminate</Badge>}
        </div>
        <Button variant="ghost" size="sm" leadIcon={RefreshCw} onClick={refresh} disabled={loading}>
          Refresh
        </Button>
      </div>

      <div style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
        gap: 14, padding: 16,
      }}>
        <KV k="Cool-down remaining" v={fmtSeconds(remaining)} highlight={isLocked} />
        <KV k="Cool-down until" v={fmtTsEpoch(cd.cooldown_until_ts)} />
        <KV k="Next cool-down index" v={String(cd.next_cooldown_index ?? 0)} />
        <KV k="Lifetime terminations" v={String(lifetime)} />
        <KV k="Last terminated" v={fmtTsEpoch(cd.last_terminated_ts)} />
        <KV k="Was admin-flagged" v={cd.was_admin_flagged ? "yes" : "no"} />
        <KV k="Ladder level" v={String(ladder.level ?? "—")} />
        <KV k="Ladder warnings issued" v={String(ladder.warnings_issued ?? "—")} />
      </div>

      {/* Release form */}
      <div style={{
        padding: "14px 16px",
        borderTop: "1px solid var(--ops-rule)",
        background: "var(--ops-paper-2, #fafaf7)",
      }}>
        <div style={{
          fontSize: 11, letterSpacing: ".14em", textTransform: "uppercase",
          color: "var(--ops-ink-3)", marginBottom: 8,
        }}>
          Manual release (writes audit row + clears cool-down)
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "stretch", flexWrap: "wrap" }}>
          <input
            type="text"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Reason for release (required for audit) — e.g. demo, support escalation, false positive"
            style={{
              flex: "1 1 320px", minWidth: 240,
              padding: "9px 12px", fontSize: 13,
              border: "1px solid var(--ops-rule-2)", borderRadius: 6,
              background: "#fff",
            }}
          />
          <label style={{
            display: "inline-flex", alignItems: "center", gap: 8,
            fontSize: 12, color: "var(--ops-ink-2)",
            padding: "0 10px", border: "1px solid var(--ops-rule)",
            borderRadius: 6, background: "#fff", cursor: "pointer",
          }}>
            <input type="checkbox"
                   checked={alsoClearST}
                   onChange={(e) => setAlsoClearST(e.target.checked)} />
            Also clear session_terminate flag (rare)
          </label>
          <Button
            variant="primary"
            leadIcon={Unlock}
            onClick={release}
            disabled={submitting || !reason.trim()}
            loading={submitting}
          >
            {isLocked ? "Release cool-down" : "Clear ladder + audit"}
          </Button>
        </div>
        <div style={{ fontSize: 11, color: "var(--ops-ink-3)", marginTop: 8, lineHeight: 1.5 }}>
          By default, releasing a user clears the cool-down clock but keeps
          <code style={{ margin: "0 4px" }}>had_session_terminate=true</code>
          so the next abuse-past-WARN3 still results in cool-down (not session-terminate).
          Tick the checkbox only when giving the user a fresh slate.
        </div>
      </div>

      {/* Recent admin actions */}
      <div style={{
        padding: "12px 16px",
        borderTop: "1px solid var(--ops-rule)",
        fontSize: 12,
      }}>
        <div style={{
          fontSize: 11, letterSpacing: ".14em", textTransform: "uppercase",
          color: "var(--ops-ink-3)", marginBottom: 8,
          display: "flex", alignItems: "center", gap: 6,
        }}>
          <History size={11} strokeWidth={2} />
          Recent admin actions on this key ({actions.length})
        </div>
        {actions.length === 0 ? (
          <div style={{ fontSize: 12, color: "var(--ops-ink-3)", padding: "8px 0" }}>
            No admin actions recorded for this key.
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {actions.slice(0, 8).map((a, i) => (
              <div key={i} style={{
                display: "grid",
                gridTemplateColumns: "180px 140px 1fr",
                gap: 10, fontSize: 12,
                padding: "6px 8px",
                background: "var(--ops-paper)",
                borderRadius: 6,
                border: "1px solid var(--ops-rule)",
              }}>
                <span style={{ fontFamily: "var(--a-font-mono)", color: "var(--ops-ink-3)" }}>
                  {fmtTs(a.ts)}
                </span>
                <span style={{ fontWeight: 600, color: "var(--ops-ink-2)" }}>
                  {a.action || "—"}
                </span>
                <span style={{ color: "var(--ops-ink-2)" }}>
                  {a.admin_id ? <em style={{ color: "var(--ops-ink-3)" }}>{a.admin_id} · </em> : null}
                  {a.reason || "—"}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Recent admin-flag rows */}
      {flags.length > 0 && (
        <div style={{
          padding: "12px 16px",
          borderTop: "1px solid var(--ops-rule)",
          fontSize: 12,
        }}>
          <div style={{
            fontSize: 11, letterSpacing: ".14em", textTransform: "uppercase",
            color: "var(--ops-ink-3)", marginBottom: 8,
          }}>
            Admin-flag rows ({flags.length})
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {flags.slice(0, 8).map((f, i) => (
              <div key={i} style={{
                display: "grid",
                gridTemplateColumns: "180px 1fr",
                gap: 10, fontSize: 12,
                padding: "6px 8px",
                background: "var(--ops-paper)",
                borderRadius: 6,
                border: "1px solid var(--ops-rule)",
              }}>
                <span style={{ fontFamily: "var(--a-font-mono)", color: "var(--ops-ink-3)" }}>
                  {fmtTs(f.ts)}
                </span>
                <span style={{ color: "var(--ops-ink-2)" }}>
                  {f.reason || f.category || "—"}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {error && (
        <div style={{
          padding: "10px 16px", fontSize: 12,
          color: "#be123c", borderTop: "1px solid var(--ops-rule)",
        }}>
          {String(error)}
        </div>
      )}
    </div>
  );
}


function KV({ k, v, highlight }) {
  return (
    <div>
      <div style={{
        fontSize: 10, letterSpacing: ".14em", textTransform: "uppercase",
        color: "var(--ops-ink-3)", marginBottom: 3,
      }}>
        {k}
      </div>
      <div style={{
        fontFamily: "var(--a-font-mono)",
        fontSize: 13,
        fontWeight: 600,
        color: highlight ? "#be123c" : "var(--ops-ink)",
      }}>
        {v}
      </div>
    </div>
  );
}


// ── Flagged-users list ────────────────────────────────────────────

function FlaggedList({ onPickKey }) {
  const { data, loading, refresh } = useAdminApi("/api/v1/admin/abuse/flagged?days_back=30", { refreshMs: 60000 });
  const rows = data?.rows || [];

  // De-dupe by key, keeping the most recent timestamp + count.
  const grouped = (() => {
    const m = new Map();
    for (const r of rows) {
      const k = r.key || r.user_id || r.session_id || "";
      if (!k) continue;
      const cur = m.get(k);
      if (!cur) {
        m.set(k, { key: k, count: 1, latest: r.ts || "", last_reason: r.reason || r.category || "" });
      } else {
        cur.count += 1;
        if ((r.ts || "") > cur.latest) {
          cur.latest = r.ts || cur.latest;
          cur.last_reason = r.reason || r.category || cur.last_reason;
        }
      }
    }
    return Array.from(m.values()).sort((a, b) => (b.latest || "").localeCompare(a.latest || ""));
  })();

  return (
    <div className="ops-panel" style={{ padding: 0 }}>
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "12px 16px", borderBottom: "1px solid var(--ops-rule)",
      }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: "var(--ops-ink)" }}>
          Admin-flagged users · last 30d
          <span style={{ fontWeight: 400, color: "var(--ops-ink-3)", marginLeft: 8 }}>
            ({grouped.length} unique · {rows.length} flag rows)
          </span>
        </div>
        <Button variant="ghost" size="sm" leadIcon={RefreshCw} onClick={refresh} disabled={loading}>
          Refresh
        </Button>
      </div>
      {grouped.length === 0 ? (
        <div style={{ padding: "20px 16px", color: "var(--ops-ink-3)", fontSize: 13 }}>
          No admin-flagged users in the last 30 days. Either things have been quiet or the
          abuse-defense layer hasn't crossed the admin-flag threshold for any user yet.
        </div>
      ) : (
        <div style={{ maxHeight: 360, overflow: "auto" }}>
          {grouped.map((g) => (
            <div key={g.key} style={{
              display: "grid",
              gridTemplateColumns: "1fr auto auto auto",
              gap: 10, alignItems: "center",
              padding: "10px 16px",
              borderBottom: "1px solid var(--ops-rule)",
              fontSize: 12,
            }}>
              <div style={{ fontFamily: "var(--a-font-mono)", color: "var(--ops-ink)",
                            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {g.key}
              </div>
              <span style={{ color: "var(--ops-ink-3)", fontFamily: "var(--a-font-mono)" }}>
                {fmtTs(g.latest)}
              </span>
              <Badge tone="warn">{g.count} flag{g.count > 1 ? "s" : ""}</Badge>
              <Button variant="secondary" size="sm" onClick={() => onPickKey(g.key)}>
                View
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}


// ── Recent classifications (abuse-only) ────────────────────────────

function RecentAbuse({ onPickKey }) {
  const { data, loading, refresh } = useAdminApi(
    "/api/v1/admin/abuse/recent?abuse_only=true&days_back=7&limit=50",
    { refreshMs: 60000 },
  );
  const rows = data?.rows || [];

  return (
    <div className="ops-panel" style={{ padding: 0 }}>
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "12px 16px", borderBottom: "1px solid var(--ops-rule)",
      }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: "var(--ops-ink)" }}>
          Recent abuse classifications · last 7d
          <span style={{ fontWeight: 400, color: "var(--ops-ink-3)", marginLeft: 8 }}>
            ({rows.length})
          </span>
        </div>
        <Button variant="ghost" size="sm" leadIcon={RefreshCw} onClick={refresh} disabled={loading}>
          Refresh
        </Button>
      </div>
      {rows.length === 0 ? (
        <div style={{ padding: "20px 16px", color: "var(--ops-ink-3)", fontSize: 13 }}>
          No abuse classifications in the last 7 days.
        </div>
      ) : (
        <div style={{ maxHeight: 360, overflow: "auto" }}>
          {rows.map((r, i) => {
            const k = r.user_id || r.session_id || "";
            return (
              <div key={i} style={{
                display: "grid",
                gridTemplateColumns: "150px 130px 1fr 90px",
                gap: 10, alignItems: "center",
                padding: "8px 16px",
                borderBottom: "1px solid var(--ops-rule)",
                fontSize: 12,
              }}>
                <span style={{ fontFamily: "var(--a-font-mono)", color: "var(--ops-ink-3)" }}>
                  {fmtTs(r.ts)}
                </span>
                <Badge tone="danger">{r.category || "abuse"}</Badge>
                <span style={{ color: "var(--ops-ink-2)",
                               overflow: "hidden", textOverflow: "ellipsis",
                               whiteSpace: "nowrap" }}>
                  <span style={{ fontFamily: "var(--a-font-mono)", color: "var(--ops-ink-3)",
                                 marginRight: 8 }}>{k}</span>
                  {r.severity ? <em style={{ color: "var(--ops-ink-3)" }}>{r.severity} · </em> : null}
                  {r.matched || r.summary || ""}
                </span>
                {k ? (
                  <Button variant="secondary" size="sm" onClick={() => onPickKey(k)}>View</Button>
                ) : <span />}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}


// ── Module-status footer ──────────────────────────────────────────

function ModuleStatusFooter() {
  const { data } = useAdminApi("/api/v1/admin/abuse/status", { refreshMs: 0 });
  if (!data) return null;
  return (
    <div style={{
      display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center",
      padding: "10px 16px", borderRadius: 6,
      border: "1px solid var(--ops-rule)", background: "var(--ops-paper)",
      fontSize: 11, color: "var(--ops-ink-3)",
      fontFamily: "var(--a-font-mono)",
    }}>
      <span>enabled={String(data.enabled)}</span>
      <span>mode={data.mode}</span>
      <span>cooldown_first={data.cooldown_first_s}s</span>
      <span>cooldown_second={data.cooldown_second_s}s</span>
      <span>cooldown_third={data.cooldown_third_s}s</span>
      <span>decay={data.cooldown_decay_s}s</span>
      <span>flag_threshold={data.admin_flag_threshold}</span>
    </div>
  );
}


// ── Root panel ─────────────────────────────────────────────────────

export default function AbuseDefensePanel() {
  const [searchInput, setSearchInput] = useState("");
  const [selectedKey, setSelectedKey] = useState("");

  function submitSearch(e) {
    e?.preventDefault?.();
    const v = searchInput.trim();
    if (!v) return;
    setSelectedKey(v);
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>

      <StatsStrip />

      {/* Search */}
      <div className="ops-panel" style={{ padding: 14 }}>
        <div style={{
          fontSize: 11, letterSpacing: ".14em", textTransform: "uppercase",
          color: "var(--ops-ink-3)", marginBottom: 8,
        }}>
          Look up a user
        </div>
        <form onSubmit={submitSearch} style={{ display: "flex", gap: 8, alignItems: "stretch" }}>
          <div style={{
            flex: 1, display: "flex", alignItems: "center", gap: 8,
            padding: "0 12px",
            border: "1px solid var(--ops-rule-2)", borderRadius: 6,
            background: "#fff",
          }}>
            <Search size={14} strokeWidth={2} style={{ color: "var(--ops-ink-3)" }} />
            <input
              type="text"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="patient_id, user_id, or session_id (e.g. lamin_jaiteh)"
              style={{
                flex: 1, border: "none", outline: "none",
                padding: "10px 0", fontSize: 13, background: "transparent",
              }}
            />
          </div>
          <Button type="submit" variant="primary" disabled={!searchInput.trim()}>
            Look up
          </Button>
          {selectedKey && (
            <Button variant="ghost" onClick={() => { setSelectedKey(""); setSearchInput(""); }}>
              Clear
            </Button>
          )}
        </form>
        <div style={{
          fontSize: 11, color: "var(--ops-ink-3)", marginTop: 8,
        }}>
          The key is whatever the abuse-defense classifier saw — usually the
          patient_id but can also be a session_id when the user was anonymous.
          Click a row in either list below to auto-fill this.
        </div>
      </div>

      {selectedKey && (
        <UserDetailCard userKey={selectedKey} onChanged={() => { /* lists self-refresh on next poll */ }} />
      )}

      <div style={{
        display: "grid",
        gridTemplateColumns: "1fr 1fr",
        gap: 16,
      }}>
        <FlaggedList onPickKey={(k) => { setSelectedKey(k); setSearchInput(k); }} />
        <RecentAbuse  onPickKey={(k) => { setSelectedKey(k); setSearchInput(k); }} />
      </div>

      <ModuleStatusFooter />
    </div>
  );
}
