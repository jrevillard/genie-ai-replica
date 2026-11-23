"""Build the standalone GENIE.AI walkthrough deck.

The deck is multilingual: one HTML file carries every language, and the
reader switches between them at runtime. Two source trees feed it:

  slides/<lang>.txt   the slide prose, one file per language. Every file
                       must reproduce the English structure exactly (same
                       slides, same layouts, same fields) — the build
                       rejects a file that drifted.
  i18n/<lang>.json     the interface strings — button labels, link names,
                       chapter titles — one file per language.

The build is the completeness gate. A language that is missing a string
fails the build, rather than leaving an English sentence in the middle of
a translated slide.

The deck also comes in two lengths. A slide names the variants that show
it on its own line (`@layout|Title|+light`), so a slide keeps its place
in the file whichever length is built.

Usage: python3 src/build_deck.py [--variant full|light|all] [--output PATH]
"""

from argparse import ArgumentParser
from base64 import b64encode
from dataclasses import dataclass, field
from html import escape
from json import dumps, loads
from pathlib import Path
from re import findall, sub

WORK = Path(__file__).parent
ASSETS = WORK / 'assets'
REVEAL = WORK.parent / 'node_modules' / 'reveal.js'
SLIDES = WORK / 'slides'
I18N = WORK / 'i18n'
# Every variant has a published path of its own, so the two decks live
# side by side.
DEFAULT_OUTPUT = {
    'full': WORK.parents[3] / 'site/static/presentations/genie-ai/index.html',
    'light': WORK.parents[3] / 'site/static/presentations/genie-ai-30/index.html',
}
DOC = 'https://genie-ai-7e342b.opensource.unicc.org'
REPO = 'https://opensource.unicc.org/un/itu/genie-ai'

LOCALES = loads((WORK / 'languages.json').read_text(encoding='utf-8'))
CODES = [locale['code'] for locale in LOCALES]
# The variants of the deck, by name. A slide names the variants that show
# it; a variant declares the chapter timings it runs with. The slide files
# are the same for every variant.
VARIANTS = loads((WORK / 'variants.json').read_text(encoding='utf-8'))
DIRECTION = {locale['code']: locale['dir'] for locale in LOCALES}
# The slide title shrinks as it grows: a title that runs past a length
# takes the next smaller size, so the content below it keeps its place.
# The steps are in characters of the translated title, which is what the
# runtime measures.
COMPACT_TITLE = 56
TIGHT_TITLE = 64
SQUEEZE_TITLE = 72
# The takeaway sits above the footer. A translation that runs long takes
# the smaller size, so it stays on the lines the slide was drawn for.
COMPACT_TAKEAWAY = 96

# The source links a slide can cite, and where each one points.
SOURCES = {
    'itu': 'https://www.itu.int/itu-d/sites/genieai/',
    'ituFramework': 'https://www.itu.int/en/ITU-D/ICT-Applications/Pages/Initiatives/ITU_OSPO/Open-Source_AI_for_Public_Services/GENIE-AI_framework.aspx',
    'project': DOC + '/',
    'welcome': DOC + '/docs/get-started/welcome/',
    'mobile': DOC + '/docs/mobile/chat-pipeline/',
    'api': DOC + '/docs/reference/api-contracts/',
    'architecture': DOC + '/docs/get-started/concepts/',
    'rag': DOC + '/docs/rag-pipeline/',
    'ingest': DOC + '/docs/knowledge-base/ingestion/',
    'uploadFormats': REPO + '/-/blob/main/components/document-repository/src/config/appConfig.js',
    'retrieval': DOC + '/docs/rag-pipeline/retrieval/',
    'multilingual': DOC + '/docs/architecture/multilingual-ssot/',
    'authz': DOC + '/docs/knowledge-base/access-control/',
    'okf': DOC + '/docs/knowledge-base/okf-studio/',
    'docsokf': DOC + '/docs/knowledge-base/documents-to-okf/',
    'admin': DOC + '/docs/frontend/admin-dashboard/',
    'lab': DOC + '/docs/knowledge-base/testing-lab/',
    'observe': DOC + '/docs/observe/',
    'models': DOC + '/docs/rag-pipeline/choosing-models/',
    'install': DOC + '/docs/deploy/install-guide/',
    'k8s': DOC + '/docs/deploy/kubernetes/',
    'vllm': 'https://docs.vllm.ai/en/latest/getting_started/installation/gpu/',
    'licence': REPO + '/-/blob/main/LICENSE',
    'web': DOC + '/docs/frontend/chat-ux/',
    'branding': DOC + '/docs/configure/branding-customization/',
    'locale': DOC + '/docs/configure/locale-whitelist/',
    'routes': DOC + '/docs/reference/routes/',
    'ingestPipeline': DOC + '/docs/rag-pipeline/ingestion/',
    'rerank': DOC + '/docs/rag-pipeline/reranking/',
    'generation': DOC + '/docs/rag-pipeline/generation/',
    'okfConfig': DOC + '/docs/knowledge-base/okf-variables/',
    'okfResolver': REPO + '/-/blob/main/components/okf-server/services/authz-resolver-service.js',
    'idp': DOC + '/docs/configure/external-idp-integration-guide/',
    'security': DOC + '/docs/architecture/trust-boundaries/',
    'observeOverview': DOC + '/docs/observe/overview/',
    'observeConfig': DOC + '/docs/observe/configuration/',
    'compose': DOC + '/docs/deploy/docker-compose-setup/#6e-remote-gpu-node-optional',
    'swarm': DOC + '/docs/deploy/docker-swarm-setup/#remote-gpu-node',
    'topologies': DOC + '/docs/deploy/topologies/',
    'gpu': DOC + '/docs/deploy/gpu/',
    'slim': DOC + '/docs/deploy/slim-images/',
    'tracing': DOC + '/docs/operate/tracing-howto/',
    'repo': REPO,
}
# Photo credits are attribution, not prose: they name the author and licence.
PHOTO_CREDITS = (
    ('El Salvador photo · randreu · CC BY 3.0', 'https://commons.wikimedia.org/wiki/File:El_Salvador_-_Corn_Farm_-_panoramio.jpg'),
    ('The Gambia photo · CC0', 'https://commons.wikimedia.org/wiki/File:Village_in_rural_Gambia.jpg'),
)

