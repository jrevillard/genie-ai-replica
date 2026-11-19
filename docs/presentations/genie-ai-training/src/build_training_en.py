from argparse import ArgumentParser
from base64 import b64encode
from dataclasses import dataclass, field
from html import escape
from json import loads
from pathlib import Path
from re import findall, sub

WORK = Path(__file__).parent
ASSETS = WORK / 'assets'
REVEAL = WORK.parent / 'node_modules' / 'reveal.js'
DEFAULT_OUTPUT = WORK.parents[3] / 'site/static/presentations/genie-ai/index.html'
DOC = 'https://genie-ai-7e342b.opensource.unicc.org'
REPO = 'https://opensource.unicc.org/un/itu/genie-ai'
DIAGRAMS = loads((WORK / 'training-mermaid.json').read_text(encoding='utf-8'))
PHOTO_CREDITS = (
    ('El Salvador photo · randreu · CC BY 3.0', 'https://commons.wikimedia.org/wiki/File:El_Salvador_-_Corn_Farm_-_panoramio.jpg'),
    ('The Gambia photo · CC0', 'https://commons.wikimedia.org/wiki/File:Village_in_rural_Gambia.jpg'),
)
SOURCES = {
    'itu': ('GENIE.AI · ITU', 'https://www.itu.int/itu-d/sites/genieai/'),
    'ituFramework': ('Framework · ITU', 'https://www.itu.int/en/ITU-D/ICT-Applications/Pages/Initiatives/ITU_OSPO/Open-Source_AI_for_Public_Services/GENIE-AI_framework.aspx'),
    'project': ('Country projects', DOC + '/'),
    'welcome': ('Framework overview', DOC + '/docs/get-started/welcome/'),
    'mobile': ('Mobile application', DOC + '/docs/mobile/chat-pipeline/'),
    'api': ('API reference', DOC + '/docs/reference/api-contracts/'),
    'architecture': ('Architecture', DOC + '/docs/get-started/concepts/'),
    'rag': ('RAG pipeline', DOC + '/docs/rag-pipeline/'),
    'ingest': ('Document ingestion', DOC + '/docs/knowledge-base/ingestion/'),
    'uploadFormats': ('Upload allowlist', REPO + '/-/blob/main/components/document-repository/src/config/appConfig.js'),
    'retrieval': ('Hybrid retrieval', DOC + '/docs/rag-pipeline/retrieval/'),
    'multilingual': ('Multilingual architecture', DOC + '/docs/architecture/multilingual-ssot/'),
    'authz': ('OKF access control', DOC + '/docs/knowledge-base/access-control/'),
    'okf': ('OKF Studio', DOC + '/docs/knowledge-base/okf-studio/'),
    'docsokf': ('Documents to OKF', DOC + '/docs/knowledge-base/documents-to-okf/'),
    'admin': ('Admin dashboard', DOC + '/docs/frontend/admin-dashboard/'),
    'lab': ('Testing Lab', DOC + '/docs/knowledge-base/testing-lab/'),
    'observe': ('Observability', DOC + '/docs/observe/'),
    'models': ('Model selection', DOC + '/docs/rag-pipeline/choosing-models/'),
    'install': ('Installation guide', DOC + '/docs/deploy/install-guide/'),
    'k8s': ('Kubernetes and Helm', DOC + '/docs/deploy/kubernetes/'),
    'vllm': ('GPU support · vLLM', 'https://docs.vllm.ai/en/latest/getting_started/installation/gpu/'),
    'licence': ('Apache 2.0 licence', REPO + '/-/blob/main/LICENSE'),
    'web': ('Web chat', DOC + '/docs/frontend/chat-ux/'),
    'branding': ('Branding', DOC + '/docs/configure/branding-customization/'),
    'locale': ('UI locales', DOC + '/docs/configure/locale-whitelist/'),
    'routes': ('API routing', DOC + '/docs/reference/routes/'),
    'ingestPipeline': ('Ingestion pipeline', DOC + '/docs/rag-pipeline/ingestion/'),
    'rerank': ('Reranking', DOC + '/docs/rag-pipeline/reranking/'),
    'generation': ('Generation', DOC + '/docs/rag-pipeline/generation/'),
    'okfConfig': ('OKF configuration', DOC + '/docs/configure/okf-variables/'),
    'okfResolver': ('Access resolver', REPO + '/-/blob/main/components/okf-server/services/authz-resolver-service.js'),
    'idp': ('External identity provider', DOC + '/docs/configure/external-idp-integration-guide/'),
    'security': ('Trust boundaries', DOC + '/docs/architecture/trust-boundaries/'),
    'observeOverview': ('Telemetry stack', DOC + '/docs/observe/overview/'),
    'observeConfig': ('Telemetry settings', DOC + '/docs/observe/configuration/'),
    'compose': ('Compose guide', DOC + '/docs/deploy/docker-compose-setup/#6e-remote-gpu-node-optional'),
    'swarm': ('Swarm guide', DOC + '/docs/deploy/docker-swarm-setup/#remote-gpu-node'),
    'topologies': ('Deployment topologies', DOC + '/docs/deploy/topologies/'),
    'gpu': ('GPU tier', DOC + '/docs/deploy/gpu/'),
    'slim': ('Slim images', DOC + '/docs/deploy/slim-images/'),
    'tracing': ('Tracing guide', DOC + '/docs/operate/tracing-howto/'),
    'repo': ('Source repository', REPO),
}

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
    11: (('vue','flutter'), ('node','keycloak'), ('docling','arango'), ('opea','hf','vllm'), ('otel','victoria','grafana'), ('docker','kube','helm')),
    5: (('vue',), ('flutter',)),
    7: (('keycloak',), ('node',), (), ('nginx','kong','envoy')),
    23: (('keycloak',), ()),
    26: ((), ('otel',), ('victoria',), ('grafana',)),
    29: (('docker',), ('docker',), ('kube','helm')),
    31: (('vllm','hf'), ('nvidia','amd'), ()),
}


