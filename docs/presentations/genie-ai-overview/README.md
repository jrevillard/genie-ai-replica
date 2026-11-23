# GENIE.AI walkthrough

This briefing uses Reveal.js for presentation controls and Mermaid for
diagrams. The standalone HTML embeds the presentation code, fonts, artwork,
logos and rendered diagrams.

It comes in two lengths, built from the same sources:

| Variant | Slides | Length | Published at |
| --- | --- | --- | --- |
| full | 43 | 60 minutes | `/presentations/genie-ai/index.html` |
| light | 27 | 30 minutes | `/presentations/genie-ai-30/index.html` |

The short deck leaves out the OKF tooling, the web and mobile screens, the
retrieval, reranking and generation detail, the observability and
troubleshooting slides, the testing-lab slide, the GPU API and sizing
slides, and the deployment matrix. Each slide names the variants that show
it.

It speaks six United Nations languages — English, French, Spanish, Russian,
Arabic and Chinese — from one file. The reader picks a language in the
top-right corner; the choice is remembered on the next visit.

The speaker view is Reveal's own: the current slide, the next one, the notes
and the clock. Open it with **Speaker notes** or the **S** key.

## Sources

| Path | Edit here to change |
| --- | --- |
| `src/slides/en.txt` | Slide order, titles, copy, chapter timings, speaker notes and the variants that show each slide |
| `src/slides/<lang>.txt` | The same slides in another language |
| `src/variants.json` | The chapter timings of each length of the deck |
| `src/i18n/en.json` | Interface strings — buttons, link names, chapter openers |
| `src/i18n/<lang>.json` | The same interface strings in another language |
| `src/GLOSSARY.md` | The terms every language uses, and how to translate them |
| `src/languages.json` | The languages the deck offers, and their reading direction |
| `src/deck.css` | Slide design, chapter openings and animation styles |
| `src/deck-motion.css` | Entry, attention and idle animations |
| `src/deck.js` | Navigation, language switching, focus during animations, fullscreen and speaker notes |
| `src/build_deck.py` | How content and assets are assembled into one HTML file |
| `src/check_language.py` | Checks one language against the English reference |
| `src/fetch_fonts.py` | Cuts the Arabic and Chinese faces down to the characters the deck prints |
| `src/diagrams/*.mmd` | Mermaid diagrams |
| `src/diagrams.json` | Diagram placement, accessible descriptions and animated routes |
| `src/render-diagrams.cjs` | SVG rendering and animated diagram paths |
| `src/assets/` | Artwork, images, logos, flags and fonts |
| `tests/verify-deck.cjs` | Browser checks for slide order, diagrams, logos, playback and every language |

The text source uses `# Chapter|Timing` and `@layout|Slide title`. The prefixes
`?`, `=`, `!` and `~` mark an eyebrow, a takeaway, speaker notes and reference
keys. Body rows take the form `Heading|Text`. Diagram numbers identify content
slides in source order. Chapter openers are inserted during the build. On the
ingestion slide, the upload description is followed by the file extensions.
The example uses three fields for the start of chunk 1, the shared text and the
end of chunk 2.

## How the languages work

The deck has one set of slides. Each piece of text in them is a **slot**, and
every language holds the same slots. Switching a language rewrites the text of
the slots already on the page — the layout never moves, so the design does not
have to be redrawn per language.

Two rules keep the six versions honest:

- **The build is the gate.** A language whose slide file does not reproduce
  the English structure exactly — same slides, same layouts, same fields — is
  refused. A language missing a string is refused too. The deck never ships
  an English sentence in the middle of a translated slide.
- **The layout adapts.** A translated title is measured, not counted: a
  Cyrillic or Arabic title is wider than a Latin one of the same length. The
  title takes the largest size at which it still fits, and the blocks of a
  slide shrink a step at a time when a translation needs more room than the
  English text left.

### Translating a language

1. Read `src/GLOSSARY.md`.
2. Copy `src/slides/en.txt` to `src/slides/<lang>.txt` and translate it, keeping
   every line, every prefix and every `|`-separated field. The `~` lines hold
   reference keys, not prose: copy them unchanged. The `|+<variant>` field at
   the end of an `@` line is machine data too: copy it unchanged.
3. Copy `src/i18n/en.json` to `src/i18n/<lang>.json` and translate the values.
   The keys stay byte-identical.
4. Check it:

   ```bash
   python3 src/check_language.py <lang>
   ```

   It must print `<lang>: structure and strings match English`.

5. Regenerate the fonts, rebuild and check the browser:

   ```bash
   python3 src/fetch_fonts.py --force --code <lang>
   npm run build
   npm run check
   ```

   The build refuses a face that was cut for an older text, so a skipped
   step fails the build instead of leaving squares.

### The fonts

