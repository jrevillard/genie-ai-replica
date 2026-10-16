import json
recs = {r["seq"]: r for r in (json.loads(l) for l in open(r"D:\ITU-Gitlab\scripts\tmp-battery-raw.jsonl", encoding="utf-8"))}
for seq in (51, 53, 58, 9, 12, 66, 59, 76):
    r = recs[seq]
    body = r.get("body") or {}
    meta = body.get("metadata") or []
    docs = body.get("retrieved_docs") or []
    print("=== #%d [%s/%s] %r" % (seq, r["category"], r["carrier_label"], r["query"]))
    for i in range(min(4, len(docs))):
        g = (meta[i] or {}).get("graph_name") if i < len(meta) else "?"
        labels = (meta[i] or {}).get("chunk_labels")
        txt = (docs[i] or {}).get("text", "")[:110].replace("\n", " ")
        print("   %d. %-38s labels=%s %s" % (i + 1, g, labels, txt))
