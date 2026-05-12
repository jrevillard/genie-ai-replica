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
 *     window.AMINA_WHATSAPP_NUMBER     = "220999xxxxx"   // E.164, no "+"
 *     window.AMINA_WHATSAPP_JOIN_CODE  = "milk-shot"     // Twilio Sandbox only
 *     window.AMINA_MESSENGER_HANDLE    = "aminacare"     // m.me/<handle>
 *     window.AMINA_MESSENGER_DEV_MODE  = true            // Meta App in Dev Mode
 *     window.AMINA_TELEGRAM_HANDLE     = "AminaCareBot"  // t.me/<handle>
 *
 * Any channel without a configured handle is shown as "coming soon" and
 * is non-clickable — so half-configured demos never break the UI.
 *
 * WhatsApp Sandbox mode: when AMINA_WHATSAPP_JOIN_CODE is set, clicking
 * the WhatsApp row opens an onboarding sub-sheet that explains the
 * Twilio Sandbox handshake (each tester must send `join <code>` once)
 * and pre-fills that exact message in the wa.me deep link. Leave the
 * join code blank for production senders.
 *
 * Messenger Dev mode: when AMINA_MESSENGER_DEV_MODE is true, clicking
 * the Messenger row opens an onboarding sub-sheet explaining that the
 * Meta App is in Development Mode and the user must be added as a
 * Tester / Developer / Admin in the App Dashboard before they can
 * message the AMINA Page. Flip to false after Meta App Review grants
 * pages_messaging Advanced Access (then any FB user can message).
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

function readJoinCode() {
  if (typeof window === "undefined") return "";
  return String(window.AMINA_WHATSAPP_JOIN_CODE || "").trim();
}

function readWhatsAppNumber() {
  if (typeof window === "undefined") return "";
  return String(window.AMINA_WHATSAPP_NUMBER || "").replace(/[^\d]/g, "");
}

function readMessengerHandle() {
  if (typeof window === "undefined") return "";
  return String(window.AMINA_MESSENGER_HANDLE || "").trim();
}

function readMessengerDevMode() {
  if (typeof window === "undefined") return false;
  return Boolean(window.AMINA_MESSENGER_DEV_MODE);
}