# Colour identifies the project mark, while role labels remain normal slide text.
MARKS = {
    'vue': ('Vue.js', '#157D57'), 'flutter': ('Flutter', '#1673BA'),
    'node': ('Node.js', '#367e2c'), 'keycloak': ('Keycloak', None),
    'docling': ('Docling', None), 'arango': ('ArangoDB', '#466C14'),
    'opea': ('OPEA', None), 'hf': ('Hugging Face TEI', '#956613'), 'vllm': ('vLLM', None),
    'otel': ('OpenTelemetry', None), 'victoria': ('VictoriaMetrics', '#632CA5'), 'grafana': ('Grafana', '#b74600'),
    'docker': ('Docker', '#176cb4'), 'kube': ('Kubernetes', '#326CE5'), 'helm': ('Helm', '#253575'),
    'nginx': ('NGINX', '#007A37'), 'kong': ('Kong', '#093f2f'), 'envoy': ('Envoy Gateway', None),
    'nvidia': ('NVIDIA', '#507400'), 'amd': ('AMD', '#9b261f'),
}
SLIDE_MARKS = {
    15: (('vue','flutter'), ('node','keycloak'), ('docling','arango'), ('opea','hf','vllm'), ('otel','victoria','grafana'), ('docker','kube','helm')),
    5: (('vue',), ('flutter',)),
    7: ((), (), ('docling',), ('vllm','nvidia','amd')),
    23: (('keycloak',), ()),
    26: ((), ('otel',), ('victoria',), ('grafana',)),
    29: (('docker',), ('docker',), ('kube','helm')),
    31: (('vllm','hf'), ('nvidia','amd'), ()),
}
DIAGRAMS = loads((WORK / 'diagrams.json').read_text(encoding='utf-8'))

# The text of every language, keyed by the slot it fills. Filled while the
# deck is rendered once per language; the runtime swaps the slots.
TRANSLATION = {code: {} for code in CODES}


def load_chrome(code):
    """Read one language's interface strings, or an empty set if absent.

    A language under translation has no file yet. The build reports it as
    incomplete rather than failing on a missing file, so a translator can
    work on one language while the others are still being written.
    """
    path = I18N / f'{code}.json'
    if not path.exists():
        return {}
    return loads(path.read_text(encoding='utf-8'))


CHROME = {code: load_chrome(code) for code in CODES}
ACTIVE = CODES[0]


@dataclass
class Slide:
    layout: str
    title: str
    chapter: str
    timing: str
    chapter_number: int
    items: list[list[str]] = field(default_factory=list)
    eyebrow: str = ''
    takeaway: str = ''
    notes: str = ''
    sources: list[str] = field(default_factory=list)
    # The variants that show this slide. Every slide is in the full deck;
    # a slide that names another variant is in that one as well.
    variants: set[str] = field(default_factory=set)
    # The documentation the resource menu lists. The build sets it on the
    # menu slide alone: the pages the deck cites, in the menu's order.
    menu: list[str] = field(default_factory=list)


def parse(code):
    """Read one language's slide file into its slides.

    A row is split on every pipe: the first field is the heading, the rest
    are the body cells. A row with no pipe is a body on its own, so it keeps
    an empty heading.

    The slide line may end with the variants that also show it, the
    field introduced by `+`: `@layout|Title|+light`. The field is machine
    data, so every language must carry the same one. Everything between
    the layout and that field is the title, so a title may carry a pipe.
    """
    slides = []
    chapter = timing = ''
    chapter_number = 0
    path = SLIDES / f'{code}.txt'
    if not path.exists():
        return slides
    for line in path.read_text(encoding='utf-8').splitlines():
        if not line:
            continue
        if line.startswith('# '):
            chapter, timing = line[2:].split('|', 1)
            chapter_number += 1
        elif line.startswith('@'):
            fields = line[1:].split('|')
            layout, title, variants = fields[0], '|'.join(fields[1:]), {'full'}
            if len(fields) > 2:
                last = fields[-1].strip()
                if last.startswith('+'):
                    title = '|'.join(fields[1:-1])
                    variants.update(name.strip() for name in last[1:].split(',') if name.strip())
                elif last in VARIANTS:
                    # The mark lost its `+`: without this it would be
                    # swallowed by the title, in silence.
                    raise SystemExit(
                        f'{code}.txt: slide "{title}": the variants field starts with +'
                    )
            unknown = variants - set(VARIANTS)
            if unknown:
                raise SystemExit(
                    f'{code}.txt: slide "{title}" names unknown variants: {sorted(unknown)}'
                )
            slides.append(Slide(layout, title, chapter, timing, chapter_number, variants=variants))
        elif line.startswith('? '):
            slides[-1].eyebrow = line[2:]
        elif line.startswith('= '):
            slides[-1].takeaway = line[2:]
        elif line.startswith('! '):
            slides[-1].notes = line[2:]
        elif line.startswith('~ '):
            slides[-1].sources = line[2:].split('|')
        else:
            fields = line.split('|')
            slides[-1].items.append(fields if len(fields) > 1 else ['', fields[0]])
    return slides


def structure(slides):
    """The shape of a slide file — what every language must reproduce."""
    return [
        (
            slide.layout, slide.chapter_number, len(slide.items),
            [len(item) for item in slide.items],
            bool(slide.eyebrow), bool(slide.takeaway), bool(slide.notes),
            tuple(slide.sources), tuple(sorted(slide.variants)),
        )
        for slide in slides
    ]


def first_drift(mine, theirs):
    """Name the first slide whose shape differs between two structures.

    The structures come from `structure`. A language file that drifted is
    diagnosed slide by slide, so the message names the line to look at
    rather than a count that matches.
    """
    for index, (candidate, english) in enumerate(zip(mine, theirs), 1):
        if candidate != english:
            return f'slide {index}: {candidate} does not match the English structure {english}'
    return f'the file has {len(mine)} slides against {len(theirs)} in English'


def e(value):
    return escape(value, quote=True)


def t(key, value):
    """Record a slide-prose translation and return the value unchanged."""
    TRANSLATION[ACTIVE][key] = value
    return value


