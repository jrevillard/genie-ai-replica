# Theme System

GENIE.AI uses a CSS-native theming architecture. A single **brand color** drives the entire accent palette, including dark mode — no JavaScript color manipulation.

## How It Works

```
JSON config (genie-ai-config.json)
  │
  ▼
main.js — injects base CSS variables via inline style
  │
  ▼
theme-variables.css — derives full palette using OKLch relative syntax
  │
  ▼
Components consume tokens via var(--token)
```

### 1. JSON Config

The config file (`public/config/genie-ai-config.json`) defines the base theme:

```json
{
  "theme": {
    "brandColor": "#4071cb",
    "bg": "#f0f2f5",
    "fg": "#1a1a2e",
    "navbar": {
      "background": "#4071cb",
      "text": "#ffffff"
    },
    "colors": {
      "success": "#10b981",
      "warning": "#f59e0b",
      "danger": "#ef4444",
      "info": "#3b82f6"
    },
    "typography": {
      "fontFamily": "'Inter', sans-serif",
      "fontScale": 1.1
    }
  }
}
```

| Field | Required | Default | Effect |
|-------|----------|---------|--------|
| `brandColor` | Yes | `#4071cb` | Primary brand color. All accent variants derived in CSS. |
| `bg` | No | `oklch(98% 0.005 250)` | Light mode page background |
| `fg` | No | `oklch(22% 0.02 240)` | Light mode primary text color |
| `navbar.background` | No | Falls back to `brandColor` | Navbar background color |
| `navbar.text` | No | Auto-contrasted | Navbar text/icon color |
| `colors.success/warning/danger/info` | No | DS defaults | Override semantic status colors |
| `typography.fontFamily` | No | System font stack | Override body font |
| `typography.fontScale` | No | `1` | Multiplier for all text sizes (e.g. `1.1`) |

### 2. CSS Derivation (theme-variables.css)

