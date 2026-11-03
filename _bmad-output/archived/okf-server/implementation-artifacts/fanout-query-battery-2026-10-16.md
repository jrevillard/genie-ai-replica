# OKF multi-repo fan-out query battery — 2026-10-16

**Purpose:** comprehensive proof attempt for per-query multi-repo fan-out
(David: the 5-query spot check "is hardly anything that proves this
capability"). 79 retriever calls: 62 queries x FULL carrier (all 7 serving
OKF graphs + legacy GRAPH), 10 re-run bali-only, plus probes. Queries were
constructed FROM the live corpora's own topic maps (per-repo title mining),
spanning repo-distinct, cross-repo confusable, historical adversarial (1-8a),
legacy-native and out-of-corpus negatives.

**When:** 2026-10-16 ~06:00 UTC. **Bali was ~50% drained** (21,591 chunks) —
its retrieval strength is underestimated and its numbers will shift as ingest
completes. El Salvador excluded (published, never drained). Raw responses:
26.5 MB (retained session-side, not committed).

**Executor:** 5-agent workflow (corpus mining -> query construction ->
production-path execution via TEI /embed + retriever -> aggregation).

---

# Multi-repo retriever query battery — verdict report

Run: 79 calls = 69 unique queries under the FULL carrier + 10 fan-out-critical re-runs under BALI_ONLY (`chunk::graphs:OKF_bali_v1::no_legacy:true`). 0 HTTP errors, 0 zero-hit queries, all k=10, search_type=similarity, production-shaped payload (TEI bge-large-en-v1.5 query-instruction embedding).

Graph key: bali=OKF_bali_v1 solar=OKF_solar-system_v1 ncd=OKF_ncd-information_v1 alpha=OKF_alphabet-company-information_v1 govuk=OKF_www-gov-uk-full-crawl_v3 slgh=OKF_slaugherhouse-heuristics_v7 resil=OKF_resilient-ai-hub_v1 GRAPH=legacy Kenya corpus. **No similarity scores are returned by the deployed retriever** (response = {id, text} + metadata{file_ids, chunk_key, graph_name, embeddings}); top-1 is therefore positional (rank 1), no score column exists.

Integrity: docs/metadata length mismatches: 0/79; provenance leaks (graph_name outside the 8-graph carrier set): 0; every hit within k=10.

## 1. Verdict table (sorted by category, then run order)