def T(key):
    """Record an interface translation and return it."""
    value = CHROME[ACTIVE][key]
    TRANSLATION[ACTIVE][key] = value
    return value


def A(key):
    """The attribute that lets the runtime find this slot again."""
    return f' data-i18n="{key}"'


def asset(name):
    mime = 'font/woff2' if name.endswith('.woff2') else 'image/webp'
    return 'data:' + mime + ';base64,' + b64encode((ASSETS / name).read_bytes()).decode('ascii')


def language_fonts():
    """The faces the languages other than English need, embedded.

    Each language that uses a script the Latin face does not cover ships
    its own subset, generated by fetch_fonts.py from the characters the
    translation actually prints. A face is added only once — the browser
    picks the face that holds the character, so the rules can coexist.
    """
    faces = ''
    directory = ASSETS / 'fonts'
    if not directory.exists():
        return faces
    for coverage_path in sorted(directory.glob('*.json')):
        coverage = loads(coverage_path.read_text(encoding='utf-8'))
        family = coverage['family']
        for name in coverage['files']:
            path = directory / name
            if not path.exists():
                continue
            weight = findall(r'-(\d+)\.woff2$', name)
            faces += (
                '@font-face{font-family:"%s";font-style:normal;font-weight:%s;'
                'font-display:swap;src:url("%s") format("woff2")}'
                % (family, weight[0] if weight else '400', asset(f'fonts/{name}'))
            )
    return faces


def links(keys):
    return [
        f'<a href="{e(SOURCES[key])}" target="_blank" rel="noopener"{A(f"src.{key}")}>{e(T(f"src.{key}"))}</a>'
        for key in keys
    ]


def stages(count):
    return ''.join(
        f'<span class="fragment stage-fragment" data-fragment-index="{i}" aria-hidden="true"></span>'
        for i in range(count)
    )


def brand_strip(keys):
    if not keys:
        return ''
    images = []
    for key in keys:
        name, colour = MARKS[key]
        if key in ('opea','vllm'):
            src = asset(f'stack-logos/{key}.webp')
        else:
            xml = (ASSETS / 'stack-logos' / f'{key}.svg').read_text(encoding='utf-8')
            if colour:
                xml = sub(r'<svg(?=\s)', f'<svg fill="{colour}"', xml, count=1)
            src = 'data:image/svg+xml;base64,' + b64encode(xml.encode()).decode('ascii')
        images.append(f'<img src="{src}" alt="{e(name)}" title="{e(name)}">')
    return '<div class="brand-strip">' + ''.join(images) + '</div>'


def blocks(prefix, items, css='blocks', guided=False, marks=()):
    return '<div class="' + css + '">' + ''.join(
        f'<article class="readout"{f" data-light={i}" if guided else ""}>'
        f'<div class="readout-heading">{brand_strip(marks[i]) if i < len(marks) else ""}'
        f'<h2{A(f"{prefix}.items.{i}.f0")}>{e(t(f"{prefix}.items.{i}.f0", item[0]))}</h2></div>'
        f'<p{A(f"{prefix}.items.{i}.f1")}>{e(t(f"{prefix}.items.{i}.f1", item[1]))}</p></article>'
        for i, item in enumerate(items)
    ) + '</div>'


def marks(n):
    """The brand marks of a slide whose rows carry logos.

    The marks are keyed by the slide's number, so they follow the slide
    when it moves. A slide that shows logos and has none here is a build
    error, not an empty strip.
    """
    if n not in SLIDE_MARKS:
        raise SystemExit(f'Slide {n} carries brand marks but has no entry in SLIDE_MARKS.')
    return SLIDE_MARKS[n]


def stack(prefix, slide, n):
    return blocks(prefix, slide.items, 'stack-grid', marks=marks(n))


def matrix(prefix, slide, n):
    header = (
        '<thead><tr>'
        f'<th scope="col"{A("chrome.matrix.appPlatform")}>{e(T("chrome.matrix.appPlatform"))}</th>'
        f'<th scope="col"{A("chrome.matrix.applicationStack")}>{e(T("chrome.matrix.applicationStack"))}</th>'
        f'<th scope="col"{A("chrome.matrix.gpuInEnvironment")}>{e(T("chrome.matrix.gpuInEnvironment"))}</th>'
        f'<th scope="col"{A("chrome.matrix.dedicatedGpuApi")}>{e(T("chrome.matrix.dedicatedGpuApi"))}</th>'
        '</tr></thead>'
    )
    rows = []
    for i, item in enumerate(slide.items):
        rows.append(
            f'<tr><th scope="row">{brand_strip(marks(n)[i])}'
            f'<span{A(f"{prefix}.items.{i}.f0")}>{e(t(f"{prefix}.items.{i}.f0", item[0]))}</span></th>'
            + ''.join(
                f'<td{A(f"{prefix}.items.{i}.f{j + 1}")}>{e(t(f"{prefix}.items.{i}.f{j + 1}", cell))}</td>'
                for j, cell in enumerate(item[1:])
            )
            + '</tr>'
        )
    return f'<table class="deployment-matrix">{header}<tbody>' + ''.join(rows) + '</tbody></table>'


def cover(prefix, slide):
    return (
        f'<img class="itu" src="{asset("epfl-itu.webp")}" alt="{e(T("chrome.itu.alt"))}" data-i18n-alt="chrome.itu.alt">'
        '<div class="cover-content">'
        f'<p class="eyebrow title-tag"{A(f"{prefix}.eyebrow")}>{e(t(f"{prefix}.eyebrow", slide.eyebrow))}</p>'
        f'<h1{A(f"{prefix}.title")}>{e(t(f"{prefix}.title", slide.title))}</h1>'
        f'<p class="cover-intro"{A(f"{prefix}.items.0.f1")}>{e(t(f"{prefix}.items.0.f1", slide.items[0][1]))}</p>'
        '</div>'
    )