CHAPTER_OPENINGS = {
    2: (
        'Bring GENIE.AI into public services.',
        'One framework can support different users, languages and delivery channels.',
        ('Web and mobile', 'Agency APIs', 'Country projects'),
        'Connect the application choices to the needs of citizens, frontline officers and service teams.',
    ),
    3: (
        'From documents to an answer.',
        'Follow the permit guide from ingestion and indexing to search, generation and review.',
        ('Source documents', 'Searchable knowledge', 'Answer with sources'),
        'Follow the corpus first. Once the permit guide is searchable, introduce what happens when someone asks a question.',
    ),
    4: (
        'Steward the knowledge the assistant can use.',
        'OKF makes it possible to review, publish and control access to serving repositories.',
        ('Curate concepts', 'Publish and ingest', 'Apply access policy'),
        'Explain that knowledge stewardship and access policy are application decisions with distinct lifecycle and security controls.',
    ),
    5: (
        'Operate a service people can verify.',
        'Follow the links between identity, evaluation and production telemetry.',
        ('Authentication', 'Answer evaluation', 'Operational telemetry'),
        'Show the control loop: verify access, test representative questions and investigate production behaviour.',
    ),
    6: (
        'Choose the app platform. Place the GPU.',
        'Application orchestration and GPU placement are separate design decisions.',
        ('Compose, Swarm or Kubernetes', 'Same environment or GPU API', 'Service and data boundaries'),
        'Prime the audience for the deployment matrix. All three application platforms can connect to a dedicated GPU API.',
    ),
    7: (
        'Return to the original question.',
        'The answer connects the public service, the knowledge it can use and the infrastructure that runs it.',
        ('Service', 'Knowledge', 'Infrastructure'),
        'Return to what a frontline officer can verify, then move to discussion.',
    ),
}


@dataclass
class Slide:
    layout: str
    title: str
    chapter: str
    timing: str
    chapter_number: int
    items: list[tuple[str, str]] = field(default_factory=list)
    eyebrow: str = ''
    takeaway: str = ''
    notes: str = ''
    sources: list[str] = field(default_factory=list)

