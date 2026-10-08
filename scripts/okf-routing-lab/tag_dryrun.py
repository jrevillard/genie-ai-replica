"""Dry-run: have the LLM auto-tag 4 repos, then simulate routing
against 4 user queries using only the generated tags. Measures whether
the bali-misroute class of bug would be prevented."""
import os, json, ssl, urllib.request, time, re, math, base64
KEY = os.environ.get('VLLM_API_KEY', '')
ctx = ssl.create_default_context()
ctx.check_hostname = False
ctx.verify_mode = ssl.CERT_NONE

REPOS = [
    ('OKF_alphabet-company-information-llm_v6', 8, 'alphabet'),
    ('OKF_bali-wikipedia-llm_v17', 8, 'bali'),
    ('OKF_www-gov-uk-full-crawl_v3', 8, 'govuk'),
    ('OKF_indonesia-history-llm_v1', 8, 'indonesia'),
]
QUERIES = [
    'Visit Bali for a beach holiday next July',
    'How do I file UK self-assessment tax return?',
    'Tell me about the Alphabet Waymo subsidiary',
    'Tell me about Indonesian history',
]

def http_json(url, body, headers):
    data = json.dumps(body).encode()
    r = urllib.request.Request(url, data=data, headers=headers, method='POST')
    return json.load(urllib.request.urlopen(r, timeout=60, context=ctx))

def arango(aql):
    return http_json(
        'http://arango-vector-db:8529/_db/genie-ai/_api/cursor',
        {'query': aql},
        {'Content-Type': 'application/json', 'Authorization': 'Basic ' + base64.b64encode(b'root:test').decode()},
    )

def sample_chunks(graph, n):
    r = arango(f'FOR c IN `{graph}_SOURCE` SORT RAND() LIMIT {n} RETURN LEFT(c.text, 1500)')
    return r.get('result', [])

def chat_complete(prompt):
    body = {
        'model': 'ibm-granite/granite-4.1-8b',
        'messages': [{'role': 'user', 'content': prompt}],
        'max_tokens': 800,
        'temperature': 0.0,
    }
    return http_json(
        'https://ai.assembly.govstack.global:444/v1/chat/completions',
        body,
        {'Content-Type': 'application/json', 'Authorization': 'Bearer ' + KEY},
    )

def embed(text):
    body = {'inputs': [text], 'truncate': True}
    r = http_json(
        'https://ai.assembly.govstack.global:444/embed',
        body,
        {'Content-Type': 'application/json', 'Authorization': 'Bearer ' + KEY},
    )
    out = r.get('data', r.get('embeddings', r))
    if isinstance(out, list) and out:
        first = out[0]
        if isinstance(first, list):
            return first
        if isinstance(first, dict) and 'embedding' in first:
            return first['embedding']
    return []

def cosine(a, b):
    if not a or not b or len(a) != len(b): return 0.0
    na = math.sqrt(sum(x*x for x in a))
    nb = math.sqrt(sum(x*x for x in b))
    if na == 0 or nb == 0: return 0.0
    return sum(x*y for x, y in zip(a, b)) / (na * nb)

# === Step 1: pull samples ===
print('=== STEP 1: chunk samples pulled from each repo ===')
samples = {}
for graph, n, label in REPOS:
    chunks = sample_chunks(graph, n)
    samples[label] = (graph, chunks)
    print(f'\n--- {label} ({graph}) - {len(chunks)} chunks ---')
    for i, c in enumerate(chunks[:2]):
        print(f'  [{i}] {c[:220].replace(chr(10), " ")}...')

# === Step 2: LLM tag generation ===
print('\n\n=== STEP 2: LLM-generated tags per repo ===')
TAG_PROMPT = """You are a curator for an enterprise knowledge-base system. A repository of
{chunks} document chunks will be ingested. Based on the chunks below, produce
a JSON object with these keys:

  topic:        list of 3-8 high-level topics the corpus covers (e.g. "antitrust-law",
               "balinese-hindu-rituals", "uk-vehicle-tax"). Each must be a phrase
               that a USER SEARCHING FOR INFORMATION might type.
  entity:       list of 0-10 specific named entities mentioned (people, products,
               places, organizations).
  scope:        single best-fit word from: geographic, technical, regulatory,
               cultural, scientific, encyclopedic, commercial, historical.
  forbidden:    list of 2-6 things a USER MIGHT EXPECT TO FIND in a corpus of
               this name that are NOT actually here. Critical for avoiding
               misrouting. E.g. for a generic-wikipedia crawl mis-tagged "Bali",
               forbidden=["travel", "tourism", "balinese-hindu", "yoga-retreats"].
  summary:      1-2 sentences describing what this corpus actually contains.

The tag strings must be SHORT (1-3 words), lowercase, hyphenated.
Output ONLY the JSON object - no commentary.

CHUNKS:
{chunks_text}
"""
generated = {}
for label, (graph, chunks) in samples.items():
    chunks_text = '\n\n---\n\n'.join(chunks)
    prompt = TAG_PROMPT.format(chunks=len(chunks), chunks_text=chunks_text[:6000])
    try:
        resp = chat_complete(prompt)
        choices = resp.get('choices', [{}])
        txt = ''
        if choices:
            msg = choices[0].get('message') or {}
            txt = msg.get('content', '') or choices[0].get('text', '')
        m = re.search(r'\{[\s\S]*\}', txt)
        if m:
            try:
                obj = json.loads(m.group(0))
            except Exception as e:
                obj = {'_raw': txt[:500], '_parse': str(e)}
        else:
            obj = {'_raw': txt[:500]}
    except Exception as e:
        obj = {'_error': str(e)[:200]}
    generated[label] = obj
    print(f'\n--- {label} generated tags ---')
    print(json.dumps(obj, indent=2)[:1500])

# === Step 3: simulate routing against queries ===
print('\n\n=== STEP 3: dry-run tag-based routing ===')
for q in QUERIES:
    print(f'\n>>> Query: "{q}"')
    qe = embed(q)
    repo_scores = []
    for label, obj in generated.items():
        if '_error' in obj or '_raw' in obj:
            print(f'  {label}: LLM tag gen FAILED - would default to chunk-probe')
            continue
        topics = obj.get('topic', []) or []
        forbidden = obj.get('forbidden', []) or []
        s = 0.0
        for t in topics:
            try:
                te = embed(t)
                s += cosine(qe, te)
            except Exception:
                pass
        penalty = 0.0
        for t in forbidden:
            try:
                te = embed(t)
                penalty += max(0, cosine(qe, te))
            except Exception:
                pass
        net = s - penalty
        repo_scores.append((label, net, s, penalty, len(topics), len(forbidden)))
    repo_scores.sort(key=lambda r: -r[1])
    for label, net, s, p, nt, nf in repo_scores:
        print(f'  net={net:+.3f}  topic_sum={s:+.3f}  forbidden_pen={p:.3f}  ({nt} topics, {nf} forbidden)  {label}')
