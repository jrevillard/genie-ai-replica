/**
 * AuthHeroArt — role-specific hero illustrations for the login card.
 * ===================================================================
 *
 * Renders one of three character images inside a role-themed gradient
 * panel. Inspired by the "Leavenoone" Dribbble onboarding flow where
 * the hero illustration occupies the top half of the auth card.
 *
 * Image files (drop in by the user — see README at bottom):
 *   /public/auth-art/patient.png   — Gambian family scene
 *   /public/auth-art/caregiver.png — CHW / nurse character
 *   /public/auth-art/admin.png     — Gambian admin / business character
 *
 * The hero works out-of-the-box without the files: each variant has a
 * graceful placeholder that shows an SVG badge + role text. As soon as
 * the PNG is dropped in, the image takes over (onLoad swap).
 *
 * Transparency handling
 * ---------------------
 * The 3 reference characters have DIFFERENT background treatments:
 *   - patient  : already lives inside a drawn living-room scene
 *                (warm cream), so we let the image breathe edge-to-edge
 *                inside a cream-tinted frame.
 *   - caregiver: plain white background in the source, so we drop a
 *                soft teal gradient behind it and let it mask-out.
 *   - admin    : plain white background in the source, so we drop a
 *                soft indigo gradient behind it.
 *
 * Animation: subtle float + fade-in on variant change. Respects
 * `prefers-reduced-motion`.
 */

import { memo, useState } from "react";


const META = {
  patient: {
    src:  "/auth-art/patient.png",
    alt:  "A Gambian family at home — patient sign-in",
    bg:   "linear-gradient(135deg, #fef3c7 0%, #fde68a 40%, #fbbf24 100%)",
    glowA: "rgba(245, 158, 11, 0.25)",
    glowB: "rgba(217, 119, 6,  0.18)",
    accent: "#f59e0b",
    placeholder: "👨‍👩‍👧",
    label: "Patient",
    objectFit: "cover",  // fills the frame (scene illustration)
    imgPad: 0,
  },
  caregiver: {
    src:  "/auth-art/caregiver.png",
    alt:  "Community health worker — caregiver sign-in",
    bg:   "linear-gradient(135deg, #ccfbf1 0%, #5eead4 45%, #14b8a6 100%)",
    glowA: "rgba(20, 184, 166, 0.28)",
    glowB: "rgba(13, 148, 136, 0.20)",
    accent: "#14b8a6",
    placeholder: "🫶",
    label: "Caregiver",
    objectFit: "contain",
    imgPad: 16,
  },
  government: {
    src:  "/auth-art/admin.png",              // reuse admin portrait with cooler blue wash
    alt:  "Government — Ministry of Health sign-in",
    bg:   "linear-gradient(135deg, #dbeafe 0%, #93c5fd 45%, #2563eb 100%)",
    glowA: "rgba(37, 99, 235, 0.30)",
    glowB: "rgba(29, 78, 216, 0.20)",
    accent: "#2563eb",
    placeholder: "🏛",
    label: "Government",
    objectFit: "contain",
    imgPad: 16,
  },
  admin: {
    src:  "/auth-art/admin.png",
    alt:  "Administrator — admin sign-in",
    bg:   "linear-gradient(135deg, #e0e7ff 0%, #a5b4fc 45%, #6366f1 100%)",
    glowA: "rgba(99, 102, 241, 0.30)",
    glowB: "rgba(79, 70, 229, 0.20)",
    accent: "#6366f1",
    placeholder: "🛡",
    label: "Admin",
    objectFit: "contain",
    imgPad: 16,
  },
};


function Placeholder({ label, emoji, accent }) {
  return (
    <div style={{
      display: "flex", flexDirection: "column",
      alignItems: "center", justifyContent: "center",
      gap: 8,
      color: "rgba(15, 23, 42, 0.75)",
      fontWeight: 700, letterSpacing: 0.3,
    }}>
      <div style={{
        width: 96, height: 96, borderRadius: "50%",
        background: "rgba(255, 255, 255, 0.55)",
        border: `2px solid ${accent}`,
        display: "flex", alignItems: "center", justifyContent: "center",
        fontSize: 48,
        boxShadow: "0 6px 20px rgba(0, 0, 0, 0.15)",
      }}>{emoji}</div>
      <div style={{ fontSize: 13, textTransform: "uppercase", letterSpacing: 1 }}>
        {label}
      </div>
      <div style={{
        fontSize: 11, color: "rgba(15, 23, 42, 0.55)",
        textAlign: "center", maxWidth: 260, padding: "0 12px",
        lineHeight: 1.4, fontWeight: 500,
      }}>
        Drop the character image at <code style={{
          background: "rgba(255,255,255,0.55)", padding: "1px 5px",
          borderRadius: 4, fontSize: 10,
        }}>/public/auth-art/{label.toLowerCase()}.png</code>
      </div>
    </div>
  );
}


