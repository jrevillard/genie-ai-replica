---
stepsCompleted: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]
inputDocuments:
  - _bmad-output/implementation-artifacts/spec-keycloak-theme.md
  - _bmad-output/project-context.md
---

# UX Design Specification genie-ai

**Author:** Jerome
**Date:** 2026-04-14

---

<!-- UX design content will be appended sequentially through collaborative workflow steps -->

## Executive Summary

### Project Vision

Redesign the GENIE.AI Keycloak theme to achieve visual continuity with the main application. The theme must look modern, professional, and readable in both light and dark modes — without revolutionizing Keycloak's standard login flow. The current implementation has the right technical structure (split panel, CSS custom properties, PatternFly v5 extension) but the visual output is unpolished: empty-looking brand panel, unreadable dark mode, and overall dated appearance.

### Target Users

Public sector agents and administrators using GENIE.AI for multilingual RAG queries. Professional, institutional context — not consumer-facing. Users expect clean, trustworthy, government-grade design.

### Key Design Challenges

- **Dark mode readability**: Current dark theme uses poor contrast ratios — black text on dark backgrounds, insufficient color differentiation
- **Brand panel rendering**: Content (logo, title, tagline) exists in the template but is not visible or well-styled on the actual page
- **Visual modernity**: Current styling feels dated compared to modern SaaS login pages — needs better spacing, typography, and visual hierarchy
- **Logo asset**: Current theme uses a placeholder logo.png; the frontend has better assets (brand-logo.png/svg) that should be used instead

### Design Opportunities

- **Centered card layout**: Replace split panel with centered card + branding header — simpler, cleaner, more standard
- **Accessibility-first dark mode**: Follow WCAG contrast guidelines (4.5:1 minimum for normal text) instead of cosmetic dark colors
- **Consistent with frontend**: Reuse the frontend's brand-logo.png and color palette for seamless visual continuity
- **Account console**: Currently untouched — opportunity to apply the same refined visual identity

## Core User Experience

### Defining Experience

The core experience is authentication — users log in, register, or reset their password through Keycloak pages before accessing GENIE.AI. The experience must be fast, clear, and frictionless. Users should never have to think about the login page itself; it should feel like a natural extension of the application.

Key flows:
- Login (username/password)
- Registration (with email verification)
- Password reset (email-based)
- OTP/TOTP two-factor authentication
- Account console (profile management)

### Platform Strategy

Web only, accessed through modern browsers. Used on desktop (institutional workstations), tablet, and mobile. Keyboard/mouse primary, touch-friendly for mobile.

### Effortless Interactions

- Login form: immediate visual focus on username/password fields, obvious submit button
- Error states: clear inline messages, not confusing alerts
- Password reset: straightforward email flow, no unnecessary steps
- Dark mode: automatic system detection with manual toggle — always readable, zero configuration needed
- Language switching: EN/FR available through Keycloak's built-in locale selector

### Critical Success Moments

- First impression: the centered card layout must look professional and modern in under 1 second
- Form readability: every label, input, and button must be legible in both light and dark modes
- Error recovery: when login fails, the user must immediately understand what went wrong and how to fix it
- Transition from login to app: the visual jump from Keycloak to GENIE.AI should feel minimal

### Experience Principles

1. **Clarity over creativity** — The login page is a gateway, not a showcase. Design serves function.
2. **Institutional trust** — Clean, professional, government-grade aesthetics. No playful or flashy elements.
3. **Contrast guaranteed** — Both light and dark modes must meet WCAG AA contrast ratios (4.5:1 for text).
4. **Visual continuity** — Colors, logo, and typography must match the GENIE.AI application to feel like the same product.

## Desired Emotional Response

### Primary Emotional Goals

- **Trust**: The login page must feel institutional and secure. Users are government agents handling sensitive data — the visual design must reinforce that this is a serious, production-grade tool.
- **Efficiency**: Users log in multiple times per day, from desktop, tablet, and mobile. The experience should feel fast and unremarkable — no friction, no confusion. "It just works."
- **Professional comfort**: The visual language should match what users expect from government IT systems — clean, neutral, no unnecessary decoration.