def conversation(prefix, slide, n):
    first, second, third = slide.items
    if n == 2:
        question_key, question = f'{prefix}.items.0.f1', t(f'{prefix}.items.0.f1', first[1])
        answer_key, answer = f'{prefix}.items.1.f1', t(f'{prefix}.items.1.f1', second[1])
        pane = (
            f'<p class="pane-kicker"{A("chrome.conversation.sourcePreview")}>{e(T("chrome.conversation.sourcePreview"))}</p>'
            f'<h2{A("chrome.conversation.guideTitle")}>{e(T("chrome.conversation.guideTitle"))}</h2>'
            f'<p class="excerpt"{A("chrome.conversation.guideExcerpt")}>{e(T("chrome.conversation.guideExcerpt"))}</p>'
            f'<p{A(f"{prefix}.items.2.f1")}>{e(t(f"{prefix}.items.2.f1", third[1]))}</p>'
        )
    else:
        question_key, question = 'chrome.conversation.question', T('chrome.conversation.question')
        answer_key, answer = f'{prefix}.items.0.f1', t(f'{prefix}.items.0.f1', first[1])
        pane = (
            f'<p class="pane-kicker"{A("chrome.conversation.verifiable")}>{e(T("chrome.conversation.verifiable"))}</p>'
            f'<h2{A(f"{prefix}.items.1.f0")}>{e(t(f"{prefix}.items.1.f0", second[0]))}</h2>'
            f'<p{A(f"{prefix}.items.1.f1")}>{e(t(f"{prefix}.items.1.f1", second[1]))}</p>'
            f'<h2{A(f"{prefix}.items.2.f0")}>{e(t(f"{prefix}.items.2.f0", third[0]))}</h2>'
            f'<p{A(f"{prefix}.items.2.f1")}>{e(t(f"{prefix}.items.2.f1", third[1]))}</p>'
        )
    return (
        '<div class="scene conversation" data-scene><div class="mock-window"><div class="mock-bar"><i></i><i></i><i></i>'
        f'<span{A("chrome.conversation.windowTitle")}>{e(T("chrome.conversation.windowTitle"))}</span></div>'
        f'<div class="conversation-body"><div class="question"{A(question_key)}>{e(question)}</div>'
        f'<div class="answer"><b{A("chrome.conversation.assistant")}>{e(T("chrome.conversation.assistant"))}</b>'
        f'<p{A(answer_key)}>{e(answer)}</p>'
        f'<span class="citation-mark" data-light="0"{A("chrome.conversation.citation")}>{e(T("chrome.conversation.citation"))}</span></div>'
        '</div></div>'
        f'<aside class="source-pane" data-light="0">{pane}</aside>{stages(1)}</div>'
    )


def surfaces(prefix, slide, n):
    return (
        '<div class="scene device-scene" data-scene><div class="device-visuals" aria-hidden="true">'
        f'<div class="device-browser" data-light="0"><div class="mock-bar"><i></i><i></i><i></i>'
        f'<span{A("chrome.surfaces.browserTitle")}>{e(T("chrome.surfaces.browserTitle"))}</span></div>'
        f'<div class="device-content"><b{A("chrome.surfaces.prompt")}>{e(T("chrome.surfaces.prompt"))}</b>'
        f'<span{A("chrome.surfaces.example")}>{e(T("chrome.surfaces.example"))}</span><div class="ghost-lines"></div></div></div>'
        f'<div class="device-phone" data-light="1"><span class="earpiece"></span>'
        f'<b{A("chrome.surfaces.browserTitle")}>{e(T("chrome.surfaces.browserTitle"))}</b>'
        f'<span{A("chrome.surfaces.example")}>{e(T("chrome.surfaces.example"))}</span><div class="ghost-lines"></div></div>'
        f'</div>{blocks(prefix, slide.items, "device-notes", True, marks(n))}{stages(len(slide.items))}</div>'
    )


def diagram_figure(n):
    """The diagram, with its label ready to be translated.

    The drawing itself stays in English — the labels inside a diagram
    are part of the picture. The alternative text that describes it is
    prose, so it is a slot the runtime fills.
    """
    svg = (WORK / 'mermaid-svg' / f'{n:02}.svg').read_text(encoding='utf-8')
    key = f'diagram.{n:02}.description'
    svg = sub(r'aria-label="[^"]*"', f'aria-label="{e(T(key))}" data-i18n-aria="{key}"', svg, count=1)
    return f'<figure class="diagram-paper">{svg}</figure>'


def documented_diagram(prefix, slide, n):
    spec = DIAGRAMS[f'{n:02}']
    explanation = blocks(prefix, slide.items, f'diagram-notes count-{len(slide.items)}', True, SLIDE_MARKS.get(n, ()))
    return (
        f'<div class="scene mermaid-stage mermaid-{spec["layout"]}" data-scene>'
        f'{diagram_figure(n)}{explanation}{stages(len(slide.items))}</div>'
    )


def ingestion(prefix, slide, n):
    formats_item, example_item, settings_item = slide.items
    formats_title = formats_item[0]
    upload = formats_item[1:]
    example_title = example_item[0]
    example = example_item[1:]
    settings_title = settings_item[0]
    chips = ''.join(
        f'<li{A(f"{prefix}.items.0.f{i + 2}")}>{e(t(f"{prefix}.items.0.f{i + 2}", label))}</li>'
        for i, label in enumerate(upload[1:])
    )
    return (
        '<div class="scene ingestion-scene" data-scene>'
        f'{diagram_figure(n)}<div class="ingestion-details">'
        f'<article class="readout ingestion-formats" data-light="0"><h2{A(f"{prefix}.items.0.f0")}>{e(t(f"{prefix}.items.0.f0", formats_title))}</h2>'
        f'<ul class="format-list">{chips}</ul>'
        f'<p{A(f"{prefix}.items.0.f1")}>{e(t(f"{prefix}.items.0.f1", upload[0]))}</p></article>'
        f'<article class="readout ingestion-example" data-light="1"><h2{A(f"{prefix}.items.1.f0")}>{e(t(f"{prefix}.items.1.f0", example_title))}</h2>'
        f'<p><b{A("chrome.ingestion.chunk1")}>{e(T("chrome.ingestion.chunk1"))}</b>'
        f'<span><span{A(f"{prefix}.items.1.f1")}>{e(t(f"{prefix}.items.1.f1", example[0]))}</span> '
        f'<mark{A(f"{prefix}.items.1.f2")}>{e(t(f"{prefix}.items.1.f2", example[1]))}</mark></span></p>'
        f'<p><b{A("chrome.ingestion.chunk2")}>{e(T("chrome.ingestion.chunk2"))}</b>'
        f'<span><mark{A(f"{prefix}.items.1.f2")}>{e(t(f"{prefix}.items.1.f2", example[1]))}</mark>'
        f'<span{A(f"{prefix}.items.1.f3")}>{e(t(f"{prefix}.items.1.f3", example[2]))}</span></span></p></article>'
        f'<article class="readout ingestion-settings" data-light="2"><h2{A(f"{prefix}.items.2.f0")}>{e(t(f"{prefix}.items.2.f0", settings_title))}</h2>'
        f'<p{A(f"{prefix}.items.2.f1")}>{e(t(f"{prefix}.items.2.f1", settings_item[1]))}</p></article></div>{stages(3)}</div>'
    )