| # | query | cat | carrier | per-graph hits | top-1 graph | latency ms |
|---|-------|-----|---------|----------------|-------------|-----------:|
| 1 | how do Balinese Hindus celebrate temple festivals with ... | A | FULL | bali:5 GRAPH:5 | bali | 3734 |
| 2 | Wayang shadow puppet theatre and the Ramayana epic trad... | A | FULL | bali:5 GRAPH:5 | bali | 3590 |
| 3 | Mount Agung volcanic eruption ashfall and evacuations | A | FULL | bali:5 GRAPH:5 | bali | 1564 |
| 4 | Belanjong pillar inscription and the ancient kingdom of... | A | FULL | bali:5 GRAPH:5 | bali | 1253 |
| 5 | Ubud Monkey Forest sanctuary and Balinese long-tailed m... | A | FULL | bali:5 GRAPH:5 | bali | 985 |
| 6 | salak snake fruit and arabica coffee plantations in the... | A | FULL | bali:5 GRAPH:5 | bali | 1417 |
| 7 | renew a driving licence photocard online | A | FULL | govuk:10 | govuk | 8149 |
| 8 | register for self assessment and file a tax return | A | FULL | govuk:10 | govuk | 8270 |
| 9 | booking a prison visit and identification rules for vis... | A | FULL | GRAPH:10 | GRAPH | 8169 |
| 10 | family visa requirements for a partner joining you in t... | A | FULL | govuk:10 | govuk | 8164 |
| 11 | find your local council for rubbish collection day | A | FULL | govuk:10 | govuk | 1220 |
| 12 | Office of Rail and Road regulator duties | A | FULL | slgh:10 | slgh | 492 |
| 13 | constructing logical identifiers LIDs for PDS4 archive ... | A | FULL | solar:4 alpha:3 resil:3 | solar | 9975 |
| 14 | Mariner 2 Venus flyby mission history | A | FULL | solar:10 | solar | 2665 |
| 15 | small moons of Saturn radius density and albedo values | A | FULL | solar:10 | solar | 4492 |
| 16 | Parkes radio telescope design and research papers | A | FULL | solar:10 | solar | 622 |
| 17 | Chang'e 5 lunar sample return mission | A | FULL | solar:10 | solar | 504 |
| 18 | Cassini VIMS ring reflectance observations | A | FULL | solar:10 | solar | 576 |
| 19 | insulin initiation and titration in type 2 diabetes | A | FULL | ncd:10 | ncd | 1937 |
| 20 | choosing antihypertensive drugs to treat high blood pre... | A | FULL | ncd:10 | ncd | 715 |
| 21 | cervical cancer screening and early detection | A | FULL | ncd:5 govuk:5 | ncd | 1629 |
| 22 | COPD diagnosis with spirometry and bronchodilator therapy | A | FULL | ncd:5 GRAPH:5 | ncd | 712 |
| 23 | WHO best buys cost effective interventions for noncommu... | A | FULL | ncd:10 | ncd | 680 |
| 24 | acute stroke treatment and secondary prevention | A | FULL | ncd:10 | ncd | 438 |
| 25 | abattoir licence annual renewal and suspension for hygi... | A | FULL | slgh:10 | slgh | 214 |
| 26 | meat inspection procedures on the slaughter line | A | FULL | slgh:10 | slgh | 300 |
| 27 | livestock transport animal welfare during the journey | A | FULL | slgh:10 | slgh | 171 |
| 28 | export certification of meat products for overseas trade | A | FULL | bali:3 govuk:3 slgh:2 GRAPH:2 | bali | 1434 |
| 29 | slaughter fees schedule and rates per animal | A | FULL | slgh:10 | slgh | 260 |
| 30 | penalty enforcement for licence breaches and unpaid rates | A | FULL | govuk:5 slgh:5 | govuk | 1481 |
| 31 | Waymo autonomous driving subsidiary profile | A | FULL | alpha:10 | alpha | 335 |
| 32 | Verily life sciences funding rounds and investors | A | FULL | alpha:10 | alpha | 225 |
| 33 | Google DeepMind division research organisation | A | FULL | alpha:5 resil:5 | alpha | 357 |
| 34 | consolidated balance sheets and capital allocation | A | FULL | alpha:5 govuk:5 | alpha | 943 |
| 35 | Google Cloud segment revenue and profitability | A | FULL | alpha:10 | alpha | 364 |
| 36 | Alphabet board of directors and independent chair | A | FULL | alpha:10 | alpha | 426 |
| 37 | ResilientAI Hub powered by GENIE-AI preventing violent ... | A | FULL | resil:10 | resil | 333 |
| 38 | violent extremism threatening SDG progress in Australia... | A | FULL | resil:10 | resil | 179 |
| 39 | subscription monetization model with incentives aligned... | A | FULL | alpha:5 resil:5 | alpha | 278 |
| 40 | five year projections for an SDG fueled legacy | A | FULL | alpha:5 resil:5 | alpha | 309 |
| 41 | measurable SDG progress metrics driving incentives and ... | A | FULL | alpha:4 govuk:3 resil:3 | alpha | 688 |
| 42 | partnership model for achieving the Sustainable Develop... | A | FULL | resil:10 | resil | 285 |
| 70 | constructing logical identifiers LIDs for PDS4 archive ... | A | BALI | bali:10 | bali | 718 |
| 71 | choosing antihypertensive drugs to treat high blood pre... | A | BALI | bali:10 | bali | 774 |
| 72 | Waymo autonomous driving subsidiary profile | A | BALI | bali:10 | bali | 1125 |
| 43 | air quality pollution and lung disease risk | B | FULL | ncd:10 | ncd | 496 |
| 44 | national cancer screening programmes for early detection | B | FULL | ncd:5 govuk:5 | ncd | 931 |
| 45 | food safety standards and hygiene inspections | B | FULL | govuk:5 slgh:5 | govuk | 903 |
| 46 | using artificial intelligence to improve healthcare ser... | B | FULL | alpha:5 resil:5 | alpha | 310 |
| 47 | company tax obligations and financial reporting | B | FULL | alpha:5 govuk:5 | alpha | 776 |
| 48 | travel advice for tropical island holidays | B | FULL | bali:4 govuk:3 GRAPH:3 | bali | 1282 |
| 49 | regulatory proceedings and antitrust compliance | B | FULL | alpha:4 govuk:3 slgh:3 | alpha | 6486 |
| 50 | weekly public health surveillance statistics reports | B | FULL | ncd:5 govuk:5 | ncd | 1192 |
| 73 | air quality pollution and lung disease risk | B | BALI | bali:10 | bali | 662 |
| 74 | company tax obligations and financial reporting | B | BALI | bali:10 | bali | 769 |
| 75 | travel advice for tropical island holidays | B | BALI | bali:10 | bali | 466 |
| 51 | fun in Indonesia | C | FULL | bali:5 GRAPH:5 | bali | 3796 |
| 52 | mental health | C | FULL | bali:3 ncd:3 govuk:2 GRAPH:2 | bali | 1251 |
| 53 | nutrition | C | FULL | solar:4 ncd:3 alpha:3 | solar | 627 |
| 54 | exercise | C | FULL | ncd:10 | ncd | 428 |
| 55 | genetic risk factors for cancer | C | FULL | ncd:10 | ncd | 441 |
| 56 | fun activities in Bali | C | FULL | bali:5 GRAPH:5 | bali | 765 |
| 57 | best beaches and surfing spots near Denpasar | C | FULL | bali:5 GRAPH:5 | bali | 938 |
| 58 | family holiday things to do in Ubud | C | FULL | GRAPH:10 | GRAPH | 8999 |
| 76 | fun in Indonesia | C | BALI | bali:10 | bali | 365 |
| 77 | genetic risk factors for cancer | C | BALI | bali:10 | bali | 626 |
| 59 | eCitizen digital payments for government services via m... | D | FULL | alpha:5 govuk:5 | alpha | 1409 |
| 60 | how to register a birth and get a birth certificate | D | FULL | govuk:10 | govuk | 778 |
| 61 | applying for a Kenyan passport | D | FULL | govuk:10 | govuk | 612 |
| 62 | how to get a national identity card | D | FULL | govuk:10 | govuk | 690 |
| 63 | Huduma service centres citizen services | D | FULL | govuk:10 | govuk | 732 |
| 78 | eCitizen digital payments for government services via m... | D | BALI | bali:10 | bali | 599 |
| 64 | Formula 1 technical regulations | E | FULL | bali:4 govuk:3 GRAPH:3 | bali | 872 |
| 65 | Antarctic Treaty environmental protection | E | FULL | bali:5 GRAPH:5 | bali | 678 |
| 66 | quantum computing error correction | E | FULL | resil:10 | resil | 204 |
| 67 | French Bordeaux wine regions and vintages | E | FULL | bali:5 GRAPH:5 | bali | 819 |
| 68 | K-pop idol training industry | E | FULL | bali:5 GRAPH:5 | bali | 906 |
| 69 | Swiss private banking secrecy laws | E | FULL | bali:4 govuk:3 GRAPH:3 | bali | 1089 |
| 79 | quantum computing error correction | E | BALI | bali:10 | bali | 309 |

