#!/usr/bin/env python3
"""Read-only probe of the deployed OPEA query path (story 1.1, V02).

The probe answers one question: "what does the running stack ACTUALLY do on
the query path?". It therefore reads the deployed configuration from the
running pods (never from the repository defaults) and exercises the deployed
preparation code for three locales, including one non-Latin script.

It is strictly read-only:

* it never writes to ArangoDB, Keycloak or any service;
* it never restarts, scales or patches a workload;
* it only issues ``kubectl get`` and ``kubectl exec`` reads, plus the
  read-only inference calls the deployed preparation code already makes
  (language detection and history translation).

Usage:

    scripts/baselines/probe-v02-query-path.py [--namespace genieai] [--out FILE]
    scripts/baselines/probe-v02-query-path.py --verify docs/baselines/v02-opea-query-path-contract.fixtures.json

Without ``--verify`` it prints one JSON document on stdout. With ``--verify``
it compares the live measurement against a recorded fixtures file and exits
non-zero when the deployment drifted. The record that consumes it lives in
``docs/baselines/v02-opea-query-path-contract.md``.
"""

from __future__ import annotations

import argparse
import json
import os
import shlex
import subprocess
import sys
from datetime import datetime, timezone

# The knobs the V02 record is about. Every one of them is read from the
# running pod, so the record states the deployed value, not the repository
# default.
ENV_KNOBS = [
    # retriever
    "ARANGO_DB",
    "ARANGO_GRAPH_NAME",
    "ARANGO_URL",
    "RETRIEVER_ARANGO_SEARCH_MODE",
    "RETRIEVER_ARANGO_SEARCH_START",
    "RETRIEVER_ARANGO_DISTANCE_STRATEGY",
    "RETRIEVER_ARANGO_DISTANCE_THRESHOLD",
    "RETRIEVER_ARANGO_FETCH_K",
    "RETRIEVER_ARANGO_K",
    "RETRIEVER_ARANGO_LAMBDA_MULT",
    "RETRIEVER_ARANGO_NUM_CENTROIDS",
    "RETRIEVER_ARANGO_SCORE_THRESHOLD",
    "RETRIEVER_ARANGO_USE_APPROX_SEARCH",
    "RETRIEVER_ARANGO_FILTER_STRATEGY",
    "RETRIEVER_ARANGO_TRAVERSAL_ENABLED",
    "RETRIEVER_ARANGO_TRAVERSAL_MAX_DEPTH",
    "RETRIEVER_ARANGO_TRAVERSAL_MAX_RETURNED",
    "RETRIEVER_ARANGO_TRAVERSAL_SCORE_THRESHOLD",
    "RETRIEVER_HYBRID_RETRIEVAL_ENABLED",
    "RETRIEVER_HYBRID_BM25_ANALYZER",
    "RETRIEVER_HYBRID_BM25_CANDIDATES",
    "RETRIEVER_HYBRID_RRF_K",
    "RETRIEVER_HYBRID_DENSE_WEIGHT",
    "RETRIEVER_HYBRID_LEXICAL_WEIGHT",
    "RETRIEVER_FANOUT_ENABLED",
    "RETRIEVER_FANOUT_MAX_GRAPHS",
    "RETRIEVER_FANOUT_PER_GRAPH_TIMEOUT_MS",
    "RETRIEVER_FANOUT_CANDIDATE_CAP_GLOBAL",
    "RETRIEVER_FANOUT_CANDIDATE_CAP_PER_GRAPH",
    "RETRIEVER_ROUTE_ENABLED",
    "RETRIEVER_ROUTE_TOP_K",
    "RETRIEVER_ROUTE_MIN_CHUNKS",
    "RETRIEVER_ROUTE_PROBE_TIMEOUT_MS",
    "RETRIEVER_ROUTE_RETRY",
    "RETRIEVER_ROUTE_HEAD_WEIGHT",
    "RETRIEVER_ROUTE_HEAD_MARGIN",
    "RETRIEVER_ROUTE_HEAD_FLOOR",
    "RETRIEVER_ROUTE_FORBIDDEN_TAG_MAX",
    "RETRIEVER_ROUTE_HEADS_SUPERSEDE",
    # embedding / query instruction
    "TEI_EMBED_MODEL",
    "TEI_EMBEDDING_ENDPOINT",
    "EMBEDDING_MODEL_ID",
    "EMBEDDING_MODEL_ENDPOINT",
    "EMBEDDING_QUERY_INSTRUCTIONS",
    # reranking
    "RERANKING_STRATEGY",
    "RERANKING_THRESHOLD",
    "RERANKER_TOP_N",
    "RERANKER_SCORE_CALIBRATION",
    "RERANKER_SCORE_TEMPERATURE",
    # preparation
    "VLLM_TRANSLATION_ENDPOINT",
    "VLLM_TRANSLATION_MODEL_ID",
    "TRANSLATION_SERVICE_HOST_IP",
    "TRANSLATION_SERVICE_PORT",
    "TRANSLATION_SERVICE_TIMEOUT",
    "LANGUAGE_REGISTRY_FILEPATH",
    "MAX_TRANSLATION_CHARS",
    "MULTI_TURN_MODE",
    "MULTI_TURN_HISTORY_TURNS",
    "MULTI_TURN_BLEND_ENABLED",
    "MULTI_TURN_BLEND_ALPHA",
    "MULTI_TURN_CONDENSE_HISTORY_TURNS",
]