def language_flag(code, key):
    icon = (ASSETS / 'flags' / f'{code}.svg').read_bytes()
    uri = 'data:image/svg+xml;base64,' + b64encode(icon).decode('ascii')
    label = T(key)
    return f'<img class="language-flag" src="{uri}" alt=""><span{A(key)}>{e(label)}</span>'


def language_journey(prefix, slide, n):
    # The quotes stay as they are: this slide illustrates a non-English
    # request travelling through an English core, so translating them would
    # change what the slide demonstrates.
    steps = (
        ('tz', 'chrome.language.question', 'sw', 'Ninapaswa kuleta nini ninapofanya upya kibali changu?'),
        ('gb', 'chrome.language.core', 'en', 'What should I bring to renew my permit?'),
        ('tz', 'chrome.language.answer', 'sw', 'Leta kibali chako cha sasa na uthibitisho wa hivi karibuni wa anwani yako.'),
    )
    cards = ''.join(
        f'<article class="language-turn" data-light="{i}"><h2>{language_flag(flag, label)}</h2>'
        f'<p lang="{lang}">{e(quote)}</p></article>'
        for i, (flag, label, lang, quote) in enumerate(steps)
    )
    return (
        '<div class="scene language-scene" data-scene>'
        f'{diagram_figure(n)}<div class="language-turns">{cards}</div>'
        f'{blocks(prefix, slide.items, "language-notes", True)}{stages(len(slide.items))}</div>'
    )


def chapter_opening(prefix, slide):
    """The divider slide that opens a chapter.

    It carries its own slot keys: the slide it precedes reuses the same
    slide number, so the chapter's notes cannot live under that number.
    """
    number = slide.chapter_number
    title = T(f'chapter.{number}.title')
    summary = T(f'chapter.{number}.summary')
    notes = T(f'chapter.{number}.notes')
    track = ''.join(
        f'<li style="--beat:{i}"{A(f"chapter.{number}.steps.{i}")}>{e(T(f"chapter.{number}.steps.{i}"))}</li>'
        for i in range(3)
    )
    return Slide(
        'chapter-divider', title, slide.chapter, slide.timing, number,
        items=[], notes=notes,
    ), (
        '<div class="chapter-body">'
        f'<div class="chapter-intro"><h1{A(f"chapter.{number}.title")}>{e(title)}</h1>'
        f'<p{A(f"chapter.{number}.summary")}>{e(summary)}</p></div>'
        f'<div class="chapter-visual"><ol class="chapter-track">{track}</ol></div></div>'
    ), f'chapter.{number}.notes'


def document(prefix, slide, n):
    labels = ('chrome.document.evidence', 'chrome.document.searchResult', 'chrome.document.grounded')
    graphics = f'''<div class="document-visual" aria-hidden="true">
      <div class="doc-stack" data-light="0"><div><b{A(labels[0])}>{e(T(labels[0]))}</b><div class="ghost-lines"></div><span{A(labels[1])}>{e(T(labels[1]))}</span></div></div>
      <div class="document-transfer" data-light="1"><span>→</span></div><div class="document-packet"><i></i><i></i><i></i></div>
      <div class="doc-results" data-light="2"><b{A(labels[2])}>{e(T(labels[2]))}</b><i></i><i></i><i></i></div>
    </div>'''
    return (
        f'<div class="scene document-scene" data-scene>{graphics}'
        f'{blocks(prefix, slide.items, "document-notes", True)}{stages(len(slide.items))}</div>'
    )


def rank(prefix, slide, n):
    ordering = [1, 2, 0]
    tags = ('chrome.rank.tag0', 'chrome.rank.tag1', 'chrome.rank.tag2')
    rows = ''.join(
        f'<div class="rank-row" data-light="{i}" style="--new:{i};--old:{ordering.index(i)}">'
        f'<span class="rank-tag"{A(tags[i])}>{e(T(tags[i]))}</span>'
        f'<div><h2{A(f"{prefix}.items.{i}.f0")}>{e(t(f"{prefix}.items.{i}.f0", item[0]))}</h2>'
        f'<p{A(f"{prefix}.items.{i}.f1")}>{e(t(f"{prefix}.items.{i}.f1", item[1]))}</p></div></div>'
        for i, item in enumerate(slide.items)
    )
    return (
        '<div class="scene rank-scene" data-scene><div class="rank-label">'
        f'<span class="rank-before"{A("chrome.rank.before")}>{e(T("chrome.rank.before"))}</span>'
        f'<span class="rank-after"{A("chrome.rank.after")}>{e(T("chrome.rank.after"))}</span></div>'
        f'<div class="rank-list">{rows}</div>{stages(1)}</div>'
    )


def profiles(prefix, slide, n):
    pills = (
        f'<span{A("chrome.profiles.publicGuide")}>{e(T("chrome.profiles.publicGuide"))}</span>'
        f'<span{A("chrome.profiles.internalProcedure")}>{e(T("chrome.profiles.internalProcedure"))}</span>'
    )
    return (
        '<div class="scene profile-scene" data-scene>'
        + ''.join(
            f'<article class="profile" data-light="{i}"><div class="profile-icon" aria-hidden="true">{e(T(f"chrome.profiles.initials{i}"))}</div>'
            f'<div><h2{A(f"{prefix}.items.{i}.f0")}>{e(t(f"{prefix}.items.{i}.f0", item[0]))}</h2>'
            f'<p{A(f"{prefix}.items.{i}.f1")}>{e(t(f"{prefix}.items.{i}.f1", item[1]))}</p>'
            f'<div class="scope-pills">{pills if i else pills.split("</span>", 1)[0] + "</span>"}</div></div></article>'
            for i, item in enumerate(slide.items)
        )
        + stages(len(slide.items))
        + '</div>'
    )


