# Copyright (C) 2025 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0
"""LLM routing of user questions to taxonomy labels before Arango retrieval.

Used when the client does not send explicit service context. Configurable via
``CHATQNA_AUTO_ROUTE`` and confidence thresholds."""

from __future__ import annotations

import json
import logging
import os
import re
from typing import Any

import httpx

logger = logging.getLogger("genie.context_auto_router")

CHATQNA_AUTO_ROUTE = os.getenv("CHATQNA_AUTO_ROUTE", "true").lower() in ("1", "true", "yes")
CHATQNA_AUTO_ROUTE_HIGH = float(os.getenv("CHATQNA_AUTO_ROUTE_CONF_HIGH", "0.65"))
CHATQNA_AUTO_ROUTE_LOW = float(os.getenv("CHATQNA_AUTO_ROUTE_CONF_LOW", "0.35"))
ROUTER_MODEL = os.getenv("CHATQNA_ROUTER_MODEL", "").strip() or os.getenv(
    "LLM_MODEL", "meta-llama/Meta-Llama-3.1-8B-Instruct"
)
ROUTER_MAX_TOKENS = int(os.getenv("CHATQNA_ROUTER_MAX_TOKENS", "320"))


def last_user_plain_text(messages: Any) -> str:
    if not isinstance(messages, list):
        return ""
    for msg in reversed(messages):
        if not isinstance(msg, dict):
            continue
        if msg.get("role") != "user":
            continue
        content = msg.get("content")
        if isinstance(content, str) and content.strip():
            return content.strip()
    return ""


def taxonomy_prompt_lines(categories: list) -> str:
    lines: list[str] = []
    for cat in categories or []:
        if not isinstance(cat, dict):
            continue
        cname = (cat.get("name") or cat.get("nameEN") or "").strip()
        if not cname:
            continue
        children = cat.get("children") or []
        svc_parts: list[str] = []
        for ch in children:
            if isinstance(ch, str) and ch.strip():
                svc_parts.append(ch.strip())
            elif isinstance(ch, dict):
                sn = (ch.get("name") or ch.get("nameEN") or "").strip()
                if sn:
                    svc_parts.append(sn)
        svc_txt = ", ".join(svc_parts) if svc_parts else "(none listed)"
        lines.append(f"- Category: {cname}. Services: {svc_txt}")
    return "\n".join(lines)


def _parse_router_json(text: str) -> dict[str, Any] | None:
    if not text or not isinstance(text, str):
        return None
    t = text.strip()
    fence = re.search(r"```(?:json)?\s*([\s\S]*?)```", t)
    if fence:
        t = fence.group(1).strip()
    try:
        return json.loads(t)
    except json.JSONDecodeError:
        m = re.search(r"\{[\s\S]*\}", t)
        if not m:
            return None
        try:
            return json.loads(m.group(0))
        except json.JSONDecodeError:
            return None


def _label_count(category_label: str | None, service_labels: list[str] | None) -> int:
    n = 0
    if category_label and str(category_label).strip():
        n += 1
    for s in service_labels or []:
        if isinstance(s, str) and s.strip():
            n += 1
    return n


def _norm_block(b: Any) -> dict[str, Any] | None:
    if not isinstance(b, dict):
        return None
    cat = b.get("categoryLabel")
    cat = cat.strip() if isinstance(cat, str) and cat.strip() else None
    svcs = b.get("serviceLabels") or []
    if not isinstance(svcs, list):
        svcs = []
    svcs = [s.strip() for s in svcs if isinstance(s, str) and s.strip()][:6]
    conf = b.get("confidence", 0.0)
    try:
        conf = float(conf)
    except (TypeError, ValueError):
        conf = 0.0
    conf = max(0.0, min(1.0, conf))
    return {"categoryLabel": cat, "serviceLabels": svcs, "confidence": conf}


