# Multi-repo retrieval query battery — runs INSIDE the retriever container.
# Output: one JSONL record per call on stdout (host redirects to a file);
# human progress on stderr. Embedding path replicates production: TEI with
# the bge query-instruction prefix (core.embedding_query_prefix), raw query
# text in `text`, vector in `embedding`.
import json
import os
import sys
import time
import urllib.error
import urllib.request

RETRIEVER_URL = "http://localhost:7000/v1/retrieval"
CARRIER_FULL = (
    "chunk::graphs:OKF_bali_v1,OKF_solar-system_v1,OKF_ncd-information_v1,"
    "OKF_alphabet-company-information_v1,OKF_www-gov-uk-full-crawl_v3,"
    "OKF_slaugherhouse-heuristics_v7,OKF_resilient-ai-hub_v1,GRAPH"
)
CARRIER_BALI = "chunk::graphs:OKF_bali_v1::no_legacy:true"
K = 10
TIMEOUT_S = 60
SPACING_S = 0.3

# (category, repo_hint, query)
QUERIES = [
    # ---- Category A: repo-distinct (6 per repo x 7) ----
    # Bali
    ("A", "bali", "how do Balinese Hindus celebrate temple festivals with offerings"),
    ("A", "bali", "Wayang shadow puppet theatre and the Ramayana epic tradition"),
    ("A", "bali", "Mount Agung volcanic eruption ashfall and evacuations"),
    ("A", "bali", "Belanjong pillar inscription and the ancient kingdom of Bali"),
    ("A", "bali", "Ubud Monkey Forest sanctuary and Balinese long-tailed macaques"),
    ("A", "bali", "salak snake fruit and arabica coffee plantations in the highlands"),
    # GOV.UK
    ("A", "govuk", "renew a driving licence photocard online"),
    ("A", "govuk", "register for self assessment and file a tax return"),
    ("A", "govuk", "booking a prison visit and identification rules for visitors"),
    ("A", "govuk", "family visa requirements for a partner joining you in the UK"),
    ("A", "govuk", "find your local council for rubbish collection day"),
    ("A", "govuk", "Office of Rail and Road regulator duties"),
    # Solar System
    ("A", "solar", "constructing logical identifiers LIDs for PDS4 archive bundles"),
    ("A", "solar", "Mariner 2 Venus flyby mission history"),
    ("A", "solar", "small moons of Saturn radius density and albedo values"),
    ("A", "solar", "Parkes radio telescope design and research papers"),
    ("A", "solar", "Chang'e 5 lunar sample return mission"),
    ("A", "solar", "Cassini VIMS ring reflectance observations"),
    # NCD
    ("A", "ncd", "insulin initiation and titration in type 2 diabetes"),
    ("A", "ncd", "choosing antihypertensive drugs to treat high blood pressure"),
    ("A", "ncd", "cervical cancer screening and early detection"),
    ("A", "ncd", "COPD diagnosis with spirometry and bronchodilator therapy"),
    ("A", "ncd", "WHO best buys cost effective interventions for noncommunicable diseases"),
    ("A", "ncd", "acute stroke treatment and secondary prevention"),
    # Slaughterhouse
    ("A", "slaughter", "abattoir licence annual renewal and suspension for hygiene breaches"),
    ("A", "slaughter", "meat inspection procedures on the slaughter line"),
    ("A", "slaughter", "livestock transport animal welfare during the journey"),
    ("A", "slaughter", "export certification of meat products for overseas trade"),
    ("A", "slaughter", "slaughter fees schedule and rates per animal"),
    ("A", "slaughter", "penalty enforcement for licence breaches and unpaid rates"),
    # Alphabet
    ("A", "alphabet", "Waymo autonomous driving subsidiary profile"),
    ("A", "alphabet", "Verily life sciences funding rounds and investors"),
    ("A", "alphabet", "Google DeepMind division research organisation"),
    ("A", "alphabet", "consolidated balance sheets and capital allocation"),
    ("A", "alphabet", "Google Cloud segment revenue and profitability"),
    ("A", "alphabet", "Alphabet board of directors and independent chair"),
    # Resilient AI Hub
    ("A", "resilient", "ResilientAI Hub powered by GENIE-AI preventing violent extremism"),
    ("A", "resilient", "violent extremism threatening SDG progress in Australia and the EU"),
    ("A", "resilient", "subscription monetization model with incentives aligned to the SDGs"),
    ("A", "resilient", "five year projections for an SDG fueled legacy"),
    ("A", "resilient", "measurable SDG progress metrics driving incentives and impact"),
    ("A", "resilient", "partnership model for achieving the Sustainable Development Goals"),
    # ---- Category B: cross-repo confusables (8) ----
    ("B", "ncd-vs-govuk", "air quality pollution and lung disease risk"),
    ("B", "ncd-vs-govuk", "national cancer screening programmes for early detection"),
    ("B", "slaughter-vs-govuk", "food safety standards and hygiene inspections"),
    ("B", "resilient-vs-ncd", "using artificial intelligence to improve healthcare services"),
    ("B", "alphabet-vs-govuk", "company tax obligations and financial reporting"),
    ("B", "bali-vs-govuk", "travel advice for tropical island holidays"),
    ("B", "alphabet-vs-govuk", "regulatory proceedings and antitrust compliance"),
    ("B", "govuk-vs-ncd", "weekly public health surveillance statistics reports"),
    # ---- Category C: historical adversarial (1-8a gate + Bali everyday) (8) ----
    ("C", "gate", "fun in Indonesia"),
    ("C", "gate", "mental health"),
    ("C", "gate", "nutrition"),
    ("C", "gate", "exercise"),
    ("C", "gate", "genetic risk factors for cancer"),
    ("C", "bali", "fun activities in Bali"),
    ("C", "bali", "best beaches and surfing spots near Denpasar"),
    ("C", "bali", "family holiday things to do in Ubud"),
    # ---- Category D: legacy GRAPH (Kenya gov services) (5) ----
    ("D", "kenya", "eCitizen digital payments for government services via mobile money"),
    ("D", "kenya", "how to register a birth and get a birth certificate"),
    ("D", "kenya", "applying for a Kenyan passport"),
    ("D", "kenya", "how to get a national identity card"),
    ("D", "kenya", "Huduma service centres citizen services"),
    # ---- Category E: out-of-corpus negatives (6) ----
    ("E", "negative", "Formula 1 technical regulations"),
    ("E", "negative", "Antarctic Treaty environmental protection"),
    ("E", "negative", "quantum computing error correction"),
    ("E", "negative", "French Bordeaux wine regions and vintages"),
    ("E", "negative", "K-pop idol training industry"),
    ("E", "negative", "Swiss private banking secrecy laws"),
]