All accent colors are computed in pure CSS using [OKLch relative color syntax](https://developer.mozilla.org/en-US/docs/Web/CSS/color_value/oklch#relative_oklch_colors):

```css
/* Light mode — brand as-is */
--accent: var(--brand);
--accent-hover: oklch(from var(--brand) calc(l - 0.04) c h);
--accent-muted: oklch(from var(--brand) l c h / 0.12);
--accent-fg: oklch(from var(--brand) min(calc(l + 0.56), 0.98) calc(c * 0.1) h);

/* Dark mode — lighter accent + brand-tinted neutrals */
--accent: oklch(from var(--brand) calc(l + 0.2) calc(c * 0.85) h);
--bg: oklch(from var(--brand) 0.14 calc(c * 0.25) h);
--surface: oklch(from var(--brand) 0.22 calc(c * 0.18) h);
```

Key behaviors:
- **Light mode**: `--accent` = brand color, hover is darker, muted is transparent
- **Dark mode**: `--accent` is lightened, and the entire neutral palette (bg, surface, border, muted) is tinted with the brand hue — a magenta brand gives a magenta-tinted dark mode, green gives green-tinted, etc.
- **No JS color math**: `adjustColor()` was removed. All derivation is CSS.

### 3. Variable Injection (main.js)

`main.js` injects config values as CSS custom properties on `<html>`:

```js
root.style.setProperty('--brand', theme.brandColor);
root.style.setProperty('--config-bg', theme.bg);   // intermediate variable
root.style.setProperty('--config-fg', theme.fg);   // intermediate variable
```

`--config-bg` / `--config-fg` are **intermediate variables** — JS sets them, CSS reads them via `var(--config-bg, <fallback>)`. This avoids inline style specificity conflicts with dark mode CSS overrides.

## Switching Themes

To deploy with a different theme:

1. Edit `public/config/genie-ai-config.json` (or copy a variant)
2. Rebuild the frontend: `docker compose build frontend`
3. Restart: `docker compose up -d frontend`

### Available Config Variants

| File | Brand Color | Description |
|------|-------------|-------------|
| `genie-ai-config.json` | `#4071cb` (blue) | Default GENIE.AI |
| `genie-ai-config-original.json` | `#4682B4` (steel blue) | Original design |
| `genie-ai-config-huduma.json` | `#4E97D1` (blue) | Kenya Huduma |
| `genie-ai-config-huduma-magenta.json` | `#7A2A6A` (magenta) | Huduma variant |
| `genie-ai-config-huduma-red.json` | `#8B2A2A` (red) | Huduma variant |
| `genie-ai-config-huduma-dark-blue.json` | `#255C92` (dark blue) | Huduma variant |
| `genie-ai-config-naat.json` | `#7FBA59` (green) | NAAT deployment |

Each variant can also override `bg` and `fg` for light mode customization.

## Token Reference

### Accent Tokens (derived from --brand)

| Token | Light Mode | Dark Mode |
|-------|-----------|-----------|
| `--accent` | Brand color | Lightened brand |
| `--accent-hover` | Slightly darker | Slightly less lightened |
| `--accent-muted` | Brand at 12% opacity | Brand at 15% opacity |
| `--accent-fg` | High-contrast on brand | Dark on lightened brand |
| `--accent-secondary` | Darker brand | Slightly lightened brand |

### Core Palette

| Token | Light Mode | Dark Mode |
|-------|-----------|-----------|
| `--bg` | Config or default (near white) | Brand-tinted dark (14% L) |
| `--surface` | White | Brand-tinted (22% L) |
| `--fg` | Config or default (dark) | Near white |
| `--muted` | Medium gray | Brand-tinted (58% L) |
| `--border` | Light gray | Brand-tinted (30% L) |

### Typography

`--font-scale` multiplier applies to all `--text-*` tokens:

```css
--text-xs: calc(0.7rem * var(--font-scale));
--text-sm: calc(0.75rem * var(--font-scale));
/* ... up to --text-3xl */
```

## Dark Mode

Dark mode is controlled by the `data-theme` attribute on `<html>`:
- `data-theme="dark"` — dark mode
- `data-theme="light"` — light mode
- `data-theme="system"` — follows OS preference

In dark mode, the **entire neutral palette** is tinted with the brand color's hue. This means:
- A blue brand → cool blue-gray dark mode
- A magenta brand → warm pink-gray dark mode
- A green brand → green-tinted dark mode

The accent color is automatically lightened to maintain contrast on dark backgrounds.

## Mobile (Flutter)

The mobile app shares the same DS architecture — a single `brandColor` drives the entire palette via type-safe Dart tokens.

### Architecture

```
lib/design_system/
├── tokens/
│   ├── app_tokens.dart          # Type-safe color tokens (access via ThemeManager().tokens)
│   ├── color_utils.dart         # Hex parsing, HSL brand tinting helpers
│   ├── spacing.dart             # DsSpacing.xs(4)/sm(8)/md(16)/lg(24)/xl(32)/xl2(48)
│   └── radii.dart               # DsRadii.sm(4)/md(8)/lg(12)/xl(16)
├── theme/
│   └── app_theme.dart           # ThemeData builder from AppTokens
└── components/
    ├── ds_button.dart           # DsButton — variants: primary, secondary, ghost, danger
    ├── ds_card.dart             # DsCard — variants: standard, flat, elevated, outline
    ├── ds_input.dart            # DsInput — sizes: sm, md, lg
    └── ds_modal.dart            # DsModal — sizes: sm, md, lg, xl + DsModal.show()
```

### Config (same schema as web)

```json
{
  "theme": {
    "brandColor": "#4682B4",
    "bg": "#f0f2f5",
    "fg": "#1a1a2e",
    "navbar": { "background": "#4682B4", "text": "#ffffff" },
    "colors": { "success": "#10b981", "warning": "#f59e0b", "danger": "#ef4444", "info": "#3b82f6" },
    "typography": { "fontScale": 1.1 }
  }
}
```

### Dart Token Derivation

`AppTokens.fromConfig()` parses the JSON config and computes all tokens. Dark mode uses `HSLColor` brand tinting — the Dart equivalent of the web's OKLch relative syntax:

```dart
// Dark bg: 14% lightness, 25% of brand saturation, same hue
darkBg = HSLColor.fromColor(brand)
    .withLightness(0.14)
    .withSaturation(hsl.saturation * 0.25)
    .toColor();
```

### Token Reference

| Token | Light Mode | Dark Mode |
|-------|-----------|-----------|
| `tokens.brand` | Config brandColor | Same |
| `tokens.bg` | Config or default | Brand-tinted dark |
| `tokens.fg` | Config or default | Near white |
| `tokens.surface` | White | Brand-tinted (22% L) |
| `tokens.muted` | Medium gray | Brand-tinted (58% L) |
| `tokens.border` | Light gray | Brand-tinted (30% L) |
| `tokens.accent` | Brand color | Lightened brand |
| `tokens.accentFg` | White | Dark brand |
| `tokens.danger` | Red | Red |
| `tokens.success` | Green | Green |

### DS Components

All components use `ThemeManager().tokens` for colors and `DsSpacing`/`DsRadii` for dimensions.

- **DsButton** — 4 variants (primary, secondary, ghost, danger), icon support, `iconOnly` mode
- **DsCard** — 4 variants (standard, flat, elevated, outline)
- **DsInput** — 3 sizes (sm=36, md=44, lg=52), prefix/suffix support
- **DsModal** — 4 sizes (sm=360, md=480, lg=640, xl=800), static `DsModal.show()` helper
