---
title: 'keycloak-theme'
type: 'feature'
created: '2026-04-14T00:00:00Z'
status: 'draft'
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Keycloak authentication pages use default Keycloak branding, creating visual discontinuity with the GENIE.AI application. Users experience jarring transitions when navigating between the main application and Keycloak login/account pages.

**Approach:** Create a custom Keycloak theme (login, account console, email) that extends the base Keycloak theme, applying GENIE.AI color palette, typography, and split-panel layout to ensure visual continuity across all authentication touchpoints.

## Boundaries & Constraints

**Always:**
- Extend Keycloak base theme (parent=keycloak in theme.properties)
- Use CSS custom properties for colors to support dark mode
- Place theme files in `configs/keycloak/themes/genie/`
- Copy existing favicon files from `components/gov-chat-frontend/public/`
- Include English and French message bundles only
- Maintain responsiveness: desktop (~45/55 split), tablet (~35% brand), mobile (brand collapses to header)
- Update `configs/keycloak/Dockerfile` to copy themes into `/opt/keycloak/themes/`
- Set `KEYCLOAK_THEME=genie` in realm YAML (single variable for login, account, email)

**Ask First:**
- Logo source: Should I create a placeholder GENIE.AI logo or do you have an existing logo file?

**Never:**
- Modify Keycloak core templates unnecessarily
- Hardcode colors directly in CSS — use CSS custom properties
- Create custom message bundles for languages other than EN/FR
- Implement account console template overrides (React SPA requires CSS-only approach)

## I/O & Edge-Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Desktop view | Screen width >= 1024px | Split panel: 45% brand left, 55% form right | Fallback to single column if layout fails |
| Tablet view | 768px <= screen width < 1024px | Split panel: 35% brand left, 65% form right | Fallback to single column |
| Mobile view | Screen width < 768px | Brand collapses to header, form takes full width | Stack vertically if flexbox fails |
| Light mode | System prefers light mode | Background #f5f7fa, surface #ffffff, text #333333 | Fallback to Keycloak default colors |
| Dark mode | System prefers dark mode | Background #1e1e1e, surface #252525, text #f0f0f0 | Fallback to light mode if media query unsupported |
| Email rendering | Email client opens HTML email | Responsive table layout, logo in header, ITU branding footer | Plain text fallback if HTML fails |

</frozen-after-approval>

## Code Map

- `configs/keycloak/Dockerfile` -- Update to copy themes/ directory into container
- `configs/keycloak/genie-realm.yaml` -- Add accountTheme and emailTheme properties
- `configs/keycloak/themes/genie/login/theme.properties` -- Parent theme and CSS imports
- `configs/keycloak/themes/genie/login/resources/css/genie.css` -- Main styles, layout, color palette
- `configs/keycloak/themes/genie/login/resources/css/dark.css` -- Dark mode overrides
- `configs/keycloak/themes/genie/login/resources/img/logo.png` -- GENIE.AI logo
- `configs/keycloak/themes/genie/login/resources/img/favicon.ico` -- Copied from frontend
- `configs/keycloak/themes/genie/login/resources/js/genie.js` -- Manual dark mode toggle
- `configs/keycloak/themes/genie/login/messages/messages_en.properties` -- English custom labels
- `configs/keycloak/themes/genie/login/messages/messages_fr.properties` -- French custom labels
- `configs/keycloak/themes/genie/login/template.ftl` -- Split panel layout wrapper
- `configs/keycloak/themes/genie/account/theme.properties` -- Parent theme for account console
- `configs/keycloak/themes/genie/account/resources/css/genie.css` -- Account console styles
- `configs/keycloak/themes/genie/account/resources/css/dark.css` -- Dark mode for account console
- `configs/keycloak/themes/genie/account/messages/messages_en.properties` -- English overrides
- `configs/keycloak/themes/genie/account/messages/messages_fr.properties` -- French overrides
- `configs/keycloak/themes/genie/email/theme.properties` -- Parent theme for emails
- `configs/keycloak/themes/genie/email/resources/img/logo.png` -- Email logo
- `configs/keycloak/themes/genie/email/text/html.ftl` -- HTML email template (table-based responsive layout)
- `configs/keycloak/themes/genie/email/text/text.ftl` -- Plain text email template
- `configs/keycloak/themes/genie/email/messages/messages_en.properties` -- English email labels
- `configs/keycloak/themes/genie/email/messages/messages_fr.properties` -- French email labels
- `components/gov-chat-frontend/public/favicon.ico` -- Source favicon to copy