# The locale samples the record covers. Three languages, one of them written
# in a non-Latin script, so the language-detection branch and the
# translate-to-English branch are both exercised.
LOCALE_SAMPLES = [
    {
        "locale": "fr",
        "text": (
            "Bonjour, comment la ville de Geneve gere-t-elle les services "
            "de transport public pour les habitants et les visiteurs ?"
        ),
    },
    {
        "locale": "es",
        "text": (
            "¿Como gestiona la ciudad de Barcelona los servicios de "
            "transporte publico para los residentes y los visitantes?"
        ),
    },
    {
        "locale": "ar",
        "text": (
            "كيف تدير مدينة دبي خدمات النقل العام للسكان والزوار "
            "خلال موسم الصيف؟"
        ),
    },
]

# Runs INSIDE the chatqna container. It calls the deployed preparation code
# (the same functions the live query path calls) so the English string it
# reports is the string the embedder receives.
IN_POD_SOURCE = r'''
import asyncio
import json
import os
import sys

sys.path.insert(0, "/app")
sys.path.insert(0, "/app/ChatQnA")

from langdetect import detect

import genieai_chatqna as cq
from core.embedding_query_prefix import TEI_EMBED_MODEL, get_query_instruction

samples = json.loads(os.environ["V02_PROBE_SAMPLES"])
instruction = get_query_instruction(TEI_EMBED_MODEL)


async def probe():
    service = cq.ChatQnAService()
    results = []
    for sample in samples:
        text = sample["text"]
        detected = detect(text)
        codes = cq.language_codes_map()
        supported = bool(detected) and (detected.lower() in codes or detected.lower() == "en")
        detected_language = detected.upper() if detected else None
        history_language = detected_language or "EN"
        if history_language.strip() != "EN":
            english, status = await service._get_translated_history_string(
                text, source_lang_code=history_language.lower()
            )
        else:
            english, status = text, "passthrough_english"
        matches = cq.USER_MSG_PATTERN.findall(english)
        query = matches[-1].strip() if matches else ""
        if not query:
            query = english
        results.append(
            {
                "locale": sample["locale"],
                "sample": text,
                "detected_language": detected_language,
                "detected_supported": supported,
                "history_language": history_language,
                "query_translation_status": status,
                "english_history": english,
                "english_query": query,
                "embedded_text": (instruction + query) if instruction else query,
            }
        )
    return results


payload = {
    "model_id": TEI_EMBED_MODEL,
    "query_instruction": instruction,
    "supported_language_count": len(cq.language_codes_map()),
    "locales": asyncio.run(probe()),
}
print("@@V02@@" + json.dumps(payload, ensure_ascii=False))
'''


def run(cmd: list[str], stdin: str | None = None) -> str:
    proc = subprocess.run(cmd, input=stdin, capture_output=True, text=True, timeout=900)
    if proc.returncode != 0:
        raise RuntimeError(f"command failed: {' '.join(cmd)}\n{proc.stderr.strip()}")
    return proc.stdout


