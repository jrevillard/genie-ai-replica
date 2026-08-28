# GENIE.AI Presentations

Marp-based slide decks for release overviews, architecture deep-dives, and
sovereign-AI briefings. All decks share the **`genie-ai` theme** defined in
[`themes/genie-ai.css`](themes/genie-ai.css) — palette, typography, layout
helpers, and Mermaid styling.

## Decks in this directory

| File | Purpose | Has Mermaid |
|------|---------|:-----------:|
| `v2.0.0-release.md` | v2.0.0 release overview | ❌ |
| `genie-ai-sovereign-architecture.md` | Sovereign AI architecture & fundamentals briefing (~30 slides) | ✅ |

Render output is written **next to the source `.md`** (e.g. `v2.0.0-release.pdf`,
`genie-ai-sovereign-architecture.html`) so that all internal links and
asset references resolve correctly. The PDF is generated **from the
HTML** (not directly from markdown) because the Marp PDF renderer
applies a stricter XSS sanitiser that strips some `style="..."`
attributes. Going through HTML gives a faithful PDF that matches the
browser preview. Build artifacts are gitignored.

## Build a deck

The build runs **two steps** from this directory (`docs/presentations/`):

```bash
# 1. Generate HTML next to the source .md (links resolve)
npx @marp-team/marp-cli <deck>.md \
  --theme-set themes/genie-ai.css \
  --engine @marp-team/marp-core/full \
  --html --allow-local-files --no-stdin \
  -o <deck>.html

# 2. Generate PDF from the HTML (Chromium print-to-PDF)
chromium \
  --headless \
  --disable-gpu \
  --print-to-pdf=<deck>.pdf \
  "file://$(pwd)/<deck>.html"
```

The first command generates HTML from the `.md`; the second prints
that HTML to PDF via headless Chromium. This two-step process avoids
the Marp PDF renderer - its XSS sanitiser strips some `style="..."`
attributes, so the direct `.md -> .pdf` path loses inline styles.
Going through HTML keeps the PDF faithful to the browser preview.
Outputting to a separate `output/` dir would break every internal asset
reference - keep both files next to the source. Requires
Chromium/Chrome installed locally (or a Docker image with Chromium).

**Flags explained:**

- `--theme-set themes/genie-ai.css` — load the shared GENIE.AI theme.
  Each deck declares `theme: genie-ai` in its frontmatter, which Marp
  resolves against this set.
- `--engine @marp-team/marp-core/full` — use the v5 "full" build that
  ships with the Mermaid plugin. **Required** for any deck containing
  ```mermaid fences. For prose-only decks you can drop this flag.
- `--allow-local-files` — let the renderer read local image references
  (logo, hero band, etc.).
- `--no-stdin` — required for non-interactive rendering.

## Embed images (self-contained HTML)

The deck markdown references images via relative paths
(`assets/genie-*.png`). The generated HTML keeps those relative
references — which means **the HTML needs the assets alongside it to
render**. For sharing a single self-contained HTML file (e.g. by email),
post-process the output to inline the PNG/JPG assets as `data:` URIs:

```bash
python3 << 'PYEOF'
import base64
import mimetypes
import re
from pathlib import Path
from urllib.parse import unquote

html_path = Path("<deck>.html")

# Répertoire racine où rechercher les images
image_root = Path(".")

content = html_path.read_text(encoding="utf-8")

# Index des images PNG trouvées récursivement
images = {}

for image_path in image_root.rglob("*.png"):
    if image_path.resolve() == html_path.resolve():
        continue

    data = base64.b64encode(image_path.read_bytes()).decode("ascii")
    data_uri = f"data:image/png;base64,{data}"

    # Différentes références possibles dans le HTML
    relative_path = image_path.as_posix()
    filename = image_path.name

    images[filename] = data_uri
    images[relative_path] = data_uri
    images[f"./{relative_path}"] = data_uri

print(f"{len(images)} références d'images indexées")

# Remplace les références connues, en commençant par les chemins les plus longs
for reference, data_uri in sorted(images.items(), key=lambda item: len(item[0]), reverse=True):
    content = content.replace(reference, data_uri)
    content = content.replace(unquote(reference), data_uri)

html_path.write_text(content, encoding="utf-8")

print(f"HTML mis à jour : {html_path}")
PYEOF
```

## Authoring a new deck

1. Copy an existing deck as a starting point:
   ```bash
   cp genie-ai-sovereign-architecture.md <new-deck>.md
   ```
2. Update the frontmatter:
   ```markdown
   ---
   marp: true
   theme: genie-ai
   paginate: true
   size: 16:9
   footer: '![h:18](genie-ai-logo-24.png) GENIE.AI'
   ---
   ```
3. Use the layout helpers defined in the theme (`.eyebrow`, `.columns`,
   `.ops-benefit`, `.agenda-item`, `.metric`, `.brand-pill`, `.hero-band`)
   for visual consistency with other GENIE.AI decks.
4. For title/closing slides, apply `<!-- _class: title -->` or
   `<!-- _class: closing -->` to get the centred gradient layout.
5. For diagrams, add Mermaid blocks with `:::role` markers and paste the
   matching `classDef` lines (see theme §9 for the full vocabulary).

## Publish

```bash
slidesfly publish output/<deck>.html --title "GENIE.AI — <deck title>"
```

Install slidesfly: `curl -fsSL https://slidesfly.com/install.sh | sh`.