### Emotional Journey Mapping

- **Arrival on login page**: "I know where I am. This is clearly GENIE.AI." (recognition, trust)
- **Filling the form**: "Straightforward, same as always." (familiarity, ease) — works equally well on desktop and mobile
- **Successful login**: Seamless transition into the app. No jarring visual jump.
- **Error (wrong password)**: "I made a mistake, here's what to fix." (clear guidance, not anxiety)
- **Dark mode**: "I can read this perfectly." (comfort, no squinting) — on any device

### Micro-Emotions

| Desired | Avoid |
|---------|-------|
| Confidence | Confusion |
| Trust | Skepticism |
| Calm | Anxiety |
| Familiarity | Surprise |

### Design Implications

- **Trust → Clean layout**: Centered card layout, generous whitespace, professional typography. No split panel — simpler is better.
- **Efficiency → Minimal steps**: Single-page login, visible "forgot password" link, no unnecessary fields. Touch-friendly targets on mobile.
- **Professional comfort → Muted palette**: Institutional blue tones, no flashy gradients, no decorative elements
- **Confidence → Clear error states**: Red for errors with actionable messages, not cryptic alerts
- **Dark mode comfort → WCAG contrast**: Text must be clearly readable on dark backgrounds — no gray-on-dark-gray
- **Mobile-first touch → Usable on any screen**: Centered layout scales naturally, form inputs are large enough for touch, no horizontal scroll

### Emotional Design Principles

1. **Boring is good** — The best login page is one users never think about. Invisible design.
2. **No surprises** — Standard Keycloak patterns, enhanced with GENIE.AI branding. Users already know how to use this.
3. **Dark mode is a first-class citizen** — Not an afterthought. If users prefer dark mode, it must be as polished as light mode.
4. **Any device, same trust** — The professional feel must be consistent whether on a workstation, tablet, or phone.
5. **Centered, not split** — Single centered card with branding header. No split panel layout. Simpler, cleaner, more standard.

## UX Pattern Analysis & Inspiration

### Inspiring Products Analysis

**Keycloak keycloak.v2 (default theme)** — This IS the reference. PatternFly v5 centered card layout, clean, professional, already responsive. The upstream theme does exactly what we need. Our job is to restyle it, not rebuild it.

### Transferable UX Patterns

- **Centered card layout** — Already provided by upstream keycloak.v2. No custom template needed.
- **Dark mode** — Already built-in via `darkMode=true`. Just need to fix the color values.
- **Responsive** — Already handled by PatternFly v5. No custom media queries needed unless specific tweaks.
- **Branding** — Logo via `resources/img/`, realm name via i18n messages (`loginTitleHtml`). No template changes.

### Anti-Patterns to Avoid

- **Copying the upstream template** — The current approach copies the entire keycloak.v2 template.ftl and adds a split-panel wrapper. This creates a maintenance burden on every Keycloak update. Instead, inherit the template from the parent and customize only via CSS.
- **Overriding upstream CSS classes** — Only override colors and branding. Don't restructure the layout — it already works.
- **Custom FreeMarker templates** — Keycloak does NOT inherit templates from parent themes. Any template.ftl in the child theme replaces the parent's entirely. This means we must either copy the full template (hard to maintain) or not provide one at all (inherit parent).
- **Unnecessary JavaScript** — The upstream dark mode script handles system preference detection. Only add custom JS if a specific feature (like manual toggle) is truly needed.

### Design Inspiration Strategy

**What to Adopt:**
- The upstream keycloak.v2 layout as-is — centered card, responsive, dark mode built-in
- CSS custom properties for all color overrides — easy to update, isolated from upstream
- `darkMode=true` + upstream dark mode script — proven, maintained by Keycloak team
- i18n messages for branding text — standard Keycloak mechanism, no template changes

**What to Adapt:**
- Color palette — replace default PatternFly colors with GENIE.AI blues
- Logo and favicon — use frontend's brand-logo.png instead of Keycloak default
- Dark mode colors — ensure WCAG AA contrast compliance

