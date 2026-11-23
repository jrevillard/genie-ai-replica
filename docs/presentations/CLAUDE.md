# Presentations - Agent Context

## New presentations

Use Reveal.js and Mermaid for new presentations. Follow the
[presentation README](README.md) and use the
[GENIE.AI walkthrough](genie-ai-overview/README.md) as a working reference.

Keep editable sources under `docs/presentations/`. Rebuild the HTML after
editing the source, and regenerate the SVGs first if Mermaid diagrams
changed. Run the deck's browser checks. For a deck published through Hugo,
check that the build copies the generated HTML and that the documentation
page links to it. The site workflow (Hugo build, publish, presentations
section) lives in `docs/site-local-dev.md`.

## The multilingual walkthrough

`docs/presentations/genie-ai-overview/` carries six United Nations languages
in one HTML file: English, French, Spanish, Russian, Arabic and Chinese.

- **Text lives in slots.** `src/slides/<lang>.txt` holds the prose,
  `src/i18n/<lang>.json` holds the interface strings. The build renders one
  set of slides and the runtime swaps the text.
- **The build is the gate.** A language whose structure drifts from English,
  or that is missing a string, fails the build. Do not work around it by
  loosening the check — fix the translation.
- **Check a language alone** with `python3 src/check_language.py <lang>`
  before rebuilding. It is much faster than a full build.
- **Read `src/GLOSSARY.md`** before translating or reviewing a translation.
  Product names stay in Latin script in every language, including Arabic.
- **Regenerate the fonts** after a translation changes:
  `PATH=.venv/bin:$PATH python3 src/fetch_fonts.py --code <lang>`. The
  Arabic and Chinese faces are cut down to the characters the deck prints; a
  face that fell behind fails the build, which names the characters it lacks.
- **The layout adapts at runtime.** Titles are measured, not counted, and the
  blocks of a slide shrink when a translation needs more room. Do not "fix" a
  long translation by shortening it — the deck handles the length.
- **The browser check covers every language.** It switches each one and
  checks that nothing overflows the slide. A change to the CSS or the
  runtime can break one language without touching the others.

## The two lengths of the walkthrough

The walkthrough is built in two lengths from one set of sources: the full
60 minute deck and a 30 minute one. A slide names the variants that show it
— `@layout|Title|+light` is in both — so a slide keeps its place in the file
whichever length is built.

- **Do not delete slides from the slide files to change the short deck.**
  Remove the `|+light` mark instead. The field is machine data, so every
  language must carry the same one; the build refuses a file that drifted.
- **A slide keeps its number in both decks.** The short deck does not
  renumber what it keeps, so the brand marks, the Mermaid diagrams, the
  translation slots and the source links keep their keys.
- **A slide the short deck drops may still be named by one it keeps.** The
  short deck names the format once, as the second way knowledge enters the
  assistant, and never presents the tooling. Keep it that way in every
  language.
- **`npm run build` writes both decks** and `npm run check` checks both.

## Existing Marp decks

Use the following tooling notes when editing an existing Marp deck.

### Build process

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

### Why not just Marp --pdf directly?

The Marp **PDF renderer** applies a stricter XSS sanitiser than the HTML
renderer. Some `style="..."` attributes are silently dropped, which makes
the direct `.md -> .pdf` path lose inline styles. Printing the HTML with
Chromium keeps the PDF faithful to the browser preview. Requires
Chromium/Chrome installed locally (or a Docker image with Chromium).

### Local patch: `Ke is not a function`

`marp-core@5.0.1` has a packaging bug that strips `style`/`class`/`href`
attributes. A local patch in `node_modules/@marp-team/marp-core/lib/marp-CdKqL-3e.mjs`
restores them. **Re-apply after every `npm install`** until marp-core 5.0.2+
is available. The patch is documented in `README.md` section "Marp v5 notes".

### Path: post-process HTML for self-contained sharing

To share a single self-contained HTML (e.g. via email), inline the
PNG/JPG assets as `data:` URIs — copy-paste the script from the
"Embed images (self-contained HTML)" section of `README.md`. It indexes
every PNG under the directory and rewrites relative references; it is
meant to be run ad hoc, not committed as a build step.

### Layout class vocabulary (theme `genie-ai.css`)

Reusable layout helpers - copy/paste from the theme:

- `.columns` - 2-col or 1fr/1.5fr/1.5fr grid for `Compare` table
- `.metric`, `.metric-row` - value cards with bordered cards
- `.eyebrow` - small uppercase label above a title
- `.ops-benefit` - "Takeaway" callout at the bottom of a slide
- `.agenda-item` - numbered agenda row
- `.brand-pill`, `.hero-band` - title-slide elements
- `.pillbar`, `.pillbtn` - used on cover/closing
- `section.title`, `section.closing` - cover and thank-you layouts
- `section.section-divider` - big numeric + section title divider
- `.card`, `.card-num`, `.card-name` - visual cards for capability lists
- `.pillar-row`, `.pillar` - used for "5 brand pillars" card layout
- `.compare`, `.head`, `.label`, `.ba`, `.genie` - comparison grid
- `section.demo` - vibrant gradient with centered layout for "Live Demo"
  inter-slide (custom class)

### Image sizing & slide-local overrides

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

### Slide HTML hygiene

- Keep `<div>` open/close balanced **per slide** (unbalanced divs can leak
  layout into the next slide). One-liner check:
  `python3 -c "import re;s=open('deck.md').read();[print(i+1,len(re.findall(r'<div\b',x)),len(re.findall(r'</div>',x))) for i,x in enumerate(re.split(r'^---+\s*\$',s,flags=re.M)[2:]) if len(re.findall(r'<div\b',x))!=len(re.findall(r'</div>',x))]"`
- Bare `&` in prose is fine (HTML5); existing slides mix `&`/`&amp;` — no need
  to normalize.
- Use `<style scoped>`, never a bare `<style>` inside a slide (a bare style
  block would apply deck-wide).

### Custom spot directives (slide-level)

- `<!-- _class: title -->` - cover layout (centred, gradient bg, brand pill)
- `<!-- _class: closing -->` - thank-you layout (centred, gradient bg)
- `<!-- _class: demo -->` - demo break layout (vibrant gradient, centered)
- `<!-- _class: section-divider -->` - big numeric + section title
- `<!-- _class: title -->` + `<!-- _paginate: false -->` - disable footer
  on a specific slide

### Output check

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
