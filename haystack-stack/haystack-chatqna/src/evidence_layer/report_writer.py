"""
Evidence Layer — markdown report writer.

Writes timestamped reports to AMINA_EVIDENCE_REPORTS_DIR.
NO PHI. Only synthetic case ids, scores, and structural metadata.
"""
from __future__ import annotations

import json
import logging
import os
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from src.evidence_layer.config import AMINA_EVIDENCE_REPORTS_DIR
from src.evidence_layer.models import EvidenceEvalResult, EvidenceSummary

logger = logging.getLogger("evidence_layer.report_writer")


def _ensure_dir() -> str:
    base = AMINA_EVIDENCE_REPORTS_DIR
    try:
        os.makedirs(base, exist_ok=True)
        return base
    except Exception as e:
        logger.warning("[evidence] reports dir failed (%s), using /tmp: %s", base, e)
        fallback = "/tmp/amina_evidence_reports"
        os.makedirs(fallback, exist_ok=True)
        return fallback


def _fmt_pct(v) -> str:
    if v is None:
        return "n/a"
    try:
        return f"{float(v) * 100:.1f}%"
    except Exception:
        return "n/a"


def write_markdown_report(
    summary: EvidenceSummary,
    results: List[EvidenceEvalResult],
) -> str:
    """Write a markdown report. Returns the absolute path."""
    base = _ensure_dir()
    ts = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
    fname = f"evidence-eval-{ts}.md"
    path = os.path.join(base, fname)

    lines: List[str] = []
    lines.append(f"# AMINA Evidence Layer — Synthetic Eval Report")
    lines.append("")
    lines.append(f"- Generated: `{summary.finished_at or ts}` UTC")
    lines.append(f"- Duration: `{summary.duration_s if summary.duration_s is not None else 'n/a'}` seconds")
    lines.append(f"- Cases run: **{summary.total}**")
    lines.append(f"- Passed: **{summary.passed}**")
    lines.append(f"- Failed: **{summary.failed}**")
    lines.append(f"- Critical failures: **{summary.critical_failures}**")
    lines.append("")
    lines.append("## Aggregate Pass Rates")
    lines.append("")
    lines.append("| Metric | Score |")
    lines.append("|---|---|")
    lines.append(f"| Overall                  | {_fmt_pct(summary.overall_pass_rate)} |")
    lines.append(f"| Emergency surface        | {_fmt_pct(summary.emergency_pass_rate)} |")
    lines.append(f"| Privacy guard (guests)   | {_fmt_pct(summary.privacy_pass_rate)} |")
    lines.append(f"| Medication safety        | {_fmt_pct(summary.medication_safety_pass_rate)} |")
    lines.append("")
    if summary.notes:
        lines.append("## Notes")
        for n in summary.notes:
            lines.append(f"- {n}")
        lines.append("")

    lines.append("## Per-case Results")
    lines.append("")
    lines.append("| ID | Domain | Severity | Pass | Triage | Emergency | Privacy | Reason |")
    lines.append("|---|---|---|---|---|---|---|---|")
    for r in results:
        lines.append(
            f"| `{r.case_id}` | {r.domain} | {r.severity} | "
            f"{'✅' if r.passed else '❌'} | "
            f"{'—' if r.triage_match is None else ('✅' if r.triage_match else '❌')} | "
            f"{'—' if r.emergency_check_passed is None else ('✅' if r.emergency_check_passed else '❌')} | "
            f"{'✅' if r.privacy_check_passed else '❌'} | "
            f"{(r.reason or '')[:140]} |"
        )
    lines.append("")
    lines.append("## Privacy Statement")
    lines.append("")
    lines.append("This report contains only synthetic protocol-derived test cases. "
                 "No real patient messages, identifiers, or PHI are included. "
                 "Hashes used elsewhere by the layer (session/patient) are not "
                 "reproduced in this document.")

    body = "\n".join(lines) + "\n"
    try:
        with open(path, "w", encoding="utf-8") as f:
            f.write(body)
    except Exception as e:
        logger.warning("[evidence] report write to %s failed: %s", path, e)
        # Last-resort fallback
        path = os.path.join("/tmp", fname)
        with open(path, "w", encoding="utf-8") as f:
            f.write(body)
    return path


def find_latest_report() -> str:
    """Return path of the most recently modified evidence-eval-*.md or ''."""
    base = AMINA_EVIDENCE_REPORTS_DIR
    if not os.path.isdir(base):
        return ""
    try:
        candidates = [
            os.path.join(base, f)
            for f in os.listdir(base)
            if f.startswith("evidence-eval-") and f.endswith(".md")
        ]
    except Exception:
        return ""
    if not candidates:
        return ""
    candidates.sort(key=lambda p: os.path.getmtime(p), reverse=True)
    return candidates[0]