def console_scene(prefix, slide, n):
    visual_labels = (
        (('chrome.console.documents', 'chrome.console.ingestionStatus'),
         ('chrome.console.userRoles', 'chrome.console.delegated'),
         ('chrome.console.systemHealth', 'chrome.console.serviceStatus'))
        if n == 22 else
        (('chrome.console.requiredEvidence', 'chrome.console.expectedSource'),
         ('chrome.console.expiredPermit', 'chrome.console.missingEvidence'),
         ('chrome.console.repeatAfterUpdate', 'chrome.console.reviewResult'))
    )
    return (
        '<div class="scene console-scene" data-scene><div class="mock-window admin-window">'
        f'<div class="mock-bar"><i></i><i></i><i></i><span{A("chrome.console.windowTitle")}>{e(T("chrome.console.windowTitle"))}</span></div>'
        + ''.join(
            f'<div class="console-row" data-light="{i}"><i class="status-dot"></i>'
            f'<b{A(first)}>{e(T(first))}</b><span{A(second)}>{e(T(second))}</span></div>'
            for i, (first, second) in enumerate(visual_labels)
        )
        + f'</div>{blocks(prefix, slide.items, "console-legend", True)}{stages(len(slide.items))}</div>'
    )


def trace(prefix, slide, n):
    labels = ('chrome.trace.identity', 'chrome.trace.retrieval', 'chrome.trace.generation', 'chrome.trace.response')
    widths = (20, 41, 62, 17)
    offsets = (4, 17, 28, 81)
    visual = ''.join(
        f'<div class="trace-row" data-light="{min(i,2)}"><span{A(labels[i])}>{e(T(labels[i]))}</span>'
        f'<i style="--offset:{offset}%;--width:{width}%"></i></div>'
        for i, (offset, width) in enumerate(zip(offsets, widths))
    )
    return (
        f'<div class="scene trace-scene" data-scene><div class="trace-visual" aria-label="Illustrative request trace">'
        f'{visual}</div>{blocks(prefix, slide.items, "trace-legend", n == 27)}'
        f'{stages(len(slide.items)) if n == 27 else ""}</div>'
    )


# The resource menu, in its order. The build keeps the entries the deck
# cites; the repository is listed whatever the deck cites.
MENU = ('itu','architecture','rag','okf','authz','observe','compose','swarm','k8s','repo')


def resources(prefix, slide, n):
    # The menu lists the documentation this deck cites. A deck that leaves
    # a subject out therefore has no link to it: the short deck never
    # presents the OKF tooling, and its menu does not offer it.
    return '<div class="resources">' + ''.join(links(slide.menu)) + '</div>'


def editorial(prefix, slide, n):
    if slide.layout == 'field':
        fields = (
            ('chrome.field.advisory','el-salvador','chrome.field.advisoryAlt'),
            ('chrome.field.health','gambia','chrome.field.healthAlt'),
        )
        return (
            '<div class="field-grid">'
            + ''.join(
                f'<article><img src="{asset(photo + ".webp")}" alt="{e(T(alt))}" class="field-photo" data-i18n-alt="{alt}">'
                f'<div class="field-copy"><span{A(sector)}>{e(T(sector))}</span>'
                f'<h2{A(f"{prefix}.items.{i}.f0")}>{e(t(f"{prefix}.items.{i}.f0", item[0]))}</h2>'
                f'<p{A(f"{prefix}.items.{i}.f1")}>{e(t(f"{prefix}.items.{i}.f1", item[1]))}</p></div></article>'
                for i, ((sector, photo, alt), item) in enumerate(zip(fields, slide.items))
            )
            + '</div>'
        )
    if slide.layout == 'finale':
        return f'<div class="scene finale-scene" data-scene>{blocks(prefix, slide.items, "finale-blocks", True)}{stages(len(slide.items))}</div>'
    return blocks(prefix, slide.items, slide.layout, marks=SLIDE_MARKS.get(n, ()))


RENDER = {
    'chat': conversation, 'surfaces': surfaces, 'document': document,
    'rank': rank, 'profiles': profiles, 'console': console_scene, 'trace': trace,
    'resources': resources, 'stack': stack, 'matrix': matrix,
}
DIAGRAM_RENDER = {'languages': language_journey, 'ingestion': ingestion}


def render(slide, n, position, total, opening=False):
    theme = "night" if not opening and slide.layout in {'cover', 'finale'} else "day"
    num = f'{n:02}'
    display = f'{position:02}'
    identifier = f'chapter-{slide.chapter_number:02}' if opening else f'slide-{num}'
    prefix = f's{n:02}'
    notes_key = f'{prefix}.notes'
    if opening:
        slide, opening_content, notes_key = chapter_opening(prefix, slide)
    header = (
        '<header class="slide-header"><div class="wordmark">GENIE<span>.AI</span></div>'
        '<span class="header-rule"></span>'
        f'<span class="chapter"{A(f"{prefix}.chapter")}>{e(t(f"{prefix}.chapter", slide.chapter))}</span></header>'
    )
    references = links(slide.sources)
    if slide.layout == 'field':
        references.extend(f'<a href="{e(url)}" target="_blank" rel="noopener">{e(label)}</a>' for label, url in PHOTO_CREDITS)
    refs = ' · '.join(references)
    footer = (
        '<footer class="slide-footer">'
        f'<div class="chapter-progress" aria-label="Chapter {slide.chapter_number} of 7" data-i18n-aria="chrome.ui.chapterOf">'
        + ''.join(f'<span class="{("current" if i == slide.chapter_number else "")}"></span>' for i in range(1, 8))
        + f'</div><div class="source-links">{refs}</div><div class="slide-numbering">{display} / {total}</div></footer>'
    )
    if opening:
        content = opening_content
    elif slide.layout == 'cover':
        content = cover(prefix, slide)
    else:
        eyebrow = f'<p class="eyebrow"{A(f"{prefix}.eyebrow")}>{e(t(f"{prefix}.eyebrow", slide.eyebrow))}</p>' if slide.eyebrow else ''
        takeaway = f'<p class="slide-takeaway"{A(f"{prefix}.takeaway")}>{e(t(f"{prefix}.takeaway", slide.takeaway))}</p>' if slide.takeaway else ''
        if num in DIAGRAMS:
            renderer = DIAGRAM_RENDER.get(slide.layout, documented_diagram)
        else:
            renderer = RENDER.get(slide.layout, editorial)
        content = (
            f'<div class="heading"><h1 class="slide-title"{A(f"{prefix}.title")}>{e(t(f"{prefix}.title", slide.title))}</h1>{eyebrow}</div>'
            f'<div class="slide-content">{renderer(prefix, slide, n)}{takeaway}</div>'
        )
    return (
        f'<section class="deck-slide layout-{slide.layout}" data-slide-theme="{theme}" id="{identifier}" '
        f'data-position="{display}" data-total="{total}" data-chapter="{e(slide.chapter)}" data-unit="{slide.chapter_number}" data-timing="{e(slide.timing)}">'
        f'<div class="slide-frame">{header}{content}{footer}</div>'
        f'<aside class="notes" hidden{A(notes_key)}>{e(t(notes_key, slide.notes))}</aside></section>'
    )


