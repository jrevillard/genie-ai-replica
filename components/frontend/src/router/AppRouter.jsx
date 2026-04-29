/**
 * AppRouter — hash-based page router with always-visible top nav.
 *
 * Routes
 * ------
 *   #/                     → redirect: if not signed in → #/home, else #/{role}
 *   #/home                 → landing page (marketing + CTAs)
 *
 *   #/login                → 3-tab login (defaults to patient tab)
 *   #/patient/login        → login, patient tab
 *   #/caregiver/login      → login, caregiver tab
 *   #/admin/login          → login, admin tab
 *
 *   #/signup               → 2-tab signup (defaults to patient)
 *   #/patient/signup       → signup, patient tab
 *   #/caregiver/signup     → signup, caregiver tab (invite code)
 *
 *   #/chat                 → full-screen Amina chat
 *
 *   #/patient              → patient dashboard (App.jsx) — forces AMINA_ACTIVE=pt
 *   #/caregiver            → caregiver portal (App.jsx)  — forces AMINA_ACTIVE=cg
 *   #/admin                → admin console (App.jsx)     — forces AMINA_ACTIVE=ad
 *   #/dashboard            → alias → whichever role is active
 *
 * Mechanism
 * ---------
 * The nav bar is ALWAYS visible (even on dashboard routes) so the user
 * can always reach Home/Chat/Login/Signup without refreshing. When a
 * dashboard URL doesn't match the currently-active role, we use the
 * sessionRegistry to switch slots (and reload once) so App.jsx
 * re-renders the correct shell.
 */

import { useCallback, useEffect, useState } from "react";
import HomePage   from "./pages/HomePage.jsx";
import LoginPage  from "./pages/LoginPage.jsx";
import SignupPage from "./pages/SignupPage.jsx";
import ChatPage   from "./pages/ChatPage.jsx";
import EmergencyAdminPage from "../emergency/EmergencyAdminPage.jsx";
import AdminShell from "../admin/AdminShell.jsx";
import GovShell   from "../gov/GovShell.jsx";
import DisclaimerPage from "../admin/DisclaimerPage.jsx";
import { registerGovSw } from "../gov/registerPwa.js";
import { signOutAdminAndGov } from "../auth/signOut.js";
import {
  switchTo, getSlot, getActive,
} from "../session/sessionRegistry.js";


// ── role helpers ───────────────────────────────────────────────────

const DASHBOARD_ROUTES = new Set([
  "dashboard", "patient", "caregiver", "admin",
]);


export function currentAuthRole() {
  try {
    if (localStorage.getItem("AMINA_ADMIN_TOKEN")) return "admin";
    if (localStorage.getItem("cg_token"))          return "caregiver";
    if (localStorage.getItem("AMINA_TOKEN")
     && localStorage.getItem("AMINA_PATIENT"))      return "patient";
  } catch { /* noop */ }
  return null;
}


const ROLE_TO_KEY = { patient: "pt", caregiver: "cg", admin: "ad" };
const KEY_TO_ROLE = { pt: "patient", cg: "caregiver", ad: "admin" };


export function navigate(route) {
  try {
    if (!route.startsWith("#")) route = `#/${route.replace(/^\//, "")}`;
    window.location.hash = route;
  } catch { /* noop */ }
}


// ── route parser ──────────────────────────────────────────────────

function _parseRoute(hash) {
  const h = (hash || "").toLowerCase().split("?")[0].replace(/\/+$/, "") || "#/";

  // Nested auth routes first.
  if (h === "#/patient/login")      return { page: "login",  tab: "pt" };
  if (h === "#/patient/signup")     return { page: "signup", tab: "pt" };
  if (h === "#/caregiver/login")    return { page: "login",  tab: "cg" };
  if (h === "#/caregiver/signup")   return { page: "signup", tab: "cg" };
  if (h === "#/admin/login")        return { page: "login",  tab: "ad" };
  if (h === "#/admin/emergencies")  return { page: "admin_emergencies" };

  // Role-specific dashboard shells.
  if (h === "#/patient")            return { page: "dashboard", forceRole: "patient" };
  if (h === "#/caregiver")          return { page: "dashboard", forceRole: "caregiver" };
  if (h === "#/admin")              return { page: "admin_console" };
  if (h === "#/dashboard" || h === "#" || h === "#/") return { page: "dashboard" };

  // Plain overlay pages.
  if (h === "#/home")               return { page: "home"   };
  if (h === "#/login")              return { page: "login"  };
  if (h === "#/signup")             return { page: "signup" };
  if (h === "#/chat")               return { page: "chat"   };

  // New admin console (polished shell, 6 sections, cmd-K palette)
  if (h === "#/admin/console")      return { page: "admin_console" };
  // Government Observatory (separate shell, aggregate-only)
  if (h === "#/gov" || h.startsWith("#/gov/")) return { page: "gov" };
  // Synthetic-data legal disclaimer (linked from consent gate + footers)
  if (h === "#/disclaimer")        return { page: "disclaimer" };

  return { page: "dashboard" };
}


