/**
 * HomePage — editorial, clinical, kinetic.
 *
 * Design language:
 *   • Editorial typography — headline is the composition, not a chip.
 *   • Glass + depth — frosted surfaces, soft shadows, no hard borders
 *     unless the element is interactive.
 *   • Kinetic restraint — one animated gradient (headline), one
 *     breathing halo (orb), one heartbeat sine (hero motif).
 *   • Scroll-reveal with staggered easing (IntersectionObserver).
 *   • Cursor spotlight in the hero so the composition feels alive
 *     without any decorative clutter.
 *   • Dual-key palette: indigo→violet (brand) + mint (medical) used
 *     for accents on status dots and live indicators.
 *   • Amina usable without signing in — the chat input IS the hero.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { currentAuthRole } from "../AppRouter.jsx";
import oauthLogin from "../oauthLogin.js";


// ── Scroll-reveal hook ─────────────────────────────────────────────

function useReveal(delay = 0) {
  const ref = useRef(null);
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === "undefined") { setShown(true); return; }
    const obs = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) { setShown(true); obs.disconnect(); break; }
        }
      },
      { threshold: 0.10, rootMargin: "0px 0px -48px 0px" },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, []);
  return {
    ref,
    style: {
      opacity: shown ? 1 : 0,
      transform: shown ? "translate3d(0,0,0)" : "translate3d(0,28px,0)",
      transition:
        `opacity 700ms cubic-bezier(0.2, 0.8, 0.2, 1) ${delay}ms,`
      + ` transform 700ms cubic-bezier(0.2, 0.8, 0.2, 1) ${delay}ms`,
      willChange: "opacity, transform",
    },
  };
}


// ── Ambient hero background (cursor-tracked spotlight) ───────────

function HeroBackdrop({ containerRef }) {
  const [pos, setPos] = useState({ x: 50, y: 40 });

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onMove = (e) => {
      const r = el.getBoundingClientRect();
      const x = ((e.clientX - r.left) / r.width)  * 100;
      const y = ((e.clientY - r.top)  / r.height) * 100;
      setPos({ x, y });
    };
    el.addEventListener("mousemove", onMove);
    return () => el.removeEventListener("mousemove", onMove);
  }, [containerRef]);

  return (
    <div aria-hidden style={{
      position: "absolute", inset: -40, pointerEvents: "none",
      zIndex: 0, overflow: "hidden",
      background:
        `radial-gradient(600px circle at ${pos.x}% ${pos.y}%, rgba(167, 139, 250, 0.18), transparent 50%),`
      + ` radial-gradient(900px 500px at 15% -10%, rgba(94, 234, 212, 0.10), transparent 60%),`
      + ` radial-gradient(1100px 600px at 110% 115%, rgba(99, 102, 241, 0.15), transparent 60%)`,
      transition: "background 220ms ease",
    }} />
  );
}


// ── Heartbeat line (decorative SVG motif) ────────────────────────

function Heartbeat() {
  return (
    <svg width="100%" height="44" viewBox="0 0 600 44" preserveAspectRatio="none"
         aria-hidden
         style={{
           position: "absolute", left: 0, right: 0, bottom: -8,
           opacity: 0.55, pointerEvents: "none",
         }}>
      <defs>
        <linearGradient id="amina-ecg-g" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0"   stopColor="#5eead4" stopOpacity="0"/>
          <stop offset="0.5" stopColor="#5eead4" stopOpacity="0.9"/>
          <stop offset="1"   stopColor="#a78bfa" stopOpacity="0"/>
        </linearGradient>
      </defs>
      <path fill="none" stroke="url(#amina-ecg-g)" strokeWidth="1.6"
            strokeLinecap="round" strokeLinejoin="round"
            d="M0 22 L90 22 L110 22 L122 8 L134 36 L146 16 L158 22 L290 22
               L308 22 L318 10 L330 34 L342 14 L354 22 L520 22 L600 22"
            style={{ strokeDasharray: 620, strokeDashoffset: 0,
                     animation: "amina-ecg-sweep 5.5s linear infinite" }} />
      <style>{`
        @keyframes amina-ecg-sweep {
          0%   { stroke-dashoffset: 620; }
          100% { stroke-dashoffset: -620; }
        }
        @media (prefers-reduced-motion: reduce) {
          @keyframes amina-ecg-sweep { 0%,100% { stroke-dashoffset: 0; } }
        }
      `}</style>
    </svg>
  );
}


// ── Avatar orb (bigger, two-layer halo) ─────────────────────────

function AvatarOrb() {
  return (
    <div aria-hidden style={{
      position: "relative",
      width: "min(280px, 36vw)", aspectRatio: "1 / 1",
    }}>
      <div style={{
        position: "absolute", inset: -24,
        borderRadius: "50%",
        background:
          "radial-gradient(circle at 50% 50%, rgba(167, 139, 250, 0.40), transparent 70%)",
        filter: "blur(6px)",
        animation: "amina-halo 5s ease-in-out infinite",
      }} />
      <div style={{
        position: "absolute", inset: 0,
        borderRadius: "50%",
        background:
          "radial-gradient(circle at 30% 28%, #c4b5fd 0%, #8b5cf6 45%, #4c1d95 100%)",
        boxShadow:
          "0 50px 110px rgba(99,102,241,0.45), inset 0 0 80px rgba(255,255,255,0.12)",
        display: "flex", alignItems: "center", justifyContent: "center",
        color: "rgba(255,255,255,0.96)",
        fontFamily: "'Times New Roman', Georgia, serif",
        fontSize: "min(108px, 13vw)", fontWeight: 700,
        letterSpacing: -2,
        animation: "amina-orb-breathe 7s ease-in-out infinite",
      }}>A</div>
      <div style={{
        position: "absolute", inset: -6,
        borderRadius: "50%",
        border: "1px solid rgba(255,255,255,0.08)",
      }} />
      <style>{`
        @keyframes amina-orb-breathe {
          0%,100% { transform: scale(1); }
          50%     { transform: scale(1.022); }
        }
        @keyframes amina-halo {
          0%,100% { opacity: 0.55; transform: scale(1); }
          50%     { opacity: 0.95; transform: scale(1.06); }
        }
        @media (prefers-reduced-motion: reduce) {
          @keyframes amina-orb-breathe { 0%,100% { transform: none; } }
          @keyframes amina-halo         { 0%,100% { transform: none; opacity: 0.6; } }
        }
      `}</style>
    </div>
  );
}


// ── Live dot ─────────────────────────────────────────────────────

function LiveDot({ color = "#5eead4", label }) {
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 6,
      color: "#cbd5e1", fontSize: 11.5, letterSpacing: 0.3,
    }}>
      <span style={{
        width: 8, height: 8, borderRadius: "50%", background: color,
        boxShadow: `0 0 0 0 ${color}`,
        animation: "amina-live-pulse 2.2s ease-in-out infinite",
      }} />
      {label}
      <style>{`
        @keyframes amina-live-pulse {
          0%   { box-shadow: 0 0 0 0 ${color}55; }
          70%  { box-shadow: 0 0 0 8px ${color}00; }
          100% { box-shadow: 0 0 0 0 ${color}00; }
        }
      `}</style>
    </span>
  );
}


// ── Hero chat input (is the primary CTA) ─────────────────────────

const SAMPLE_PROMPTS = [
  "What should my blood pressure target be?",
  "Safe to fast with diabetes during Ramadan?",
  "Help me read a 160/100 reading",
  "How do I take Amlodipine?",
];

function ChatHero() {
  const [draft, setDraft] = useState("");
  const inputRef = useRef(null);

  const go = useCallback((seed) => {
    try {
      if (seed) sessionStorage.setItem("AMINA_CHAT_SEED", seed);
      else      sessionStorage.removeItem("AMINA_CHAT_SEED");
    } catch { /* noop */ }
    window.location.hash = "#/chat";
  }, []);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <form onSubmit={(e) => { e.preventDefault(); go(draft.trim() || ""); }}
            style={{
              display: "flex", alignItems: "center", gap: 10,
              padding: "10px 10px 10px 22px",
              background: "rgba(15, 23, 42, 0.45)",
              border: "1px solid rgba(148, 163, 184, 0.22)",
              borderRadius: 999,
              boxShadow:
                "0 24px 60px rgba(0,0,0,0.35),"
              + " 0 0 0 1px rgba(167,139,250,0.14) inset",
              backdropFilter: "blur(18px)",
              WebkitBackdropFilter: "blur(18px)",
              transition: "border-color 220ms ease, box-shadow 220ms ease, transform 220ms ease",
            }}
            onMouseEnter={(e) => { e.currentTarget.style.transform = "translateY(-2px)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.transform = "translateY(0)"; }}
            onFocusCapture={(e) => {
              e.currentTarget.style.borderColor = "rgba(167, 139, 250, 0.65)";
              e.currentTarget.style.boxShadow   =
                "0 28px 64px rgba(99, 102, 241, 0.35),"
              + " 0 0 0 1px rgba(167,139,250,0.35) inset";
            }}
            onBlurCapture={(e) => {
              e.currentTarget.style.borderColor = "rgba(148, 163, 184, 0.22)";
              e.currentTarget.style.boxShadow   =
                "0 24px 60px rgba(0,0,0,0.35),"
              + " 0 0 0 1px rgba(167,139,250,0.14) inset";
            }}>
        <LiveDot label="Amina is online" />
        <input ref={inputRef}
               value={draft}
               onChange={(e) => setDraft(e.target.value)}
               placeholder="Ask Amina anything about your health…"
               autoComplete="off"
               style={{
                 flex: 1, padding: "12px 8px",
                 background: "transparent",
                 border: "none", outline: "none",
                 color: "#f8fafc", fontSize: 15.5,
                 fontFamily: "inherit", minWidth: 80,
               }} />
        <button type="submit"
                style={{
                  padding: "11px 20px",
                  background: draft.trim()
                    ? "linear-gradient(135deg, #7c3aed 0%, #4f46e5 100%)"
                    : "rgba(99, 102, 241, 0.22)",
                  color: draft.trim() ? "#fff" : "#c7d2fe",
                  border: "none", borderRadius: 999,
                  fontSize: 13, fontWeight: 700,
                  cursor: "pointer",
                  transition: "background 220ms ease, transform 120ms ease",
                  boxShadow: draft.trim()
                    ? "0 10px 24px rgba(124, 58, 237, 0.45)"
                    : "none",
                }}
                onMouseDown={(e) => { e.currentTarget.style.transform = "scale(0.97)"; }}
                onMouseUp={(e)   => { e.currentTarget.style.transform = "scale(1)"; }}>
          {draft.trim() ? "Send" : "Start chat"}
        </button>
      </form>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, paddingLeft: 4 }}>
        {SAMPLE_PROMPTS.map((p, i) => (
          <button key={i} onClick={() => go(p)}
                  style={{
                    padding: "6px 12px",
                    background: "transparent",
                    color: "#94a3b8",
                    border: "1px solid rgba(148, 163, 184, 0.18)",
                    borderRadius: 999,
                    fontSize: 12, fontWeight: 500, cursor: "pointer",
                    transition: "all 180ms ease",
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.color = "#f1f5f9";
                    e.currentTarget.style.borderColor = "rgba(167, 139, 250, 0.50)";
                    e.currentTarget.style.background  = "rgba(99, 102, 241, 0.08)";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.color = "#94a3b8";
                    e.currentTarget.style.borderColor = "rgba(148, 163, 184, 0.18)";
                    e.currentTarget.style.background  = "transparent";
                  }}>
            {p}
          </button>
        ))}
      </div>
    </div>
  );
}


