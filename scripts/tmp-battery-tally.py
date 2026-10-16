import json
EXP = {"bali": "OKF_bali_v1", "govuk": "OKF_www-gov-uk-full-crawl_v3", "solar": "OKF_solar-system_v1",
       "ncd": "OKF_ncd-information_v1", "slaughter": "OKF_slaugherhouse-heuristics_v7",
       "alphabet": "OKF_alphabet-company-information_v1", "resilient": "OKF_resilient-ai-hub_v1",
       "kenya": "GRAPH"}
recs = [json.loads(l) for l in open(r"D:\ITU-Gitlab\scripts\tmp-battery-raw.jsonl", encoding="utf-8")]
tally = {}
for r in recs:
    if r["carrier_label"] != "FULL":
        continue
    exp = EXP.get(r["repo_hint"])
    dist = r.get("graph_distribution") or {}
    share = dist.get(exp, 0) if exp else None
    cat = r["category"]
    tally.setdefault(cat, {"n": 0, "dom": 0, "part": 0, "abs": 0})
    tally[cat]["n"] += 1
    if exp is None:
        continue
    if share >= 6:
        tally[cat]["dom"] += 1
    elif share >= 1:
        tally[cat]["part"] += 1
    else:
        tally[cat]["abs"] += 1
for cat, t in sorted(tally.items()):
    print("%s: n=%d target-dominant(>=6/10)=%d partial(1-5)=%d target-absent=%d" % (cat, t["n"], t["dom"], t["part"], t["abs"]))
print()
for r in recs:
    if r["carrier_label"] == "FULL" and r["repo_hint"] in EXP and (r.get("graph_distribution") or {}).get(EXP[r["repo_hint"]], 0) == 0:
        print("  TARGET-ABSENT: #%d %s %r -> %s" % (r["seq"], r["category"], r["query"], json.dumps(r["graph_distribution"])))