## 2. Category stats

### A — repo-distinct (42 FULL queries, 6 per repo x 7 repos)

- Target repo contributed >=1 hit: **40/42 (95%)**
- Target repo is top-1: **35/42 (83%)**
- Mean share of target-repo hits among the 10: **74.8%**
- Target-dominant (>=6/10): **24/42**; partial (1-5/10): **16/42**; target-absent (0/10): **2/42**
- Target-absent queries:
  - seq 9 `booking a prison visit and identification rules for visitors` (target govuk) -> GRAPH:10
  - seq 12 `Office of Rail and Road regulator duties` (target govuk) -> slgh:10
- Per-repo detail (target hits out of 10, per query):
  - bali    : [5, 5, 5, 5, 5, 5]  top-1 6/6
  - solar   : [4, 10, 10, 10, 10, 10]  top-1 6/6
  - ncd     : [10, 10, 5, 5, 10, 10]  top-1 6/6
  - alpha   : [10, 10, 5, 5, 10, 10]  top-1 6/6
  - govuk   : [10, 10, 0, 10, 10, 0]  top-1 4/6
  - slgh    : [10, 10, 10, 2, 10, 5]  top-1 4/6
  - resil   : [10, 10, 5, 5, 3, 10]  top-1 3/6
- Slot thieves (hits captured by non-target graphs across all 42 A queries):
  - GRAPH: 47 slots (44% of all stolen slots)
  - govuk: 21 slots (20%)
  - alpha: 17 slots (16%)
  - slgh: 10 slots (9%)
  - resil: 8 slots (8%)
  - bali: 3 slots (3%)

