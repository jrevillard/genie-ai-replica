/**
 * ChannelLinkFab — floating "Talk to us" widget that deep-links patients
 * into the Amina bot on WhatsApp, Messenger, and Telegram.
 *
 * Blends into every literacy mode (beginner / basic / advanced) by being
 * mounted once inside LiteracyBootstrap, which already owns a dedicated
 * React root (#amina-literacy-root) above the main App.
 *
 * Deep-link config is read from window globals so ops can set it per
 * deployment without rebuilding:
 *
 *     window.AMINA_WHATSAPP_NUMBER  = "220999xxxxx"   // E.164, no "+"
 *     window.AMINA_MESSENGER_HANDLE = "aminacare"     // m.me/<handle>
 *     window.AMINA_TELEGRAM_HANDLE  = "AminaCareBot"  // t.me/<handle>
 *
 * Any channel without a configured handle is shown as "coming soon" and
 * is non-clickable — so half-configured demos never break the UI.
 *
 * Design language: clinical-professional. Slate-900 pill trigger with an
 * emerald status dot, white card sheet, brand-colored channel rows with
 * left accent stripes, soft shadow, rounded-2xl corners, subtle spring
 * animations, reduced-motion respect.
 */

import { useEffect, useRef, useState } from "react";

// ── Channel config ──────────────────────────────────────────────────────────

const PREFILLED_MESSAGE = "Hello Amina, I'd like to talk to a health assistant.";

const CHANNELS = [
  {
    key:     "whatsapp",
    label:   "WhatsApp",
    tagline: "Instant chat on your phone",
    brand:   "#25D366",
    brandDark: "#128C7E",
    icon: (
      <svg viewBox="0 0 32 32" width="20" height="20" aria-hidden="true">
        <path fill="#fff" d="M16 3C9 3 3.4 8.6 3.4 15.6c0 2.4.7 4.7 1.9 6.7L3 29l6.9-2.2c1.9 1 4 1.6 6.2 1.6 7 0 12.6-5.6 12.6-12.6S23 3 16 3zm0 22.9c-2 0-3.9-.5-5.6-1.5l-.4-.2-4.1 1.3 1.3-4-.3-.4a10.3 10.3 0 01-1.6-5.5c0-5.7 4.7-10.4 10.4-10.4s10.4 4.7 10.4 10.4-4.7 10.3-10.1 10.3zm5.7-7.7c-.3-.2-1.8-.9-2.1-1-.3-.1-.5-.2-.7.2-.2.3-.8 1-1 1.2-.2.2-.3.2-.6.1-.9-.4-1.7-.9-2.5-1.9-.6-.7-1-1.5-1.2-1.8-.1-.3 0-.4.1-.6.1-.1.3-.3.4-.5.1-.1.2-.3.3-.4.1-.2 0-.3 0-.5s-.6-1.5-.9-2.1c-.2-.5-.5-.5-.7-.5h-.6c-.2 0-.5.1-.8.3-.3.3-1 1-1 2.4 0 1.4 1 2.7 1.1 2.9.2.2 2 3 4.8 4.1 1.7.7 2.3.7 3.1.6.5 0 1.5-.6 1.7-1.2.2-.6.2-1.1.2-1.2-.1-.2-.3-.3-.6-.4z"/>
      </svg>
    ),
  },
  {
    key:     "messenger",
    label:   "Messenger",
    tagline: "Chat from Facebook",
    brand:   "#0084FF",
    brandDark: "#0064D0",
    icon: (
      <svg viewBox="0 0 32 32" width="20" height="20" aria-hidden="true">
        <path fill="#fff" d="M16 3C8.8 3 3 8.4 3 15.1c0 3.8 1.9 7.2 4.8 9.4v4.6l4.4-2.4c1.2.3 2.5.5 3.8.5 7.2 0 13-5.4 13-12.1S23.2 3 16 3zm1.3 16.3l-3.3-3.5-6.5 3.5 7.1-7.6 3.4 3.5 6.5-3.5-7.2 7.6z"/>
      </svg>
    ),
  },
  {
    key:     "telegram",
    label:   "Telegram",
    tagline: "Fast & secure chat",
    brand:   "#229ED9",
    brandDark: "#1A7AB0",
    icon: (
      <svg viewBox="0 0 32 32" width="20" height="20" aria-hidden="true">
        <path fill="#fff" d="M26.9 6.3L4.2 15.1c-1.5.6-1.5 1.5-.3 1.9l5.8 1.8 13.4-8.4c.6-.4 1.2-.2.7.3l-10.8 9.8-.4 6c.6 0 .9-.3 1.2-.6l2.9-2.8 6 4.4c1.1.6 1.9.3 2.2-1l4-18.7c.4-1.6-.6-2.4-1.8-1.9z"/>
      </svg>
    ),
  },
];