// ── hide dashboard overlays when an overlay page is active ────────

function _setDashboardVisibility(visible) {
  try {
    const root = document.getElementById("root");
    if (root) root.style.display = visible ? "" : "none";
    const overlayIds = [
      "amina-inbox-root",
      "amina-caregiver-inbox-root",
      "amina-role-switcher-root",
      "amina-supply-ledger-root",
      "amina-dualpath-ledger-root",
      "amina-scout-manager-root",
      "amina-village-manager-root",
      "amina-bantaba-manager-root",
    ];
    for (const id of overlayIds) {
      const el = document.getElementById(id);
      if (el) el.style.display = visible ? "" : "none";
    }
  } catch { /* noop */ }
}


// ── nav bar (always visible) ─────────────────────────────────────
//
// Design: clinical, modern, quiet. Cues adapted from Linear / Arc:
//   • No colored pill on the active item — instead, a 2px underline
//     dot in the brand accent slides under the active link.
//   • Monochrome SVG icons (no emoji) for crisp rendering at 13px.
//   • Two logical zones:
//       left   — brand mark + primary product nav (Home / Chat)
//       right  — role-scoped nav, role chip, + auth actions
//   • Auth actions split: "Sign in" ghost, "Create account" filled.
//   • Slow, subtle motion: 220ms ease-out, no bouncing.

const ICON_NAV = {
  home:       "M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H10v6H5a1 1 0 0 1-1-1z",
  chat:       "M4 4h16a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H9l-5 4V5a1 1 0 0 1 1-1z",
  dashboard:  "M3 12h8V3H3zM13 21h8V3h-8zM3 21h8v-6H3z",
  care:       "M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 1 0-7.8 7.8l1 1 7.8 7.9 7.9-7.9 1-1a5.5 5.5 0 0 0-.1-7.8z",
  shield:     "M12 2 4 5v6c0 5 3.4 9.4 8 11 4.6-1.6 8-6 8-11V5z",
  alert:      "M12 3 2 21h20zM12 10v5M12 18v.01",
  plus:       "M12 5v14M5 12h14",
  login:      "M10 17l5-5-5-5M15 12H3M21 4v16",
};


function NavIcon({ d, size = 14, strokeWidth = 2 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
         stroke="currentColor" strokeWidth={strokeWidth}
         strokeLinecap="round" strokeLinejoin="round"
         aria-hidden style={{ flexShrink: 0 }}>
      <path d={d} />
    </svg>
  );
}


function RoleChip({ role }) {
  if (!role) return null;
  const palette = {
    patient:   { bg: "rgba(96, 165, 250, 0.12)",  fg: "#bfdbfe", dot: "#60a5fa" },
    caregiver: { bg: "rgba(167, 139, 250, 0.12)", fg: "#ddd6fe", dot: "#a78bfa" },
    admin:     { bg: "rgba(244, 114, 182, 0.12)", fg: "#fbcfe8", dot: "#f472b6" },
  }[role] || { bg: "rgba(148, 163, 184, 0.12)", fg: "#cbd5e1", dot: "#94a3b8" };
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 6,
      padding: "4px 10px", borderRadius: 999,
      background: palette.bg, color: palette.fg,
      fontSize: 11, fontWeight: 700, letterSpacing: 0.35,
      textTransform: "uppercase",
    }}>
      <span style={{
        width: 6, height: 6, borderRadius: "50%",
        background: palette.dot,
        boxShadow: `0 0 10px ${palette.dot}`,
      }} />
      {role}
    </span>
  );
}