### B — cross-repo confusables (8 FULL queries)

| query | plausible repos | distribution | both contributed | top-1 |
|-------|-----------------|--------------|------------------|-------|
| air quality pollution and lung disease risk | ncd-vs-govuk | ncd:10 | NO | ncd |
| national cancer screening programmes for early detection | ncd-vs-govuk | ncd:5 govuk:5 | YES | ncd |
| food safety standards and hygiene inspections | slaughter-vs-govuk | govuk:5 slgh:5 | YES | govuk |
| using artificial intelligence to improve healthcare services | resilient-vs-ncd | alpha:5 resil:5 | NO | alpha |
| company tax obligations and financial reporting | alphabet-vs-govuk | alpha:5 govuk:5 | YES | alpha |
| travel advice for tropical island holidays | bali-vs-govuk | bali:4 govuk:3 GRAPH:3 | YES | bali |
| regulatory proceedings and antitrust compliance | alphabet-vs-govuk | alpha:4 govuk:3 slgh:3 | YES | alpha |
| weekly public health surveillance statistics reports | govuk-vs-ncd | ncd:5 govuk:5 | YES | ncd |

Both plausible repos contributed on 5/8; alpha gate-crashed as a third leg on "AI for healthcare" (alpha:5 resil:5, ncd got 0).

### C — adversarial / gate queries

| query | carrier | distribution | NCD hits |
|-------|---------|--------------|---------:|
| fun in Indonesia | FULL | bali:5 GRAPH:5 | 0 |
| mental health | FULL | bali:3 ncd:3 govuk:2 GRAPH:2 | 3 |
| nutrition | FULL | solar:4 ncd:3 alpha:3 | 3 |
| exercise | FULL | ncd:10 | 10 |
| genetic risk factors for cancer | FULL | ncd:10 | 10 |
| fun activities in Bali | FULL | bali:5 GRAPH:5 | 0 |
| best beaches and surfing spots near Denpasar | FULL | bali:5 GRAPH:5 | 0 |
| family holiday things to do in Ubud | FULL | GRAPH:10 | 0 |
| fun in Indonesia | BALI_ONLY | bali:10 | 0 |
| genetic risk factors for cancer | BALI_ONLY | bali:10 | 0 |

