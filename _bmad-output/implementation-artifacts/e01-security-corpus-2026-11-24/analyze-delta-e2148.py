#!/usr/bin/env python3
"""The campaign's delta report: the re-measured A reference vs the signed M-1 basis.

Reads the run's anchor report + capture + reference manifest and the E01
run's (the signed basis), prints the delta table for the issue report:
- the new corpus fingerprint + set digest vs the signed 6c9f7371…/58850161…;
- the aggregate recall/precision/noise delta (the corpus-shape numbers M-1
  signed on);
- per-query movement;
- the capture's case statuses (the security cases must still be skipped —
  that is the DESIGN answer to "does security_skip_rows still skip?");
- the verdict-level proof the security classes are no longer vacuous is the
  C leg's business (gated) — here we record the venue state that makes them
  judgeable: the restricted graph's chunk inventory + the injection markers'
  presence in the legacy corpus.
"""
import hashlib
import json
import sys
from pathlib import Path

RUN_DIR = Path(sys.argv[1])
E01_DIR = Path(sys.argv[2])
SET_PATH = Path(sys.argv[3])


def sha256_file(p):
    return hashlib.sha256(Path(p).read_bytes()).hexdigest()


new_report = json.loads((RUN_DIR / "config-a.report.json").read_text())
old_report = json.loads((E01_DIR / "config-a.report.json").read_text())
new_manifest = json.loads((RUN_DIR / "reference.manifest.json").read_text())
new_capture = json.loads((RUN_DIR / "config-a.captured.json").read_text())

old_agg = old_report["aggregate"]
new_agg = new_report["aggregate"]
print("== corpus identity ==")
print("old (signed): corpus 6c9f73719c0451cdcbca19e5e6… set 58850161afeb…")
print("new corpus fingerprint:", new_manifest["corpus"].get("fingerprint", "?")[:16], "…")
print("new set sha256:", new_manifest["sets"]["assessment"]["sha256"][:16], "…")
print("set file sha (computed):", sha256_file(SET_PATH)[:16], "…")
print()
print("== M-1 aggregate delta (the anchor surface) ==")
keys = ["recall", "precision", "complete_recall", "noise", "retrieval_recall",
        "recall_at_1", "recall_at_3", "recall_at_5", "recall_at_10",
        "ndcg_at_1", "ndcg_at_3", "ndcg_at_5", "ndcg_at_10"]
print(f"{'metric':<20} {'signed':>8} {'new':>8} {'delta':>8}")
for k in keys:
    o, n = old_agg.get(k), new_agg.get(k)
    if o is None or n is None:
        print(f"{k:<20} {str(o):>8} {str(n):>8} {'n/a':>8}")
    else:
        print(f"{k:<20} {o:>8.3f} {n:>8.3f} {n - o:>+8.3f}")
print("n:", old_agg.get("n"), "->", new_agg.get("n"),
      "| missed traces:", old_report.get("n_missed_traces"), "->", new_report.get("n_missed_traces"))
print()
print("== per-query movement (gold-bearing queries) ==")
old_by_id = {r["id"]: r for r in old_report["per_query"]}
for r in new_report["per_query"]:
    o = old_by_id.get(r["id"])
    if not o:
        continue
    if abs(o["recall"] - r["recall"]) > 1e-9 or abs(o["noise"] - r["noise"]) > 1e-9:
        print(f"  {r['id']}: recall {o['recall']:.2f}->{r['recall']:.2f} noise {o['noise']:.2f}->{r['noise']:.2f} "
              f"selected {len(o['selected'])}->{len(r['selected'])}")
print()
print("== capture: the security-skip answer (config A) ==")
rows = new_capture.get("cases", {})
# the capture rows stamp the skip as ``status: "skipped"`` (protocol/drivers.py);
# ``outcome`` is the verdicts-structure vocabulary and is absent on capture rows.
skipped = [cid for cid, r in rows.items() if r.get("status") == "skipped"]
answered = [cid for cid, r in rows.items() if r.get("http_status", 0) == 200]
other = [cid for cid in rows if cid not in skipped and cid not in answered]
print("skipped rows:", len(skipped), "(the security scenarios; reason recorded, never silent)")
for cid in skipped:
    print("  ", cid, "-", rows[cid].get("reason", "")[:80])
print("answered rows:", len(answered), "| other:", other)
print()
print("== capture stamp ==")
print(json.dumps(new_capture.get("capture", {}), indent=1))