function NavLink({ href, label, icon, active, onClick }) {
  const [hover, setHover] = useState(false);
  return (
    <a href={href} onClick={onClick}
       onMouseEnter={() => setHover(true)}
       onMouseLeave={() => setHover(false)}
       aria-current={active ? "page" : undefined}
       style={{
         position: "relative",
         padding: "7px 11px",
         display: "inline-flex", alignItems: "center", gap: 7,
         color: active ? "#fff"
              : hover  ? "#e2e8f0"
                       : "#94a3b8",
         fontSize: 13, fontWeight: 600, letterSpacing: -0.1,
         textDecoration: "none",
         borderRadius: 8,
         background: hover && !active ? "rgba(148, 163, 184, 0.08)" : "transparent",
         transition: "color 180ms ease, background 180ms ease",
       }}>
      <NavIcon d={icon} />
      <span>{label}</span>
      {/* Active underline dot — slides in via scale */}
      <span aria-hidden style={{
        position: "absolute", left: "50%", bottom: -10,
        width: active ? 18 : 0, height: 2,
        transform: "translateX(-50%)",
        borderRadius: 2,
        background: "linear-gradient(90deg, #8b5cf6 0%, #6366f1 100%)",
        boxShadow: active ? "0 0 12px rgba(139, 92, 246, 0.55)" : "none",
        transition: "width 280ms cubic-bezier(0.2, 0.8, 0.2, 1), box-shadow 280ms",
      }} />
    </a>
  );
}


function AuthActions({ role, go }) {
  // Signed out → ghost "Sign in" + filled "Create account"
  if (!role) {
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <a href="#/login" onClick={go("#/login")}
           style={{
             padding: "7px 12px",
             color: "#cbd5e1", fontSize: 13, fontWeight: 600,
             textDecoration: "none", borderRadius: 8,
             transition: "color 160ms ease",
           }}
           onMouseEnter={(e) => e.currentTarget.style.color = "#fff"}
           onMouseLeave={(e) => e.currentTarget.style.color = "#cbd5e1"}>
          Sign in
        </a>
        <a href="#/signup" onClick={go("#/signup")}
           style={{
             padding: "7px 14px",
             background: "linear-gradient(135deg, #7c3aed 0%, #4f46e5 100%)",
             color: "#fff",
             fontSize: 13, fontWeight: 700, letterSpacing: 0.1,
             textDecoration: "none", borderRadius: 999,
             boxShadow: "0 6px 16px rgba(99, 102, 241, 0.35)",
             transition: "transform 180ms ease, box-shadow 180ms ease",
           }}
           onMouseEnter={(e) => {
             e.currentTarget.style.transform = "translateY(-1px)";
             e.currentTarget.style.boxShadow = "0 10px 22px rgba(99, 102, 241, 0.50)";
           }}
           onMouseLeave={(e) => {
             e.currentTarget.style.transform = "translateY(0)";
             e.currentTarget.style.boxShadow = "0 6px 16px rgba(99, 102, 241, 0.35)";
           }}>
          Create account
        </a>
      </div>
    );
  }
  // Signed in → role chip only. Switching accounts happens via the
  // SessionSwitcher pill (top-left) or /login.
  return <RoleChip role={role} />;
}