// ── OAuth row (icon-only, pill) ─────────────────────────────────

const ICON_GOOGLE = (
  <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden>
    <path fill="#FFC107" d="M43.6 20.1H42V20H24v8h11.3C33.6 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3 0 5.8 1.1 8 3l5.7-5.7C34 6.1 29.3 4 24 4 13 4 4 13 4 24s9 20 20 20 20-9 20-20c0-1.3-.1-2.6-.4-3.9z"/>
    <path fill="#FF3D00" d="M6.3 14.7L12.9 19.5C14.7 15.1 19 12 24 12c3 0 5.8 1.1 8 3l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/>
    <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z"/>
    <path fill="#1976D2" d="M43.6 20.1H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.6-.4-3.9z"/>
  </svg>
);
const ICON_FACEBOOK = (
  <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden>
    <path fill="#1877F2" d="M24 12a12 12 0 10-13.9 11.85v-8.4H7.08V12h3.05V9.36c0-3 1.8-4.67 4.54-4.67 1.31 0 2.68.23 2.68.23v2.95h-1.51c-1.49 0-1.95.93-1.95 1.88V12h3.33l-.53 3.47h-2.8v8.38A12 12 0 0024 12z"/>
  </svg>
);
const ICON_DHIS2 = (
  <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden>
    <rect width="24" height="24" rx="5" fill="#147CD7"/>
    <path fill="#fff" d="M7 6h5.2c3.6 0 6 2.4 6 6s-2.4 6-6 6H7V6zm3 3v6h2.2c1.9 0 3.2-1.2 3.2-3s-1.3-3-3.2-3H10z"/>
  </svg>
);


