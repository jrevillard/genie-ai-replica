#!/usr/bin/env python3
"""Regenerate the E01 assessment set with THIS campaign's venue identities.

Reads the hash-resolved extended set (the #2151 Phase-1 file after the
match_gold_chunks pass) and this run's ingestion ledger, then writes the
campaign's resolved set:

- every EXISTING ``context.authorized_source_ids`` entry is remapped from the
  ids the #2148 campaign's uploads generated (the inherited cases are
  byte-identical to that campaign's set) to the ids THIS run's uploads
  generated — the venue generates a fresh file id per upload;
- every graded restricted case (``e01g-``, ``access_scenario: restricted``)
  GAINS ``context.authorized_source_ids`` from its ``expected_chunks[]
  .source_doc`` fixture name (the #2151 README: the graded cases carry none,
  so the verdict layer's mechanical subset check stays inert until the
  campaign gives them the real vocabulary);
- ``_doc`` records the provenance.

Everything else is byte-identical: queries, gold (hashes INCLUDED — the
match pass already resolved them), case classes, languages, turn structure.
"""
import json
import re
import sys
from pathlib import Path

BASE_SET = Path(sys.argv[1])
LEDGER_2148 = Path(sys.argv[2])
LEDGER_2162 = Path(sys.argv[3])
OUT = Path(sys.argv[4])

data = json.loads(BASE_SET.read_text(encoding="utf-8"))
ledger_old = json.loads(LEDGER_2148.read_text(encoding="utf-8"))["uploads"]
ledger_new = json.loads(LEDGER_2162.read_text(encoding="utf-8"))["uploads"]

assert set(ledger_new) == {
    "doc-restricted-e01", "doc-shared-e01", "doc-wide-e01", "doc-revoked-e01",
    "doc-forestry-e01", "doc-catalogue-e01", "doc-servicerequest-e01",
}, ledger_new
OLD_TO_NEW = {old: ledger_new[key] for key, old in ledger_old.items() if old in set(ledger_old.values())}
assert len(OLD_TO_NEW) == 7, OLD_TO_NEW

# fixture filename -> ledger key: e01-sec-doc-restricted-e01.md -> doc-restricted-e01
DOC_KEY_RE = re.compile(r"^e01-sec-(doc-.*-e01)\.md$")

n_remapped = 0
n_added = 0
added_detail: list[str] = []

def remap_context(context: dict, case_id: str) -> None:
    global n_remapped, n_added
    source_ids = context.get("authorized_source_ids")
    if isinstance(source_ids, list) and source_ids:
        context["authorized_source_ids"] = [OLD_TO_NEW.get(sid, sid) for sid in source_ids]
        n_remapped += len(source_ids)

for case in data["entries"]:
    contexts = []
    if isinstance(case.get("context"), dict):
        contexts.append(case["context"])
    for turn in case.get("turns") or []:
        if isinstance(turn.get("context"), dict):
            contexts.append(turn["context"])

    for context in contexts:
        remap_context(context, case.get("id", "?"))

    # graded restricted cases gain their source ids from the gold's source_doc
    if (
        case.get("access_scenario") == "restricted"
        and str(case.get("id", "")).startswith("e01g-")
    ):
        doc_keys = sorted({
            m.group(1)
            for ch in (case.get("expected_chunks") or [])
            if isinstance(ch, dict)
            for m in [DOC_KEY_RE.match(ch.get("source_doc", ""))]
            if m
        })
        if doc_keys:
            context = case.setdefault("context", {})
            existing = context.get("authorized_source_ids") or []
            new_ids = [ledger_new[k] for k in doc_keys]
            context["authorized_source_ids"] = existing + [i for i in new_ids if i not in existing]
            n_added += len(doc_keys)
            added_detail.append(f"{case['id']}: {doc_keys}")

    if case.get("id") == "e01-sec-narrowed":
        labels = (case.get("context") or {}).get("requested_labels")
        assert labels == ["Natural Resources"], f"narrowed labels: {labels}"
    if case.get("id") == "e01-sec-restricted":
        print("restricted authorized ids:", (case.get("context") or {}).get("authorized_source_ids"))

data["_doc"] = (
    "E01 assessment set — the FINAL A-reference basis (issue #2162, "
    "2026-11-24). Derived from the #2151 acceptance-grade Phase-1 set "
    "(e01-assessment-grade-2026-11-24) after the campaign's two venue-"
    "resolution passes: (1) match_gold_chunks resolved every graded "
    "retrieval case's content_hash against the served `text` field of the "
    "seeded corpus (the #2153 pin); (2) the authorized_source_ids carry the "
    "file ids THIS run's uploads generated (the inherited cases' #2148 ids "
    "were remapped; the 14 graded restricted cases gained their ids from the "
    "gold's source_doc). The corpus: GRAPH_SOURCE holds the 3 "
    "test-document.md chunks plus the 2 injection fixtures (public corpus); "
    "GRAPH_RESTRICTED_E01 holds the 5 restricted fixtures, re-seeded for "
    "this campaign after #2148's cleanup retracted them. 67 cases; the set "
    "digest moves with the ids — the expected, documented outcome."
)

OUT.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
print(f"remapped {n_remapped} authorized source ids; added ids to {n_added} graded restricted cases")
for d in added_detail:
    print("  +", d)
print(f"wrote {OUT}")