HTML is interactive (animations, links). PDF is for distribution.

Requires Node.js 18+ and a browser (Chrome/Chromium) for PDF output.

---

## Marp v5 notes

The repo currently runs `marp-core@5.0.1` with `marp-cli@4.5.0`. There is
**no stable marp-cli v5 yet** (latest stable marp-cli = 4.5.0). The mismatch
means we drive marp-core v5 through marp-cli v4, which is the supported path
for Mermaid until marp-cli v5 ships.

### Known bug: `Ke is not a function`

`marp-core@5.0.1` has a packaging bug where `lib/marp-CdKqL-3e.mjs` tries to
import `friendlyAttrValue` from `xss`, but xss v1 only exports `FilterXSS`.
Any slide containing an HTML element with a standard attribute
(`class`, `src`, `href`, `alt`, `title`, …) crashes with
`TypeError: Ke is not a function`. Attributes `id` and `data-*` are unaffected.

**Local patch** (re-apply after every `npm install` until marp-core 5.0.2+):

```bash
# Replace `safeAttrValue:(t,n,r)=>Ke(t,n,r)` with a self-contained validator.
# Both occurrences (html_inline + html_block rules).
python3 - <<'PYEOF'
from pathlib import Path
p = Path('node_modules/@marp-team/marp-core/lib/marp-CdKqL-3e.mjs')
c = p.read_text()
old = 'safeAttrValue:(t,n,r)=>Ke(t,n,r)'
new = ('safeAttrValue:(t,n,r,i)=>{'
       'if(n==="href"||n==="src"){'
       'if(!/^(https?:|mailto:|#|\\/)/i.test(r))return void 0}'
       'return r}')
p.write_text(c.replace(old, new))
print('Inline+Block patches applied:', c.count(old))
PYEOF
```

If the patch prints `0`, your marp-core is newer than 5.0.1 — the bug is
already fixed upstream and you don't need the patch.

### Rendering with Mermaid

` ```mermaid ` code fences are processed by the
`@marp-team/marp-core/plugins/mermaid` plugin (powered by `beautiful-mermaid`).
Plugins are **only** loaded by the `/full` entrypoint — that's why `--engine
@marp-team/marp-core/full` is mandatory. Lightweight engine builds ignore
Mermaid fences and render them as plain code blocks.

### Adding Mermaid to a new slide

1. Use a fenced code block with the `mermaid` info string:
   ````markdown
   ```mermaid
   flowchart LR
     A[User] --> B[Frontend]
     B --> C[Backend]
   ```
   ````
2. Optionally annotate nodes with roles (paste the matching `classDef` lines
   from the theme's §9 — `client`, `gateway`, `core`, `data`, `ai`, `orch`,
   `risk`, `ok`):
   ````markdown
   ```mermaid
   flowchart LR
     A[User]:::client --> B[Kong]:::gateway --> C[Backend]:::core
     C --> D[ArangoDB]:::data
     C --> E[LLM]:::ai

   classDef client fill:#ffffff,stroke:#94a3b8,stroke-width:1px,color:#475569;
   classDef gateway fill:#ffffff,stroke:#1b3fad,stroke-width:2px,color:#1b3fad;
   classDef core fill:#ffffff,stroke:#34373d,stroke-width:1px,color:#34373d;
   classDef data fill:#eef3ff,stroke:#1b3fad,stroke-width:1.5px,color:#122f87;
   classDef ai fill:#f0fdf6,stroke:#2b855b,stroke-width:1.5px,color:#1f5e3f;
   ```
   ````
3. Re-render with the `--engine @marp-team/marp-core/full` flag.

## Theme reference

See [`themes/genie-ai.css`](themes/genie-ai.css) for the full theme source.
Section map:

1. Fonts (Inter + JetBrains Mono)
2. Design tokens (GENIE.AI palette, Mermaid vars, Shiki vars)
3. Headings (h1/h2/h3 with gradient underline on h2)
4. Code & tables
5. Layout helpers (`.columns`, `.eyebrow`, `.metric`, `.ops-benefit`, `.agenda-item`)
6. Title & closing layouts (`section.title`, `section.closing`, `.brand-pill`, `.hero-band`)
7. Footer
8. Mermaid diagrams (CSS sizing + bold-label styling)
9. Standard Mermaid `classDef` block (copy/paste reference)
