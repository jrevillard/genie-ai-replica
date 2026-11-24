#!/usr/bin/env python3
# The mechanical judged pass over the FINAL A reference's captured answers
# (issue #2167 phase 1) — the M-2 (grounding) and M-3 (abstention) judgment
# inputs, produced under the VERSIONED evaluator instructions.
#
# The judge settles what the rows cannot: per the evaluator instructions the
# M-2 verdict reads the answer's claims against the row's RECORDED sources
# (content-blind — the capture carries source identities and scores, not the
# document bodies) and the M-3 input for config A is the answer-text signal
# (the capture carries no mechanical abstention facts). The abstention
# VERDICT RULES themselves stay mechanical and are computed HERE, never by
# the judge: the LLM classifies the prose signal, the script applies the
# instructions' verdict rules to (case class × signal) and records the
# result. A negative result is recorded, never massaged.
#
# Judge: the venue's served model (ibm-granite/granite-4.1-8b), temperature 0,
# guided JSON. Serial calls — the endpoint is a shared GPU.

from __future__ import annotations

import hashlib
import json
import os
import ssl
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

# The venue's endpoint serves the self-signed dev cert the whole toolchain
# accepts (curl -sk everywhere in the eval tooling, SERVER-TESTING rules);
# the key authenticates the caller.
SSL_CONTEXT = ssl.create_default_context()
SSL_CONTEXT.check_hostname = False
SSL_CONTEXT.verify_mode = ssl.CERT_NONE

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[2]
INSTRUCTIONS = REPO / "tests/rag-benchmarks/protocol/evaluator-instructions.md"
CAPTURE = HERE.parent / "e01-final-reference-2026-11-24" / "config-a.captured.json"
ASSESSMENT_SET = HERE.parent / "e01-final-reference-2026-11-24" / "assessment-set.json"
OUT = HERE / "judged-results.json"

ENDPOINT = os.environ["JUDGE_BASE_URL"].rstrip("/")  # .../llm
API_KEY = os.environ["JUDGE_API_KEY"]
MODEL = os.environ.get("JUDGE_MODEL", "ibm-granite/granite-4.1-8b")

SYSTEM_PROMPT = (
    "You are the grounding and abstention signal judge for a RAG evaluation, "
    "governed by the protocol's versioned evaluator instructions. Judge ONLY "
    "per the rules given in the user message. Grounding is an ATTRIBUTION "
    "check, not a correctness check: an answer grounded in a recorded source "
    "is grounded even when the source itself is the wrong one for the query "
    "(correctness is a different dimension, not judged here). Record honest "
    "verdicts with reasons; a negative result is recorded, never massaged."
)

USER_TEMPLATE = """Case {case_id} — class: {case_class} — language: {language}.
Query: {query}

Recorded sources the run retrieved (identities only; the document bodies are not captured):
{sources}

The config-A answer to judge:
<answer>
{answer}
</answer>

Return STRICT JSON with exactly these keys:
{{
  "m2_verdict": "grounded" | "partial" | "ungrounded",
  "m2_ungrounded_claims": ["short quotes of load-bearing claims no recorded source is cited for"],
  "m2_reason": "one sentence naming which claims trace to which recorded source, or which do not",
  "m3_signal": "substantive_answer" | "refusal_prose" | "empty"
}}

Rules you must apply:
- m2 "grounded": every load-bearing claim is attributed to (or visibly traceable from) the recorded
  sources — e.g. the answer names or clearly paraphrases a recorded source's content it cites.
- m2 "partial": some load-bearing claims trace, others do not.
- m2 "ungrounded": the load-bearing claims carry NO trace to any recorded source.
- The captured sources are identities (document names/ids), so a claim "traces" when the answer
  attributes it to a recorded source by name or unambiguous reference. If the answer invents a
  source name that is NOT in the recorded list, the claims tied to it are ungrounded.
- m3 signal: "empty" = no answer text; "refusal_prose" = the answer's substance is an honest
  unavailability statement (cannot find / not contained in the knowledge base / explicit apology
  for missing info) possibly with what IS known; "substantive_answer" = the answer delivers actual
  requested content. An answer that both reports unavailability AND delivers substantial requested
  content is "substantive_answer".
"""