function OAuthPill({ provider, icon, label, onClick, busy }) {
  return (
    <button type="button" onClick={onClick} disabled={!!busy}
            aria-label={`Sign in with ${label}`}
            style={{
              flex: "1 1 120px",
              padding: "11px 16px",
              display: "inline-flex", alignItems: "center",
              justifyContent: "center", gap: 10,
              background: "rgba(255, 255, 255, 0.04)",
              color: "#f1f5f9",
              border: "1px solid rgba(148, 163, 184, 0.18)",
              borderRadius: 12,
              fontSize: 13, fontWeight: 600,
              cursor: busy ? "not-allowed" : "pointer",
              transition: "all 200ms cubic-bezier(0.2,0.8,0.2,1)",
              backdropFilter: "blur(10px)",
              WebkitBackdropFilter: "blur(10px)",
            }}
            onMouseEnter={(e) => {
              if (busy) return;
              e.currentTarget.style.background  = "rgba(255, 255, 255, 0.09)";
              e.currentTarget.style.borderColor = "rgba(167, 139, 250, 0.55)";
              e.currentTarget.style.transform   = "translateY(-2px)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background  = "rgba(255, 255, 255, 0.04)";
              e.currentTarget.style.borderColor = "rgba(148, 163, 184, 0.18)";
              e.currentTarget.style.transform   = "translateY(0)";
            }}>
      {icon}<span>{busy === provider ? "…" : label}</span>
    </button>
  );
}