function readDeepLink(key) {
  if (typeof window === "undefined") return null;
  switch (key) {
    case "whatsapp": {
      const num = readWhatsAppNumber();
      if (!num) return null;
      // In Sandbox mode, the first message MUST be `join <code>` — pre-fill it.
      // In production mode, pre-fill the friendly greeting.
      const joinCode = readJoinCode();
      const text = joinCode ? `join ${joinCode}` : PREFILLED_MESSAGE;
      return `https://wa.me/${num}?text=${encodeURIComponent(text)}`;
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

// Format the sandbox number for display: 14155238886 -> "+1 (415) 523-8886"
function formatWhatsAppNumber(digits) {
  if (!digits) return "";
  if (digits.length === 11 && digits.startsWith("1")) {
    return `+1 (${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`;
  }
  return `+${digits}`;
}


// ── Component ────────────────────────────────────────────────────────────────

export default function ChannelLinkFab() {
  const [open, setOpen]     = useState(false);
  const [pulse, setPulse]   = useState(true);
  // When set, the corresponding onboarding sub-sheet is shown instead of
  // the channel list. Mutually exclusive — only one can be active.
  const [whatsAppOnboard,  setWhatsAppOnboard]  = useState(false);
  const [messengerOnboard, setMessengerOnboard] = useState(false);
  const [copied, setCopied] = useState(false);
  const firstOpen           = useRef(false);
  const rootRef             = useRef(null);

  const joinCode       = readJoinCode();
  const sandboxMode    = Boolean(joinCode);
  const waNumberRaw    = readWhatsAppNumber();
  const waNumberDisp   = formatWhatsAppNumber(waNumberRaw);
  const waHref         = readDeepLink("whatsapp");
  const joinMessage    = `join ${joinCode}`;

  const msgHandle      = readMessengerHandle();
  const messengerDev   = readMessengerDevMode();
  const msgHref        = readDeepLink("messenger");
  const onAnyOnboard   = whatsAppOnboard || messengerOnboard;

  // Stop the first-impression pulse after 20s so it's never noisy.
  useEffect(() => {
    const t = setTimeout(() => setPulse(false), 20_000);
    return () => clearTimeout(t);
  }, []);

  // Close on Escape key.
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => {
      if (e.key === "Escape") {
        if (whatsAppOnboard)       setWhatsAppOnboard(false);
        else if (messengerOnboard) setMessengerOnboard(false);
        else                       setOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, whatsAppOnboard, messengerOnboard]);

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    const onClick = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) {
        setOpen(false);
        setWhatsAppOnboard(false);
        setMessengerOnboard(false);
      }
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  // Reset onboarding state when the sheet closes.
  useEffect(() => {
    if (!open) {
      setWhatsAppOnboard(false);
      setMessengerOnboard(false);
    }
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
    // WhatsApp + sandbox mode: intercept and show the onboarding sub-sheet
    // instead of jumping straight to wa.me — testers need to know they have
    // to send `join <code>` first.
    if (key === "whatsapp" && sandboxMode) {
      e.preventDefault();
      setWhatsAppOnboard(true);
      return;
    }
    // Messenger + dev mode: intercept and show the dev-access onboarding
    // sub-sheet. Without Meta App Review Advanced Access on pages_messaging,
    // only app admins/developers/testers can message the page — users need
    // to know that BEFORE clicking through to m.me.
    if (key === "messenger" && messengerDev) {
      e.preventDefault();
      setMessengerOnboard(true);
      return;
    }
    // Otherwise let the anchor do its natural thing, just close the sheet.
    setOpen(false);
  };

  const handleCopyJoin = async () => {
    try {
      await navigator.clipboard.writeText(joinMessage);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      /* clipboard blocked — no-op */
    }
  };

  const handleOpenWhatsApp = () => {
    // Let the link open in a new tab; close everything after.
    window.open(waHref, "_blank", "noopener,noreferrer");
    setWhatsAppOnboard(false);
    setOpen(false);
  };

  const handleOpenMessenger = () => {
    window.open(msgHref, "_blank", "noopener,noreferrer");
    setMessengerOnboard(false);
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
        {messengerOnboard ? (
          // ── Messenger Dev-mode onboarding sub-sheet ─────────────────────────
          <>
            <div className="amina-channel-header amina-channel-header--mg">
              <button
                type="button"
                className="amina-channel-back"
                onClick={() => setMessengerOnboard(false)}
                aria-label="Back to channel list"
              >
                <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true">
                  <path fill="currentColor" d="M12.95 15.45a1 1 0 01-1.4 0l-4.5-4.5a1 1 0 010-1.4l4.5-4.5a1 1 0 011.4 1.4L9.4 10l3.55 3.55a1 1 0 010 1.4z"/>
                </svg>
              </button>
              <div className="amina-channel-header-icon" aria-hidden="true">
                <svg viewBox="0 0 32 32" width="18" height="18">
                  <path fill="#fff" d="M16 3C8.8 3 3 8.4 3 15.1c0 3.8 1.9 7.2 4.8 9.4v4.6l4.4-2.4c1.2.3 2.5.5 3.8.5 7.2 0 13-5.4 13-12.1S23.2 3 16 3zm1.3 16.3l-3.3-3.5-6.5 3.5 7.1-7.6 3.4 3.5 6.5-3.5-7.2 7.6z"/>
                </svg>
              </div>
              <div className="amina-channel-header-text">
                <div className="amina-channel-title">Connect on Messenger</div>
                <div className="amina-channel-subtitle">Limited preview · approved testers only</div>
              </div>
            </div>

            <div className="amina-mg-body">
              <div className="amina-mg-callout">
                <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
                  <path fill="currentColor" d="M12 2a10 10 0 100 20 10 10 0 000-20zm.8 14.5h-1.6v-1.6h1.6zm0-3.2h-1.6V7h1.6z"/>
                </svg>
                <span>
                  The AMINA Facebook App is in <em>Development Mode</em>.
                  Until Meta finishes its review of <code>pages_messaging</code>,
                  only Facebook users added as <strong>Tester</strong>,
                  <strong> Developer</strong>, or <strong>Admin</strong> on
                  the app can message the AMINA Page.
                </span>
              </div>

              <ol className="amina-mg-steps">
                <li>
                  <span className="amina-mg-step-num">1</span>
                  <div className="amina-mg-step-text">
                    Email <a href="mailto:privacy@amina-design.com?subject=Messenger%20tester%20access">privacy@amina-design.com</a> with your
                    <strong> Facebook username or profile URL</strong>.
                    The AMINA admin will add you as a Tester &mdash; takes
                    under a minute.
                  </div>
                </li>
                <li>
                  <span className="amina-mg-step-num">2</span>
                  <div className="amina-mg-step-text">
                    Check Facebook notifications for an invite from
                    <em> AMINA Care</em> → tap <em>Accept</em>.
                  </div>
                </li>
                <li>
                  <span className="amina-mg-step-num">3</span>
                  <div className="amina-mg-step-text">
                    Tap <em>Open Messenger</em> below &mdash; the chat with
                    the AMINA Page opens directly. Say <em>hi</em> to start.
                  </div>
                </li>
              </ol>

              <button
                type="button"
                className="amina-mg-cta"
                onClick={handleOpenMessenger}
              >
                <svg viewBox="0 0 32 32" width="18" height="18" aria-hidden="true">
                  <path fill="#fff" d="M16 3C8.8 3 3 8.4 3 15.1c0 3.8 1.9 7.2 4.8 9.4v4.6l4.4-2.4c1.2.3 2.5.5 3.8.5 7.2 0 13-5.4 13-12.1S23.2 3 16 3zm1.3 16.3l-3.3-3.5-6.5 3.5 7.1-7.6 3.4 3.5 6.5-3.5-7.2 7.6z"/>
                </svg>
                Open Messenger
              </button>

              <div className="amina-mg-note">
                If you're not yet added as a tester, Messenger will open
                but messages won't be delivered &mdash; complete step 1
                first. Once Meta approves App Review, this gate disappears
                automatically and anyone can message the Page.
              </div>
            </div>
          </>
        ) : whatsAppOnboard ? (
          // ── WhatsApp Sandbox onboarding sub-sheet ───────────────────────────
          <>
            <div className="amina-channel-header amina-channel-header--wa">
              <button
                type="button"
                className="amina-channel-back"
                onClick={() => setWhatsAppOnboard(false)}
                aria-label="Back to channel list"
              >
                <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true">
                  <path fill="currentColor" d="M12.95 15.45a1 1 0 01-1.4 0l-4.5-4.5a1 1 0 010-1.4l4.5-4.5a1 1 0 011.4 1.4L9.4 10l3.55 3.55a1 1 0 010 1.4z"/>
                </svg>
              </button>
              <div className="amina-channel-header-icon" aria-hidden="true">
                <svg viewBox="0 0 32 32" width="18" height="18">
                  <path fill="#fff" d="M16 3C9 3 3.4 8.6 3.4 15.6c0 2.4.7 4.7 1.9 6.7L3 29l6.9-2.2c1.9 1 4 1.6 6.2 1.6 7 0 12.6-5.6 12.6-12.6S23 3 16 3zm5.7 15.2c-.3-.2-1.8-.9-2.1-1-.3-.1-.5-.2-.7.2-.2.3-.8 1-1 1.2-.2.2-.3.2-.6.1-.9-.4-1.7-.9-2.5-1.9-.6-.7-1-1.5-1.2-1.8-.1-.3 0-.4.1-.6.1-.1.3-.3.4-.5.1-.1.2-.3.3-.4.1-.2 0-.3 0-.5s-.6-1.5-.9-2.1c-.2-.5-.5-.5-.7-.5h-.6c-.2 0-.5.1-.8.3-.3.3-1 1-1 2.4 0 1.4 1 2.7 1.1 2.9.2.2 2 3 4.8 4.1 1.7.7 2.3.7 3.1.6.5 0 1.5-.6 1.7-1.2.2-.6.2-1.1.2-1.2-.1-.2-.3-.3-.6-.4z"/>
                </svg>
              </div>
              <div className="amina-channel-header-text">
                <div className="amina-channel-title">Connect on WhatsApp</div>
                <div className="amina-channel-subtitle">One-time sandbox setup · ~10 seconds</div>
              </div>
            </div>

            <div className="amina-wa-body">
              <ol className="amina-wa-steps">
                <li>
                  <span className="amina-wa-step-num">1</span>
                  <div className="amina-wa-step-text">
                    Save the number{" "}
                    <span className="amina-wa-mono">{waNumberDisp}</span>{" "}
                    in your contacts.
                  </div>
                </li>
                <li>
                  <span className="amina-wa-step-num">2</span>
                  <div className="amina-wa-step-text">
                    Tap <em>Open WhatsApp</em> below. We'll pre-fill this exact
                    message — just hit send:
                    <button
                      type="button"
                      className="amina-wa-codebox"
                      onClick={handleCopyJoin}
                      aria-label="Copy join command"
                      title="Tap to copy"
                    >
                      <span className="amina-wa-mono">{joinMessage}</span>
                      <span className="amina-wa-copy-badge">
                        {copied ? "Copied" : "Copy"}
                      </span>
                    </button>
                  </div>
                </li>
                <li>
                  <span className="amina-wa-step-num">3</span>
                  <div className="amina-wa-step-text">
                    Twilio will confirm <em>You are all set!</em> — now just
                    type your question and Amina will reply.
                  </div>
                </li>
              </ol>

              <button
                type="button"
                className="amina-wa-cta"
                onClick={handleOpenWhatsApp}
              >
                <svg viewBox="0 0 32 32" width="18" height="18" aria-hidden="true">
                  <path fill="#fff" d="M16 3C9 3 3.4 8.6 3.4 15.6c0 2.4.7 4.7 1.9 6.7L3 29l6.9-2.2c1.9 1 4 1.6 6.2 1.6 7 0 12.6-5.6 12.6-12.6S23 3 16 3zm0 22.9c-2 0-3.9-.5-5.6-1.5l-.4-.2-4.1 1.3 1.3-4-.3-.4a10.3 10.3 0 01-1.6-5.5c0-5.7 4.7-10.4 10.4-10.4s10.4 4.7 10.4 10.4-4.7 10.3-10.1 10.3z"/>
                </svg>
                Open WhatsApp
              </button>

              <div className="amina-wa-note">
                If WhatsApp goes idle for 72h, send <span className="amina-wa-mono">{joinMessage}</span> again to rejoin.
              </div>
            </div>
          </>
        ) : (
          // ── Default channel list ───────────────────────────────────────────
          <>
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
                        {disabled
                          ? "Coming soon"
                          : (ch.key === "whatsapp" && sandboxMode)
                            ? "Tap to see how to connect"
                          : (ch.key === "messenger" && messengerDev)
                            ? "Limited preview · tap for access"
                          : ch.tagline}
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
          </>
        )}
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

/* ── WhatsApp sandbox onboarding sub-sheet ──────────────────────────────── */

.amina-channel-header--wa {
  background: linear-gradient(135deg, #128C7E 0%, #25D366 100%);
  padding-left: 50px;          /* room for the back button */
  position: relative;
}
.amina-channel-back {
  position: absolute;
  top: 50%;
  left: 12px;
  transform: translateY(-50%);
  width: 28px;
  height: 28px;
  border-radius: 999px;
  border: 0;
  background: rgba(255,255,255,0.18);
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: background 160ms ease, transform 160ms ease;
}
.amina-channel-back:hover {
  background: rgba(255,255,255,0.28);
  transform: translateY(-50%) translateX(-1px);
}

.amina-wa-body {
  padding: 14px 16px 14px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.amina-wa-steps {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.amina-wa-steps li {
  display: flex;
  gap: 10px;
  align-items: flex-start;
  font-size: 12.5px;
  line-height: 1.45;
  color: #1e293b;
}
.amina-wa-step-num {
  flex-shrink: 0;
  width: 20px;
  height: 20px;
  border-radius: 999px;
  background: #ecfdf5;
  color: #047857;
  font-size: 11px;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-top: 1px;
}
.amina-wa-step-text { flex: 1; min-width: 0; }
.amina-wa-step-text em {
  font-style: normal;
  font-weight: 600;
  color: #0f172a;
}
.amina-wa-mono {
  font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, monospace;
  font-size: 12px;
  background: #f1f5f9;
  border: 1px solid rgba(15, 23, 42, 0.08);
  padding: 1px 6px;
  border-radius: 6px;
  color: #0f172a;
  white-space: nowrap;
}

.amina-wa-codebox {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  width: 100%;
  margin-top: 8px;
  padding: 8px 10px;
  border-radius: 10px;
  border: 1px dashed rgba(16, 185, 129, 0.4);
  background: #f0fdf4;
  cursor: pointer;
  transition: background 140ms ease, border-color 140ms ease;
}
.amina-wa-codebox:hover {
  background: #ecfdf5;
  border-color: rgba(16, 185, 129, 0.6);
}
.amina-wa-codebox .amina-wa-mono {
  background: transparent;
  border: 0;
  padding: 0;
  font-size: 13px;
  font-weight: 600;
  color: #065f46;
}
.amina-wa-copy-badge {
  font-size: 10.5px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: #047857;
  background: #d1fae5;
  padding: 2px 7px;
  border-radius: 999px;
  flex-shrink: 0;
}

.amina-wa-cta {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  width: 100%;
  margin-top: 2px;
  padding: 11px 14px;
  border-radius: 12px;
  border: 0;
  background: linear-gradient(135deg, #25D366 0%, #128C7E 100%);
  color: #fff;
  font-size: 13.5px;
  font-weight: 600;
  cursor: pointer;
  box-shadow: 0 8px 18px -8px rgba(18, 140, 126, 0.55);
  transition: transform 160ms ease, box-shadow 160ms ease;
}
.amina-wa-cta:hover {
  transform: translateY(-1px);
  box-shadow: 0 12px 22px -10px rgba(18, 140, 126, 0.65);
}
.amina-wa-cta:active { transform: translateY(0); }

.amina-wa-note {
  font-size: 11px;
  color: #64748b;
  line-height: 1.45;
  padding-top: 2px;
  border-top: 1px solid rgba(15, 23, 42, 0.05);
  margin-top: 2px;
  padding-top: 10px;
}
.amina-wa-note .amina-wa-mono {
  font-size: 11px;
  padding: 0 4px;
}

/* ── Messenger Dev-mode onboarding sub-sheet ────────────────────────────── */

.amina-channel-header--mg {
  background: linear-gradient(135deg, #0064D0 0%, #0084FF 100%);
  padding-left: 50px;
  position: relative;
}

.amina-mg-body {
  padding: 14px 16px 14px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.amina-mg-callout {
  display: flex;
  gap: 8px;
  align-items: flex-start;
  padding: 10px 12px;
  border-radius: 10px;
  background: linear-gradient(180deg, #eff6ff 0%, #dbeafe 100%);
  border: 1px solid rgba(59, 130, 246, 0.25);
  color: #1e3a8a;
  font-size: 12px;
  line-height: 1.5;
}
.amina-mg-callout svg {
  flex-shrink: 0;
  color: #2563eb;
  margin-top: 1px;
}
.amina-mg-callout em {
  font-style: normal;
  font-weight: 600;
  color: #1e3a8a;
}
.amina-mg-callout code {
  font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, monospace;
  font-size: 11.5px;
  background: rgba(30, 58, 138, 0.08);
  padding: 0 4px;
  border-radius: 4px;
  color: #1e3a8a;
}
.amina-mg-callout strong {
  font-weight: 700;
  color: #1e3a8a;
}

.amina-mg-steps {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.amina-mg-steps li {
  display: flex;
  gap: 10px;
  align-items: flex-start;
  font-size: 12.5px;
  line-height: 1.45;
  color: #1e293b;
}
.amina-mg-step-num {
  flex-shrink: 0;
  width: 20px;
  height: 20px;
  border-radius: 999px;
  background: #dbeafe;
  color: #1e40af;
  font-size: 11px;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-top: 1px;
}
.amina-mg-step-text { flex: 1; min-width: 0; }
.amina-mg-step-text em {
  font-style: normal;
  font-weight: 600;
  color: #0f172a;
}
.amina-mg-step-text a {
  color: #0084FF;
  text-decoration: none;
  font-weight: 600;
}
.amina-mg-step-text a:hover { text-decoration: underline; }

.amina-mg-cta {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  width: 100%;
  margin-top: 2px;
  padding: 11px 14px;
  border-radius: 12px;
  border: 0;
  background: linear-gradient(135deg, #0084FF 0%, #0064D0 100%);
  color: #fff;
  font-size: 13.5px;
  font-weight: 600;
  cursor: pointer;
  box-shadow: 0 8px 18px -8px rgba(0, 100, 208, 0.55);
  transition: transform 160ms ease, box-shadow 160ms ease;
}
.amina-mg-cta:hover {
  transform: translateY(-1px);
  box-shadow: 0 12px 22px -10px rgba(0, 100, 208, 0.65);
}
.amina-mg-cta:active { transform: translateY(0); }

.amina-mg-note {
  font-size: 11px;
  color: #64748b;
  line-height: 1.45;
  border-top: 1px solid rgba(15, 23, 42, 0.05);
  padding-top: 10px;
  margin-top: 2px;
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
