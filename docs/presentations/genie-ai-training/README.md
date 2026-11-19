# GENIE.AI training presentation

This 43-slide English briefing uses Reveal.js for presentation controls and
Mermaid for diagrams. The standalone HTML embeds the presentation code, fonts,
artwork, logos and rendered diagrams.

## Sources

| Path | Edit here to change |
| --- | --- |
| `src/training-en.txt` | Slide order, titles, copy, chapter timings and speaker notes |
| `src/training-en.css` | Slide design, chapter openings and animation styles |
| `src/training-motion.css` | Entry, attention and idle animations |
| `src/training-en.js` | Navigation, focus during animations, fullscreen and speaker notes |
| `src/build_training_en.py` | How content and assets are assembled into one HTML file |
| `src/diagrams/*.mmd` | Mermaid diagrams |
| `src/training-mermaid.json` | Diagram placement, accessible descriptions and animated routes |
| `src/render-training-mermaid.cjs` | SVG rendering and animated diagram paths |
| `src/assets/` | Artwork, images, logos, flags and fonts |
| `tests/verify-deck.cjs` | Browser checks for slide order, diagrams, logos and playback |

The text source uses `# Chapter|Timing` and `@layout|Slide title`. The prefixes
`?`, `=`, `!` and `~` mark an eyebrow, a takeaway, speaker notes and reference
keys. Body rows take the form `Heading|Text`. Diagram numbers identify content
slides in source order. Chapter openers are inserted during the build. On the
ingestion slide, the upload description is followed by the file extensions.
The example uses three fields for the start of chunk 1, the shared text and the
end of chunk 2.

## Presenting

The entrance plays when moving forward. Arrows advance any guided stages, and
returning to an earlier slide brings back its settled view. Selected diagrams
and illustrations keep a small amount of motion at rest. Choose **Pause
motion** or press **M** to stop animations and continue presenting. The deck
also respects the system's reduced-motion preference and `?reduced=1`.

Mermaid classes such as `step0` assign guided stages. Entry motion follows
those stages unless a node has an explicit `beat` class such as `beat2`.
The diagram metadata's `idleEdges` list orders the edges for the resting loop.

## Build

Run these commands from this directory with Node.js, npm and Python 3.10 or later.

```bash
npm ci
npm run build
```

The generator writes
`site/static/presentations/genie-ai/index.html` at repository root.
It uses the checked-in SVGs for a text, style or script edit.

After editing the Mermaid sources, regenerate the SVGs and rebuild the HTML.

```bash
npx playwright install chromium
npm run build:diagrams
npm run build
npm run check
```

Set `GENIE_TRAINING_CHROMIUM` to an executable path if you use a system
Chromium. For example, set it to `/usr/bin/chromium` on Linux.

## Hugo and merge requests

Hugo copies the generated HTML from `site/static/` into the published site.
The page at `site/content/en/docs/get-started/training.md` links to the deck
using the repository's root-based `baseURL`.

Include the edited sources, updated SVGs when applicable, and rebuilt HTML in
the same merge request. Preview with the workflow in the
[documentation site README](../../../site/README.md), then open
`http://127.0.0.1:1313/presentations/genie-ai/`. Python, Node.js and Mermaid
are used to rebuild the presentation. The published HTML loads its runtime and
visual assets from the file itself.

## Visual assets

The background artwork and ITU mark come from the supplied OpenTech Connect
presentation. Country photos are attributed on the slides. Technology marks
come from Simple Icons, CNCF Artwork or the individual project repositories.
The flag artwork is from Flagcdn. The embedded Reveal.js and Carlito licences
are included in the generated HTML. Carlito's licence is also available in
`src/assets/carlito-LICENSE`.