function OAuthRow() {
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState("");
  const go = async (id) => {
    setBusy(id); setError("");
    const r = await oauthLogin(id);
    setBusy(null);
    if (!r.ok) setError(r.error || `${id} sign-in failed`);
  };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <OAuthPill provider="google"   icon={ICON_GOOGLE}   label="Google"   onClick={() => go("google")}   busy={busy} />
        <OAuthPill provider="facebook" icon={ICON_FACEBOOK} label="Facebook" onClick={() => go("facebook")} busy={busy} />
        <OAuthPill provider="dhis2"    icon={ICON_DHIS2}    label="DHIS2"    onClick={() => go("dhis2")}    busy={busy} />
      </div>
      {error && (
        <div style={{
          padding: "7px 10px", fontSize: 11.5, color: "#fecaca",
          background: "rgba(248, 113, 113, 0.10)",
          border: "1px solid rgba(248, 113, 113, 0.30)",
          borderRadius: 8,
        }}>{error}</div>
      )}
    </div>
  );
}


// ── Persona tile ─────────────────────────────────────────────────

function Persona({ icon, label, desc, href, accent, signedIn, delay }) {
  const { ref, style } = useReveal(delay);
  return (
    <a ref={ref} href={href}
       onClick={(e) => { e.preventDefault(); window.location.hash = href; }}
       style={{
         ...style,
         position: "relative",
         display: "block", overflow: "hidden",
         padding: "26px 26px 22px 26px",
         background: "rgba(15, 23, 42, 0.40)",
         border: "1px solid rgba(148, 163, 184, 0.15)",
         borderRadius: 18,
         textDecoration: "none", color: "inherit",
         backdropFilter: "blur(10px)",
         WebkitBackdropFilter: "blur(10px)",
         transition: [style.transition,
                      "transform 280ms cubic-bezier(0.2,0.8,0.2,1)",
                      "border-color 280ms cubic-bezier(0.2,0.8,0.2,1)",
                      "box-shadow 280ms cubic-bezier(0.2,0.8,0.2,1)"].join(","),
       }}
       onMouseEnter={(e) => {
         e.currentTarget.style.transform   = "translateY(-4px)";
         e.currentTarget.style.borderColor = `${accent}66`;
         e.currentTarget.style.boxShadow   =
           `0 30px 60px rgba(0,0,0,0.35), 0 0 0 1px ${accent}33, 0 0 40px ${accent}22`;
       }}
       onMouseLeave={(e) => {
         e.currentTarget.style.transform   = "translateY(0)";
         e.currentTarget.style.borderColor = "rgba(148, 163, 184, 0.15)";
         e.currentTarget.style.boxShadow   = "none";
       }}>
      {/* Corner glow */}
      <span aria-hidden style={{
        position: "absolute", top: -40, right: -40,
        width: 160, height: 160, borderRadius: "50%",
        background: `radial-gradient(circle at 30% 30%, ${accent}55, transparent 70%)`,
        filter: "blur(12px)", pointerEvents: "none",
      }} />
      <div style={{
        width: 42, height: 42, borderRadius: 12,
        background: `${accent}24`, border: `1px solid ${accent}55`,
        display: "inline-flex", alignItems: "center", justifyContent: "center",
        fontSize: 22, marginBottom: 14,
      }}>{icon}</div>
      <div style={{ fontSize: 18, fontWeight: 800, color: "#fff",
                    letterSpacing: -0.3 }}>
        {label}
      </div>
      <div style={{ fontSize: 13, color: "#94a3b8", marginTop: 6, lineHeight: 1.5 }}>
        {desc}
      </div>
      <div style={{ marginTop: 18, display: "inline-flex",
                    alignItems: "center", gap: 6,
                    color: accent, fontSize: 13, fontWeight: 700 }}>
        {signedIn ? "Open" : "Continue"}
        <span style={{ transition: "transform 200ms" }}>→</span>
      </div>
    </a>
  );
}


