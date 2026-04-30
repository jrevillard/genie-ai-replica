/**
 * CaregiverPrivacyAcceptanceCard — Phase 10 v1.
 * ===============================================
 *
 * Admin-console visibility into caregiver privacy-policy acceptance:
 *   - aggregate counts (total / accepted / pending / rate)
 *   - per-caregiver table (safe fields only)
 *
 * Backed by GET /api/v1/admin/caregivers/privacy-consent-status which
 * is auth-gated (admin JWT) and returns ONLY the safe fields:
 *   caregiver_id, name, role, has_current_consent, notice_version,
 *   accepted_at, record_id, method, stale_or_pending.
 *
 * Never displays:
 *   - raw signature
 *   - signature_hash / guardian_signature_hash
 *   - phone, IP, user-agent, token
 *   - checkbox prose
 *   - patient data
 *
 * Visual style intentionally matches the rest of the admin console —
 * the parent (Governance section) supplies the .amina-admin-scope
 * theme tokens (admin-tokens.css). We add minimal local styles
 * scoped to .privacy-acceptance-card so nothing leaks into the
 * caregiver portal.
 */

import { useCallback, useEffect, useState } from "react";


const API = ((typeof window !== "undefined" && window.AMINA_API)
  || "http://localhost:8000").replace(/\/+$/, "");