Carlito carries the Latin and Cyrillic text. The Arabic and Chinese faces are
cut down to the characters their translation actually prints, with fontTools,
from the complete face Google Fonts serves. Asking Google for a subset over
the network does not work — the request carries every character of the
translation, the URL grows past what the service accepts, and it answers with
the whole face.

`src/fetch_fonts.py` needs fontTools and brotli:

```bash
uv venv .venv && uv pip install --python .venv/bin/python fonttools brotli
PATH=.venv/bin:$PATH python3 src/fetch_fonts.py
```

The generated files live under `src/assets/fonts/` and are committed: the
build reads them and never reaches the network. Each face travels with the
list of the characters it was cut for, and the build refuses a face whose
list no longer covers what the translation prints.

### Arabic and the reading direction

The deck sets `dir="rtl"` on the document for Arabic, and the layout mirrors
itself: the styles use logical properties (`inset-inline-start`,
`border-inline-start`, `text-align: start`), so the logo, the columns and the
progress bar move to the other side without a second stylesheet.

Mixed text is the part that needs care. A Latin name inside an Arabic sentence
— `GENIE.AI`, `ArangoDB`, `BM25` — becomes a bidi island, so the browser does
not place the punctuation around it on the wrong side. The runtime marks those
runs left-to-right and isolates them. The slide number and the source links
are Latin in every language, so they are isolated as a whole: without that,
`28 / 43` would read as `43 / 28`.

The Mermaid diagrams stay in English in every language. Their labels are part
of the drawing; the description that names the diagram for a screen reader is
a slot, and it is translated.

### The language and the URL

The language is a parameter of the URL — `?lang=ar`. A link therefore carries
it, and the speaker view, which loads the deck again in a frame, reads the
same one. Choosing a language reloads the deck with the new parameter, and the
speaker view is reopened so its frame shows the new language too.


## Presenting

The entrance plays when moving forward. Arrows advance any guided stages, and
returning to an earlier slide brings back its settled view. Selected diagrams
and illustrations keep a small amount of motion at rest. Choose **Pause
motion** or press **M** to stop animations and continue presenting. The deck
also respects the system's reduced-motion preference and `?reduced=1`.

Mermaid classes such as `step0` assign guided stages. Entry motion follows
those stages unless a node has an explicit `beat` class such as `beat2`.
The diagram metadata's `idleEdges` list orders the edges for the resting loop.

The speaker-notes window follows the language and the reading direction of the
slide it shows. It is Reveal's own speaker view: the current slide, the next
one, the notes and a clock. The deck's own controls stay out of it.

## The two lengths

The two decks are one source read twice. A slide names the variants that
show it on its own line:

```
@cover|Whose knowledge shapes an AI answer?|+light
```

A slide whose title is not followed by `|+<variant>` is in the full deck
only; the `+` keeps a pipe in a title prose. The
field is machine data, so every language carries the same one — the build
refuses a file that drifted.

A slide keeps the number it holds in the slide file, whatever the length,
so the short deck does not renumber what it keeps: the brand marks, the
Mermaid diagrams, the translation slots and the source links all keep their
keys. Inserting a slide does not change what the other length shows.

`src/variants.json` holds the chapter timings of each length, so the two
decks do not carry the same clock:

```json
{
  "light": {
    "timings": {"1": "00:00–04:00"}
  }
}
```

A slide the short deck leaves out may still be referenced by a slide it
keeps. The short deck names the format once, as the second way knowledge
enters the assistant, and never presents the tooling: the slides it keeps
speak of knowledge repositories, not of a studio.

## Build

Run these commands from this directory with Node.js, npm and Python 3.10 or later.

```bash
npm ci
npm run build
```

The generator writes both decks at repository root:
`site/static/presentations/genie-ai/index.html` and
`site/static/presentations/genie-ai-30/index.html`.
It uses the checked-in SVGs for a text, style or script edit.

To build one of them, name it:

```bash
python3 src/build_deck.py --variant=light
```

After editing the Mermaid sources, regenerate the SVGs and rebuild the HTML.

```bash
npx playwright install chromium
npm run build:diagrams
npm run build
npm run check
```

`npm run check` runs the browser checks against both decks.

Set `GENIE_OVERVIEW_CHROMIUM` to an executable path if you use a system
Chromium. For example, set it to `/usr/bin/chromium` on Linux.

## Hugo and merge requests

Hugo copies the generated HTML from `site/static/` into the published site.
The page at `site/content/en/docs/get-started/presentation.md` links to the deck
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
The flag artwork is from Flagcdn. The embedded Reveal.js, Carlito, Noto Sans
Arabic and Noto Sans SC licences are included in the generated HTML. Carlito's
licence is also available in `src/assets/carlito-LICENSE`.
