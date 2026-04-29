/**
 * SessionSwitcher — floating pill that lists every signed-in session
 * (patient, caregiver, admin) and lets you flip between them in one
 * click. Fixed to the top-left corner so it never collides with the
 * InboxBell cluster on the right.
 *
 * Only renders when there is MORE than one stored slot — a single
 * session doesn't need a switcher.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  listSlots, getActive, switchTo, forgetSlot, decodeDisplayName,
  hydrateFromLive,
} from "./sessionRegistry.js";


const META = {
  pt: { icon: "👤", label: "Patient",    accent: "#60a5fa" },
  cg: { icon: "🫶", label: "Caregiver",  accent: "#a78bfa" },
  ad: { icon: "🛡", label: "Admin",      accent: "#f472b6" },
};


function _snapshot() {
  hydrateFromLive();
  const slots = listSlots();
  const out = [];
  for (const role of ["pt", "cg", "ad"]) {
    if (!slots[role]) continue;
    out.push({
      role,
      active: getActive() === role,
      name:   decodeDisplayName(role),
    });
  }
  return out;
}


export default function SessionSwitcher() {
  const [slots,   setSlots]   = useState(_snapshot);
  const [open,    setOpen]    = useState(false);
  const rootRef               = useRef(null);

  // Re-scan on auth changes.
  useEffect(() => {
    const tick = () => setSlots(_snapshot());
    tick();
    const t = setInterval(tick, 1500);
    window.addEventListener("amina:auth-changed", tick);
    window.addEventListener("storage", tick);
    return () => {
      clearInterval(t);
      window.removeEventListener("amina:auth-changed", tick);
      window.removeEventListener("storage", tick);
    };
  }, []);

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    const onDoc = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const current = slots.find((s) => s.active) || slots[0];

  // Only show the switcher when there's a choice. Sign-in flows with
  // a single stored session are unaffected.
  if (!current || slots.length < 2) return null;

  const onSwitch = useCallback((role) => {
    if (role === current.role) { setOpen(false); return; }
    switchTo(role);
  }, [current]);

  const onForget = useCallback((role) => {
    // eslint-disable-next-line no-alert
    if (!window.confirm(`Sign out of the ${META[role].label} session?`)) return;
    forgetSlot(role);
  }, []);

  const m = META[current.role];

  return (
    <div ref={rootRef}
         style={{
           // Centered horizontally at the top of the viewport. The
           // pill itself uses translateX(-50%) to anchor on its own
           // mid-point so the dropdown below can still align under it.
           position: "fixed", top: 20, left: "50%",
           transform: "translateX(-50%)",
           zIndex: 9270,
           fontFamily: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
         }}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`Active session: ${m.label} — switch`}
        style={{
          display: "inline-flex", alignItems: "center", gap: 8,
          padding: "6px 12px 6px 8px",
          border: "none",
          background: "linear-gradient(135deg, #1f2937 0%, #0b1220 100%)",
          color: "#fff",
          borderRadius: 999,
          cursor: "pointer",
          fontSize: 12,
          boxShadow: `0 4px 14px rgba(15, 23, 42, 0.35), 0 0 0 2px ${m.accent}55`,
          transition: "transform 120ms ease",
        }}
        onMouseEnter={(e) => { e.currentTarget.style.transform = "scale(1.03)"; }}
        onMouseLeave={(e) => { e.currentTarget.style.transform = "scale(1)"; }}
      >
        <span aria-hidden="true" style={{ fontSize: 14 }}>{m.icon}</span>
        <span style={{ fontWeight: 700 }}>{current.name || m.label}</span>
        <span style={{
          fontSize: 9, fontWeight: 700, letterSpacing: 0.3,
          textTransform: "uppercase",
          padding: "2px 6px", borderRadius: 999,
          background: `${m.accent}33`, color: m.accent,
        }}>{m.label}</span>
        <span aria-hidden="true" style={{ opacity: 0.7, fontSize: 10 }}>{open ? "▲" : "▼"}</span>
      </button>

      {open && (
        <div role="listbox" aria-label="Switch session"
             style={{
               // Centered under the now-centered pill.
               position: "absolute", top: "calc(100% + 8px)",
               left: "50%", transform: "translateX(-50%)",
               minWidth: 240, padding: 6,
               background: "#0b1220",
               border: "1px solid rgba(148, 163, 184, 0.22)",
               borderRadius: 12,
               boxShadow: "0 18px 44px rgba(0,0,0,0.45)",
               animation: "amina-session-switcher-in 160ms ease-out",
             }}>
          <div style={{
            fontSize: 10, fontWeight: 700, letterSpacing: 0.4,
            textTransform: "uppercase", color: "#94a3b8",
            padding: "6px 10px 4px 10px",
          }}>Signed-in accounts</div>

          {slots.map((s) => {
            const sm = META[s.role];
            return (
              <div key={s.role}
                   style={{
                     display: "flex", alignItems: "center", gap: 8,
                     padding: "6px 8px", borderRadius: 8,
                     background: s.active ? "rgba(99, 102, 241, 0.14)" : "transparent",
                     border: s.active ? "1px solid rgba(129, 140, 248, 0.40)" : "1px solid transparent",
                     marginBottom: 4,
                   }}>
                <button type="button" onClick={() => onSwitch(s.role)}
                        role="option" aria-selected={s.active}
                        style={{
                          flex: 1, display: "flex", alignItems: "center", gap: 8,
                          padding: "6px 8px", background: "transparent",
                          border: "none", color: s.active ? "#fff" : "#cbd5e1",
                          cursor: s.active ? "default" : "pointer",
                          textAlign: "left", fontSize: 13,
                        }}>
                  <span style={{
                    width: 26, height: 26, borderRadius: 6,
                    background: `${sm.accent}1f`,
                    border: `1px solid ${sm.accent}55`,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: 14, flexShrink: 0,
                  }}>{sm.icon}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12, fontWeight: 700 }}>
                      {s.name || sm.label}
                    </div>
                    <div style={{ fontSize: 10, color: "#94a3b8" }}>
                      {sm.label}{s.active ? " · active" : ""}
                    </div>
                  </div>
                  {s.active ? (
                    <span style={{ color: sm.accent, fontWeight: 700, fontSize: 14 }}>✓</span>
                  ) : (
                    <span style={{ color: "#64748b", fontSize: 10, fontWeight: 700 }}>
                      SWITCH
                    </span>
                  )}
                </button>
                <button type="button" onClick={() => onForget(s.role)}
                        aria-label={`Sign out of ${sm.label}`}
                        title={`Sign out of ${sm.label}`}
                        style={{
                          width: 24, height: 24, borderRadius: 6,
                          background: "rgba(248, 113, 113, 0.10)",
                          color: "#fca5a5",
                          border: "1px solid rgba(248, 113, 113, 0.30)",
                          cursor: "pointer", fontSize: 12,
                        }}>×</button>
              </div>
            );
          })}

          <div style={{
            marginTop: 4, padding: "6px 10px",
            fontSize: 10, color: "#64748b", lineHeight: 1.5,
          }}>
            Sign in to a second role on the auth screen — it will appear here
            automatically. Switching reloads the app, keeping the other
            session alive in the background.
          </div>
        </div>
      )}

      <style>{`
        @keyframes amina-session-switcher-in {
          from { opacity: 0; transform: translateY(-6px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}