# ── JSON sidecar — structured data for the admin UI ────────────────
def write_json_report(
    summary: EvidenceSummary,
    results: List[EvidenceEvalResult],
    *,
    md_path: Optional[str] = None,
) -> str:
    """Write a JSON sidecar so the UI can render the report without
    having to parse markdown. Filename mirrors the markdown one.
    Returns the absolute path."""
    base = _ensure_dir()
    if md_path:
        fname = os.path.basename(md_path).replace(".md", ".json")
    else:
        ts = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
        fname = f"evidence-eval-{ts}.json"
    path = os.path.join(base, fname)
    payload = {
        "summary": summary.to_dict(),
        "results": [r.to_dict() for r in results],
        "version": 1,
    }
    body = json.dumps(payload, default=str, ensure_ascii=False, indent=2)
    try:
        with open(path, "w", encoding="utf-8") as f:
            f.write(body)
    except Exception as e:
        logger.warning("[evidence] json report write to %s failed: %s", path, e)
        path = os.path.join("/tmp", fname)
        with open(path, "w", encoding="utf-8") as f:
            f.write(body)
    return path


def _safe_filename(name: str) -> Optional[str]:
    """Reject any path traversal attempts. Only allow simple
    `evidence-eval-*.json` / `.md` filenames in the reports dir."""
    if not name:
        return None
    if "/" in name or "\\" in name or ".." in name:
        return None
    if not name.startswith("evidence-eval-"):
        return None
    if not (name.endswith(".md") or name.endswith(".json")):
        return None
    return name


def list_reports(limit: int = 20) -> List[Dict[str, Any]]:
    """Return the most-recent eval reports with structured metadata.

    Each entry: {filename_md, filename_json|None, mtime, score, total,
                 passed, failed, critical_failures, duration_s}.
    Score / counts come from the JSON sidecar when present.
    """
    base = AMINA_EVIDENCE_REPORTS_DIR
    if not os.path.isdir(base):
        return []
    try:
        files = os.listdir(base)
    except Exception:
        return []

    md_paths = [f for f in files if f.startswith("evidence-eval-") and f.endswith(".md")]
    md_paths.sort(key=lambda f: os.path.getmtime(os.path.join(base, f)), reverse=True)
    md_paths = md_paths[:max(1, min(int(limit or 20), 100))]

    out: List[Dict[str, Any]] = []
    for md in md_paths:
        full = os.path.join(base, md)
        json_name = md.replace(".md", ".json")
        json_path = os.path.join(base, json_name) if json_name in files else None

        entry: Dict[str, Any] = {
            "filename_md":   md,
            "filename_json": json_name if json_path else None,
            "mtime":         _format_mtime(full),
            "size_bytes":    _safe_size(full),
        }
        if json_path:
            try:
                with open(json_path, "r", encoding="utf-8") as f:
                    payload = json.load(f)
                s = (payload or {}).get("summary") or {}
                entry.update({
                    "score":             s.get("overall_pass_rate"),
                    "total":             s.get("total"),
                    "passed":            s.get("passed"),
                    "failed":            s.get("failed"),
                    "critical_failures": s.get("critical_failures"),
                    "duration_s":        s.get("duration_s"),
                    "started_at":        s.get("started_at"),
                    "finished_at":       s.get("finished_at"),
                })
            except Exception as e:
                logger.debug("[evidence] could not parse json sidecar %s: %s", json_path, e)
        out.append(entry)
    return out


def read_report_bundle(filename: str) -> Optional[Dict[str, Any]]:
    """Return both markdown body and structured JSON for a given report
    filename (either the .md or the .json basename). Refuses path
    traversal. Returns None when the file is missing."""
    safe = _safe_filename(filename)
    if not safe:
        return None
    base = AMINA_EVIDENCE_REPORTS_DIR
    md_name   = safe if safe.endswith(".md")   else safe.replace(".json", ".md")
    json_name = safe if safe.endswith(".json") else safe.replace(".md",   ".json")
    md_path   = os.path.join(base, md_name)
    json_path = os.path.join(base, json_name)

    bundle: Dict[str, Any] = {
        "filename_md":   md_name,
        "filename_json": json_name if os.path.isfile(json_path) else None,
        "markdown":      None,
        "summary":       None,
        "results":       None,
    }
    if os.path.isfile(md_path):
        try:
            with open(md_path, "r", encoding="utf-8") as f:
                bundle["markdown"] = f.read()
        except Exception as e:
            logger.warning("[evidence] read md %s failed: %s", md_path, e)
    if os.path.isfile(json_path):
        try:
            with open(json_path, "r", encoding="utf-8") as f:
                payload = json.load(f)
            bundle["summary"] = (payload or {}).get("summary")
            bundle["results"] = (payload or {}).get("results")
        except Exception as e:
            logger.warning("[evidence] read json %s failed: %s", json_path, e)

    if bundle["markdown"] is None and bundle["summary"] is None:
        return None
    return bundle


def _format_mtime(path: str) -> Optional[str]:
    try:
        ts = os.path.getmtime(path)
        return datetime.fromtimestamp(ts, tz=timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    except Exception:
        return None


def _safe_size(path: str) -> Optional[int]:
    try:
        return os.path.getsize(path)
    except Exception:
        return None
