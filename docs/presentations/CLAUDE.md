# Presentations - Agent Context

Operational notes for AI agents working on the Marp-based slide decks in this
directory. Human-facing docs live in README.md; this file is for tooling
tips and conventions that an agent needs to know but a human reader does
not.

## Build process (current)

The build runs **two commands** - HTML first (with all internal links
working), then PDF from the same source:

```bash
# 1. HTML output - must be NEXT TO the source .md so relative links resolve
npx @marp-team/marp-cli deck.md \
  --theme-set themes/genie-ai.css \
  --engine @marp-team/marp-core/full \
  --html --allow-local-files --no-stdin \
  -o deck.html

# 2. PDF (Marp re-renders from markdown either way)
npx @marp-team/marp-cli deck.md \
  --theme-set themes/genie-ai.css \
  --engine @marp-team/marp-core/full \
  --pdf --allow-local-files --no-stdin \
  -o deck.pdf
```

Output ends up **next to the source `.md`** (e.g. `genie-ai-sovereign-architecture.pdf`),
NOT in a separate `output/` directory. This is critical: assets referenced
as `assets/foo.png` must be next to the PDF for it to render. The previous
`output/` convention broke every internal link.

The **second command is a no-op** once the HTML exists - Marp regenerates
from markdown either way. Going through HTML for the browser preview, and
through PDF for distribution, is the current convention.

## Why not just --pdf directly?

The Marp **PDF renderer** applies a stricter XSS sanitiser than the HTML
renderer. Some `style="..."` attributes are silently dropped, which makes
the PDF look subtly different from the browser preview. The two-step
process keeps both representations consistent.

**Workaround** (when not feasible to do two steps): render the PDF **after**
opening the HTML in a browser, or use the pre-built HTML for verification.
But the canonical path is HTML first then PDF second.

## Local patch: `Ke is not a function`

`marp-core@5.0.1` has a packaging bug that strips `style`/`class`/`href`
attributes. A local patch in `node_modules/@marp-team/marp-core/lib/marp-CdKqL-3e.mjs`
restores them. **Re-apply after every `npm install`** until marp-core 5.0.2+
is available. The patch is documented in `README.md` section "Marp v5 notes".

## Path: post-process HTML for self-contained sharing

To share a single self-contained HTML (e.g. via email), inline the
PNG/JPG assets as `data:` URIs:

```python
import base64
from pathlib import Path
deck = 'genie-ai-sovereign-architecture'
html = Path(f'{deck}.html')
content = html.read_text()
for ref, img in [('genie-ai-logo-24.png', 'genie-ai-logo-24.png'),
                 ('hero-visual.jpg', 'hero-visual.jpg')]:
    data = base64.b64encode(Path(img).read_bytes()).decode()
    mime = 'image/png' if img.endswith('.png') else 'image/jpeg'
    content = content.replace(ref, f'data:{mime};base64,{data}')
html.write_text(content)
```

The script lives in the human-facing `README.md` and is meant to be
copy-pasted, not committed as a build step.

## Layout class vocabulary (theme `genie-ai.css`)

Reusable layout helpers - copy/paste from the theme:

- `.columns` - 2-col or 1fr/1.5fr/1.5fr grid for `Compare` table
- `.metric`, `.metric-row` - value cards with bordered cards
- `.eyebrow` - small uppercase label above a title
- `.ops-benefit` - "Takeaway" callout at the bottom of a slide
- `.agenda-item` - numbered agenda row
- `.brand-pill`, `.hero-band` - title-slide elements
- `.pillbar`, `.pillbtn` - used on cover/closing
- `section.title`, `section.closing` - cover and thank-you layouts
- `section.session-divider` - big numeric + section title divider
- `.card`, `.card-num`, `.card-name` - visual cards for capability lists
- `.pillar-row`, `.pillar` - used for "5 brand pillars" card layout
- `.compare`, `.head`, `.label`, `.ba`, `.genie` - comparison grid
- `section.demo` - vibrant gradient with centered layout for "Live Demo"
  inter-slide (custom class)

## Custom spot directives (slide-level)

- `<!-- _class: title -->` - cover layout (centred, gradient bg, brand pill)
- `<!-- _class: closing -->` - thank-you layout (centred, gradient bg)
- `<!-- _class: demo -->` - demo break layout (vibrant gradient, centered)
- `<!-- _class: session-divider -->` - big numeric + section title
- `<!-- _class: title -->` + `<!-- _paginate: false -->` - disable footer
  on a specific slide

## Output check

After editing a slide, rebuild and inspect:

```bash
npx @marp-team/marp-cli deck.md \
  --theme-set themes/genie-ai.css --engine @marp-team/marp-core/full \
  --html --allow-local-files --no-stdin -o deck.html
```

Open `<deck>.html` in a browser to verify the **full** layout
(inline styles preserved). Then:

```bash
npx @marp-team/marp-cli deck.md \
  --theme-set themes/genie-ai.css --engine @marp-team/marp-core/full \
  --pdf --allow-local-files --no-stdin -o deck.pdf
```

If the PDF looks subtly different from the browser preview, it's the
sanitiser - re-check your `style="..."` attributes for known-safe
properties (`display`, `text-align`, `margin`, `color`, `font-size`,
`background`, `border`, `border-radius`, `padding`, `width`, `max-width`).