function TopNav({ route, role }) {
  const go = (r) => (e) => { e.preventDefault(); navigate(r); };

  const home = {
    href: "#/home", icon: ICON_NAV.home, label: "Home",
    active: route === "home",
  };
  const chat = {
    href: "#/chat", icon: ICON_NAV.chat, label: "Chat",
    active: route === "chat",
  };

  // Role-scoped nav items
  const scoped = [];
  if (role === "patient") scoped.push({
    href: "#/patient", icon: ICON_NAV.dashboard, label: "Dashboard",
    active: route === "dashboard" || route === "pt",
  });
  if (role === "caregiver") scoped.push({
    href: "#/caregiver", icon: ICON_NAV.care, label: "Portal",
    active: route === "dashboard" || route === "cg",
  });
  if (role === "admin") scoped.push({
    href: "#/admin/console", icon: ICON_NAV.shield, label: "Console",
    active: route === "admin_console" || route === "dashboard" || route === "ad",
  });
  if (role === "admin") scoped.push({
    href: "#/gov", icon: ICON_NAV.shield, label: "Government view",
    active: route === "gov",
  });
  if (role === "admin") scoped.push({
    href: "#/admin/emergencies", icon: ICON_NAV.alert, label: "Emergencies",
    active: route === "admin_emergencies",
  });

  return (
    <nav style={{
      position: "fixed", top: 0, left: 0, right: 0,
      zIndex: 9810, height: 52,
      padding: "0 22px",
      background: "linear-gradient(180deg, rgba(9,14,24,0.90) 0%, rgba(9,14,24,0.78) 100%)",
      backdropFilter: "blur(18px) saturate(140%)",
      WebkitBackdropFilter: "blur(18px) saturate(140%)",
      borderBottom: "1px solid rgba(148, 163, 184, 0.10)",
      boxShadow: "0 1px 0 rgba(255,255,255,0.03) inset",
      display: "flex", alignItems: "center", gap: 6,
      fontFamily: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
      pointerEvents: "auto",
    }}>
      {/* ── Brand ───────────────────────────────────── */}
      <a href="#/home" onClick={go("#/home")}
         style={{
           display: "inline-flex", alignItems: "center", gap: 10,
           color: "#fff", textDecoration: "none",
           paddingRight: 16,
           marginRight: 8,
           borderRight: "1px solid rgba(148, 163, 184, 0.10)",
           height: 52,
         }}>
        <span aria-hidden style={{
          position: "relative",
          width: 28, height: 28, borderRadius: 9,
          background: "linear-gradient(135deg, #c4b5fd 0%, #8b5cf6 45%, #4f46e5 100%)",
          display: "inline-flex", alignItems: "center", justifyContent: "center",
          boxShadow: "0 4px 14px rgba(99,102,241,0.45), inset 0 0 0 1px rgba(255,255,255,0.15)",
          animation: "amina-nav-brand-breathe 6s ease-in-out infinite",
        }}>
          <span style={{
            color: "#fff", fontFamily: "'Times New Roman', Georgia, serif",
            fontSize: 16, fontWeight: 700, letterSpacing: -0.5,
            lineHeight: 1,
          }}>A</span>
          <span aria-hidden style={{
            position: "absolute", inset: -3, borderRadius: 11,
            border: "1px solid rgba(167, 139, 250, 0.28)",
            animation: "amina-nav-brand-halo 6s ease-in-out infinite",
            pointerEvents: "none",
          }} />
        </span>
        <span style={{
          fontWeight: 800, fontSize: 14, letterSpacing: 1.2,
        }}>AMINA</span>
      </a>

      {/* ── Main nav ────────────────────────────────── */}
      <div style={{ display: "flex", alignItems: "center", gap: 2 }}>
        <NavLink href={home.href} label={home.label} icon={home.icon}
                 active={home.active} onClick={go(home.href)} />
        <NavLink href={chat.href} label={chat.label} icon={chat.icon}
                 active={chat.active} onClick={go(chat.href)} />
        {scoped.map((it) => (
          <NavLink key={it.href} href={it.href} label={it.label} icon={it.icon}
                   active={it.active} onClick={go(it.href)} />
        ))}
      </div>

      <div style={{ flex: 1 }} />

      {/* ── Auth actions ────────────────────────────── */}
      <AuthActions role={role} go={go} />

      <style>{`
        @keyframes amina-nav-brand-breathe {
          0%,100% { transform: scale(1); }
          50%     { transform: scale(1.04); }
        }
        @keyframes amina-nav-brand-halo {
          0%,100% { opacity: 0.35; transform: scale(1); }
          50%     { opacity: 0.85; transform: scale(1.08); }
        }
        @media (prefers-reduced-motion: reduce) {
          @keyframes amina-nav-brand-breathe { 0%,100% { transform: none; } }
          @keyframes amina-nav-brand-halo    { 0%,100% { opacity: 0.4; transform: none; } }
        }
      `}</style>
    </nav>
  );
}


// ── force a role switch based on URL ──────────────────────────────

function _enforceForceRole(forceRole) {
  if (!forceRole) return;
  const activeKey = getActive();
  const wantKey   = ROLE_TO_KEY[forceRole];
  if (!wantKey) return;
  if (activeKey === wantKey) return;
  // Does the user have a slot for this role?
  if (getSlot(wantKey)) {
    // Switch. switchTo() sets the key, dispatches event, and reloads
    // after 50ms — exactly what we need to swap App.jsx's shell.
    switchTo(wantKey);
    return;
  }
  // No slot for the forced role → send them to the correct login tab.
  const loginRoute = `#/${forceRole}/login`;
  setTimeout(() => navigate(loginRoute), 50);
}


// ── main router ───────────────────────────────────────────────────

// ── Route wrappers for the two new shells ───────────────────────

function AdminConsoleRoute() {
  const token = (typeof localStorage !== "undefined"
    && (localStorage.getItem("AMINA_ADMIN_TOKEN") || localStorage.getItem("AMINA_TOKEN"))) || "";
  const onLogout = () => {
    // Hard sign-out: see components/frontend/src/auth/signOut.js for
    // the full list of keys cleared and the rationale. Bug fix
    // 2026-04-30: the previous version cleared only AMINA_TOKEN +
    // AMINA_ADMIN_TOKEN, leaving AMINA_ADMIN ("true"/"false") flag,
    // AMINA_GOV_OFFICIAL, and the sessionStorage observatory consent
    // receipt — so the user appeared logged in on next nav and the
    // policy gate didn't re-prompt on the next sign-in.
    signOutAdminAndGov();
    navigate("#/login");
  };
  return <AdminShell token={token} onLogout={onLogout} />;
}