// ── Feature ─────────────────────────────────────────────────────

function Feature({ icon, title, body, delay }) {
  const { ref, style } = useReveal(delay);
  return (
    <div ref={ref} style={{
      ...style,
      padding: "24px 26px 20px 26px",
      background: "rgba(15, 23, 42, 0.25)",
      border: "1px solid rgba(148, 163, 184, 0.10)",
      borderRadius: 16,
      transition: [style.transition,
                   "background 200ms ease",
                   "border-color 200ms ease"].join(","),
    }}
    onMouseEnter={(e) => {
      e.currentTarget.style.background  = "rgba(15, 23, 42, 0.50)";
      e.currentTarget.style.borderColor = "rgba(167, 139, 250, 0.30)";
    }}
    onMouseLeave={(e) => {
      e.currentTarget.style.background  = "rgba(15, 23, 42, 0.25)";
      e.currentTarget.style.borderColor = "rgba(148, 163, 184, 0.10)";
    }}>
      <div style={{
        width: 30, height: 30, borderRadius: 8,
        background: "rgba(94, 234, 212, 0.10)",
        border: "1px solid rgba(94, 234, 212, 0.30)",
        display: "inline-flex", alignItems: "center", justifyContent: "center",
        fontSize: 15, marginBottom: 10,
      }}>{icon}</div>
      <div style={{ fontSize: 14, fontWeight: 700, color: "#f1f5f9",
                    letterSpacing: -0.2 }}>{title}</div>
      <div style={{ fontSize: 12.5, color: "#94a3b8", marginTop: 6, lineHeight: 1.55 }}>
        {body}
      </div>
    </div>
  );
}


// ── Stat pill row ────────────────────────────────────────────────

function StatRow() {
  const Stat = ({ value, label }) => (
    <div style={{ flex: "1 1 120px", minWidth: 100 }}>
      <div style={{
        fontSize: 28, fontWeight: 800, color: "#fff",
        letterSpacing: -0.8,
        fontFeatureSettings: "'tnum' 1",
      }}>{value}</div>
      <div style={{
        fontSize: 11, color: "#94a3b8", marginTop: 4,
        letterSpacing: 1.5, textTransform: "uppercase", fontWeight: 600,
      }}>{label}</div>
    </div>
  );
  return (
    <div style={{
      display: "flex", gap: 24, flexWrap: "wrap",
      padding: "24px 26px",
      background: "rgba(15, 23, 42, 0.35)",
      border: "1px solid rgba(148, 163, 184, 0.14)",
      borderRadius: 18,
      backdropFilter: "blur(14px)",
      WebkitBackdropFilter: "blur(14px)",
    }}>
      <Stat value="24/7"   label="Availability" />
      <Stat value="2"      label="Languages" />
      <Stat value="13"     label="Partner Hospitals" />
      <Stat value="199"    label="Emergency Fallback" />
    </div>
  );
}


// ── Main ─────────────────────────────────────────────────────────