export default function CaregiverPrivacyAcceptanceCard({ token }) {
  const [data, setData]       = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState("");

  const fetchStatus = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const r = await fetch(
        `${API}/api/v1/admin/caregivers/privacy-consent-status`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      if (!r.ok) {
        throw new Error(`HTTP ${r.status}`);
      }
      const j = await r.json();
      setData(j);
    } catch (e) {
      setError(`Could not load privacy-acceptance status (${e.message || "network"}).`);
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  return (
    <>
      <style>{`
        .privacy-acceptance-card {
          background: linear-gradient(180deg, #0e1226 0%, #0a0d1d 100%);
          border: 1px solid rgba(148, 163, 184, 0.16);
          border-radius: 14px;
          padding: 22px 24px 20px;
          color: #e8edf5;
          font-family: var(--a-font, "Inter Tight"), system-ui, sans-serif;
          margin-bottom: 28px;
        }
        .privacy-acceptance-card .pa-head {
          display: flex; align-items: flex-start; justify-content: space-between;
          gap: 16px; margin-bottom: 14px; flex-wrap: wrap;
        }
        .privacy-acceptance-card .pa-eyebrow {
          font-size: 10.5px; letter-spacing: 0.18em;
          text-transform: uppercase; font-weight: 700;
          color: #818cf8;
        }
        .privacy-acceptance-card .pa-title {
          font-family: var(--a-font-disp, "Fraunces"), serif;
          font-size: 19px; font-weight: 500; letter-spacing: -0.01em;
          color: #f1f5f9; margin: 6px 0 0;
        }
        .privacy-acceptance-card .pa-sub {
          font-size: 12.5px; color: rgba(232, 237, 245, 0.55);
          margin: 4px 0 0; line-height: 1.5;
        }
        .privacy-acceptance-card .pa-refresh {
          appearance: none; border: 1px solid rgba(148, 163, 184, 0.20);
          background: rgba(148, 163, 184, 0.06);
          color: rgba(232, 237, 245, 0.85);
          font: inherit; font-size: 12px; font-weight: 600;
          padding: 6px 12px; border-radius: 8px;
          cursor: pointer; transition: all .15s ease;
        }
        .privacy-acceptance-card .pa-refresh:hover {
          border-color: #818cf8; color: #fff;
        }
        .privacy-acceptance-card .pa-stats {
          display: grid; grid-template-columns: repeat(4, 1fr);
          gap: 10px; margin: 14px 0 18px;
        }
        @media (max-width: 800px) {
          .privacy-acceptance-card .pa-stats { grid-template-columns: repeat(2, 1fr); }
        }
        .privacy-acceptance-card .pa-stat {
          background: rgba(255, 255, 255, 0.025);
          border: 1px solid rgba(148, 163, 184, 0.10);
          border-radius: 10px; padding: 12px 14px;
        }
        .privacy-acceptance-card .pa-stat-k {
          font-size: 10.5px; color: rgba(232, 237, 245, 0.45);
          letter-spacing: 0.10em; text-transform: uppercase;
          font-weight: 600;
        }
        .privacy-acceptance-card .pa-stat-v {
          font-family: var(--a-font-disp, "Fraunces"), serif;
          font-size: 22px; color: #f1f5f9; font-weight: 500;
          margin-top: 2px; font-variant-numeric: tabular-nums;
        }
        .privacy-acceptance-card .pa-pill {
          display: inline-flex; align-items: center; gap: 6px;
          padding: 3px 9px; border-radius: 999px;
          font-size: 11px; font-weight: 600; letter-spacing: 0.02em;
        }
        .privacy-acceptance-card .pa-pill-accepted {
          background: rgba(47, 125, 91, 0.18);
          color: #86efac;
          border: 1px solid rgba(47, 125, 91, 0.40);
        }
        .privacy-acceptance-card .pa-pill-pending {
          background: rgba(199, 123, 44, 0.18);
          color: #fcd34d;
          border: 1px solid rgba(199, 123, 44, 0.40);
        }
        .privacy-acceptance-card table.pa-table {
          width: 100%; border-collapse: collapse; font-size: 12.5px;
        }
        .privacy-acceptance-card table.pa-table thead th {
          text-align: left;
          font-size: 10.5px; font-weight: 600;
          letter-spacing: 0.08em; text-transform: uppercase;
          color: rgba(232, 237, 245, 0.50);
          padding: 8px 10px;
          border-bottom: 1px solid rgba(148, 163, 184, 0.16);
        }
        .privacy-acceptance-card table.pa-table tbody td {
          padding: 10px 10px;
          border-bottom: 1px solid rgba(148, 163, 184, 0.06);
          color: rgba(232, 237, 245, 0.85);
          font-variant-numeric: tabular-nums;
        }
        .privacy-acceptance-card .pa-empty {
          padding: 18px; text-align: center; font-size: 13px;
          color: rgba(232, 237, 245, 0.55);
        }
        .privacy-acceptance-card .pa-error {
          padding: 12px 14px; border-radius: 8px;
          background: rgba(220, 38, 38, 0.10);
          border: 1px solid rgba(220, 38, 38, 0.40);
          color: #fecaca; font-size: 12.5px;
        }
        .privacy-acceptance-card .pa-foot {
          margin-top: 14px;
          font-size: 11px; color: rgba(232, 237, 245, 0.40);
          letter-spacing: 0.02em;
        }
      `}</style>

      <div className="privacy-acceptance-card">
        <div className="pa-head">
          <div>
            <div className="pa-eyebrow">Caregiver privacy</div>
            <h3 className="pa-title">Privacy-policy acceptance status</h3>
            <p className="pa-sub">
              Aggregate + per-caregiver view of who has accepted the
              current notice version. Safe fields only — no signatures,
              hashes, tokens, IPs, user agents, or patient data.
            </p>
          </div>
          <button
            type="button"
            className="pa-refresh"
            onClick={fetchStatus}
            disabled={loading}
            aria-label="Refresh privacy-acceptance status"
          >
            {loading ? "Refreshing…" : "Refresh"}
          </button>
        </div>

        {error && (
          <div className="pa-error" role="alert">
            {error}
          </div>
        )}

        {data && !error && (
          <>
            <div className="pa-stats">
              <div className="pa-stat">
                <div className="pa-stat-k">Total caregivers</div>
                <div className="pa-stat-v">{data.total_caregivers ?? 0}</div>
              </div>
              <div className="pa-stat">
                <div className="pa-stat-k">Accepted current</div>
                <div className="pa-stat-v">{data.accepted_current ?? 0}</div>
              </div>
              <div className="pa-stat">
                <div className="pa-stat-k">Pending / stale</div>
                <div className="pa-stat-v">{data.pending_or_stale ?? 0}</div>
              </div>
              <div className="pa-stat">
                <div className="pa-stat-k">Acceptance rate</div>
                <div className="pa-stat-v">
                  {(data.acceptance_rate_pct ?? 0).toFixed(1)}%
                </div>
              </div>
            </div>

            {(data.caregivers || []).length === 0 ? (
              <div className="pa-empty">
                No caregivers found in the directory.
              </div>
            ) : (
              <div style={{ overflowX: "auto" }}>
                <table className="pa-table">
                  <thead>
                    <tr>
                      <th>Caregiver</th>
                      <th>Role</th>
                      <th>Status</th>
                      <th>Notice version</th>
                      <th>Accepted at</th>
                      <th>Method</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.caregivers.map((cg) => {
                      const accepted = cg.has_current_consent === true;
                      return (
                        <tr key={cg.caregiver_id}>
                          <td>
                            {cg.name || cg.caregiver_id}
                          </td>
                          <td>
                            {cg.role || "—"}
                          </td>
                          <td>
                            <span
                              className={
                                "pa-pill " +
                                (accepted
                                  ? "pa-pill-accepted"
                                  : "pa-pill-pending")
                              }
                            >
                              {accepted ? "Accepted" : "Pending"}
                            </span>
                          </td>
                          <td>{cg.notice_version || "—"}</td>
                          <td>
                            {cg.accepted_at
                              ? new Date(cg.accepted_at).toLocaleString()
                              : "—"}
                          </td>
                          <td>{cg.method || "—"}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            <div className="pa-foot">
              Required notice version: {data.notice_version_required || "—"} ·
              Enforcement:{" "}
              {data.required_flag
                ? "required (production gate active)"
                : "warn-only (production gate not yet flipped)"}
              {data.last_checked_at
                ? ` · Last checked ${new Date(data.last_checked_at).toLocaleString()}`
                : ""}
            </div>
          </>
        )}

        {loading && !data && !error && (
          <div className="pa-empty">Loading caregiver privacy status…</div>
        )}
      </div>
    </>
  );
}