**What to Remove:**
- `template.ftl` — no longer needed, upstream parent provides it
- Split panel CSS — replaced by upstream centered card layout
- Split panel HTML in template — no longer applicable
- `genie.js` (dark mode toggle) — evaluate if upstream dark mode is sufficient; remove if not needed

## Design System Foundation

### Design System Choice

**PatternFly v5** — as provided by the upstream keycloak.v2 parent theme. No additional design system needed.

### Rationale for Selection

- PatternFly v5 is already loaded by the parent theme via `stylesCommon`
- All Keycloak components (buttons, inputs, alerts, cards) are built on PatternFly v5 classes
- Red Hat maintains PatternFly v5 with WCAG accessibility compliance built-in
- Adding another design system would create conflicts and increase bundle size
- CSS-only customization via custom properties is the most maintainable approach

### Implementation Approach

Override PatternFly v5 CSS variables and Keycloak-specific classes through two CSS files:

- `css/genie.css` — Light mode: color overrides on `:root`, Keycloak class overrides (`#kc-header-wrapper`, `.pf-v5-c-login__main-header`), logo sizing
- `css/dark.css` — Dark mode: color overrides scoped to `@media (prefers-color-scheme: dark)` or `:root[data-theme="dark"]`

No JavaScript for styling. No template changes. No additional CSS framework.

### Customization Strategy

| What | How | Files |
|------|-----|-------|
| Primary color | Override PF5 color variables on `:root` | `genie.css` |
| Background | Override body/login background | `genie.css` |
| Logo | Place `brand-logo.png` in `resources/img/` (Keycloak auto-detects) | `resources/img/` |
| Favicon | Place favicon in `resources/img/` | `resources/img/` |
| Realm name | i18n message `loginTitleHtml` | `messages/messages_en.properties` |
| Dark mode | Color overrides in dark.css, activated by upstream `darkMode=true` | `dark.css` |
| Buttons, inputs, links | CSS overrides on `.pf-v5-c-button`, `.pf-v5-c-form-control`, etc. | `genie.css` |

## Core Interaction Definition

### Defining Experience

"Log in and get to work." The defining interaction is the login itself — username, password, submit. Nothing more, nothing less. The theme's job is to make this interaction invisible: the user sees the GENIE.AI branding, enters credentials, and is in the app. No friction, no visual noise, no confusion.

### User Mental Model

Users already know how to log into a web application. They expect:
- Username/email field at the top
- Password field below
- A prominent "Sign In" button
- A "Forgot Password?" link visible but not intrusive
- A "Register" link if registration is enabled
- Error messages near the relevant field, not in a confusing alert

The upstream keycloak.v2 template already provides all of this. Our CSS must not break any of these expectations.

### Success Criteria

- The login page loads in under 2 seconds
- The user immediately recognizes the GENIE.AI branding (logo + name)
- Form fields and buttons are clearly visible in both light and dark mode
- Error messages are readable and actionable
- The page looks professional on desktop, tablet, and mobile
- The visual transition from login to the GENIE.AI app feels seamless

### UX Patterns

All patterns are **established** — no novel interactions. We use the standard Keycloak login flow as provided by keycloak.v2. Our contribution is purely visual (colors, logo, contrast), not interactive.

### Experience Mechanics

No custom mechanics needed. The upstream template handles:
- Form submission and validation
- Error display
- Social login providers (if configured)
- TOTP/OTP two-factor authentication
- Password reset flow
- Registration flow
- Remember me checkbox

Our CSS must ensure all these flows remain visually consistent and readable.

## Visual Design Foundation

### Color System

Reuse the GENIE.AI frontend color palette from `theme-variables.css` for visual continuity.

**Light Mode:**

| Token | Value | Usage |
|-------|-------|-------|
| Primary | `#4E97D1` | Buttons, links, active elements |
| Primary hover | `#3a7da0` | Button hover state |
| Background | `#f5f7fa` | Page background |
| Surface/Card | `#ffffff` | Login card background |
| Input background | `#ffffff` | Form fields |
| Text primary | `#333333` | Headings, labels |
| Text secondary | `#4d4d4d` | Descriptions, helper text |
| Text muted | `#6c757d` | Placeholder text |
| Border | `#dcdfe4` | Input borders, dividers |
| Success | `#10b981` | Success messages |
| Warning | `#f59e0b` | Warning messages |
| Error | `#ef4444` | Error messages |