async def classify_route_for_query(
    *,
    question: str,
    taxonomy_lines: str,
    llm_host: str,
    llm_port: int,
    api_key: str | None,
) -> dict[str, Any]:
    if not question or not question.strip():
        return {"error": "empty_question", "primary": None}

    sys = (
        "You classify a user question for a government services knowledge base. "
        "Pick the single best category and 0-4 service names from the taxonomy lines only "
        "(use exact strings from the taxonomy). Output strictly one JSON object, no markdown, keys:\n"
        '{"categoryLabel":"string or null","serviceLabels":["..."],"confidence":0.0-1.0,'
        '"secondary":{"categoryLabel":"string or null","serviceLabels":[],"confidence":0.0-1.0} or null}\n'
        "If unsure, set confidence below 0.4 and use few or zero serviceLabels. "
        "Use null category only if no category fits."
    )
    user = f"TAXONOMY (pick ONLY from here):\n{taxonomy_lines}\n\nUSER_QUESTION:\n{question}"

    payload = {
        "model": ROUTER_MODEL,
        "messages": [
            {"role": "system", "content": sys},
            {"role": "user", "content": user},
        ],
        "temperature": 0,
        "max_tokens": ROUTER_MAX_TOKENS,
        "stream": False,
    }
    url = f"http://{llm_host}:{llm_port}/v1/chat/completions"
    headers = {"Content-Type": "application/json"}
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"

    try:
        async with httpx.AsyncClient(timeout=20.0) as client:
            resp = await client.post(url, json=payload, headers=headers)
            resp.raise_for_status()
            data = resp.json()
            content = data["choices"][0]["message"]["content"]
    except Exception as e:
        logger.warning("context_auto_router: LLM call failed: %s", e)
        return {"error": str(e), "primary": None}

    parsed = _parse_router_json(content)
    if not parsed:
        logger.warning("context_auto_router: failed to parse JSON from classifier")
        return {"error": "parse_failed", "raw": (content or "")[:500], "primary": None}

    primary = _norm_block(parsed)
    sec_raw = parsed.get("secondary")
    secondary = _norm_block(sec_raw) if sec_raw else None
    return {"primary": primary, "secondary": secondary, "raw": (content or "")[:800]}


def build_retrieval_from_route(
    *,
    base_context: dict[str, Any],
    route: dict[str, Any],
) -> tuple[dict[str, Any], dict[str, Any], str | None]:
    lang = base_context.get("language") or "EN"
    routing_meta: dict[str, Any] = {"mode": "auto_broad", "classifier_error": route.get("error")}

    if route.get("primary") is None and route.get("error"):
        rc = {"categoryLabel": "General", "serviceLabels": [], "language": lang}
        routing_meta["mode"] = "auto_broad"
        routing_meta["reason"] = "classifier_failed"
        return rc, routing_meta, None

    p = route.get("primary")
    if not p:
        rc = {"categoryLabel": "General", "serviceLabels": [], "language": lang}
        routing_meta["reason"] = "no_primary"
        return rc, routing_meta, None

    conf = float(p.get("confidence", 0.0))
    s = route.get("secondary")
    routing_meta["primary"] = p
    routing_meta["secondary"] = s
    routing_meta["confidence"] = conf

    if conf >= CHATQNA_AUTO_ROUTE_HIGH:
        cat = p.get("categoryLabel") or "General"
        svcs = list(p.get("serviceLabels") or [])
        routing_meta["mode"] = "auto_filtered"
        rc = {"categoryLabel": cat, "serviceLabels": svcs, "language": lang}
        nlab = _label_count(cat, svcs)
        fs = "OR" if nlab > 1 else None
        return rc, routing_meta, fs

    if conf >= CHATQNA_AUTO_ROUTE_LOW:
        cat = p.get("categoryLabel") or "General"
        merged = list(p.get("serviceLabels") or [])
        if s and isinstance(s, dict):
            for x in s.get("serviceLabels") or []:
                if isinstance(x, str) and x.strip() and x.strip() not in merged:
                    merged.append(x.strip())
        merged = merged[:6]
        routing_meta["mode"] = "auto_merged_top2"
        return (
            {"categoryLabel": cat, "serviceLabels": merged, "language": lang},
            routing_meta,
            "OR",
        )

    routing_meta["mode"] = "auto_broad"
    routing_meta["reason"] = "low_confidence"
    return {"categoryLabel": "General", "serviceLabels": [], "language": lang}, routing_meta, None


def strip_non_retrieval_keys(ctx: dict[str, Any]) -> dict[str, Any]:
    out: dict[str, Any] = {}
    for k in ("categoryLabel", "serviceLabels", "language"):
        if k not in ctx:
            continue
        v = ctx[k]
        if v is None:
            continue
        out[k] = v
    return out