def parse():
    slides = []
    chapter = timing = ''
    chapter_number = 0
    for line in (WORK / 'training-en.txt').read_text(encoding='utf-8').splitlines():
        if not line:
            continue
        if line.startswith('# '):
            chapter, timing = line[2:].split('|', 1)
            chapter_number += 1
        elif line.startswith('@'):
            layout, title = line[1:].split('|', 1)
            slides.append(Slide(layout, title, chapter, timing, chapter_number))
        elif line.startswith('? '):
            slides[-1].eyebrow = line[2:]
        elif line.startswith('= '):
            slides[-1].takeaway = line[2:]
        elif line.startswith('! '):
            slides[-1].notes = line[2:]
        elif line.startswith('~ '):
            slides[-1].sources = line[2:].split('|')
        else:
            slides[-1].items.append(tuple(line.split('|', 1)) if '|' in line else ('', line))
    return slides

def e(value):
    return escape(value, quote=True)

def asset(name):
    mime = 'font/woff2' if name.endswith('.woff2') else 'image/webp'
    return 'data:' + mime + ';base64,' + b64encode((ASSETS / name).read_bytes()).decode('ascii')

def links(keys):
    return [
        f'<a href="{e(SOURCES[key][1])}" target="_blank" rel="noopener">{e(SOURCES[key][0])}</a>'
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

def blocks(items, css='blocks', guided=False, marks=()):
    return '<div class="' + css + '">' + ''.join(
        f'<article class="readout"{f" data-light={i}" if guided else ""}>'
        f'<div class="readout-heading">{brand_strip(marks[i]) if i < len(marks) else ""}<h2>{e(heading)}</h2></div>'
        f'<p>{e(body)}</p></article>'
        for i, (heading, body) in enumerate(items)
    ) + '</div>'

def stack(slide, n):
    return blocks(slide.items, 'stack-grid', marks=SLIDE_MARKS[n])

def matrix(slide, n):
    header = (
        '<thead><tr><th scope="col">App platform</th><th scope="col">Application stack</th>'
        '<th scope="col">GPU in that environment</th><th scope="col">Dedicated GPU API</th></tr></thead>'
    )
    rows = []
    for i, (name, body) in enumerate(slide.items):
        environment, integrated, external_gpu = body.split('|')
        rows.append(
            f'<tr><th scope="row">{brand_strip(SLIDE_MARKS[n][i])}<span>{e(name)}</span></th>'
            f'<td>{e(environment)}</td><td>{e(integrated)}</td><td>{e(external_gpu)}</td></tr>'
        )
    return '<table class="deployment-matrix">' + header + '<tbody>' + ''.join(rows) + '</tbody></table>'

def cover(slide, _):
    return (
        f'<img class="itu" src="{asset("epfl-itu.webp")}" alt="International Telecommunication Union">'
        '<div class="cover-content">'
        f'<p class="eyebrow title-tag">{e(slide.eyebrow)}</p>'
        f'<h1>{e(slide.title)}</h1><p class="cover-intro">{e(slide.items[0][1])}</p>'
        '</div>'
    )

def conversation(slide, n):
    first, second, third = slide.items
    if n == 2:
        question, answer, evidence = first[1], second[1], third[1]
        pane = '<p class="pane-kicker">Source preview</p><h2>Permit Renewal Guide</h2><p class="excerpt">“You must bring your current permit and a recent proof of address.”</p><p>' + e(evidence) + '</p>'
    else:
        question, answer = 'What should I bring when I renew my permit?', first[1]
        pane = (
            '<p class="pane-kicker">What the institution can verify</p>'
            f'<h2>{e(second[0])}</h2><p>{e(second[1])}</p>'
            f'<h2>{e(third[0])}</h2><p>{e(third[1])}</p>'
        )
    return (
        '<div class="scene conversation" data-scene><div class="mock-window"><div class="mock-bar"><i></i><i></i><i></i><span>Renewal information service · Illustrative</span></div>'
        f'<div class="conversation-body"><div class="question">{e(question)}</div>'
        f'<div class="answer"><b>Assistant</b><p>{e(answer)}</p><span class="citation-mark" data-light="0">[1] Permit Renewal Guide</span></div>'
        '</div></div>'
        f'<aside class="source-pane" data-light="0">{pane}</aside>{stages(1)}</div>'
    )

def surfaces(slide, n):
    return (
        '<div class="scene device-scene" data-scene><div class="device-visuals" aria-hidden="true">'
        '<div class="device-browser" data-light="0"><div class="mock-bar"><i></i><i></i><i></i><span>Public services</span></div>'
        '<div class="device-content"><b>What would you like to ask?</b><span>Renew my permit</span><div class="ghost-lines"></div></div></div>'
        '<div class="device-phone" data-light="1"><span class="earpiece"></span><b>Public services</b><span>Renew my permit</span><div class="ghost-lines"></div></div>'
        f'</div>{blocks(slide.items, "device-notes", True, SLIDE_MARKS[n])}{stages(len(slide.items))}</div>'
    )

def diagram_figure(n):
    svg = (WORK / 'mermaid-svg' / f'{n:02}.svg').read_text(encoding='utf-8')
    return f'<figure class="diagram-paper">{svg}</figure>'

def documented_diagram(slide, n):
    spec = DIAGRAMS[f'{n:02}']
    explanation = blocks(slide.items, f'diagram-notes count-{len(slide.items)}', True, SLIDE_MARKS.get(n, ()))
    return (
        f'<div class="scene mermaid-stage mermaid-{spec["layout"]}" data-scene>'
        f'{diagram_figure(n)}{explanation}{stages(len(slide.items))}</div>'
    )

def ingestion(slide, n):
    (formats_title, upload), (example_title, example), (settings_title, settings) = slide.items
    upload_note, *formats = upload.split('|')
    chips = ''.join(f'<li>{e(label)}</li>' for label in formats)
    first, overlap, second = (e(text) for text in example.split('|'))
    return (
        '<div class="scene ingestion-scene" data-scene>'
        f'{diagram_figure(n)}<div class="ingestion-details">'
        f'<article class="readout ingestion-formats" data-light="0"><h2>{e(formats_title)}</h2>'
        f'<ul class="format-list">{chips}</ul><p>{e(upload_note)}</p></article>'
        f'<article class="readout ingestion-example" data-light="1"><h2>{e(example_title)}</h2>'
        f'<p><b>Chunk 1</b><span>{first} <mark>{overlap}</mark></span></p>'
        f'<p><b>Chunk 2</b><span><mark>{overlap}</mark>{second}</span></p></article>'
        f'<article class="readout ingestion-settings" data-light="3"><h2>{e(settings_title)}</h2>'
        f'<p>{e(settings)}</p></article></div>{stages(4)}</div>'
    )

def language_flag(code, language):
    icon = (ASSETS / 'flags' / f'{code}.svg').read_bytes()
    uri = 'data:image/svg+xml;base64,' + b64encode(icon).decode('ascii')
    return f'<img class="language-flag" src="{uri}" alt=""><span>{e(language)}</span>'

def language_journey(slide, n):
    steps = (
        ('tz', 'Question · Kiswahili', 'sw', 'Ninapaswa kuleta nini ninapofanya upya kibali changu?'),
        ('gb', 'English RAG core', 'en', 'What should I bring to renew my permit?'),
        ('tz', 'Answer · Kiswahili', 'sw', 'Leta kibali chako cha sasa na uthibitisho wa hivi karibuni wa anwani yako.'),
    )
    cards = ''.join(
        f'<article class="language-turn" data-light="{i}"><h2>{language_flag(flag,label)}</h2>'
        f'<p lang="{lang}">{e(quote)}</p></article>'
        for i, (flag, label, lang, quote) in enumerate(steps)
    )
    return (
        '<div class="scene language-scene" data-scene>'
        f'{diagram_figure(n)}<div class="language-turns">{cards}</div>'
        f'{blocks(slide.items,"language-notes",True)}{stages(len(slide.items))}</div>'
    )

def chapter_opening(slide):
    title, summary, steps, notes = CHAPTER_OPENINGS[slide.chapter_number]
    track = ''.join(
        f'<li style="--beat:{i}">{e(label)}</li>'
        for i, label in enumerate(steps)
    )
    return Slide(
        'chapter-divider', title, slide.chapter, slide.timing, slide.chapter_number,
        items=[], notes=notes,
    ), (
        '<div class="chapter-body">'
        f'<div class="chapter-intro"><h1>{e(title)}</h1><p>{e(summary)}</p></div>'
        f'<div class="chapter-visual"><ol class="chapter-track">{track}</ol></div></div>'
    )

def document(slide, n):
    labels = {
        14: ('Selected evidence', 'Search result', 'Grounded response'),
    }[n]
    graphics = f'''<div class="document-visual" aria-hidden="true">
      <div class="doc-stack" data-light="0"><div><b>{labels[0]}</b><div class="ghost-lines"></div><span>{labels[1]}</span></div></div>
      <div class="document-transfer" data-light="1"><span>→</span></div><div class="document-packet"><i></i><i></i><i></i></div>
      <div class="doc-results" data-light="2"><b>{labels[2]}</b><i></i><i></i><i></i></div>
    </div>'''
    return (
        f'<div class="scene document-scene" data-scene>{graphics}'
        f'{blocks(slide.items, "document-notes", True)}{stages(len(slide.items))}</div>'
    )

def rank(slide, _):
    ordering = [1, 2, 0]
    tags = ('TARGET EVIDENCE', 'RELATED PROCEDURE', 'BROAD CONTEXT')
    rows = ''.join(
        f'<div class="rank-row" data-light="{i}" style="--new:{i};--old:{ordering.index(i)}">'
        f'<span class="rank-tag">{tags[i]}</span><div><h2>{e(label)}</h2><p>{e(body)}</p></div></div>'
        for i, (label, body) in enumerate(slide.items)
    )
    return (
        '<div class="scene rank-scene" data-scene><div class="rank-label">'
        '<span class="rank-before">First-pass candidates</span><span class="rank-after">Reranked candidates</span></div>'
        f'<div class="rank-list">{rows}</div>{stages(1)}</div>'
    )

def profiles(slide, _):
    return (
        '<div class="scene profile-scene" data-scene>'
        + ''.join(
            f'<article class="profile" data-light="{i}"><div class="profile-icon" aria-hidden="true">{("FO","CW")[i]}</div>'
            f'<div><h2>{e(label)}</h2><p>{e(body)}</p><div class="scope-pills"><span>Public guide</span>'
            f'{("<span>Internal procedure</span>" if i else "")}</div></div></article>'
            for i, (label, body) in enumerate(slide.items)
        )
        + stages(len(slide.items))
        + '</div>'
    )

def console(slide, n):
    visual_labels = (
        (('Documents', 'Ingestion status'), ('User roles', 'Delegated administration'), ('System health', 'Service status'))
        if n == 22 else
        (('Required evidence', 'Expected source'), ('Expired permit', 'Missing evidence'), ('Repeat after update', 'Review result'))
    )
    return (
        '<div class="scene console-scene" data-scene><div class="mock-window admin-window">'
        '<div class="mock-bar"><i></i><i></i><i></i><span>GENIE.AI · Illustrative view</span></div>'
        + ''.join(
            f'<div class="console-row" data-light="{i}"><i class="status-dot"></i><b>{first}</b><span>{second}</span></div>'
            for i, (first, second) in enumerate(visual_labels)
        )
        + f'</div>{blocks(slide.items, "console-legend", True)}{stages(len(slide.items))}</div>'
    )

def trace(slide, n):
    labels = ('Identity', 'Retrieval', 'Generation', 'Response')
    widths = (20, 41, 62, 17)
    offsets = (4, 17, 28, 81)
    visual = ''.join(
        f'<div class="trace-row" data-light="{min(i,2)}"><span>{name}</span><i style="--offset:{offset}%;--width:{width}%"></i></div>'
        for i, (name, offset, width) in enumerate(zip(labels, offsets, widths))
    )
    return (
        '<div class="scene trace-scene" data-scene><div class="trace-visual" aria-label="Illustrative request trace">'
        f'{visual}</div>{blocks(slide.items, "trace-legend", n == 27)}'
        f'{stages(len(slide.items)) if n == 27 else ""}</div>'
    )

def resources(slide, _):
    keys = ('itu', 'architecture', 'rag', 'okf', 'authz', 'observe', 'compose', 'swarm', 'k8s', 'repo')
    return '<div class="resources">' + ''.join(links(keys)) + '</div>'

def editorial(slide, n):
    if slide.layout == 'field':
        fields = (
            ('AGRICULTURAL ADVISORY','el-salvador','Corn field in El Salvador'),
            ('PREVENTIVE HEALTH','gambia','Rural setting in The Gambia'),
        )
        return (
            '<div class="field-grid">'
            + ''.join(
                f'<article><img src="{asset(photo+".webp")}" alt="{e(alt)}" class="field-photo">'
                f'<div class="field-copy"><span>{sector}</span><h2>{e(label)}</h2><p>{e(body)}</p></div></article>'
                for (sector, photo, alt), (label, body) in zip(fields, slide.items)
            )
            + '</div>'
        )
    if slide.layout == 'finale':
        return f'<div class="scene finale-scene" data-scene>{blocks(slide.items,"finale-blocks",True)}{stages(len(slide.items))}</div>'
    return blocks(slide.items, slide.layout, marks=SLIDE_MARKS.get(n, ()))

RENDER = {
    'chat': conversation, 'surfaces': surfaces, 'document': document,
    'rank': rank, 'profiles': profiles, 'console': console, 'trace': trace,
    'resources': resources, 'stack': stack, 'matrix': matrix,
}
DIAGRAM_RENDER = {'languages': language_journey, 'ingestion': ingestion}

def render(slide, n, position, total, opening=False):
    theme = "night" if not opening and slide.layout in {'cover', 'finale'} else "day"
    num = f'{n:02}'
    display = f'{position:02}'
    identifier = f'chapter-{slide.chapter_number:02}' if opening else f'slide-{num}'
    if opening:
        slide, opening_content = chapter_opening(slide)
    header = (
        '<header class="slide-header"><div class="wordmark">GENIE<span>.AI</span></div>'
        '<span class="header-rule"></span>'
        f'<span class="chapter">{e(slide.chapter)}</span></header>'
    )
    references = links(slide.sources)
    if slide.layout == 'field':
        references.extend(f'<a href="{e(url)}" target="_blank" rel="noopener">{e(label)}</a>' for label, url in PHOTO_CREDITS)
    refs = ' · '.join(references)
    footer = (
        '<footer class="slide-footer">'
        f'<div class="chapter-progress" aria-label="Chapter {slide.chapter_number} of 7">'
        + ''.join(f'<span class="{("current" if i == slide.chapter_number else "")}"></span>' for i in range(1, 8))
        + f'</div><div class="source-links">{refs}</div><div class="slide-numbering">{display} / {total}</div></footer>'
    )
    if opening:
        content = opening_content
    elif slide.layout == 'cover':
        content = cover(slide, n)
    else:
        title_class = ' compact' if len(slide.title) >= 56 else ''
        eyebrow = f'<p class="eyebrow">{e(slide.eyebrow)}</p>' if slide.eyebrow else ''
        takeaway = f'<p class="slide-takeaway">{e(slide.takeaway)}</p>' if slide.takeaway else ''
        if num in DIAGRAMS:
            renderer = DIAGRAM_RENDER.get(slide.layout, documented_diagram)
        else:
            renderer = RENDER.get(slide.layout, editorial)
        content = (
            f'<div class="heading"><h1 class="slide-title{title_class}">{e(slide.title)}</h1>{eyebrow}</div>'
            f'<div class="slide-content">{renderer(slide, n)}{takeaway}</div>'
        )
    return (
        f'<section class="deck-slide layout-{slide.layout}" data-slide-theme="{theme}" id="{identifier}" '
        f'data-position="{display}" data-total="{total}" data-chapter="{e(slide.chapter)}" data-unit="{slide.chapter_number}" data-timing="{e(slide.timing)}">'
        f'<div class="slide-frame">{header}{content}{footer}</div>'
        f'<aside class="notes" hidden>{e(slide.notes)}</aside></section>'
    )

slides = parse()
assert all(slide.notes for slide in slides), 'Every slide needs speaker notes'
artwork = {'globe':'epfl-globe', 'wave':'epfl-wave', 'footer':'epfl-footer', 'waves-dark':'waves-dark'}
art = ':root{' + ''.join(f'--art-{key}:url("{asset(name+".webp")}");' for key, name in artwork.items()) + '}'
font = ''
for subset, block in findall(r'/\* (latin(?:-ext)?) \*/\s*(@font-face[^}]+})', (ASSETS / 'carlito-google.css').read_text(encoding='utf-8')):
    weight = findall(r'font-weight: (\d+)', block)[0]
    font += sub(r'url\([^)]+\)', f'url("{asset(f"carlito-{subset}-{weight}.woff2")}")', block)
reveal_css = (REVEAL / 'dist' / 'reveal.css').read_text(encoding='utf-8').split('@media print{', 1)[0]
deck_css = '\n'.join((WORK / file).read_text(encoding='utf-8') for file in ('training-en.css', 'training-motion.css'))
css = reveal_css + font + art + deck_css
js = (REVEAL / 'dist' / 'reveal.js').read_text(encoding='utf-8').split('//# sourceMappingURL=')[0]
runtime = (WORK / 'training-en.js').read_text(encoding='utf-8')
license_notice = '\n\n'.join(
    path.read_text(encoding='utf-8')
    for path in (REVEAL / 'LICENSE', ASSETS / 'carlito-LICENSE')
)
controls = '''<nav id="deck-ui" aria-label="Presentation controls">
<button id="go-back" type="button" aria-label="Previous">‹</button>
<button id="go-forward" type="button" aria-label="Next">›</button>
<button id="deck-motion" type="button" title="Pause or resume animations (M)" aria-keyshortcuts="M">Pause motion</button>
<button id="deck-notes" type="button">Speaker notes</button>
<button id="go-full" type="button">Full screen</button></nav>'''
sequence = []
last_chapter = 1
for i, slide in enumerate(slides, 1):
    if slide.chapter_number != last_chapter:
        sequence.append((slide, i, True))
        last_chapter = slide.chapter_number
    sequence.append((slide, i, False))
total = len(sequence)
content = '\n'.join(
    render(slide, i, position, total, opening)
    for position, (slide, i, opening) in enumerate(sequence, 1)
)
html = (
    '<!doctype html><html lang="en"><head><meta charset="utf-8">'
    '<meta name="viewport" content="width=device-width, initial-scale=1">'
    '<meta name="description" content="GENIE.AI technical briefing for public-sector organisations">'
    '<title>GENIE.AI · Public-sector briefing</title>'
    f'<style>{css}</style></head><body>{controls}'
    f'<main class="reveal"><div class="slides">\n{content}\n</div></main>'
    f'<!-- Embedded component licences\n{license_notice}\n-->'
    f'<script>{js}</script><script>{runtime}</script></body></html>'
)
assert '</script' not in js.lower() and '</script' not in runtime.lower()
parser = ArgumentParser(description='Build the standalone GENIE.AI presentation.')
parser.add_argument('--output', type=Path, default=DEFAULT_OUTPUT)
target = parser.parse_args().output
target.parent.mkdir(parents=True, exist_ok=True)
target.write_text(html, encoding='utf-8')
print(target)