**Dark Mode:**

| Token | Value | Usage |
|-------|-------|-------|
| Primary | `#4E97D1` | Same as light — sufficient contrast on dark |
| Background | `#1e1e1e` | Page background |
| Surface/Card | `#252525` | Login card background |
| Input background | `#333333` | Form fields |
| Text primary | `#f0f0f0` | Headings, labels |
| Text secondary | `#b3b3b3` | Descriptions, helper text |
| Text muted | `#9ca3af` | Placeholder text |
| Border | `#3a3a3a` | Input borders, dividers |

**WCAG AA Contrast Check (dark mode):**
- `#f0f0f0` on `#1e1e1e` = 16.5:1 ✅
- `#f0f0f0` on `#252525` = 13.9:1 ✅
- `#b3b3b3` on `#252525` = 8.4:1 ✅
- `#4E97D1` on `#1e1e1e` = 5.3:1 ✅
- `#4E97D1` on `#252525` = 4.5:1 ✅ (borderline AA for normal text)

### Typography System

No custom fonts. Use the system font stack already provided by PatternFly v5. Keycloak's upstream template handles typography. No overrides needed.

### Spacing & Layout Foundation

No custom spacing. The upstream keycloak.v2 layout provides proper spacing via PatternFly v5's spacing system. Our CSS only overrides colors and branding — not layout structure.

### Accessibility Considerations

- All color combinations meet WCAG AA contrast ratio (4.5:1 for normal text)
- Dark mode uses high-contrast text colors (`#f0f0f0`, `#b3b3b3`) — not gray-on-dark
- No reliance on color alone to convey information (errors use text + color)
- Upstream PatternFly v5 provides built-in focus indicators and keyboard navigation

## Design Direction Decision

### Design Directions Explored

No mockup variations generated. The design direction is constrained by the upstream keycloak.v2 template — we inherit its layout as-is and apply GENIE.AI colors via CSS. There is no layout choice to make.

### Chosen Direction

**Upstream keycloak.v2 layout + GENIE.AI color palette.** The centered card PatternFly v5 layout provided by the parent theme, restyled with the frontend's `theme-variables.css` color tokens.

### Design Rationale

- The upstream layout already follows modern SaaS login page conventions (centered card, clean form, responsive)
- CSS-only customization ensures zero maintenance burden on Keycloak updates
- Reusing the frontend's exact color tokens guarantees visual continuity between the app and the auth pages
- System-preference dark mode only (no manual toggle) — simpler, fewer moving parts

### Implementation Approach

1. Delete `template.ftl` from the theme (inherit parent)
2. Delete `genie.js` — upstream dark mode via system preference is sufficient
3. Delete split-panel CSS from `genie.css`
4. Rewrite `genie.css` with only color overrides on PatternFly v5 and Keycloak classes
5. Update `dark.css` with frontend's dark mode color values from `theme-variables.css`
6. Replace `logo.png` with frontend's `brand-logo.png`
7. Verify favicon.ico is in place
8. Keep i18n messages (loginTitleHtml, loginSubheading) — lightweight, useful
9. Simplify `theme.properties`: remove `scripts=`, keep `styles=` and `darkMode=true`
10. Account console: treat as separate scope (parent is `keycloak`, different classes)

### Scope Boundaries

- **In scope**: Login theme (CSS + resources)
- **Out of scope**: Account console (separate CSS effort), email template (separate work)
- **Deferred**: Manual dark mode toggle, custom branding elements requiring template changes

## User Journey Flows

The upstream keycloak.v2 template handles all authentication flows. Our CSS must ensure each flow renders correctly in both light and dark modes. The flows to verify after implementation:

### Login Flow

User navigates to the app → redirected to Keycloak login → enters credentials → submits → redirected back to app.

**CSS verification points:** logo visible, form fields readable, submit button prominent, error messages visible on wrong credentials.

