# Presentations - Agent Context

Operational notes for AI agents working on the Marp-based slide decks in this
directory. Human-facing docs live in README.md; this file is for tooling
tips and conventions that an agent needs to know but a human reader does
not.

## Build process (current)

The build runs **two steps** - Marp HTML first (with all internal links
working), then headless Chromium prints that HTML to PDF:

```bash
# 1. HTML output - must be NEXT TO the source .md so relative links resolve
npx @marp-team/marp-cli deck.md \
  --theme-set themes/genie-ai.css \
  --engine @marp-team/marp-core/full \
  --html --allow-local-files --no-stdin \
  -o deck.html

# 2. PDF from the HTML (Chromium print-to-PDF)
chromium \
  --headless \
  --disable-gpu \
  --print-to-pdf=deck.pdf \
  "file://$(pwd)/deck.html"
```

Output ends up **next to the source `.md`** (e.g. `genie-ai-sovereign-architecture.pdf`),
NOT in a separate `output/` directory. This is critical: assets referenced
as `assets/foo.png` must be next to the PDF for it to render. The previous
`output/` convention broke every internal link.

## Why not just Marp --pdf directly?

The Marp **PDF renderer** applies a stricter XSS sanitiser than the HTML
renderer. Some `style="..."` attributes are silently dropped, which makes
the direct `.md -> .pdf` path lose inline styles. Printing the HTML with
Chromium keeps the PDF faithful to the browser preview. Requires
Chromium/Chrome installed locally (or a Docker image with Chromium).

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

## Image sizing & slide-local overrides

Theme image caps use **`cqh`** (1% of the container's **content-box** height).
Marpit sets `container-type: size` on every section, and container units
resolve against the content box — 720px slide minus section padding
(40px top + 40px bottom) = **640px base**. So `50cqh` = 320px, `80cqh` = 512px.
**Never use `vh`** — it resolves against the browser *viewport*, so images
silently resize with the window / fullscreen.

- `section img` → `max-height: 80cqh` (global cap, = 512px)
- `section .columns img` → `max-height: 50cqh` (2-col images)
- Mermaid: `70cqh` default, `50cqh` `.mermaid-narrow`, `65cqh` `.mermaid-wide`

Per-image / per-slide overrides, strongest last:

1. **Marp size keywords** in alt text — `![w:600](img.png)`, `![h:280](img.png)`,
   `![w:600 h:280](img.png)` — compile to inline `style="width:600px"` on the
   `<img>` (one dimension set ⇒ aspect ratio preserved). They **cannot exceed**
   theme `max-*` caps: CSS `max-height`/`max-width` still clamp inline
   `height`/`width`.
2. **Inline HTML** `<img src="..." style="...">` — full per-element control
   (including `max-height: none`).
3. **`<style scoped>`** anywhere in a slide — CSS scoped to that slide only.
   Marpit gives the section a `data-marpit-scope-<key>` attribute and prefixes
   every selector with it; scoped styles are emitted **after** the theme CSS,
   so they win the cascade. Match the theme selector and keep enough
   specificity:

   ```markdown
   <style scoped>
   section .columns img {
     max-height: 62cqh;
   }
   </style>
   ```

Rule of thumb: keep the theme conservative, tune one slide with
`<style scoped>`, one image with `![h:...]`. A size keyword **cannot exceed**
the theme `max-*` cap — if a slide genuinely needs more, raise the cap in the
theme (verified against the other slides first), never override per-slide with
raw `<img>` tags. Prefer the markdown annotation so decks stay readable.

## Slide HTML hygiene

- Keep `<div>` open/close balanced **per slide** (unbalanced divs can leak
  layout into the next slide). One-liner check:
  `python3 -c "import re;s=open('deck.md').read();[print(i+1,len(re.findall(r'<div\b',x)),len(re.findall(r'</div>',x))) for i,x in enumerate(re.split(r'^---+\s*\$',s,flags=re.M)[2:]) if len(re.findall(r'<div\b',x))!=len(re.findall(r'</div>',x))]"`
- Bare `&` in prose is fine (HTML5); existing slides mix `&`/`&amp;` — no need
  to normalize.
- Use `<style scoped>`, never a bare `<style>` inside a slide (a bare style
  block would apply deck-wide).

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
(inline styles preserved). For agent-side visual verification, screenshot
the Nth slide headlessly (playwright-core is in the repo root
`node_modules/`, browsers in `~/.cache/ms-playwright`):

```javascript
const { chromium } = require('<repo-root>/node_modules/playwright-core');
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  await page.goto('file://<abs-path>/deck.html');
  await page.waitForTimeout(1500);
  for (let i = 1; i < N; i++) { await page.keyboard.press('ArrowRight'); await page.waitForTimeout(120); }
  await page.waitForTimeout(800);
  await page.screenshot({ path: '/tmp/slideN.png' });
  await browser.close();
})();
```

Note: `require()` resolves from the **script's** directory — pass an
absolute path to `node_modules/playwright-core` if the script lives in `/tmp`.

To find **all overflowing slides at once** (content taller than the 720px
slide), measure every section's `scrollHeight` instead of eyeballing:

```javascript
const res = await page.evaluate(() =>
  Array.from(document.querySelectorAll('div#\\:\\$p > svg > foreignObject > section'))
    .map((s, i) => ({ n: i + 1, h: s.scrollHeight }))
    .filter(r => r.h > 722)
);
console.log(res); // n = slide number, h = content height
```

Fix pattern: a `<style scoped>` block compressing that slide's margins
(`h3`/`ul`/`.ops-benefit`/`svg[data-marp-mermaid]` margins) — never global
theme changes.
Then:

```bash
npx @marp-team/marp-cli deck.md \
  --theme-set themes/genie-ai.css --engine @marp-team/marp-core/full \
  --pdf --allow-local-files --no-stdin -o deck.pdf
```

If the PDF looks subtly different from the browser preview, it's the
sanitiser - re-check your `style="..."` attributes for known-safe
properties (`display`, `text-align`, `margin`, `color`, `font-size`,
`background`, `border`, `border-radius`, `padding`, `width`, `max-width`).
