# Copyright (C) 2026 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0
"""The run manifest builder (every run versions what it ran on).

One manifest rides every run report (reference or gated) and records:

* **corpus** — the source collection + its content-hash fingerprint (the
  fingerprint the caller computed from the collection's chunk content hashes —
  :func:`fingerprint_corpus`);
* **sets** — the sha256 of every set file the run consumed;
* **configuration** — per config (A/B/C), the resolved-env snapshot (values
  read from the live containers, redacted of credential-named keys), the
  model ids as resolved from the serving endpoints, and the digests of the
  resolved prompt surfaces;
* **evaluator_instructions** — the digest of the versioned instructions file
  (what the judged dimensions check; the file lives beside this package);
* **kind** — ``reference`` (an A-only run, never gated) or ``gated`` (a B/C
  run, which MUST chain its lineage: the reference manifest's digest and the
  signed thresholds file's digest);
* **pair** — the E01/E02 pair conditions stamped from :mod:`pairs` when the
  run belongs to a pair.

No credentials in any record: :func:`redact` drops every key whose name
carries a credential marker (PASSWORD/SECRET/TOKEN/KEY/BEARER/CREDENTIAL,
case-insensitive) from anything recorded. The redaction is a denylist over
KEY NAMES, not a scan of values — a config value named ``RETRIES`` survives,
a value stored under ``KEYCLOAK_ADMIN_PASSWORD`` does not.
"""

from __future__ import annotations

import hashlib
import json
from datetime import UTC, datetime
from pathlib import Path

from . import PROTOCOL_VERSION
from . import pairs as pairs_mod

MANIFEST_VERSION = "1.0.0"

CONFIGS = ("A", "B", "C")
KINDS = ("reference", "gated")

# Any recorded key whose NAME contains one of these markers is dropped.
SECRET_KEY_MARKERS = ("PASSWORD", "SECRET", "TOKEN", "KEY", "BEARER", "CREDENTIAL")


class ManifestError(ValueError):
    """The manifest inputs violate the manifest contract (e.g. a gated run
    with no lineage, or a credential-named key handled by redaction gone
    wrong — never silently)."""


def sha256_text(text: str) -> str:
    """sha256 of a UTF-8 string."""
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def sha256_file(path: str | Path) -> str:
    """sha256 of a file's bytes — the digest set files, prompt surfaces and
    evaluator-instructions files record. The identity function IS the capture
    machinery's (``capture_baseline.file_sha256``) — one spelling in the tree,
    never a second implementation that could drift."""
    import capture_baseline  # local import: the sibling capture module

    return capture_baseline.file_sha256(Path(path))


def sha256_json(obj) -> str:
    """sha256 over the canonical JSON serialization (sorted keys) — the digest
    a manifest or thresholds file is referenced by."""
    return sha256_text(json.dumps(obj, sort_keys=True, ensure_ascii=False))


def digest_without_embedded(record: dict) -> str:
    """sha256 over the canonical JSON of a record MINUS its embedded ``digest``
    key — the verifiable identity a rebuild must reproduce (a report digesting
    itself would never terminate)."""
    return sha256_json({key: value for key, value in record.items() if key != "digest"})


def redact(mapping: dict) -> dict:
    """Drop every key whose name carries a credential marker (case-insensitive).

    Applied to everything the manifest records — the resolved-env snapshots
    first among them. The recorded evidence must be shareable; a leaked
    secret in a committed manifest is the failure this exists to prevent.
    """
    out = {}
    for key, value in mapping.items():
        name = str(key).upper()
        if any(marker in name for marker in SECRET_KEY_MARKERS):
            continue
        out[key] = value
    return out


def fingerprint_corpus(source_collection: str, content_hashes: list[str]) -> str:
    """The corpus fingerprint: sha256 over the collection name and its sorted
    chunk content hashes.

    The content hashes are the same identity the anchor eval matches on
    (``eval/chunk_identity.content_hash``) — the fingerprint therefore changes
    exactly when the corpus content changes, and survives a re-ingest that
    keeps chunk text identical. The caller collects the hashes from the source
    collection (the A driver's ``run_eval.build_key_to_content_hash`` path);
    this function is pure.
    """
    h = hashlib.sha256()
    h.update(source_collection.encode("utf-8"))
    h.update(b"\x00")
    for digest in sorted(content_hashes):
        h.update(digest.encode("utf-8"))
        h.update(b"\x00")
    return h.hexdigest()


def build_manifest(
    *,
    kind: str,
    config: str,
    corpus: dict,
    sets: dict,
    configuration: dict,
    evaluator_instructions_path: str | Path,
    lineage: dict | None = None,
    pair: str | None = None,
    created_utc: str | None = None,
) -> dict:
    """Build one run manifest; raise :class:`ManifestError` on a contract breach.

    ``kind`` ``gated`` REQUIRES ``lineage`` (the reference manifest digest +
    the signed thresholds digest — the gate supplies it); ``kind`` ``reference``
    refuses a lineage (a reference run chains nothing — it IS the chain's
    head). ``configuration`` maps config letter → ``{"resolved_env", "model_ids",
    "prompt_digests"}``; every recorded mapping is redacted of credential-named
    keys. ``pair`` stamps the pair-conditions manifest (see :mod:`pairs`).
    """
    if kind not in KINDS:
        raise ManifestError(f"manifest kind must be one of {', '.join(KINDS)} (got {kind!r})")
    if config not in CONFIGS:
        raise ManifestError(f"config must be one of {', '.join(CONFIGS)} (got {config!r})")
    if kind == "gated" and not lineage:
        raise ManifestError("a gated run manifest requires its lineage (reference + thresholds digests)")
    if kind == "reference" and lineage:
        raise ManifestError("a reference run manifest carries no lineage — it is the chain's head")

    recorded_configuration = {}
    for config_letter, snapshot in configuration.items():
        resolved_env = snapshot.get("resolved_env") or {}
        if not isinstance(resolved_env, dict):
            raise ManifestError(f"configuration[{config_letter}].resolved_env must be a mapping")
        recorded_configuration[config_letter] = {
            "resolved_env": redact(resolved_env),
            "model_ids": dict(snapshot.get("model_ids") or {}),
            "prompt_digests": dict(snapshot.get("prompt_digests") or {}),
        }

    manifest = {
        "artifact": "run-manifest",
        "version": MANIFEST_VERSION,
        "protocol_version": PROTOCOL_VERSION,
        "kind": kind,
        "config": config,
        "created_utc": created_utc or datetime.now(UTC).isoformat(timespec="seconds"),
        "corpus": dict(corpus),
        "sets": dict(sets),
        "configuration": recorded_configuration,
        "evaluator_instructions": {
            "path": str(evaluator_instructions_path),
            "sha256": sha256_file(evaluator_instructions_path),
        },
    }
    if pair is not None:
        manifest["pair"] = pairs_mod.pair_conditions(pair)
    if lineage is not None:
        manifest["lineage"] = dict(lineage)
    return manifest


def manifest_digest(manifest: dict) -> str:
    """The digest a thresholds file (or a gated run's lineage) references."""
    return sha256_json(manifest)


def manifest_lineage(manifest: dict) -> tuple[str | None, str | None]:
    """The (corpus fingerprint, assessment-set digest) a manifest records —
    one derivation for every surface that verifies or states a lineage."""
    corpus = (manifest.get("corpus") or {}).get("fingerprint")
    assessment = ((manifest.get("sets") or {}).get("assessment") or {}).get("sha256")
    return corpus, assessment