def build_slides(slides, numbers):
    """Render the slides, and the chapter openers that precede them.

    `numbers` is the set of slide numbers a variant shows. A slide keeps
    the number it holds in the slide file, so a variant that leaves slides
    out does not renumber the ones it keeps: the brand marks, the diagrams
    and the translation slots all keep their keys.
    """
    shown = [slide for i, slide in enumerate(slides, 1) if i in numbers]
    cited = {key for slide in shown for key in slide.sources}
    for slide in shown:
        if slide.layout == 'resources':
            slide.menu = [key for key in MENU if key == 'repo' or key in cited]
    sequence = []
    last_chapter = 1
    for i, slide in enumerate(slides, 1):
        if i not in numbers:
            continue
        if slide.chapter_number != last_chapter:
            sequence.append((slide, i, True))
            last_chapter = slide.chapter_number
        sequence.append((slide, i, False))
    total = len(sequence)
    return '\n'.join(
        render(slide, i, position, total, opening)
        for position, (slide, i, opening) in enumerate(sequence, 1)
    )


def check_complete():
    """Fail the build when a language is missing a string.

    The runtime swaps translated text into the slots this build produced. A
    slot with no translation would keep its English text, so a gap here is
    an English sentence in the middle of a translated slide.
    """
    problems = []
    reference = set(TRANSLATION[CODES[0]])
    for code in CODES[1:]:
        missing = reference - set(TRANSLATION[code])
        extra = set(TRANSLATION[code]) - reference
        if missing:
            problems.append(f"{code}: missing {len(missing)} string(s): {', '.join(sorted(missing)[:8])}")
        if extra:
            problems.append(f"{code}: {len(extra)} string(s) with no English counterpart: {', '.join(sorted(extra)[:8])}")
    # Every interface file must carry the same keys, so a mistyped key in
    # one language cannot silently fall back to English.
    chrome_reference = set(CHROME[CODES[0]])
    for code in CODES[1:]:
        difference = chrome_reference ^ set(CHROME[code])
        if difference:
            problems.append(f"{code}.json: key set differs from English: {', '.join(sorted(difference)[:8])}")
    if problems:
        raise SystemExit('Incomplete translation:\n  ' + '\n  '.join(problems))


def ready_languages():
    """The languages that can be built: the English one and its translations.

    A language whose files are not there yet is not built — it simply does
    not appear in the selector. A language whose files ARE there but do not
    agree with English is a defect, and the build refuses it.
    """
    ready = [CODES[0]]
    for code in CODES[1:]:
        if (SLIDES / f'{code}.txt').exists() and (I18N / f'{code}.json').exists():
            ready.append(code)
    return ready


def keep(slides, variant):
    """The slide numbers a variant shows.

    A slide names the variants that show it, so the numbers follow the
    slide file rather than a list of its own: inserting a slide does not
    change what the other variants show.
    """
    numbers = {i for i, slide in enumerate(slides, 1) if variant in slide.variants}
    if not numbers:
        raise SystemExit(f'The {variant} variant shows no slide.')
    return numbers


def retime(slides, variant):
    """Apply the variant's chapter timings to the parsed slides.

    The timing a slide carries comes from the chapter it opens in the
    slide file. A variant that runs in another length declares its own
    timings, so the two decks do not carry the same clock. Every chapter
    the variant shows must have one, and it must not time a chapter it
    leaves out: a gap or a hole in the clock is a defect nothing on the
    page would show.
    """
    timings = VARIANTS[variant].get('timings')
    if not timings:
        return
    shown = {str(slide.chapter_number) for slide in slides if variant in slide.variants}
    missing = sorted(shown - set(timings))
    extra = sorted(set(timings) - shown)
    if missing:
        raise SystemExit(f'The {variant} variant has no timing for chapter(s) {", ".join(missing)}.')
    if extra:
        raise SystemExit(f'The {variant} variant times chapter(s) {", ".join(extra)} it does not show.')
    for slide in slides:
        slide.timing = timings[str(slide.chapter_number)]


def collect(variant):
    """Read every language, check they agree, and record the translations.

    The translations are recorded for the slides the variant shows: the
    runtime fills those slots, and a slot no language translated would keep
    its English text. Each language is rendered once, in its own language,
    and the first one is the content the page carries.
    """
    global ACTIVE, CODES
    codes = ready_languages()
    if len(codes) < len(CODES):
        missing = [code for code in CODES if code not in codes]
        print(f'Languages not built yet: {", ".join(missing)}')
    CODES = codes
    for code in CODES:
        TRANSLATION[code].clear()
    content = None
    reference = None
    for code in CODES:
        ACTIVE = code
        slides = parse(code)
        retime(slides, variant)
        if reference is None:
            reference = structure(slides)
        elif structure(slides) != reference:
            raise SystemExit(
                f"{code}.txt does not match the English structure: "
                f"{first_drift(structure(slides), reference)}"
            )
        rendered = build_slides(slides, keep(slides, variant))
        if code == CODES[0]:
            content = rendered
    # The interface strings are not part of a slide: the buttons and the
    # controls live outside the deck. Each language's own file holds
    # them, so they are registered here and travel with the deck.
    for code in CODES:
        ACTIVE = code
        for key in CHROME[code]:
            T(key)
    check_complete()
    return content