function AuthHeroArtInner({ variant = "patient", height = 280 }) {
  const meta = META[variant] || META.patient;
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);

  return (
    <div
      key={variant}       // remount → fresh fade/slide
      className="amina-hero"
      style={{
        position: "relative",
        height,
        width: "100%",
        background: meta.bg,
        overflow: "hidden",
        borderBottom: "1px solid rgba(148, 163, 184, 0.10)",
      }}
    >
      {/* Ambient glow blobs (absolute) */}
      <div className="hero-glow-a" style={{
        position: "absolute",
        top: -40, left: -30,
        width: 200, height: 200, borderRadius: "50%",
        background: `radial-gradient(circle, ${meta.glowA} 0%, transparent 70%)`,
        filter: "blur(10px)",
        pointerEvents: "none",
      }} />
      <div className="hero-glow-b" style={{
        position: "absolute",
        bottom: -60, right: -40,
        width: 240, height: 240, borderRadius: "50%",
        background: `radial-gradient(circle, ${meta.glowB} 0%, transparent 70%)`,
        filter: "blur(10px)",
        pointerEvents: "none",
      }} />

      {/* Decorative dot grid (top-right) */}
      <svg
        aria-hidden="true"
        width="60" height="60"
        style={{ position: "absolute", top: 12, right: 12, opacity: 0.32 }}
      >
        {[0, 1, 2, 3].flatMap((y) =>
          [0, 1, 2, 3].map((x) => (
            <circle
              key={`${x}-${y}`}
              cx={x * 14 + 4} cy={y * 14 + 4} r="1.5"
              fill="rgba(15, 23, 42, 0.5)"
            />
          ))
        )}
      </svg>

      {/* Decorative wavy strip at bottom */}
      <svg
        aria-hidden="true"
        viewBox="0 0 400 40" preserveAspectRatio="none"
        style={{ position: "absolute", left: 0, right: 0, bottom: 0,
                 width: "100%", height: 22, opacity: 0.9 }}
      >
        <path
          d="M 0 20 Q 100 0, 200 20 T 400 20 L 400 40 L 0 40 Z"
          fill="rgba(15, 23, 42, 0.55)"
        />
      </svg>

      {/* Character — image if present, else placeholder */}
      <div
        className="hero-float"
        style={{
          position: "absolute",
          inset: 0,
          padding: meta.imgPad,
          display: "flex",
          alignItems: "flex-end",
          justifyContent: "center",
          zIndex: 1,
        }}
      >
        {failed ? (
          <Placeholder label={meta.label} emoji={meta.placeholder} accent={meta.accent} />
        ) : (
          <img
            src={meta.src}
            alt={meta.alt}
            onLoad={() => setLoaded(true)}
            onError={() => setFailed(true)}
            style={{
              maxHeight: "100%",
              maxWidth: "100%",
              width: meta.objectFit === "cover" ? "100%" : "auto",
              height: meta.objectFit === "cover" ? "100%" : "auto",
              objectFit: meta.objectFit,
              objectPosition: "center bottom",
              opacity: loaded ? 1 : 0,
              transition: "opacity 400ms ease",
              // Soft drop-shadow so characters feel grounded
              filter: "drop-shadow(0 6px 12px rgba(0, 0, 0, 0.22))",
            }}
          />
        )}
      </div>

      {/* Loading shimmer while image fetches (only shown if not loaded + not failed) */}
      {!loaded && !failed && (
        <div aria-hidden="true" style={{
          position: "absolute", inset: 0,
          background: "linear-gradient(100deg, transparent 0%, rgba(255,255,255,0.12) 50%, transparent 100%)",
          backgroundSize: "200% 100%",
          animation: "amina-hero-shimmer 1.6s ease-in-out infinite",
          pointerEvents: "none",
        }} />
      )}
    </div>
  );
}

const AuthHeroArt = memo(AuthHeroArtInner);
export default AuthHeroArt;


// ── inject keyframes once ───────────────────────────────────────

if (typeof document !== "undefined" && !document.getElementById("amina-hero-art-style")) {
  const s = document.createElement("style");
  s.id = "amina-hero-art-style";
  s.textContent = `
    @keyframes amina-hero-enter {
      from { opacity: 0; transform: translateY(8px) scale(0.985); }
      to   { opacity: 1; transform: translateY(0)   scale(1);     }
    }
    @keyframes amina-hero-float {
      0%, 100% { transform: translateY(0); }
      50%      { transform: translateY(-4px); }
    }
    @keyframes amina-hero-glow-a {
      0%, 100% { transform: translate(0, 0)   scale(1);    opacity: 1; }
      50%      { transform: translate(10px, 12px) scale(1.08); opacity: 0.85; }
    }
    @keyframes amina-hero-glow-b {
      0%, 100% { transform: translate(0, 0)   scale(1);    opacity: 1; }
      50%      { transform: translate(-8px, -10px) scale(1.12); opacity: 0.8; }
    }
    @keyframes amina-hero-shimmer {
      0%   { background-position: 200% 0; }
      100% { background-position: -100% 0; }
    }
    .amina-hero        { animation: amina-hero-enter 420ms cubic-bezier(0.16, 1, 0.3, 1); }
    .hero-float        { animation: amina-hero-float  6.5s ease-in-out infinite; }
    .hero-glow-a       { animation: amina-hero-glow-a 9s  ease-in-out infinite; }
    .hero-glow-b       { animation: amina-hero-glow-b 11s ease-in-out infinite; }
    @media (prefers-reduced-motion: reduce) {
      .amina-hero, .hero-float, .hero-glow-a, .hero-glow-b { animation: none; }
    }
  `;
  document.head.appendChild(s);
}


/*
 * ─────────────────────────────────────────────────────────────────
 *  How to install the 3 character images
 * ─────────────────────────────────────────────────────────────────
 *
 *  Save your 3 reference PNGs (transparent background preferred) to:
 *
 *    components/frontend/public/auth-art/patient.png
 *    components/frontend/public/auth-art/caregiver.png
 *    components/frontend/public/auth-art/admin.png
 *
 *  Recommended:
 *    • PNG with transparent background for caregiver + admin
 *    • Scene illustration (any bg) for patient — frame shows it edge-to-edge
 *    • Square or portrait aspect (e.g. 600×600 or 600×800)
 *    • Under 200 KB each; use https://tinypng.com to compress
 *
 *  Hot-reload picks them up without restarting Vite. Until they're
 *  present, the UI shows a tasteful placeholder pointing to the
 *  expected path.
 */