- `fun in Indonesia` (1-8a gate — NCD must contribute NOTHING): NCD = 0 FULL, 0 BALI_ONLY -> gate **PASSES** at retriever level
- `genetic risk factors for cancer` (positive gate — NCD expected): NCD = 10/10 FULL -> **PASSES**
- Suppressed band leaks today: `mental health` NCD 3/10, `nutrition` NCD 3/10, `exercise` NCD 10/10

### D — legacy GRAPH (Kenya gov services) provenance queries

| query | carrier | distribution | GRAPH hits | GRAPH top-1? |
|-------|---------|--------------|-----------:|--------------|
| eCitizen digital payments for government services via mobile money | FULL | alpha:5 govuk:5 | 0 | no |
| how to register a birth and get a birth certificate | FULL | govuk:10 | 0 | no |
| applying for a Kenyan passport | FULL | govuk:10 | 0 | no |
| how to get a national identity card | FULL | govuk:10 | 0 | no |
| Huduma service centres citizen services | FULL | govuk:10 | 0 | no |
| eCitizen ... (BALI_ONLY) | BALI | bali:10 | 0 | no |

GRAPH hits across the 5 FULL legacy-native queries: **0/50** — the legacy leg is effectively absent exactly where it is the wanted corpus. GRAPH never outranked an OKF graph anywhere in category D.

### E — out-of-corpus negatives

- Zero-hit rate: **0/79 = 0%** — the retriever never refuses; every out-of-corpus query returns 10 confident-looking chunks. No abstention signal exists at retriever level.

| query | carrier | distribution (false-positive routing) |
|-------|---------|----------------------------------------|
| Formula 1 technical regulations | FULL | bali:4 govuk:3 GRAPH:3 |
| Antarctic Treaty environmental protection | FULL | bali:5 GRAPH:5 |
| quantum computing error correction | FULL | resil:10 |
| French Bordeaux wine regions and vintages | FULL | bali:5 GRAPH:5 |
| K-pop idol training industry | FULL | bali:5 GRAPH:5 |
| Swiss private banking secrecy laws | FULL | bali:4 govuk:3 GRAPH:3 |
| quantum computing error correction | BALI_ONLY | bali:10 |

FULL-carrier slots captured on negatives: bali 23, GRAPH 21, resil 10, govuk 6 (of 60).

### F — BALI_ONLY re-runs vs the same query under FULL carrier

| query | cat | FULL distribution | BALI_ONLY distribution | what changed |
|-------|-----|-------------------|------------------------|--------------|
| constructing LIDs for PDS4 archive bundles | A | solar:4 alpha:3 resil:3 | bali:10 | alpha 3->0, bali 0->10, resil 3->0, solar 4->0 |
| choosing antihypertensive drugs | A | ncd:10 | bali:10 | ncd 10->0, bali 0->10 |
| Waymo autonomous driving subsidiary profile | A | alpha:10 | bali:10 | alpha 10->0, bali 0->10 |
| air quality pollution and lung disease risk | B | ncd:10 | bali:10 | ncd 10->0, bali 0->10 |
| company tax obligations and financial reporting | B | alpha:5 govuk:5 | bali:10 | alpha 5->0, govuk 5->0, bali 0->10 |
| travel advice for tropical island holidays | B | bali:4 govuk:3 GRAPH:3 | bali:10 | bali 4->10, govuk 3->0, GRAPH 3->0 |
| fun in Indonesia | C | bali:5 GRAPH:5 | bali:10 | bali 5->10, GRAPH 5->0 |
| genetic risk factors for cancer | C | ncd:10 | bali:10 | ncd 10->0, bali 0->10 |
| eCitizen digital payments | D | alpha:5 govuk:5 | bali:10 | alpha 5->0, govuk 5->0, bali 0->10 |
| quantum computing error correction | E | resil:10 | bali:10 | resil 10->0, bali 0->10 |

BALI_ONLY returns exactly 10 bali hits on every re-run — including Waymo, antihypertensives and eCitizen Kenya. It is a scope filter, not a relevance gate.

