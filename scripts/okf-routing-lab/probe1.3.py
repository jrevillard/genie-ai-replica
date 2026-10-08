"""Story 1.3 deploy smoke probe against the new build. Embeddings via the
local config's TEI, then direct retriever call. Wall-time + per-leg results
from the new routed retriever."""
import json, time, urllib.request, ssl, os
from concurrent.futures import ThreadPoolExecutor
import base64

ARANGO_AUTH = 'Basic ' + base64.b64encode(b'root:test').decode()
VLLM_KEY = os.environ.get('VLLM_API_KEY', '')
TEI = 'https://ai.assembly.govstack.global:444/embed'
ARANGO = 'http://arango-vector-db:8529/_db/genie-ai/_api/cursor'
RETRIEVER = 'http://localhost:7000/v1/retrieval'
GRAPHS = ['GRAPH', 'OKF_alphabet-company-information-llm_v6', 'OKF_kenya-government-services_v17',
          'OKF_www-gov-uk-full-crawl_v3', 'OKF_bali-wikipedia-llm_v17', 'OKF_indonesia-history-llm_v1',
          'OKF_ncd-information_v1', 'OKF_w5-cycle-1790524694865_v2',
          'OKF_story-7-7-doc-import-smoke-1789404732138_v6']
SHORT = lambda g: g.replace('OKF_', '').replace('-llm_v', '-v')[:14]

def embed(text):
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE
    req = urllib.request.Request(TEI, data=json.dumps({'inputs': text, 'truncate': True}).encode(),
        headers={'Content-Type': 'application/json', 'Authorization': 'Bearer ' + VLLM_KEY})
    return json.load(urllib.request.urlopen(req, timeout=60, context=ctx))

def probe(coll, emb):
    body = {'query': 'FOR doc IN @@coll LET s = APPROX_NEAR_COSINE(doc.embedding, @emb) SORT s DESC LIMIT 40 RETURN s',
            'bindVars': {'@coll': coll, 'emb': emb}}
    req = urllib.request.Request(ARANGO, data=json.dumps(body).encode(),
        headers={'Content-Type': 'application/json', 'Authorization': ARANGO_AUTH})
    return json.load(urllib.request.urlopen(req, timeout=60)).get('result') or []

def post_retriever(body, timeout=120):
    req = urllib.request.Request(RETRIEVER, data=json.dumps(body).encode(),
        headers={'Content-Type': 'application/json'})
    return json.load(urllib.request.urlopen(req, timeout=timeout))

QUERIES = [
    ('ALPHABET-pure', 'Tell me about the corporate structure of the Alphabet companies.'),
    ('ALPHABET+UK  ', 'Give me the context of Alphabet corporation in the UK and focus on government adoption of their services'),
    ('FOLLOWUP-degen', 'why are entities like Google cloud missing from the table?'),
    ('KENYA-pure    ', 'How do I register a new business in Kenya?'),
    ('INDO-pure     ', 'What is the history of Borobudur temple in Indonesia?'),
]

for tag, q in QUERIES:
    t0 = time.time()
    e = embed(q)
    t_embed = (time.time() - t0) * 1000
    # 1. global top-40 competition
    all_rows = []
    t_probe0 = time.time()
    with ThreadPoolExecutor(max_workers=8) as ex:
        futs = {ex.submit(probe, g + '_SOURCE', e): g for g in GRAPHS if g != 'GRAPH'}
        for f in futs:
            for s in f.result():
                all_rows.append((futs[f], s))
    t_probe = (time.time() - t_probe0) * 1000
    all_rows.sort(key=lambda r: r[1], reverse=True)
    top = all_rows[:40]
    counts = {}
    for g, _ in top:
        counts[g] = counts.get(g, 0) + 1
    qualified = sorted(g for g, n in counts.items() if n >= 3)
    floor = ''
    if not qualified and top:
        best = max(counts, key=lambda g: counts[g])
        qualified = [best]
        floor = f' (floor: {SHORT(best)})'
    # 2. full fan-out through the NEW routed retriever
    body = {'text': q, 'embedding': e, 'search_start': 'chunk::graphs:' + ','.join(GRAPHS),
            'search_type': 'hybrid', 'k': 20, 'reranking_strategy': 'adaptive'}
    t0_route = time.time()
    r = post_retriever(body)
    t_route = (time.time() - t0_route) * 1000
    metas = r.get('metadata') or []
    per = {}
    for m in metas:
        per[SHORT(m.get('graph_name', '?'))] = per.get(SHORT(m.get('graph_name', '?')), 0) + 1
    print(f"== {tag}  embed={t_embed:.0f}ms  probe={t_probe:.0f}ms  retriever={t_route:.0f}ms")
    print(f"   route qualified ({len(qualified)}): {[SHORT(g) for g in qualified]}{floor}")
    print(f"   per-graph top-40 counts: { {SHORT(g): n for g, n in counts.items()} }")
    print(f"   full-fanout per-graph (20 chunks): {per}")