# 10 most fan-out-critical queries, re-run under BALI_ONLY (2-3 per category)
BALI_RERUN = [
    ("A", "solar", "constructing logical identifiers LIDs for PDS4 archive bundles"),
    ("A", "ncd", "choosing antihypertensive drugs to treat high blood pressure"),
    ("A", "alphabet", "Waymo autonomous driving subsidiary profile"),
    ("B", "ncd-vs-govuk", "air quality pollution and lung disease risk"),
    ("B", "alphabet-vs-govuk", "company tax obligations and financial reporting"),
    ("B", "bali-vs-govuk", "travel advice for tropical island holidays"),
    ("C", "gate", "fun in Indonesia"),
    ("C", "gate", "genetic risk factors for cancer"),
    ("D", "kenya", "eCitizen digital payments for government services via mobile money"),
    ("E", "negative", "quantum computing error correction"),
]

try:
    from core.embedding_query_prefix import TEI_EMBED_MODEL, get_query_instruction

    QUERY_INSTRUCTION = get_query_instruction(TEI_EMBED_MODEL)
except Exception as e:  # pragma: no cover
    sys.stderr.write("WARN: prefix module unavailable (%s); using default\n" % e)
    QUERY_INSTRUCTION = "Represent this sentence for searching relevant passages: "

TEI_URL = os.environ.get("TEI_EMBEDDING_ENDPOINT", "http://tei:80").rstrip("/")
TEI_TOKEN = (
    os.environ.get("HUGGINGFACEHUB_API_TOKEN")
    or os.environ.get("HF_TOKEN")
    or ""
)


def http_post(url, payload, token=None, timeout=TIMEOUT_S):
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = "Bearer " + token
    req = urllib.request.Request(
        url, data=json.dumps(payload).encode("utf-8"), headers=headers, method="POST"
    )
    t0 = time.perf_counter()
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return (
                r.status,
                round((time.perf_counter() - t0) * 1000, 1),
                r.read().decode("utf-8", "replace"),
                None,
            )
    except urllib.error.HTTPError as e:
        try:
            raw = e.read().decode("utf-8", "replace")
        except Exception:
            raw = ""
        return e.code, round((time.perf_counter() - t0) * 1000, 1), raw, "HTTP %s" % e.code
    except Exception as e:
        return None, round((time.perf_counter() - t0) * 1000, 1), "", "%s: %s" % (type(e).__name__, e)