## Tasks & Acceptance

**Execution:**
- [ ] `configs/keycloak/Dockerfile` -- Add `COPY themes/ /opt/keycloak/themes/` to copy theme directory -- Keycloak container needs theme files to be present
- [ ] `configs/keycloak/genie-realm.yaml` -- Replace `loginTheme: $(env:KEYCLOAK_LOGIN_THEME)` with `loginTheme: $(env:KEYCLOAK_THEME)`, add `accountTheme: $(env:KEYCLOAK_THEME)` and `emailTheme: $(env:KEYCLOAK_THEME)` -- Single theme variable controls all three
- [ ] `configs/keycloak/themes/genie/login/theme.properties` -- Create file with `parent=keycloak`, CSS imports in `styles=css/genie.css css/dark.css` -- Extend base theme and load stylesheets
- [ ] `configs/keycloak/themes/genie/login/resources/css/genie.css` -- Create CSS with CSS custom properties (primary: #4E97D1, background: #f5f7fa, etc.), split-panel flexbox layout, responsive breakpoints for desktop/tablet/mobile -- Apply GENIE.AI visual identity
- [ ] `configs/keycloak/themes/genie/login/resources/css/dark.css` -- Create CSS with `@media (prefers-color-scheme: dark)` overriding all color custom properties to dark variants -- Enable automatic dark mode
- [ ] `configs/keycloak/themes/genie/login/resources/js/genie.js` -- Create JS for manual dark mode toggle using theme cookie -- Optional manual override
- [ ] `configs/keycloak/themes/genie/login/resources/img/logo.png` -- Copy or create GENIE.AI logo -- Brand panel needs logo
- [ ] `configs/keycloak/themes/genie/login/resources/img/favicon.ico` -- Copy from `components/gov-chat-frontend/public/favicon.ico` -- Use existing favicon
- [ ] `configs/keycloak/themes/genie/login/messages/messages_en.properties` -- Create English message bundle with custom login heading and tagline -- Customize English labels
- [ ] `configs/keycloak/themes/genie/login/messages/messages_fr.properties` -- Create French message bundle with custom login heading and tagline -- Customize French labels
- [ ] `configs/keycloak/themes/genie/login/template.ftl` -- Create FreeMarker template with split panel structure: left brand panel (logo + tagline), right form container -- Replace default single-column layout
- [ ] `configs/keycloak/themes/genie/account/theme.properties` -- Create file with `parent=keycloak` and `styles=css/genie.css css/dark.css` -- Extend account console theme
- [ ] `configs/keycloak/themes/genie/account/resources/css/genie.css` -- Create CSS targeting Keycloak account console classes, applying GENIE.AI color palette and typography -- Style account console
- [ ] `configs/keycloak/themes/genie/account/resources/css/dark.css` -- Create CSS with dark mode overrides for account console -- Enable dark mode in account console
- [ ] `configs/keycloak/themes/genie/account/messages/messages_en.properties` -- Create English message bundle for account console -- Customize English labels
- [ ] `configs/keycloak/themes/genie/account/messages/messages_fr.properties` -- Create French message bundle for account console -- Customize French labels
- [ ] `configs/keycloak/themes/genie/email/theme.properties` -- Create file with `parent=keycloak` -- Extend base email theme
- [ ] `configs/keycloak/themes/genie/email/resources/img/logo.png` -- Copy logo for email templates -- Email header needs logo
- [ ] `configs/keycloak/themes/genie/email/text/html.ftl` -- Create FreeMarker HTML email template with responsive table layout, logo header, ITU branding footer -- Style HTML emails
- [ ] `configs/keycloak/themes/genie/email/text/text.ftl` -- Create plain text email template with logo text header and ITU footer -- Style plain text emails
- [ ] `configs/keycloak/themes/genie/email/messages/messages_en.properties` -- Create English email label overrides -- Customize English email labels
- [ ] `configs/keycloak/themes/genie/email/messages/messages_fr.properties` -- Create French email label overrides -- Customize French email labels

**Acceptance Criteria:**
- Given a user accessing a Keycloak login page, when the page loads, then the split panel layout is displayed with GENIE.AI branding (logo, colors) and the form on the right side
- Given a user with system preference for dark mode, when accessing any Keycloak page, then the dark color scheme is automatically applied
- Given a user resizing their browser window, when crossing responsive breakpoints, then the layout adjusts from split panel (desktop) to reduced brand panel (tablet) to brand header (mobile)
- Given a user accessing the Keycloak account console, when the page loads, then GENIE.AI colors and typography are applied throughout the console
- Given a Keycloak email being sent, when the email is rendered, then it contains the GENIE.AI logo, uses GENIE.AI colors, and includes an ITU branding footer

## Spec Change Log

## Design Notes

**CSS Custom Properties Strategy:**
Define colors in `genie.css` at `:root` level for easy overrides:
```css
:root {
  --genie-primary: #4E97D1;
  --genie-primary-hover: #3a7da0;
  --genie-bg: #f5f7fa;
  --genie-surface: #ffffff;
  --genie-text-primary: #333333;
  --genie-text-secondary: #888888;
}
```

Dark mode in `dark.css`:
```css
@media (prefers-color-scheme: dark) {
  :root {
    --genie-bg: #1e1e1e;
    --genie-surface: #252525;
    --genie-text-primary: #f0f0f0;
    --genie-text-secondary: #999999;
  }
}
```

**Split Panel Layout:**
Use flexbox with two children:
```css
.login-pf-page { display: flex; height: 100vh; }
.brand-panel { flex: 0 0 45%; background: var(--genie-primary); }
.form-panel { flex: 1; padding: 2rem; }
@media (max-width: 1023px) { .brand-panel { flex: 0 0 35%; } }
@media (max-width: 767px) {
  .login-pf-page { flex-direction: column; }
  .brand-panel { flex: 0 0 auto; padding: 1rem; }
  .form-panel { flex: 1; }
}
```

**Email Template Structure:**
Use table-based layout for email client compatibility:
```html
<table role="presentation" width="100%">
  <tr><td class="header"><img src="cid:logo.png"></td></tr>
  <tr><td class="content">${message}</td></tr>
  <tr><td class="footer">ITU International Telecommunication Union</td></tr>
</table>
```

## Verification

**Commands:**
- `grep -q "COPY themes/ /opt/keycloak/themes/" configs/keycloak/Dockerfile` -- expected: Dockerfile copies themes to correct path
- `grep -q "accountTheme: \$(env:KEYCLOAK_THEME)" configs/keycloak/genie-realm.yaml` -- expected: Realm has account theme set
- `grep -q "emailTheme: \$(env:KEYCLOAK_THEME)" configs/keycloak/genie-realm.yaml` -- expected: Realm has email theme set
- `test -f configs/keycloak/themes/genie/login/theme.properties` -- expected: Login theme properties exist
- `test -f configs/keycloak/themes/genie/login/resources/css/genie.css` -- expected: Login CSS exists
- `test -f configs/keycloak/themes/genie/login/resources/css/dark.css` -- expected: Login dark CSS exists
- `test -f configs/keycloak/themes/genie/login/template.ftl` -- expected: Layout template exists

**Manual checks (if no CLI):**
- Verify CSS custom properties are defined in genie.css with correct hex colors
- Verify dark.css contains @media (prefers-color-scheme: dark) with all color overrides
- Verify template.ftl has split panel structure with brand-panel and form-panel sections
- Verify message bundles contain custom labels (e.g., login heading, tagline)
- Verify Dockerfile includes theme copy instruction