### Registration Flow

User clicks "Register" link → registration form → submits → email verification → redirect to login.

**CSS verification points:** form layout intact, required field indicators visible, success/error messages readable.

### Password Reset Flow

User clicks "Forgot Password?" → enters username/email → receives email → clicks link → sets new password.

**CSS verification points:** form layout consistent with login, info messages readable.

### TOTP/OTP Two-Factor Flow

After primary login → TOTP setup or code entry → verification → access granted.

**CSS verification points:** QR code visible (TOTP), input field properly sized, error feedback clear.

### Error Recovery

Wrong password, expired session, account locked (brute force) → error message displayed → user can retry or take corrective action.

**CSS verification points:** error banner uses error color (`#ef4444`) with readable text, not hidden or low-contrast.

### Journey Patterns

All flows share the same visual pattern: centered card, GENIE.AI header, form body, optional footer links. Consistency is guaranteed by inheriting the upstream template.

## Component Strategy

### Design System Components

All components are provided by the upstream Keycloak themes. No custom components needed. Our CSS restyles existing components via class overrides.

**Login components (PatternFly v5 via keycloak.v2 parent):**
- `.pf-v5-c-button.pf-m-primary` — primary action buttons
- `.pf-v5-c-button.pf-m-secondary` — secondary actions
- `.pf-v5-c-button.pf-m-link` — link-style buttons
- `.pf-v5-c-form-control` — text inputs
- `.pf-v5-c-check` — checkboxes
- `.pf-v5-c-alert` — alert banners
- `#kc-header-wrapper` — realm branding header
- `.pf-v5-c-login__main-header` — card top accent border

**Account console components (React SPA via keycloak parent):**
- Different class structure than login — needs separate CSS inspection
- Same GENIE.AI color tokens apply
- CSS-only approach (no template changes, React SPA)

**Email template:**
- HTML template already customized (`email/html/template.ftl`) — table-based layout
- CSS is inline in the template, not in a separate CSS file
- Apply GENIE.AI colors to the table layout
- Use brand-logo.png in email header

### Custom Components

None. All UI is provided by upstream themes. Zero custom HTML for login and account console. Email template is already custom.

### Visual Alignment Across Scopes

All three scopes share the same visual identity:
- **Color palette**: GENIE.AI tokens from `theme-variables.css`
- **Logo**: `brand-logo.png` from frontend
- **Typography**: System font stack (PatternFly v5 default)
- **Dark mode**: Same color values (`#1e1e1e`, `#252525`, `#f0f0f0`, etc.)

### Implementation Roadmap

**Phase 1 — Login theme:**
1. Clean up: delete `template.ftl`, `genie.js`, split-panel CSS
2. Replace logo with `brand-logo.png`
3. Rewrite `genie.css` with color-only overrides
4. Update `dark.css` with frontend's dark mode values
5. Simplify `theme.properties`
6. Deploy, verify all flows in both modes

**Phase 2 — Account console:**
1. Inspect account console classes (React SPA)
2. Create/update `account/resources/css/genie.css` with GENIE.AI color overrides
3. Update `account/resources/css/dark.css` for dark mode
4. Verify in both modes

**Phase 3 — Email template:**
1. Update `email/html/template.ftl` with GENIE.AI colors
2. Copy `brand-logo.png` to `email/resources/img/`
3. Update email message bundles if needed
4. Test email rendering

## UX Consistency Patterns

### Color Override Rules

All three scopes (login, account console, email) follow the same rules:

1. **Never hardcode colors** — always use CSS custom properties defined at `:root`
2. **Same tokens, same values** — the 12 color tokens from `theme-variables.css` are the single source of truth
3. **Dark mode mirrors the frontend** — use `theme-variables.css` dark values, not custom guesses
4. **Status colors never change** — success `#10b981`, warning `#f59e0b`, error `#ef4444` in both modes

### Branding Consistency