def embed_query(text):
    """Embed via TEI with the production query-instruction prefix."""
    s, ms, raw, err = http_post(
        TEI_URL + "/embed",
        {"inputs": (QUERY_INSTRUCTION or "") + text, "truncate": True},
        token=TEI_TOKEN or None,
    )
    if s != 200:
        return None, ms, err or ("TEI HTTP %s" % s)
    try:
        b = json.loads(raw)
        vec = b[0] if isinstance(b[0], list) else b
        return vec, ms, None
    except Exception as e:
        return None, ms, "TEI parse: %s" % e


def graph_distribution(body):
    meta = (body or {}).get("metadata") or []
    dist = {}
    for m in meta:
        g = m.get("graph_name")
        if g is None:
            g = "<no_graph_name>"
        dist[g] = dist.get(g, 0) + 1
    return dist


def run_one(seq, category, repo_hint, query, carrier_label, carrier_string):
    rec = {
        "seq": seq,
        "category": category,
        "repo_hint": repo_hint,
        "query": query,
        "carrier_label": carrier_label,
        "carrier_string": carrier_string,
        "k": K,
        "search_type": "similarity",
    }
    vec, embed_ms, err = embed_query(query)
    rec["embed_ms"] = embed_ms
    if err:
        rec["http_status"] = None
        rec["latency_ms"] = None
        rec["error"] = "embed_failed: %s" % err
        rec["n_hits"] = None
        rec["graph_distribution"] = {}
        rec["body"] = None
        return rec
    rec["embed_dims"] = len(vec)
    s, ms, raw, err = http_post(
        RETRIEVER_URL,
        {
            "text": query,
            "embedding": vec,
            "search_start": carrier_string,
            "search_type": "similarity",
            "k": K,
        },
    )
    rec["http_status"] = s
    rec["latency_ms"] = ms
    if err:
        rec["error"] = err
        rec["n_hits"] = None
        rec["graph_distribution"] = {}
        rec["body_preview"] = raw[:2000]
        rec["body"] = None
        return rec
    try:
        body = json.loads(raw)
    except Exception as e:
        rec["error"] = "non-JSON 200 body: %s" % e
        rec["n_hits"] = None
        rec["graph_distribution"] = {}
        rec["body_preview"] = raw[:2000]
        rec["body"] = None
        return rec
    rec["error"] = None
    rec["body"] = body
    meta = body.get("metadata") or []
    rec["n_hits"] = len(meta)
    rec["graph_distribution"] = graph_distribution(body)
    return rec


def main():
    seq = 0
    n_total = len(QUERIES) + len(BALI_RERUN)
    t_start = time.perf_counter()
    for category, repo_hint, query in QUERIES:
        seq += 1
        rec = run_one(seq, category, repo_hint, query, "FULL", CARRIER_FULL)
        sys.stdout.write(json.dumps(rec, ensure_ascii=False) + "\n")
        sys.stdout.flush()
        sys.stderr.write(
            "[%d/%d] %s FULL %r status=%s ms=%s hits=%s graphs=%s err=%s\n"
            % (
                seq,
                n_total,
                category,
                query[:48],
                rec["http_status"],
                rec["latency_ms"],
                rec["n_hits"],
                json.dumps(rec["graph_distribution"]),
                rec["error"],
            )
        )
        sys.stderr.flush()
        time.sleep(SPACING_S)
    for category, repo_hint, query in BALI_RERUN:
        seq += 1
        rec = run_one(seq, category, repo_hint, query, "BALI_ONLY", CARRIER_BALI)
        sys.stdout.write(json.dumps(rec, ensure_ascii=False) + "\n")
        sys.stdout.flush()
        sys.stderr.write(
            "[%d/%d] %s BALI %r status=%s ms=%s hits=%s graphs=%s err=%s\n"
            % (
                seq,
                n_total,
                category,
                query[:48],
                rec["http_status"],
                rec["latency_ms"],
                rec["n_hits"],
                json.dumps(rec["graph_distribution"]),
                rec["error"],
            )
        )
        sys.stderr.flush()
        time.sleep(SPACING_S)
    sys.stderr.write("BATTERY DONE %d calls in %.1fs\n" % (seq, time.perf_counter() - t_start))


if __name__ == "__main__":
    main()