export default function HomePage({ navigate }) {
  const role = currentAuthRole();
  const heroRef    = useRef(null);
  const personas   = useReveal(60);
  const features   = useReveal(60);
  const stats      = useReveal(60);
  const footer     = useReveal(60);

  return (
    <div style={{
      maxWidth: 1160, margin: "0 auto",
      padding: "30px 28px 80px 28px",
      color: "#e2e8f0",
    }}>

      {/* ── HERO ─────────────────────────────────────────── */}
      <section ref={heroRef} style={{
        position: "relative",
        padding: "68px 0 64px 0",
      }}>
        <HeroBackdrop containerRef={heroRef} />
        <div style={{
          position: "relative", zIndex: 1,
          display: "grid",
          gridTemplateColumns: "minmax(0, 1.35fr) minmax(240px, 0.8fr)",
          gap: 44, alignItems: "center",
        }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 26 }}>
            <div style={{ display: "flex", gap: 18, alignItems: "center" }}>
              <LiveDot color="#5eead4" label="Online in The Gambia" />
              <span style={{ color: "rgba(148,163,184,0.35)" }}>·</span>
              <span style={{ color: "#94a3b8", fontSize: 11.5, letterSpacing: 0.3 }}>
                WHO-PEN grounded
              </span>
            </div>
            <h1 style={{
              margin: 0, color: "#fff",
              fontSize: "clamp(42px, 6.4vw, 84px)",
              lineHeight: 0.98,
              fontWeight: 800,
              letterSpacing: -2.5,
            }}>
              Health guidance<br/>
              <span style={{
                background: "linear-gradient(90deg, #5eead4 0%, #a78bfa 35%, #6366f1 70%, #a78bfa 100%)",
                backgroundSize: "200% 100%",
                WebkitBackgroundClip: "text", backgroundClip: "text",
                WebkitTextFillColor: "transparent", color: "transparent",
                animation: "amina-hero-gradient 9s ease-in-out infinite",
              }}>
                that listens.
              </span>
              <style>{`
                @keyframes amina-hero-gradient {
                  0%,100% { background-position:   0% 50%; }
                  50%     { background-position: 100% 50%; }
                }
                @media (prefers-reduced-motion: reduce) {
                  @keyframes amina-hero-gradient { 0%,100% { background-position: 0% 50%; } }
                }
              `}</style>
            </h1>
            <p style={{
              margin: 0, color: "#cbd5e1", maxWidth: 520,
              fontSize: "clamp(15px, 1.2vw, 17px)", lineHeight: 1.55,
              fontWeight: 400,
            }}>
              An AI health companion for everyday care, culturally grounded and
              clinically sound. Start talking — no account needed.
            </p>

            {!role && (
              <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
                <a href="#/login" onClick={(e) => { e.preventDefault(); navigate("#/login"); }}
                   style={{
                     display: "inline-flex", alignItems: "center", gap: 8,
                     padding: "12px 28px",
                     background: "linear-gradient(135deg, #7c3aed 0%, #4f46e5 100%)",
                     color: "#fff", fontSize: 15, fontWeight: 700,
                     textDecoration: "none", borderRadius: 12,
                     boxShadow: "0 6px 20px rgba(99,102,241,0.40), inset 0 1px 0 rgba(255,255,255,0.15)",
                     transition: "transform 180ms ease, box-shadow 180ms ease",
                     letterSpacing: 0.2,
                   }}
                   onMouseEnter={(e) => {
                     e.currentTarget.style.transform = "translateY(-2px)";
                     e.currentTarget.style.boxShadow = "0 10px 28px rgba(99,102,241,0.55), inset 0 1px 0 rgba(255,255,255,0.15)";
                   }}
                   onMouseLeave={(e) => {
                     e.currentTarget.style.transform = "translateY(0)";
                     e.currentTarget.style.boxShadow = "0 6px 20px rgba(99,102,241,0.40), inset 0 1px 0 rgba(255,255,255,0.15)";
                   }}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M15 3h4a2 2 0 012 2v14a2 2 0 01-2 2h-4"/><polyline points="10 17 15 12 10 7"/><line x1="15" y1="12" x2="3" y2="12"/></svg>
                  Sign in
                </a>
                <a href="#/signup" onClick={(e) => { e.preventDefault(); navigate("#/signup"); }}
                   style={{
                     display: "inline-flex", alignItems: "center", gap: 8,
                     padding: "12px 28px",
                     background: "rgba(148,163,184,0.10)",
                     border: "1.5px solid rgba(148,163,184,0.25)",
                     color: "#e2e8f0", fontSize: 15, fontWeight: 700,
                     textDecoration: "none", borderRadius: 12,
                     backdropFilter: "blur(8px)",
                     transition: "transform 180ms ease, background 180ms ease, border-color 180ms ease",
                     letterSpacing: 0.2,
                   }}
                   onMouseEnter={(e) => {
                     e.currentTarget.style.transform = "translateY(-2px)";
                     e.currentTarget.style.background = "rgba(148,163,184,0.18)";
                     e.currentTarget.style.borderColor = "rgba(167,139,250,0.45)";
                   }}
                   onMouseLeave={(e) => {
                     e.currentTarget.style.transform = "translateY(0)";
                     e.currentTarget.style.background = "rgba(148,163,184,0.10)";
                     e.currentTarget.style.borderColor = "rgba(148,163,184,0.25)";
                   }}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M16 21v-2a4 4 0 00-4-4H5a4 4 0 00-4-4v2"/><circle cx="8.5" cy="7" r="4"/><line x1="20" y1="8" x2="20" y2="14"/><line x1="23" y1="11" x2="17" y2="11"/></svg>
                  Create account
                </a>
              </div>
            )}

            <div style={{ maxWidth: 640 }}>
              <ChatHero />
            </div>
          </div>

          <div style={{ display: "flex", justifyContent: "center", alignItems: "center" }}>
            <AvatarOrb />
          </div>
        </div>

        {/* Heartbeat line at the bottom of hero */}
        <div style={{ position: "relative", height: 44 }}>
          <Heartbeat />
        </div>
      </section>

      {/* ── QUICK SIGN-IN STRIP ──────────────────────────── */}
      <section style={{
        display: "grid",
        gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1.4fr)",
        gap: 18, alignItems: "center",
        padding: "22px 26px",
        background:
          "linear-gradient(135deg, rgba(15,23,42,0.40) 0%, rgba(30,41,59,0.30) 100%)",
        border: "1px solid rgba(148, 163, 184, 0.12)",
        borderRadius: 18,
        backdropFilter: "blur(14px)",
        WebkitBackdropFilter: "blur(14px)",
        marginTop: 18,
      }}>
        <div>
          <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: 2.4,
                         textTransform: "uppercase", color: "#a78bfa" }}>
            Quick sign-in
          </div>
          <div style={{ fontSize: 14, color: "#cbd5e1", marginTop: 6,
                         lineHeight: 1.5 }}>
            Continue with an existing account — email sign-in on the login page.
          </div>
        </div>
        <OAuthRow />
      </section>

      {/* ── STATS ────────────────────────────────────────── */}
      <section ref={stats.ref} style={{ ...stats.style, marginTop: 20 }}>
        <StatRow />
      </section>

      {/* ── PERSONAS ─────────────────────────────────────── */}
      <section ref={personas.ref} style={{ ...personas.style, marginTop: 76 }}>
        <div style={{ marginBottom: 26, maxWidth: 540 }}>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 2.4,
                         textTransform: "uppercase", color: "#a78bfa" }}>
            Pick your view
          </div>
          <h2 style={{
            margin: "10px 0 0 0", color: "#fff",
            fontSize: "clamp(26px, 2.8vw, 34px)",
            fontWeight: 800, lineHeight: 1.1, letterSpacing: -1,
          }}>
            Three dedicated experiences, one platform.
          </h2>
        </div>
        <div style={{
          display: "grid", gap: 14,
          gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
        }}>
          <Persona icon="👤" label="Patient"
                   desc="Chat with Amina, track medicines, follow your care plan, invite a caregiver."
                   accent="#60a5fa" href="#/patient/login" delay={40}
                   signedIn={role === "patient"} />
          <Persona icon="🫶" label="Caregiver"
                   desc="Live inbox of messages and emergencies, one-tap hospital escalation."
                   accent="#a78bfa" href="#/caregiver/login" delay={120}
                   signedIn={role === "caregiver"} />
          <Persona icon="🛡" label="Admin"
                   desc="Community oversight, DHIS2 sync, cluster alerts, village scoreboard."
                   accent="#f472b6" href="#/admin/login" delay={200}
                   signedIn={role === "admin"} />
        </div>
      </section>

      {/* ── FEATURES ────────────────────────────────────── */}
      <section ref={features.ref} style={{ ...features.style, marginTop: 76 }}>
        <div style={{ marginBottom: 26, maxWidth: 540 }}>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 2.4,
                         textTransform: "uppercase", color: "#a78bfa" }}>
            Why Amina
          </div>
          <h2 style={{
            margin: "10px 0 0 0", color: "#fff",
            fontSize: "clamp(26px, 2.8vw, 34px)",
            fontWeight: 800, lineHeight: 1.1, letterSpacing: -1,
          }}>
            Clinical. Cultural. Continuous.
          </h2>
        </div>
        <div style={{
          display: "grid", gap: 12,
          gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
        }}>
          <Feature icon="🩺" title="WHO-PEN grounded"
                   body="NCD guidance tuned to Gambian practice — diabetes, hypertension, asthma."
                   delay={0} />
          <Feature icon="🚨" title="Emergency escalation"
                   body="Caregiver → hospital → 199 fallback with a 60-minute admin safety net."
                   delay={80} />
          <Feature icon="🏥" title="DHIS2 ready"
                   body="Tracker and aggregate sync to the national dataset, configurable per pilot."
                   delay={160} />
          <Feature icon="🔒" title="Private by default"
                   body="Nothing leaves your account unless you invite a caregiver."
                   delay={240} />
          <Feature icon="🌍" title="Bilingual"
                   body="English and Mandinka, built with community health workers."
                   delay={320} />
          <Feature icon="📝" title="Continuity"
                   body="Every follow-up remembered — no starting over each consultation."
                   delay={400} />
        </div>
      </section>

      {/* ── CLOSING CTA ─────────────────────────────────── */}
      <section style={{ marginTop: 80, textAlign: "center" }}>
        <h2 style={{
          margin: 0, color: "#fff",
          fontSize: "clamp(28px, 3.2vw, 38px)",
          fontWeight: 800, letterSpacing: -0.8,
        }}>
          Health advice, whenever you need it.
        </h2>
        <p style={{ margin: "12px auto 0 auto", color: "#94a3b8",
                     maxWidth: 480, fontSize: 15, lineHeight: 1.55 }}>
          No subscription. No sign-up. Just open the chat and ask.
        </p>
        <button type="button"
                onClick={() => { window.location.hash = "#/chat"; }}
                style={{
                  marginTop: 22,
                  padding: "14px 26px",
                  background: "linear-gradient(135deg, #7c3aed 0%, #4f46e5 100%)",
                  color: "#fff", border: "none",
                  borderRadius: 999, fontSize: 15, fontWeight: 800,
                  letterSpacing: 0.2, cursor: "pointer",
                  boxShadow: "0 20px 44px rgba(124, 58, 237, 0.45)",
                  transition: "transform 220ms ease, box-shadow 220ms ease",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.transform  = "translateY(-2px) scale(1.02)";
                  e.currentTarget.style.boxShadow  = "0 28px 56px rgba(124, 58, 237, 0.55)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.transform  = "translateY(0) scale(1)";
                  e.currentTarget.style.boxShadow  = "0 20px 44px rgba(124, 58, 237, 0.45)";
                }}>
          Open chat →
        </button>
      </section>

      {/* ── FOOTER ──────────────────────────────────────── */}
      <footer ref={footer.ref} style={{
        ...footer.style,
        marginTop: 80, paddingTop: 24,
        borderTop: "1px solid rgba(148, 163, 184, 0.14)",
        display: "flex", gap: 14, flexWrap: "wrap",
        alignItems: "center", justifyContent: "space-between",
        color: "#64748b", fontSize: 12,
      }}>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <div style={{
            width: 22, height: 22, borderRadius: 6,
            background: "linear-gradient(135deg, #8b5cf6, #6366f1)",
            display: "inline-flex", alignItems: "center", justifyContent: "center",
            color: "#fff", fontSize: 11, fontWeight: 800,
          }}>A</div>
          <span>AMINA · Powered by WHO PEN Protocols</span>
        </div>
        <div style={{ display: "flex", gap: 18 }}>
          <a href="#/chat"   onClick={(e) => { e.preventDefault(); window.location.hash = "#/chat"; }}
             style={{ color: "#94a3b8", textDecoration: "none", fontWeight: 600 }}>Chat</a>
          <a href="#/login"  onClick={(e) => { e.preventDefault(); navigate("#/login"); }}
             style={{ color: "#94a3b8", textDecoration: "none", fontWeight: 600 }}>Sign in</a>
          <a href="#/signup" onClick={(e) => { e.preventDefault(); navigate("#/signup"); }}
             style={{ color: "#94a3b8", textDecoration: "none", fontWeight: 600 }}>Create account</a>
        </div>
      </footer>
    </div>
  );
}
