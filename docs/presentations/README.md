# GENIE.AI Release Presentations

MARP-based slide decks for release overviews.

## Generate

```bash
npx @marp-team/marp-cli v2.0.0-release.md --html --allow-local-files --no-stdin -o output/v2.0.0-release.html
npx @marp-team/marp-cli v2.0.0-release.md --pdf --allow-local-files --no-stdin -o output/v2.0.0-release.pdf
```

## Embed images (self-contained HTML)

```bash
python3 << 'PYEOF'
import base64, re
from pathlib import Path
html = Path('output/v2.0.0-release.html')
content = html.read_text()
for ref, img in [('genie-ai-logo-24.png', 'genie-ai-logo-24.png'), ('hero-visual.jpg', 'hero-visual.jpg')]:
    data = base64.b64encode(Path(img).read_bytes()).decode()
    content = content.replace(ref, f'data:image/{img.split(".")[-1]};base64,{data}')
html.write_text(content)
PYEOF
```

## Publish

```bash
slidesfly publish output/v2.0.0-release.html --title "GENIE.AI v2.0.0 — What's New"
```

Install slidesfly: `curl -fsSL https://slidesfly.com/install.sh | sh`

HTML is interactive (animations, links). PDF is for distribution.

Requires Node.js 18+ and a browser (Chrome/Chromium) for PDF output.