function readDeepLink(key) {
  if (typeof window === "undefined") return null;
  switch (key) {
    case "whatsapp": {
      const num = String(window.AMINA_WHATSAPP_NUMBER || "").replace(/[^\d]/g, "");
      if (!num) return null;
      return `https://wa.me/${num}?text=${encodeURIComponent(PREFILLED_MESSAGE)}`;
    }
    case "messenger": {
      const h = String(window.AMINA_MESSENGER_HANDLE || "").trim();
      return h ? `https://m.me/${h}` : null;
    }
    case "telegram": {
      const h = String(window.AMINA_TELEGRAM_HANDLE || "").trim();
      return h ? `https://t.me/${h}` : null;
    }
    default:
      return null;
  }
}


// ── Component ────────────────────────────────────────────────────────────────

export default function ChannelLinkFab() {
  const [open, setOpen]     = useState(false);
  const [pulse, setPulse]   = useState(true);
  const firstOpen           = useRef(false);
  const rootRef             = useRef(null);

  // Stop the first-impression pulse after 20s so it's never noisy.
  useEffect(() => {
    const t = setTimeout(() => setPulse(false), 20_000);
    return () => clearTimeout(t);
  }, []);

  // Close on Escape key.
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    const onClick = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  const handleToggle = () => {
    firstOpen.current = true;
    setPulse(false);
    setOpen((v) => !v);
  };

  const handleChannel = (key, href) => (e) => {
    if (!href) {
      e.preventDefault();
      return;
    }
    // Let the anchor do its natural thing, but close the sheet.
    setOpen(false);
  };

  return (
    <div
      ref={rootRef}
      className="amina-channel-fab"
      data-open={open ? "1" : "0"}
      data-literacy-ignore
      role="region"
      aria-label="Contact channels"
    >
      <style>{CSS}</style>

      {/* Expanded sheet */}
      <div
        className="amina-channel-sheet"
        role="dialog"
        aria-hidden={!open}
        aria-label="Choose a messaging channel"
      >
        <div className="amina-channel-header">
          <div className="amina-channel-header-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="18" height="18">
              <path fill="currentColor" d="M12 2a10 10 0 00-8.2 15.7L2 22l4.4-1.8A10 10 0 1012 2zm0 18a8 8 0 01-4.3-1.3l-.3-.2-2.6 1 1-2.6-.2-.3A8 8 0 1112 20z"/>
            </svg>
          </div>
          <div className="amina-channel-header-text">
            <div className="amina-channel-title">Talk to us</div>
            <div className="amina-channel-subtitle">We reply on your favourite app</div>
          </div>
        </div>

        <div className="amina-channel-list">
          {CHANNELS.map((ch, i) => {
            const href = readDeepLink(ch.key);
            const disabled = !href;
            return (
              <a
                key={ch.key}
                href={href || "#"}
                target="_blank"
                rel="noopener noreferrer"
                className={`amina-channel-item${disabled ? " is-disabled" : ""}`}
                style={{
                  "--brand":     ch.brand,
                  "--brandDark": ch.brandDark,
                  "--i":         i,
                }}
                onClick={handleChannel(ch.key, href)}
                aria-disabled={disabled || undefined}
              >
                <span className="amina-channel-icon" aria-hidden="true">{ch.icon}</span>
                <span className="amina-channel-text">
                  <span className="amina-channel-label">{ch.label}</span>
                  <span className="amina-channel-tagline">
                    {disabled ? "Coming soon" : ch.tagline}
                  </span>
                </span>
                <span className="amina-channel-chev" aria-hidden="true">
                  <svg viewBox="0 0 20 20" width="16" height="16">
                    <path fill="currentColor" d="M7.05 4.55a1 1 0 011.4 0l4.5 4.5a1 1 0 010 1.4l-4.5 4.5a1 1 0 01-1.4-1.4L10.6 10 7.05 6.45a1 1 0 010-1.4z"/>
                  </svg>
                </span>
              </a>
            );
          })}
        </div>

        <div className="amina-channel-foot">
          <span className="amina-channel-foot-dot" />
          Secure · End-to-end on WhatsApp · Free to use
        </div>
      </div>

      {/* Trigger pill */}
      <button
        type="button"
        className={`amina-channel-trigger${pulse && !firstOpen.current ? " is-pulse" : ""}`}
        onClick={handleToggle}
        aria-expanded={open}
        aria-label={open ? "Close contact channels" : "Open contact channels"}
      >
        <span className="amina-channel-trigger-ring" aria-hidden="true" />
        <span className="amina-channel-trigger-inner">
          {open ? (
            <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true">
              <path fill="currentColor" d="M15.3 4.7a1 1 0 010 1.4L11.4 10l3.9 3.9a1 1 0 11-1.4 1.4L10 11.4l-3.9 3.9a1 1 0 01-1.4-1.4L8.6 10 4.7 6.1a1 1 0 011.4-1.4L10 8.6l3.9-3.9a1 1 0 011.4 0z"/>
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
              <path fill="currentColor" d="M20 2H4a2 2 0 00-2 2v18l4-4h14a2 2 0 002-2V4a2 2 0 00-2-2zm-2 12H6v-2h12v2zm0-4H6V8h12v2z"/>
            </svg>
          )}
          <span className="amina-channel-trigger-label">
            {open ? "Close" : "Talk to us"}
          </span>
        </span>
      </button>
    </div>
  );
}