def find_pods(namespace: str) -> dict[str, str]:
    """Map service name -> running pod name."""
    raw = run(["kubectl", "-n", namespace, "get", "pods", "-o", "json"])
    pods = json.loads(raw)["items"]
    wanted = {
        "retriever": "umbrella-retriever-",
        "chatqna": "umbrella-chatqna-",
        "reranker": "umbrella-reranker-",
        "embedding": "umbrella-embedding-",
    }
    found: dict[str, str] = {}
    for pod in pods:
        if pod["status"]["phase"] != "Running":
            continue
        name = pod["metadata"]["name"]
        for service, marker in wanted.items():
            if service not in found and marker in name:
                found[service] = name
    return found


def pod_env(namespace: str, pod: str) -> dict[str, str]:
    raw = run(["kubectl", "-n", namespace, "exec", pod, "--", "env"])
    env = {}
    for line in raw.splitlines():
        if "=" not in line:
            continue
        key, value = line.split("=", 1)
        env[key] = value
    return env


def probe_locales(namespace: str, pod: str) -> dict:
    payload = shlex.quote(json.dumps(LOCALE_SAMPLES, ensure_ascii=False))
    cmd = [
        "kubectl",
        "-n",
        namespace,
        "exec",
        "-i",
        pod,
        "--",
        "sh",
        "-c",
        f"V02_PROBE_SAMPLES={payload} python3 -",
    ]
    out = run(cmd, stdin=IN_POD_SOURCE)
    for line in out.splitlines():
        if line.startswith("@@V02@@"):
            return json.loads(line[len("@@V02@@") :])
    raise RuntimeError(f"probe marker not found in chatqna output:\n{out[-2000:]}")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--namespace", default="genieai")
    parser.add_argument("--out", default=None, help="write the JSON document to this file too")
    parser.add_argument(
        "--verify",
        default=None,
        help="compare the live measurement against a recorded fixtures file and exit non-zero on drift",
    )
    args = parser.parse_args()

    pods = find_pods(args.namespace)
    missing = {"retriever", "chatqna", "reranker", "embedding"} - set(pods)
    if missing:
        print(f"missing running pods in namespace {args.namespace}: {sorted(missing)}", file=sys.stderr)
        return 2

    envs = {service: pod_env(args.namespace, pod) for service, pod in pods.items()}
    document = {
        "probe": "v02-opea-query-path",
        "recorded_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "namespace": args.namespace,
        "pods": pods,
        "deployed_env": {
            service: {knob: env.get(knob) for knob in ENV_KNOBS if knob in env}
            for service, env in envs.items()
        },
        "absent_knobs": {
            service: [knob for knob in ENV_KNOBS if knob not in env]
            for service, env in envs.items()
        },
    }
    document["preparation"] = probe_locales(args.namespace, pods["chatqna"])

    text = json.dumps(document, indent=2, ensure_ascii=False)
    if args.out:
        with open(args.out, "w", encoding="utf-8") as handle:
            handle.write(text + "\n")

    if args.verify:
        return verify(args.verify, document)

    print(text)
    return 0


def verify(fixtures_path: str, document: dict) -> int:
    """Compare the live measurement against a recorded fixtures file."""
    with open(fixtures_path, encoding="utf-8") as handle:
        recorded = json.load(handle)["measured"]

    drift = []
    for service, knobs in recorded["deployed_env"].items():
        live = document["deployed_env"].get(service, {})
        for knob, value in knobs.items():
            if live.get(knob) != value:
                drift.append(f"{service}.{knob}: recorded {value!r} -> live {live.get(knob)!r}")
        for knob in recorded.get("absent_knobs", {}).get(service, []):
            if knob in live:
                drift.append(f"{service}.{knob}: recorded absent -> live {live.get(knob)!r}")

    live_prep = document["preparation"]
    rec_prep = recorded.get("preparation", {})
    if live_prep.get("query_instruction") != rec_prep.get("query_instruction"):
        drift.append(
            f"query_instruction: recorded {rec_prep.get('query_instruction')!r} "
            f"-> live {live_prep.get('query_instruction')!r}"
        )
    for live_locale, rec_locale in zip(live_prep.get("locales", []), rec_prep.get("locales", [])):
        for field in ("locale", "detected_language", "query_translation_status"):
            if live_locale.get(field) != rec_locale.get(field):
                drift.append(
                    f"locale {rec_locale.get('locale')}.{field}: recorded {rec_locale.get(field)!r} "
                    f"-> live {live_locale.get(field)!r}"
                )

    if drift:
        print("DRIFT against the recorded V02 contract:")
        for line in drift:
            print(f"  - {line}")
        return 1
    print("V02 contract verified: the live deployment matches the recorded measurement.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
