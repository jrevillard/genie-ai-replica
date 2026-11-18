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
    scripts/baselines/probe-v02-query-path.py \
        --verify docs/baselines/v02-opea-query-path-contract.fixtures.json

Without ``--verify`` it prints one JSON document on stdout. With ``--verify``
it compares the live measurement against a recorded fixtures file: a drift in
the DEPLOYED CONFIGURATION fails the check, while a difference in the sampled
locale strings is reported as a warning (the detector and the translation
model are not seeded, so those strings are a sample, not a contract).

The record that consumes it lives in
``docs/baselines/v02-opea-query-path-contract.md``.
"""

from __future__ import annotations

import argparse
import json
import shlex
import subprocess
import sys
from datetime import datetime, timezone

# The knobs the V02 record is about, per container. Every one of them is read
# from the running pod, so the record states the deployed value, not the
# repository default.
CONTAINER_KNOBS: dict[str, list[str]] = {
    "retriever": [
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
        "RETRIEVER_ARANGO_TRAVERSAL_CONCURRENT_BATCHES",
        "RETRIEVER_ARANGO_TRAVERSAL_MAX_LINKS",
        "RETRIEVER_ARANGO_TRAVERSAL_MAX_EDGES_PER_NODE",
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
        "TEI_EMBEDDING_ENDPOINT",
    ],
    "chatqna": [
        "RETRIEVER_ARANGO_SEARCH_START",
        "RETRIEVER_ARANGO_DISTANCE_THRESHOLD",
        "RETRIEVER_ARANGO_FETCH_K",
        "RETRIEVER_ARANGO_K",
        "RETRIEVER_ARANGO_LAMBDA_MULT",
        "RETRIEVER_ARANGO_SCORE_THRESHOLD",
        "RETRIEVER_ARANGO_TRAVERSAL_ENABLED",
        "RETRIEVER_ARANGO_TRAVERSAL_MAX_DEPTH",
        "RETRIEVER_ARANGO_TRAVERSAL_MAX_RETURNED",
        "RETRIEVER_ARANGO_TRAVERSAL_SCORE_THRESHOLD",
        "RERANKING_STRATEGY",
        "RERANKING_THRESHOLD",
        "RERANKER_TOP_N",
        "RERANKER_SCORE_CALIBRATION",
        "RERANKER_SCORE_TEMPERATURE",
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
        "TEI_EMBED_MODEL",
        "EMBEDDING_QUERY_INSTRUCTIONS",
    ],
    "reranker": [
        "RERANKING_STRATEGY",
        "RERANKING_THRESHOLD",
        "RERANKER_TOP_N",
    ],
    "embedding": [
        "TEI_EMBEDDING_ENDPOINT",
        "EMBEDDING_MODEL_ID",
        "EMBEDDING_MODEL_ENDPOINT",
    ],
    "backend": [
        "OPEA_HOST",
        "OPEA_PORT",
        "CONTEXT_OPTION",
        "TRANSLATION_BACKEND",
        "GPU_NODE_HOST",
        "VLLM_TRANSLATION_ENDPOINT",
        "VLLM_TRANSLATION_MODEL_ID",
        "STREAMING_TRANSLATION_ENABLED",
        "OPEA_STREAMING",
    ],
}

# The containers the probe reads, and the pod-name marker that identifies
# each of them.
CONTAINERS: dict[str, str] = {
    "retriever": "umbrella-retriever-",
    "chatqna": "umbrella-chatqna-",
    "reranker": "umbrella-reranker-",
    "embedding": "umbrella-embedding-",
    "backend": "umbrella-backend-",
}

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
                [{"role": "user", "content": text}], source_lang_code=history_language.lower()
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
    "translation_window": cq._get_translation_window(),
    "translation_char_budget": cq._get_max_translation_chars(),
    "locales": asyncio.run(probe()),
}
print("@@V02@@" + json.dumps(payload, ensure_ascii=False))
'''


class ProbeError(RuntimeError):
    """A probe step that could not be completed."""


def run(cmd: list[str], stdin: str | None = None) -> str:
    try:
        proc = subprocess.run(cmd, input=stdin, capture_output=True, text=True, timeout=900)
    except subprocess.TimeoutExpired as exc:
        raise ProbeError(f"command timed out after 900s: {' '.join(cmd)}") from exc
    except FileNotFoundError as exc:
        raise ProbeError(f"command not found: {cmd[0]} (is kubectl installed?)") from exc
    if proc.returncode != 0:
        raise ProbeError(f"command failed: {' '.join(cmd)}\n{proc.stderr.strip()}")
    return proc.stdout


def find_pods(namespace: str) -> dict[str, str]:
    """Map container name -> running pod name."""
    raw = run(["kubectl", "-n", namespace, "get", "pods", "-o", "json"])
    pods = json.loads(raw)["items"]
    found: dict[str, tuple[str, str]] = {}
    for pod in pods:
        if pod["status"]["phase"] != "Running":
            continue
        name = pod["metadata"]["name"]
        created = pod["metadata"].get("creationTimestamp", "")
        for container, marker in CONTAINERS.items():
            if marker not in name:
                continue
            # A rolling update leaves two Running pods of the same service
            # behind; the newest one is the one the Service routes to.
            if container not in found or created > found[container][1]:
                found[container] = (name, created)
    return {container: name for container, (name, _) in found.items()}


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
    raise ProbeError(f"probe marker not found in chatqna output:\n{out[-2000:]}")


def measure(namespace: str) -> dict:
    pods = find_pods(namespace)
    missing = sorted(set(CONTAINERS) - set(pods))
    if missing:
        raise ProbeError(f"missing running pods in namespace {namespace}: {', '.join(missing)}")

    envs = {container: pod_env(namespace, pod) for container, pod in pods.items()}
    document = {
        "probe": "v02-opea-query-path",
        "recorded_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "namespace": namespace,
        "pods": pods,
        "deployed_env": {
            container: {knob: env[knob] for knob in CONTAINER_KNOBS[container] if knob in env}
            for container, env in envs.items()
        },
        "absent_knobs": {
            container: [knob for knob in CONTAINER_KNOBS[container] if knob not in env]
            for container, env in envs.items()
        },
    }
    document["preparation"] = probe_locales(namespace, pods["chatqna"])
    return document


def verify(fixtures_path: str, document: dict) -> int:
    """Compare the live measurement against a recorded fixtures file."""
    with open(fixtures_path, encoding="utf-8") as handle:
        fixtures = json.load(handle)
    recorded = fixtures["measured"]

    drift: list[str] = []
    warnings: list[str] = []

    # 1. The recorded measurement must still match the deployment.
    for container, knobs in recorded["deployed_env"].items():
        live = document["deployed_env"].get(container, {})
        for knob, value in knobs.items():
            if live.get(knob) != value:
                drift.append(f"{container}.{knob}: recorded {value!r} -> live {live.get(knob)!r}")
        for knob in recorded.get("absent_knobs", {}).get(container, []):
            if knob in live:
                drift.append(f"{container}.{knob}: recorded absent -> live {live.get(knob)!r}")

    # 2. Every knob an expectation claims must be served by the named
    #    container, with the recorded value.
    expectations = fixtures.get("expectations", {})
    behaviors = expectations.get("behaviors", {})
    preparation = expectations.get("preparation", {})
    claims = dict(behaviors)
    claims["preparation"] = preparation
    for name, claim in claims.items():
        for container, knobs in (claim.get("deployed_knobs") or {}).items():
            live = document["deployed_env"].get(container, {})
            for knob, value in knobs.items():
                if knob not in live:
                    drift.append(f"{name}: {container}.{knob} is not served by the deployment")
                elif live[knob] != value:
                    drift.append(f"{name}: {container}.{knob} expected {value!r} -> live {live[knob]!r}")
        for container, knobs in (claim.get("absent_knobs") or {}).items():
            live = document["deployed_env"].get(container, {})
            for knob in knobs:
                if knob in live:
                    drift.append(f"{name}: {container}.{knob} expected absent -> live {live[knob]!r}")

    # 3. The query-instruction resolution is a contract, not a sample.
    live_prep = document["preparation"]
    rec_prep = recorded.get("preparation", {})
    for field in (
        "query_instruction",
        "model_id",
        "supported_language_count",
        "translation_window",
        "translation_char_budget",
    ):
        if live_prep.get(field) != rec_prep.get(field):
            drift.append(f"preparation.{field}: recorded {rec_prep.get(field)!r} -> live {live_prep.get(field)!r}")

    # 4. The locale strings are a SAMPLE: the detector is unseeded and the
    #    translation model is sampled, so a difference is a warning.
    expected_locales = preparation.get("locales", [])
    live_locales = {l.get("locale"): l for l in live_prep.get("locales", [])}
    for locale in expected_locales:
        live_locale = live_locales.get(locale["locale"])
        if live_locale is None:
            warnings.append(f"locale {locale['locale']}: no live measurement")
            continue
        for field in (
            "detected_language",
            "detected_supported",
            "history_language",
            "query_translation_status",
            "english_query",
            "embedded_text",
        ):
            if live_locale.get(field) != locale.get(field):
                warnings.append(
                    f"locale {locale['locale']}.{field}: recorded {locale.get(field)!r} "
                    f"-> live {live_locale.get(field)!r} (sampled value, not a contract)"
                )

    for line in warnings:
        print(f"WARN {line}")
    if drift:
        print("DRIFT against the recorded V02 contract:")
        for line in drift:
            print(f"  - {line}")
        return 1
    print("V02 contract verified: the live deployment matches the recorded measurement.")
    return 0


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

    try:
        document = measure(args.namespace)
    except (ProbeError, OSError, ValueError) as exc:
        print(f"probe failed: {exc}", file=sys.stderr)
        return 2

    text = json.dumps(document, indent=2, ensure_ascii=False)
    if args.out:
        with open(args.out, "w", encoding="utf-8") as handle:
            handle.write(text + "\n")

    if args.verify:
        try:
            return verify(args.verify, document)
        except (OSError, ValueError, KeyError) as exc:
            print(f"verify failed: {exc}", file=sys.stderr)
            return 2

    print(text)
    return 0


if __name__ == "__main__":
    sys.exit(main())