function GovRoute() {
  useEffect(() => { registerGovSw(); }, []);
  return <GovShell />;
}

function DisclaimerRoute() {
  return <DisclaimerPage />;
}


export default function AppRouter() {
  const [route, setRoute] = useState(() => _parseRoute(
    typeof window !== "undefined" ? window.location.hash : "",
  ));

  useEffect(() => {
    const onHash = () => setRoute(_parseRoute(window.location.hash));
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  // Default-route redirect: if we land on #/ without any role + hash,
  // send the user to home so they can discover the pages.
  useEffect(() => {
    if (route.page !== "dashboard") return;
    if (route.forceRole) return;
    const role = currentAuthRole();
    if (!role) {
      // Unauthenticated visitor on "/" → home page.
      navigate("#/home");
    }
  }, [route.page, route.forceRole]);

  // Role enforcement for #/patient, #/caregiver, #/admin.
  useEffect(() => {
    if (route.page === "dashboard" && route.forceRole) {
      _enforceForceRole(route.forceRole);
    }
  }, [route.page, route.forceRole]);

  // Toggle visibility + title.
  useEffect(() => {
    const onOverlay = route.page !== "dashboard";
    _setDashboardVisibility(!onOverlay);
    try {
      const titles = {
        home: "Home · AMINA", login: "Sign in · AMINA",
        signup: "Sign up · AMINA", chat: "Chat with Amina",
        admin_emergencies: "Emergencies · AMINA Admin",
        dashboard: "AMINA",
      };
      document.title = titles[route.page] || "AMINA";
    } catch { /* noop */ }
  }, [route.page]);

  const role = currentAuthRole();
  const showOverlay = route.page !== "dashboard";

  // These shells own their own full-screen chrome (sidebar + topbar). The
  // public TopNav + overlay wrapper would double-up and waste space, so
  // we skip them for these routes. Keep TopNav on home/chat/login/signup
  // where users expect to navigate between those surfaces.
  const FULLSCREEN_SHELLS = new Set(["admin_console", "gov", "disclaimer"]);
  const isFullscreenShell = FULLSCREEN_SHELLS.has(route.page);

  // Once signed in (patient / caregiver / admin JWT present) the role-
  // scoped App.jsx dashboard owns its own top chrome. The public TopNav
  // on top caused routing leaks — clicking AMINA/Home kicked users
  // back to #/home. Hide it on the dashboard route whenever a role is
  // active; keep it visible for guests on home/login/signup/chat.
  const isSignedInDashboard = route.page === "dashboard" && !!role;
  const hideTopNav          = isFullscreenShell || isSignedInDashboard;

  return (
    <>
      {/* Public nav bar — hidden for fullscreen shells and signed-in dashboards */}
      {!hideTopNav && <TopNav route={route.page} role={role} />}

      {/* Spacer for the legacy dashboard so App.jsx content isn't covered. We
          only need it when the TopNav is actually visible above. */}
      {!showOverlay && !hideTopNav && (
        <div style={{ height: 52 }} id="amina-nav-spacer" />
      )}

      {/* Fullscreen shells render themselves with `position: fixed; inset: 0`
          so they need no overlay wrapper + no top offset. */}
      {isFullscreenShell && (
        <>
          {route.page === "admin_console" && <AdminConsoleRoute />}
          {route.page === "gov"           && <GovRoute />}
          {route.page === "disclaimer"    && <DisclaimerRoute />}
        </>
      )}

      {showOverlay && !isFullscreenShell && (
        <div style={{
          position: "fixed",
          top: 52, left: 0, right: 0, bottom: 0,
          zIndex: 9800,
          background:
            "radial-gradient(1200px 600px at 20% -10%, rgba(99, 102, 241, 0.18), transparent 60%),"
            + " radial-gradient(1000px 500px at 110% 110%, rgba(139, 92, 246, 0.15), transparent 60%),"
            + " #070b13",
          color: "#e2e8f0",
          overflow: "auto",
          fontFamily: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
        }}>
          {route.page === "home"   && <HomePage   navigate={navigate} />}
          {route.page === "login"  && <LoginPage  navigate={navigate} initialTab={route.tab} />}
          {route.page === "signup" && <SignupPage navigate={navigate} initialTab={route.tab} />}
          {route.page === "chat"   && <ChatPage   navigate={navigate} />}
          {route.page === "admin_emergencies" && <EmergencyAdminPage />}
          {/* admin_console + gov are fullscreen shells — rendered above without the overlay wrapper */}
        </div>
      )}
    </>
  );
}
