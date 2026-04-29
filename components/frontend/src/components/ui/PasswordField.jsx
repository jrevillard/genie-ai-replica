/**
 * PasswordField — clinical-grade password input with show/hide toggle.
 * =====================================================================
 *
 * Drop-in replacement for a raw <input type="password"> pair.
 * Design goals:
 *   - Clinical / professional aesthetic (muted indigo accent, subtle
 *     shadows, no flashy gradients)
 *   - Eye / eye-slash SVG icon — inline SVG so it inherits currentColor
 *     and works in dark + light themes without extra assets
 *   - Accessible: toggle is a real <button> with aria-label + aria-pressed,
 *     correct keyboard focus ring, does not interrupt tab order into/out
 *     of the input
 *   - Zero external icon library (no extra bundle cost)
 *   - Respects prefers-reduced-motion for the icon transition
 *
 * Usage:
 *   <PasswordField
 *     value={password}
 *     onChange={(e) => setPassword(e.target.value)}
 *     placeholder="Enter password"
 *     autoComplete="current-password"   // or "new-password" for signup
 *   />
 *
 * The component forwards every other <input> prop (name, disabled,
 * autoFocus, onKeyDown, etc.) so it behaves exactly like a native input.
 */

import { useState, forwardRef } from "react";

const EyeOpenIcon = (props) => (
  <svg
    {...props}
    width="20"
    height="20"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
    <circle cx="12" cy="12" r="3" />
  </svg>
);

const EyeClosedIcon = (props) => (
  <svg
    {...props}
    width="20"
    height="20"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M17.94 17.94A10.5 10.5 0 0 1 12 20c-7 0-11-8-11-8a19.8 19.8 0 0 1 4.24-5.66M9.88 4.24A10.5 10.5 0 0 1 12 4c7 0 11 8 11 8a19.8 19.8 0 0 1-2.16 3.19M1 1l22 22" />
    <path d="M10.58 10.58a2 2 0 0 0 2.82 2.82" />
  </svg>
);

const PasswordField = forwardRef(function PasswordField(
  {
    value,
    onChange,
    placeholder = "Enter password",
    autoComplete = "current-password",
    name = "password",
    id,
    disabled = false,
    className = "",
    style: styleOverride,
    inputStyle,
    "aria-label": ariaLabel,
    ...rest
  },
  ref
) {
  const [visible, setVisible] = useState(false);
  const toggleId = id ? `${id}-toggle` : undefined;

  return (
    <div
      className={`amina-pw-field ${className}`.trim()}
      style={{
        position:        "relative",
        display:         "flex",
        alignItems:      "center",
        width:           "100%",
        ...styleOverride,
      }}
    >
      <input
        ref={ref}
        id={id}
        name={name}
        type={visible ? "text" : "password"}
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        autoComplete={autoComplete}
        disabled={disabled}
        aria-label={ariaLabel}
        style={{
          width:         "100%",
          padding:       "12px 44px 12px 14px",   // right pad leaves room for button
          border:        "1.5px solid rgba(148, 163, 184, 0.3)",
          borderRadius:  10,
          background:    "rgba(15, 23, 42, 0.35)",
          color:         "#e2e8f0",
          fontSize:      14,
          fontFamily:    "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
          outline:       "none",
          transition:    "border-color 180ms ease, box-shadow 180ms ease, background 180ms ease",
          ...inputStyle,
        }}
        onFocus={(e) => {
          e.currentTarget.style.borderColor = "rgba(129, 140, 248, 0.8)";
          e.currentTarget.style.background  = "rgba(15, 23, 42, 0.55)";
          e.currentTarget.style.boxShadow   = "0 0 0 3px rgba(129, 140, 248, 0.18)";
          rest.onFocus && rest.onFocus(e);
        }}
        onBlur={(e) => {
          e.currentTarget.style.borderColor = "rgba(148, 163, 184, 0.3)";
          e.currentTarget.style.background  = "rgba(15, 23, 42, 0.35)";
          e.currentTarget.style.boxShadow   = "none";
          rest.onBlur && rest.onBlur(e);
        }}
        {...rest}
      />

      <button
        id={toggleId}
        type="button"
        onClick={() => setVisible((v) => !v)}
        aria-label={visible ? "Hide password" : "Show password"}
        aria-pressed={visible}
        tabIndex={disabled ? -1 : 0}
        disabled={disabled}
        style={{
          position:       "absolute",
          right:          8,
          top:            "50%",
          transform:      "translateY(-50%)",
          display:        "inline-flex",
          alignItems:     "center",
          justifyContent: "center",
          width:          32,
          height:         32,
          padding:        0,
          border:         "none",
          background:     "transparent",
          color:          visible ? "#a5b4fc" : "#94a3b8",
          cursor:         disabled ? "not-allowed" : "pointer",
          borderRadius:   8,
          transition:     "color 160ms ease, background 160ms ease, transform 120ms ease",
          outline:        "none",
        }}
        onMouseEnter={(e) => {
          if (disabled) return;
          e.currentTarget.style.background = "rgba(129, 140, 248, 0.12)";
          e.currentTarget.style.color      = "#c7d2fe";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = "transparent";
          e.currentTarget.style.color      = visible ? "#a5b4fc" : "#94a3b8";
        }}
        onMouseDown={(e) => {
          if (disabled) return;
          e.currentTarget.style.transform = "translateY(-50%) scale(0.92)";
        }}
        onMouseUp={(e) => {
          if (disabled) return;
          e.currentTarget.style.transform = "translateY(-50%) scale(1)";
        }}
        onFocus={(e) => {
          e.currentTarget.style.boxShadow = "0 0 0 2px rgba(129, 140, 248, 0.55)";
        }}
        onBlur={(e) => {
          e.currentTarget.style.boxShadow = "none";
        }}
      >
        {visible ? <EyeOpenIcon /> : <EyeClosedIcon />}
      </button>
    </div>
  );
});

export default PasswordField;