def build(variant):
    """Render the deck once per language and merge them into one file."""
    global ACTIVE
    content = collect(variant)
    # The page itself is written in the first language.
    ACTIVE = CODES[0]
    artwork = {'globe':'epfl-globe', 'wave':'epfl-wave', 'footer':'epfl-footer', 'waves-dark':'waves-dark'}
    art = ':root{' + ''.join(f'--art-{key}:url("{asset(name + ".webp")}");' for key, name in artwork.items()) + '}'
    font = ''
    for subset, block in findall(r'/\* (latin(?:-ext)?|cyrillic) \*/\s*(@font-face[^}]+})', (ASSETS / 'carlito-google.css').read_text(encoding='utf-8')):
        weight = findall(r'font-weight: (\d+)', block)[0]
        font += sub(r'url\([^)]+\)', f'url("{asset(f"carlito-{subset}-{weight}.woff2")}")', block)
    font += language_fonts()
    reveal_css = (REVEAL / 'dist' / 'reveal.css').read_text(encoding='utf-8').split('@media print{', 1)[0]
    deck_css = '\n'.join((WORK / file).read_text(encoding='utf-8') for file in ('deck.css', 'deck-motion.css'))
    css = reveal_css + font + art + deck_css
    js = (REVEAL / 'dist' / 'reveal.js').read_text(encoding='utf-8').split('//# sourceMappingURL=')[0]
    # The notes plugin is Reveal's own speaker view: the current slide,
    # the next one, the notes and the clock. It is bundled, so the deck
    # stays one file.
    notes_plugin = (REVEAL / 'plugin' / 'notes' / 'notes.js').read_text(encoding='utf-8')
    runtime = (WORK / 'deck.js').read_text(encoding='utf-8')
    licence_paths = [REVEAL / 'LICENSE', ASSETS / 'carlito-LICENSE']
    # The Arabic and Chinese faces travel with the deck, so their
    # licences travel with it too.
    licence_paths += sorted(ASSETS.glob('noto-*-LICENSE*'))
    license_notice = '\n\n'.join(path.read_text(encoding='utf-8') for path in licence_paths)
    options = ''.join(
        f'<option value="{locale["code"]}"{f" selected" if locale["code"] == CODES[0] else ""}>'
        f'{e(locale["label"])}</option>'
        for locale in LOCALES if locale['code'] in CODES
    )
    controls = (
        '<nav id="deck-ui" aria-label="Presentation controls" data-i18n-aria="chrome.ui.controls">'
        '<button id="go-back" type="button" aria-label="Previous" data-i18n-aria="chrome.ui.previous">‹</button>'
        '<button id="go-forward" type="button" aria-label="Next" data-i18n-aria="chrome.ui.next">›</button>'
        f'<button id="deck-motion" type="button" title="Pause or resume animations (M)" aria-keyshortcuts="M"{A("chrome.ui.pause")}>{e(T("chrome.ui.pause"))}</button>'
        f'<button id="deck-notes" type="button"{A("chrome.ui.notes")}>{e(T("chrome.ui.notes"))}</button>'
        f'<button id="go-full" type="button"{A("chrome.ui.fullScreen")}>{e(T("chrome.ui.fullScreen"))}</button>'
        f'<label class="deck-language"><span class="visually-hidden"{A("chrome.ui.language")}>{e(T("chrome.ui.language"))}</span>'
        f'<select id="deck-language">{options}</select></label></nav>'
    )
    # The translations travel as one JSON blob; the runtime fills the slots.
    bundle = {
        'languages': [locale for locale in LOCALES if locale['code'] in CODES],
        'compactTitle': COMPACT_TITLE,
        'tightTitle': TIGHT_TITLE,
        'squeezeTitle': SQUEEZE_TITLE,
        'compactTakeaway': COMPACT_TAKEAWAY,
        'slots': {code: TRANSLATION[code] for code in CODES},
    }
    html = (
        f'<!doctype html><html lang="{CODES[0]}" dir="{DIRECTION[CODES[0]]}"><head><meta charset="utf-8">'
        '<meta name="viewport" content="width=device-width, initial-scale=1">'
        f'<meta name="description" content="{e(T("chrome.deck.description"))}" data-i18n-content="chrome.deck.description">'
        f'<title data-i18n="chrome.deck.title">{e(T("chrome.deck.title"))}</title>'
        f'<style>{css}</style></head><body>{controls}'
        f'<main class="reveal"><div class="slides">\n{content}\n</div></main>'
        f'<!-- Embedded component licences\n{license_notice}\n-->'
        f'<script id="deck-i18n" type="application/json">{dumps(bundle, ensure_ascii=False).replace("<", "\\u003c")}</script>'
        f'<script>{js}</script><script>{notes_plugin}</script><script>{runtime}</script></body></html>'
    )
    assert '</script' not in js.lower() and '</script' not in runtime.lower()
    assert '</script' not in notes_plugin.lower()
    return html


if __name__ == '__main__':
    parser = ArgumentParser(description='Build the standalone GENIE.AI presentation.')
    parser.add_argument('--variant', choices=sorted(VARIANTS) + ['all'], default='all',
                        help='The variant to build. "all" builds every one of them.')
    parser.add_argument('--output', type=Path, default=None,
                        help='Where to write a single variant. Defaults to its published path.')
    args = parser.parse_args()
    variants = sorted(VARIANTS) if args.variant == 'all' else [args.variant]
    if args.output and len(variants) > 1:
        parser.error('--output writes one variant: name it with --variant')
    for variant in variants:
        target = args.output or DEFAULT_OUTPUT[variant]
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(build(variant), encoding='utf-8')
        print(target)