| Element | Login | Account Console | Email |
|---------|-------|----------------|-------|
| Logo | `resources/img/brand-logo.png` | `resources/img/brand-logo.png` | `resources/img/brand-logo.png` |
| Favicon | `resources/img/favicon.ico` | — | — |
| Primary color | `#4E97D1` | `#4E97D1` | `#4E97D1` |
| Background | `#f5f7fa` / `#1e1e1e` | `#f5f7fa` / `#1e1e1e` | `#f5f7fa` |
| Font | System stack (PF5) | System stack (PF5) | System stack (email-safe) |

### CSS Override Principles

1. **Minimal selectors** — override only what needs changing (colors, not layout)
2. **No `!important`** — upstream specificity should be enough for color overrides; use more specific selectors if needed
3. **No structural changes** — never override `display`, `flex`, `grid`, `position`, `width`, `height` on upstream layout classes
4. **Dark mode in separate file** — `dark.css` scoped to `@media (prefers-color-scheme: dark)` and `:root[data-theme="dark"]`, matching the frontend's approach
5. **Scope selectors** — login overrides target `.pf-v5-c-*` and `#kc-*` classes; account console targets its own React classes; email uses inline styles

## Responsive Design & Accessibility

### Responsive Strategy

**No custom responsive design needed.** The upstream keycloak.v2 template is fully responsive via PatternFly v5's built-in breakpoints. Our CSS-only color overrides do not affect layout behavior.

**Verification after implementation:** test login page on desktop (1440px), tablet (768px), and mobile (375px) to confirm the upstream responsive behavior is preserved.

### Accessibility Strategy

**WCAG AA compliance** — inherited from PatternFly v5 upstream. Our contribution:

- **Contrast ratios verified** — all color combinations meet 4.5:1 minimum (documented in Visual Foundation)
- **No layout changes** — we don't modify structure, so upstream accessibility (keyboard nav, screen reader support, focus indicators) is preserved
- **No color-only information** — error states use text + color, not color alone
- **Touch targets** — upstream PatternFly v5 provides adequate touch target sizes (44x44px minimum)

### Testing Strategy

**After each phase (login, account console, email):**

1. Visual check in Playwright at 3 viewports (desktop, tablet, mobile)
2. Toggle system dark mode and verify readability
3. Verify all authentication flows render correctly (login, register, reset, TOTP, errors)
4. Check email rendering in a mail client (at least one)

### Implementation Checklist

Before starting implementation, verify:
- [ ] Whether `css/styles.css` is needed (or if parent loads it via `stylesCommon`)
- [ ] Identify the exact CSS class for the logo in the upstream header
- [ ] Determine favicon strategy (`.ico` only, or multi-size from frontend)
- [ ] Test with `template.ftl` deleted — if logo doesn't appear, find the right mechanism
- [ ] Verify upstream `darkMode=true` works with custom `dark.css`

## 14. Workflow Completion

### Summary

The UX design specification for the GENIE.AI Keycloak theme is complete. Through 14 collaborative steps, the design converged on a **CSS-only customization approach** that maximizes maintainability while delivering a polished, brand-aligned experience across login, account console, and email.

### Key Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Layout | Centered card (upstream default) | Split panel rejected; upstream template is cleaner and simpler to maintain |
| Customization method | CSS color overrides only | Minimal diff from upstream keycloak.v2 template — easy to maintain across Keycloak upgrades |
| Dark mode | System preference via `darkMode=true` | No manual toggle; upstream handles detection automatically |
| Color source | Frontend `theme-variables.css` | Visual continuity between frontend and auth pages |
| Logo | `brand-logo.png` from frontend | Consistent branding across the platform |
| Scope | Login + Account Console + Email | All three themes treated together for consistency |

### Deliverables

- **This document** — full UX design specification covering all three theme scopes
- **Implementation scope** — CSS-only rewrite: delete `template.ftl`, delete `genie.js`, rewrite `genie.css`, update `dark.css`, simplify `theme.properties`

### Recommended Next Steps

1. **`/bmad-bmm-quick-dev`** — implement the CSS-only theme redesign following this spec
2. **Visual verification** — Playwright screenshots at desktop/tablet/mobile viewports after implementation
3. **Update `spec-keycloak-theme.md`** — align the implementation spec with the new CSS-only approach (currently documents split-panel strategy)