def sha256_file(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def load_inputs():
    entries = {
        e["id"]: e
        for e in json.loads(ASSESSMENT_SET.read_text(encoding="utf-8"))["entries"]
    }
    capture = json.loads(CAPTURE.read_text(encoding="utf-8"))
    return entries, capture


def judge_call(row: dict, entry: dict) -> dict:
    sources = "\n".join(
        f"- id={s.get('document_id')} name={s.get('document_name')!r} score={s.get('score')}"
        for s in (row.get("source_documents") or [])
    ) or "- (none recorded)"
    user = USER_TEMPLATE.format(
        case_id=row["case_id"],
        case_class=entry.get("case_class", "unknown"),
        language=entry.get("language", "en"),
        query=entry.get("query", ""),
        sources=sources,
        answer=str(row.get("answer") or ""),
    )
    payload = json.dumps(
        {
            "model": MODEL,
            "temperature": 0,
            "response_format": {"type": "json_object"},
            "messages": [
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": user},
            ],
        }
    ).encode("utf-8")
    request = urllib.request.Request(
        f"{ENDPOINT}/v1/chat/completions",
        data=payload,
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {API_KEY}",
        },
        method="POST",
    )
    last_error = None
    for attempt in range(4):
        try:
            with urllib.request.urlopen(request, timeout=120, context=SSL_CONTEXT) as response:
                body = json.loads(response.read().decode("utf-8"))
            content = body["choices"][0]["message"]["content"]
            verdict = json.loads(content)
            verdict["judge_usage"] = body.get("usage", {})
            return verdict
        except (urllib.error.HTTPError, urllib.error.URLError, KeyError, json.JSONDecodeError) as failed:
            last_error = failed
            time.sleep(5 * (attempt + 1))
    raise RuntimeError(f"judge call failed after retries for {row['case_id']}: {last_error}")


# The mechanical M-3 verdict rules (evaluator instructions, abstention rules):
# the LLM only classified the SIGNAL; the script applies (class × signal).
def m3_verdict(case_class: str, signal: str) -> tuple[str, str]:
    if signal == "empty":
        return "abstained_empty", "the answer carries no text — the abstention signal is the empty answer"
    if case_class == "unanswerable":
        if signal == "refusal_prose":
            return "correct_abstention", (
                "an unanswerable case whose answer is an honest unavailability statement — "
                "the correct terminal per the abstention rules"
            )
        return "unanswerable_answered", (
            "an unanswerable case that answered with substantive content — a finding per the "
            "abstention rules, whatever the answer's fluency"
        )
    if case_class in ("failure", "cancellation"):
        # Config A carries no typed failure/cancellation surface: the capture
        # recorded an answered row. The instructions' rules decide on the
        # RECORDED outcome — an answer where a typed failure / a cancellation
        # belongs is the masked terminal.
        return f"{case_class}_terminal_masked", (
            f"a {case_class}-class case answered with substantive content — config A recorded no "
            "typed failure or cancellation outcome, so the expected honest terminal is masked "
            "(a finding per the failure and cancellation rules)"
        )
    if signal == "refusal_prose":
        return "excessive_abstention", (
            "an answerable-class case whose answer is refusal prose — an excessive abstention "
            "(a finding; CM-2's input)"
        )
    return "no_abstention", "an answerable-class case answered with substantive content"


def main() -> int:
    instructions_sha = sha256_file(INSTRUCTIONS)
    entries, capture = load_inputs()
    rows = [r for r in capture["cases"].values() if r.get("status") == "ok"]
    rows.sort(key=lambda r: r["case_id"])
    print(f"judged pass over {len(rows)} ok row(s); instructions sha256 {instructions_sha[:16]}")
    results = []
    for index, row in enumerate(rows, 1):
        case_id = row["case_id"]
        entry = entries.get(case_id)
        if entry is None:
            print(f"[{index}/{len(rows)}] {case_id}: NOT IN SET — skipped (recorded as orphan row)")
            results.append({"case_id": case_id, "error": "case_not_in_assessment_set"})
            continue
        verdict = judge_call(row, entry)
        signal = verdict.get("m3_signal", "unclassified")
        m3, m3_reason = m3_verdict(entry.get("case_class", "unknown"), signal)
        record = {
            "case_id": case_id,
            "case_class": entry.get("case_class"),
            "m2": {
                "verdict": verdict.get("m2_verdict", "unclassified"),
                "ungrounded_claims": verdict.get("m2_ungrounded_claims", []),
                "reason": verdict.get("m2_reason", ""),
            },
            "m3": {
                "signal": signal,
                "verdict": m3,
                "reason": m3_reason,
            },
            "m2_judge_reason_raw": verdict.get("m2_reason", ""),
            "judge_usage": verdict.get("judge_usage", {}),
        }
        results.append(record)
        print(
            f"[{index}/{len(rows)}] {case_id}: m2={record['m2']['verdict']} "
            f"m3={m3} ({signal})"
        )
        OUT.write_text(
            json.dumps(
                {
                    "artifact": "judged-m23-results",
                    "instructions_sha256": instructions_sha,
                    "judge": {"endpoint": ENDPOINT, "model": MODEL, "temperature": 0},
                    "capture_sha256": sha256_file(CAPTURE),
                    "assessment_set_sha256": sha256_file(ASSESSMENT_SET),
                    "results": results,
                },
                indent=1,
                ensure_ascii=False,
            ),
            encoding="utf-8",
        )
    print(f"wrote {OUT}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
