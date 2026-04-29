/**
 * LanguagePicker — floating language switch button + dropdown.
 *
 * Positioned top-left (opposite the InboxBell at top-right in LTR) so the
 * two never overlap. In RTL the i18n.css moves it to top-right naturally.
 *
 * Accessibility
 *   - Uses aria-haspopup="listbox" + aria-expanded
 *   - Each option is a <button role="menuitemradio">
 *   - Escape + outside-click close
 *   - Respects prefers-reduced-motion
 *
 * Persistence
 *   - Writes through setLanguage() which handles localStorage + document.dir
 */

import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  SUPPORTED_LANGS, LANG_META, setLanguage, isRTL,
} from "./index.js";

export default function LanguagePicker() {
  const { t, i18n } = useTranslation();
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);

  // Close on Escape / outside click.
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === "Escape") setOpen(false); };
    const onDoc = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDoc);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDoc);
    };
  }, [open]);

  const cur  = (i18n.language || "en").split(/[-_]/)[0];
  const meta = LANG_META[cur] || LANG_META.en;

  const handleSelect = async (lng) => {
    setOpen(false);
    if (lng === cur) return;
    await setLanguage(lng);
  };

  return (
    <div ref={rootRef}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`${t("language.title")} — ${meta.nativeName}`}
        style={{
          // Row 3 of the right-side stack, docked in the empty area
          // below the "Today & Care" cards:
          //   [InboxBell 490] [RoleSwitcher 548] [LanguagePicker 606] [ScribeFab 664]
          //
          // z-index 9850 matches the shared "floating pill" tier so
          // no pill can capture clicks meant for any other pill's
          // dropdown. Previously at 9250, which sat BELOW the
          // AppRouter overlay (9800) and rendered invisible on
          // home/chat/login routes.
          position:   "fixed",
          top:        606,
          right:      20,
          left:       "auto",
          bottom:     "auto",
          zIndex:     9850,
          display:    "inline-flex",
          alignItems: "center",
          gap:        6,
          padding:    "6px 10px 6px 8px",
          border:     "none",
          cursor:     "pointer",
          background: "linear-gradient(135deg, #0f172a 0%, #1e293b 100%)",
          color:      "#fff",
          borderRadius: 999,
          boxShadow:  "0 4px 14px rgba(15, 23, 42, 0.25)",
          fontSize:   12,
          fontFamily: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
          transition: "transform 140ms ease, box-shadow 140ms ease",
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.transform = "scale(1.04)";
          e.currentTarget.style.boxShadow = "0 6px 20px rgba(15, 23, 42, 0.35)";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.transform = "scale(1)";
          e.currentTarget.style.boxShadow = "0 4px 14px rgba(15, 23, 42, 0.25)";
        }}
      >
        <span aria-hidden="true" style={{ fontSize: 16, lineHeight: 1 }}>
          {meta.flag}
        </span>
        <span style={{ fontWeight: 600 }}>{meta.nativeName}</span>
        <span aria-hidden="true" style={{ opacity: 0.6, fontSize: 10, marginLeft: 2 }}>
          {open ? "▲" : "▼"}
        </span>
      </button>

      {open ? (
        <div
          role="listbox"
          aria-label={t("language.subtitle")}
          style={{
            // Dropdown opens UPWARD from the pill (top:606) so its list
            // stays inside the empty right-column area above the pill.
            // List height ~250px → top anchor at ~350 (606 - 250 - gap).
            position:    "fixed",
            top:         "auto",
            bottom:      "calc(100vh - 598px)",
            right:       20,
            left:        "auto",
            // 9900 — one tier above pill tier (9850) so the list
            // items win the hit-test even over the RoleSwitcher
            // pill, which overlaps the dropdown area at right:20.
            zIndex:      9900,
            minWidth:    220,
            background:  "#fff",
            borderRadius: 12,
            boxShadow:   "0 12px 32px rgba(15, 23, 42, 0.22)",
            overflow:    "hidden",
            border:      "1px solid #e2e8f0",
            fontFamily:  "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
            animation:   "amina-lang-in 180ms cubic-bezier(0.22, 1, 0.36, 1)",
          }}
        >
          <div style={{
            padding: "10px 14px",
            background: "linear-gradient(135deg, #0f766e, #0891b2)",
            color: "#fff",
          }}>
            <div style={{ fontSize: 13, fontWeight: 700 }}>{t("language.title")}</div>
            <div style={{ fontSize: 11, opacity: 0.85, marginTop: 2 }}>
              {t("language.subtitle")}
            </div>
          </div>
          <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
            {SUPPORTED_LANGS.map((lng) => {
              const m      = LANG_META[lng];
              const active = lng === cur;
              const rtl    = isRTL(lng);
              return (
                <li key={lng} role="presentation">
                  <button
                    type="button"
                    role="menuitemradio"
                    aria-checked={active}
                    onClick={() => handleSelect(lng)}
                    style={{
                      width:      "100%",
                      display:    "flex",
                      alignItems: "center",
                      gap:        12,
                      padding:    "10px 14px",
                      border:     "none",
                      background: active ? "#f0fdfa" : "#fff",
                      color:      "#0f172a",
                      cursor:     "pointer",
                      textAlign:  "start",
                      fontSize:   13,
                      borderBottom: "1px solid #f1f5f9",
                      fontFamily: "inherit",
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.background = "#f8fafc"; }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = active ? "#f0fdfa" : "#fff"; }}
                  >
                    <span aria-hidden="true" style={{ fontSize: 18 }}>{m.flag}</span>
                    <span style={{
                      flex: 1, minWidth: 0,
                      display: "flex", flexDirection: "column", gap: 1,
                      textAlign: rtl ? "right" : "left",
                      direction: rtl ? "rtl" : "ltr",
                      unicodeBidi: "embed",
                    }}>
                      <span style={{ fontWeight: 600 }}>{m.nativeName}</span>
                      <span style={{ fontSize: 11, color: "#64748b" }}>
                        {m.name}
                        {rtl ? "  · RTL" : ""}
                      </span>
                    </span>
                    {active ? (
                      <span aria-hidden="true" style={{ color: "#0f766e", fontWeight: 700 }}>✓</span>
                    ) : null}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}

      <style>{`
        @keyframes amina-lang-in {
          from { opacity: 0; transform: translateY(-6px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @media (prefers-reduced-motion: reduce) {
          @keyframes amina-lang-in { from, to { opacity: 1; transform: none; } }
        }
      `}</style>
    </div>
  );
}