## 3. Findings

1. **Per-query relevance selection across repos is real but weak.** 20 distinct per-graph distributions across 69 FULL queries; top-1 spans 8 distinct graphs (bali 17, alpha 13, ncd 11, govuk 10, solar 7, slgh 5, resil 4, GRAPH 2). Same-repo query groups swing widely (govuk 0-10, slgh 2-10, resil 3-10, bali pinned at 5), so mixes are query-dependent — not a static interleave. But the dominant signature is still a rigid 2-graph tie.

2. **Mechanical 5/5 split — sharpened.** All 25 two-graph records are EXACTLY 5/5, zero deviations, across unrelated domains (bali/GRAPH, ncd/govuk, alpha/resil). Multi-graph records likewise quantize into recurring shapes: 7x 4/3/3 and 2x 3/3/2/2 (45 records are clean 10/10). Consistent with a per-graph quota/claim step in fusion rather than pure relevance ranking — unprovable from rank data alone, but score-ordering producing exact 5/5 in every two-graph case would be a remarkable coincidence.

3. **Head engagement is universal.** Every carrier head contributed hits (govuk 23, GRAPH 20, bali 17, alpha 15, ncd 13, resil 10, slgh 9, solar 7 of 69 queries) — fan-out reaches all heads; ranking is the problem, not routing.

4. **Legacy pollution is high and inverted.** 20/69 FULL queries (29%) contain >=1 legacy GRAPH chunk; GRAPH took 98 slots (~14% of all slots) and was top-1 twice (prison visit 10/10, Ubud holidays 10/10). Meanwhile the 5 legacy-native D queries got 0/50 GRAPH hits. The legacy leg is inversely relevant: absent when wanted, crowding in when not.

5. **Silent single-leg losses (candidates, not verdicts):** govuk target 0/10 on prison visit + Office of Rail and Road; govuk 0/10 on air quality (B); ncd 0/10 on AI-for-healthcare (B); GRAPH 0/10 on all five legacy-native D queries. Bali-leg zeros may partly reflect the ~50% drain; GRAPH and fully-ingested OKF zeros are real.

6. **Latency**: retrieval p50 732ms, p90 4492ms, max 9975ms (8 calls >4s, embed excluded). 6/8 slow calls have govuk or legacy GRAPH in the hit set; the two solar-target slow calls are the 10.0s max itself (PDS4 LIDs — a 3-graph 4/3/3 fan-out split) and 4.5s Saturn moons (clean 10/10). Small sample; no mechanism proven.

## 4. Caveats

- **One repo still draining**: bali ~50% ingested (21,591 chunks so far). Its true retrieval strength is underestimated; A-category bali numbers and the bali/GRAPH 5/5 ties will shift as ingest completes.
- **El Salvador excluded** — never drained, not in the carrier; no conclusion covers it (never appeared, as expected).
- **No similarity scores in the response**: the deployed retriever returns no score/distance field (verified: 0 occurrences in 26.5MB of raw responses). 'Top-1' is positional; outranked-by claims rest on rank order, not margins.
- **Metadata/doc alignment assumed by index** (metadata[i] <-> retrieved_docs[i]); lengths match 79/79, but the API exposes no join key.
- **Single run, no repeats** — per-query variance and latency percentiles are one-shot.
- **Documented payload is broken on the deployed image**: text-only requests 422 (pydantic requires embedding). The battery replicated production instead (TEI /embed with the bge query-instruction prefix) — results reflect the real call path, but the documented check-okf-repo.js flow does not work.
- **Response bloat**: every hit carries two full 1024-dim vectors (~400KB/response; 26.5MB for 79 calls).
- **What this cannot prove**: with bali half-drained and one run per query, the battery proves fan-out mechanics (provenance, carrier containment, no_legacy) and exposes ranking pathologies; it cannot quantify final-state relevance quality, score-margin behaviour, or prove the fusion-quota mechanism.