// ── Styles ──────────────────────────────────────────────────────────────────

const CSS = `
.amina-channel-fab {
  position: fixed;
  right: 20px;
  bottom: 104px;
  z-index: 9250;
  font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 12px;
  pointer-events: none;
}
.amina-channel-fab > * { pointer-events: auto; }

/* ── Trigger pill ────────────────────────────────────────────────────────── */

.amina-channel-trigger {
  position: relative;
  border: 0;
  padding: 0;
  background: transparent;
  cursor: pointer;
  outline: none;
}
.amina-channel-trigger-inner {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 10px;
  padding: 13px 20px 13px 16px;
  border-radius: 999px;
  background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%);
  color: #fff;
  font-size: 14px;
  font-weight: 600;
  letter-spacing: 0.01em;
  box-shadow:
    0 10px 30px -8px rgba(15, 23, 42, 0.45),
    0 4px 12px -4px rgba(15, 23, 42, 0.3),
    inset 0 1px 0 rgba(255,255,255,0.08);
  transition: transform 220ms cubic-bezier(.2,.9,.25,1.15),
              box-shadow 220ms ease,
              background 220ms ease;
}
.amina-channel-trigger:hover .amina-channel-trigger-inner {
  transform: translateY(-2px);
  box-shadow:
    0 14px 36px -10px rgba(15, 23, 42, 0.55),
    0 6px 14px -4px rgba(15, 23, 42, 0.35);
}
.amina-channel-trigger:active .amina-channel-trigger-inner {
  transform: translateY(0);
}
.amina-channel-trigger svg { display: block; }

/* Emerald status ring on trigger — "live/available" cue */
.amina-channel-trigger-inner::before {
  content: "";
  position: absolute;
  top: 11px;
  right: 14px;
  width: 8px;
  height: 8px;
  border-radius: 999px;
  background: #10b981;
  box-shadow: 0 0 0 3px rgba(16, 185, 129, 0.25);
}
.amina-channel-trigger-label { white-space: nowrap; }

/* Pulse ring that runs for ~20s to draw attention */
.amina-channel-trigger-ring {
  position: absolute;
  inset: 0;
  border-radius: 999px;
  pointer-events: none;
}
.amina-channel-trigger.is-pulse .amina-channel-trigger-ring::after {
  content: "";
  position: absolute;
  inset: 0;
  border-radius: 999px;
  border: 2px solid rgba(16, 185, 129, 0.55);
  animation: amina-chan-pulse 2.4s ease-out infinite;
}
@keyframes amina-chan-pulse {
  0%   { transform: scale(1);    opacity: 0.9; }
  70%  { transform: scale(1.18); opacity: 0;   }
  100% { transform: scale(1.18); opacity: 0;   }
}

/* ── Sheet ───────────────────────────────────────────────────────────────── */

.amina-channel-sheet {
  width: 300px;
  background: #ffffff;
  border: 1px solid rgba(15, 23, 42, 0.08);
  border-radius: 18px;
  box-shadow:
    0 24px 60px -18px rgba(15, 23, 42, 0.35),
    0 8px 24px -8px rgba(15, 23, 42, 0.2);
  overflow: hidden;
  transform-origin: bottom right;
  transform: translateY(10px) scale(0.94);
  opacity: 0;
  visibility: hidden;
  transition:
    transform 280ms cubic-bezier(.2,.9,.25,1.15),
    opacity   220ms ease,
    visibility 0s linear 280ms;
}
.amina-channel-fab[data-open="1"] .amina-channel-sheet {
  transform: translateY(0) scale(1);
  opacity: 1;
  visibility: visible;
  transition:
    transform 320ms cubic-bezier(.2,.9,.25,1.15),
    opacity   220ms ease,
    visibility 0s linear 0s;
}

.amina-channel-header {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 16px 18px 14px;
  background: linear-gradient(135deg, #0f766e 0%, #0891b2 100%);
  color: #fff;
}
.amina-channel-header-icon {
  width: 36px;
  height: 36px;
  border-radius: 12px;
  background: rgba(255,255,255,0.16);
  display: flex;
  align-items: center;
  justify-content: center;
}
.amina-channel-title {
  font-size: 15px;
  font-weight: 700;
  letter-spacing: 0.01em;
}
.amina-channel-subtitle {
  font-size: 12px;
  opacity: 0.85;
  margin-top: 2px;
}

.amina-channel-list {
  padding: 10px 10px 6px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.amina-channel-item {
  position: relative;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 12px 12px 14px;
  border-radius: 12px;
  color: #0f172a;
  text-decoration: none;
  background: #f8fafc;
  border: 1px solid rgba(15, 23, 42, 0.05);
  overflow: hidden;
  opacity: 0;
  transform: translateY(8px);
  transition:
    transform 220ms ease,
    background 180ms ease,
    border-color 180ms ease,
    box-shadow 180ms ease;
}
.amina-channel-fab[data-open="1"] .amina-channel-item {
  opacity: 1;
  transform: translateY(0);
  transition-delay: calc(80ms + var(--i) * 55ms);
}
.amina-channel-item::before {
  content: "";
  position: absolute;
  left: 0; top: 0; bottom: 0;
  width: 4px;
  background: var(--brand);
  border-radius: 4px 0 0 4px;
  opacity: 0.9;
}
.amina-channel-item:hover {
  background: #fff;
  border-color: rgba(15, 23, 42, 0.12);
  box-shadow: 0 6px 16px -8px rgba(15, 23, 42, 0.18);
}
.amina-channel-item:hover .amina-channel-chev {
  transform: translateX(3px);
  color: var(--brandDark);
}
.amina-channel-item.is-disabled {
  opacity: 0.55;
  cursor: not-allowed;
}
.amina-channel-item.is-disabled:hover {
  background: #f8fafc;
  border-color: rgba(15, 23, 42, 0.05);
  box-shadow: none;
}

.amina-channel-icon {
  width: 36px;
  height: 36px;
  border-radius: 10px;
  background: linear-gradient(135deg, var(--brand), var(--brandDark));
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 4px 10px -4px color-mix(in srgb, var(--brand) 55%, transparent);
  flex-shrink: 0;
}

.amina-channel-text {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}
.amina-channel-label {
  font-size: 14px;
  font-weight: 600;
  color: #0f172a;
}
.amina-channel-tagline {
  font-size: 11.5px;
  color: #64748b;
  margin-top: 2px;
}

.amina-channel-chev {
  color: #94a3b8;
  transition: transform 180ms ease, color 180ms ease;
  flex-shrink: 0;
}

.amina-channel-foot {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 16px 14px;
  font-size: 11px;
  color: #64748b;
  border-top: 1px solid rgba(15, 23, 42, 0.05);
  background: #fcfcfd;
}
.amina-channel-foot-dot {
  width: 6px;
  height: 6px;
  border-radius: 999px;
  background: #10b981;
  box-shadow: 0 0 0 3px rgba(16, 185, 129, 0.2);
}

/* Respect reduced motion */
@media (prefers-reduced-motion: reduce) {
  .amina-channel-trigger-inner,
  .amina-channel-sheet,
  .amina-channel-item,
  .amina-channel-chev {
    transition: none !important;
  }
  .amina-channel-trigger.is-pulse .amina-channel-trigger-ring::after {
    animation: none;
  }
}

/* Small-screen tweak — keep out of the thumb-reach column */
@media (max-width: 480px) {
  .amina-channel-fab {
    right: 14px;
    bottom: 92px;
  }
  .amina-channel-sheet {
    width: min(92vw, 300px);
  }
}
`;
