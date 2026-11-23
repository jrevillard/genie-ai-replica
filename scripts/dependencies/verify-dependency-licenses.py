#!/usr/bin/env python3
# Copyright (C) 2026 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0
"""Pre-adoption licence + defaults audit for a pinned Python dependency tree.

Usage:
    verify-dependency-licenses.py --fetch REQ [--fetch REQ ...] --out EVIDENCE
    verify-dependency-licenses.py --verify REQ [REQ ...] --evidence EVIDENCE

--fetch   reads the pinned trees, asks PyPI for the metadata of EXACTLY those
          versions and writes the evidence file. A package whose metadata
          carries no SPDX expression is resolved by downloading the artifact
          and reading the licence file it ships - the exact-version proof the
          checklist asks for. The defaults audit is a human verdict: those
          entries come back with "defaults": null.

--verify  is offline, and is the gate: every pinned name==version must carry
          a licence that is not NOASSERTION/UNKNOWN/NONE, a source for that
          licence, and a defaults-audit verdict (telemetry + cloud export).
          A NOASSERTION licence counts as UNVERIFIED and blocks.

Several requirement files can be audited together (a runtime tree and a test
tree): the evidence file then covers their union, and a row for a package no
tree pins anymore is a failure - a stale row hides a bump.

Procedure and the rules it enforces: docs/dependencies/pre-adoption-checklist.md
"""

import argparse
import hashlib
import json
import re
import sys
import tarfile
import urllib.request
import zipfile
from io import BytesIO

PYPI = "https://pypi.org/pypi/{name}/{version}/json"

# A licence whose identity could not be established. Every one of them blocks
# the adoption (the checklist counts them as unverified).
UNVERIFIED = {"", "NOASSERTION", "UNKNOWN", "NONE", "N/A"}

# Licence texts are recognised by their own wording. The mapping is
# deliberately small and explicit: an unrecognised text is UNKNOWN, which
# blocks - it never guesses.
LICENCE_PATTERNS = [
    ("Apache-2.0", r"Apache License\s+Version 2\.0"),
    ("MIT", r"Permission is hereby granted, free of charge"),
    ("MPL-2.0", r"Mozilla Public License Version 2\.0"),
    ("ISC", r"Permission to use, copy, modify, and/or distribute this software"),
    ("GPL-3.0-only", r"GNU GENERAL PUBLIC LICENSE\s+Version 3"),
    ("GPL-2.0-only", r"GNU GENERAL PUBLIC LICENSE\s+Version 2"),
    ("LGPL-3.0-only", r"GNU LESSER GENERAL PUBLIC LICENSE\s+Version 3"),
    ("LGPL-2.1-only", r"GNU LESSER GENERAL PUBLIC LICENSE\s+Version 2\.1"),
    ("Unlicense", r"This is free and unencumbered software released into the public domain"),
    ("BSL-1.0", r"Boost Software License"),
    ("BSD-3-Clause", r"Neither the name of .* nor the names of its contributors"),
    ("BSD-2-Clause", r"Redistribution and use in source and binary forms"),
]

LICENCE_FILE = re.compile(r"^(LICEN[CS]E|COPYING|NOTICE)", re.IGNORECASE)

# The classifier is the publisher's own declaration, but it is coarse: only
# the unambiguous ones are mapped. "BSD License" is deliberately absent — the
# classifier does not say which variant, so the exact terms are unknown and
# the package stays UNVERIFIED until somebody reads the artefact.
CLASSIFIER_LICENCES = {
    "License :: OSI Approved :: Apache Software License": "Apache-2.0",
    "License :: OSI Approved :: MIT License": "MIT",
    "License :: OSI Approved :: Mozilla Public License 2.0 (MPL 2.0)": "MPL-2.0",
    "License :: OSI Approved :: ISC License (ISCL)": "ISC",
    "License :: OSI Approved :: Python Software Foundation License": "PSF-2.0",
    "License :: OSI Approved :: The Unlicense (Unlicense)": "Unlicense",
    "License :: OSI Approved :: Boost Software License 1.0 (BSL-1.0)": "BSL-1.0",
}


def parse_requirements(path):
    """Return the pinned `name==version` pairs of a requirements file."""
    pins = []
    with open(path, encoding="utf-8") as handle:
        for line in handle:
            line = line.split("#", 1)[0].strip()
            if not line or "==" not in line:
                continue
            name, version = line.split("==", 1)
            pins.append((name.strip(), version.strip()))
    return sorted(pins)


def all_pins(requirement_paths):
    """Return the union of the pinned pairs of every requirements file."""
    merged = {}
    for path in requirement_paths:
        for name, version in parse_requirements(path):
            merged[name] = version
    return sorted(merged.items())


def detect_licence(text):
    """Return the SPDX id of a licence text, or UNKNOWN."""
    for identifier, pattern in LICENCE_PATTERNS:
        if re.search(pattern, text, re.IGNORECASE | re.DOTALL):
            return identifier
    return "UNKNOWN"


def fetch_json(url):
    request = urllib.request.Request(url, headers={"User-Agent": "genie-ai-dependency-audit"})
    with urllib.request.urlopen(request, timeout=30) as response:
        return json.load(response)


def fetch_bytes(url):
    request = urllib.request.Request(url, headers={"User-Agent": "genie-ai-dependency-audit"})
    with urllib.request.urlopen(request, timeout=120) as response:
        return response.read()


def licence_files(entry, payload):
    """Return the (name, bytes) of the licence files an artifact ships."""
    members = []
    if entry.get("packagetype") == "bdist_wheel" or entry["url"].endswith(".whl"):
        with zipfile.ZipFile(BytesIO(payload)) as archive:
            for info in archive.infolist():
                if info.filename.endswith("/"):
                    continue
                base = info.filename.rsplit("/", 1)[-1]
                if LICENCE_FILE.match(base):
                    members.append((info.filename, archive.read(info.filename)))
    else:
        with tarfile.open(fileobj=BytesIO(payload), mode="r:*") as archive:
            for info in archive.getmembers():
                if not info.isfile():
                    continue
                base = info.name.rsplit("/", 1)[-1]
                if LICENCE_FILE.match(base):
                    extracted = archive.extractfile(info)
                    members.append((info.name, extracted.read() if extracted else b""))
    return sorted(members)


def artefact_licence(urls):
    """Return (licence_id, source) read from the licence file of an artifact.

    `urls` is the file list of a PyPI release. Every artifact of the EXACT
    version is tried - the source distribution first (it carries the project's
    own licence file), the wheels after it - and the first licence TEXT this
    script recognises wins. The sha256 of the file is recorded next to it: the
    proof is about a file of a given artifact, not about a project page.
    """
    seen = []
    ordered = sorted(urls, key=lambda entry: (entry.get("packagetype") != "sdist", entry.get("url", "")))
    for entry in ordered:
        try:
            payload = fetch_bytes(entry["url"])
        except Exception:
            continue
        for name, blob in licence_files(entry, payload):
            seen.append(name)
            identifier = detect_licence(blob.decode("utf-8", errors="replace"))
            if identifier != "UNKNOWN":
                digest = hashlib.sha256(blob).hexdigest()
                return identifier, f"artifact:{entry['filename']}#licence:{name} sha256:{digest}"
    detail = ", ".join(seen) if seen else "no licence file"
    return "UNKNOWN", f"no recognisable licence text in the published artifacts ({detail})"


def resolve(name, version):
    """Return the evidence row of one exact version."""
    url = PYPI.format(name=name, version=version)
    data = fetch_json(url)
    info = data["info"]
    expression = (info.get("license_expression") or "").strip()
    legacy = (info.get("license") or "").strip()
    classifiers = info.get("classifiers") or []
    if expression and expression not in UNVERIFIED:
        licence, source = expression, f"pypi:license_expression ({url})"
    else:
        licence, source = artefact_licence(data.get("urls", []))
        if licence == "UNKNOWN" and legacy:
            detected = legacy if re.fullmatch(r"[A-Za-z0-9.+-]+", legacy) else detect_licence(legacy)
            if detected != "UNKNOWN":
                licence, source = detected, f"pypi:info.license ({url})"
        if licence == "UNKNOWN":
            for classifier in classifiers:
                mapped = CLASSIFIER_LICENCES.get(classifier)
                if mapped:
                    licence, source = mapped, f"pypi:classifier '{classifier}' ({url})"
                    break
    return {
        "name": name,
        "version": version,
        "license": licence,
        "license_source": source,
        "verified": licence not in UNVERIFIED,
        "status": None,
        "risk_acceptance": None,
        "defaults": None,
    }


def verify(requirement_paths, evidence_path):
    """Offline gate: the evidence must cover the pinned trees exactly."""
    pins = all_pins(requirement_paths)
    with open(evidence_path, encoding="utf-8") as handle:
        evidence = json.load(handle)
    entries = {}
    problems = []
    for index, entry in enumerate(evidence.get("packages", [])):
        name = entry.get("name") if isinstance(entry, dict) else None
        if not isinstance(name, str) or not name.strip():
            problems.append(
                f"packages[{index}]: an evidence row carries no usable 'name' - the row "
                f"cannot be matched against any pin ({json.dumps(entry)[:80]})"
            )
            continue
        if name in entries:
            problems.append(f"{name}: a duplicate evidence row - the last one read wins")
        entries[name] = entry
    pinned = {name for name, _ in pins}

    for name, version in pins:
        entry = entries.get(name)
        if entry is None:
            problems.append(f"{name}=={version}: no evidence row - the pin was added without an audit")
            continue
        if entry.get("version") != version:
            problems.append(f"{name}: the evidence audits {entry.get('version')} but the tree pins {version}")
            continue
        licence = (entry.get("license") or "").strip()
        if licence in UNVERIFIED:
            problems.append(f"{name}=={version}: licence is '{licence or 'empty'}' - unverified, it blocks")
        if not (entry.get("license_source") or "").strip():
            problems.append(f"{name}=={version}: no licence source recorded")
        defaults = entry.get("defaults") or {}
        for field in ("telemetry", "cloud_export"):
            if not (defaults.get(field) or "").strip():
                problems.append(f"{name}=={version}: the defaults audit has no '{field}' verdict")
        status = (entry.get("status") or "").strip()
        if not status:
            problems.append(f"{name}=={version}: the release channel ('status') is not recorded")
        elif status.lower() != "stable":
            if not (entry.get("risk_acceptance") or "").strip():
                problems.append(
                    f"{name}=={version}: '{status}' is not a stable release - it needs an explicit "
                    "operational-risk acceptance"
                )

    for name in sorted(entries):
        if name not in pinned:
            problems.append(f"{name}: an evidence row for a package the tree no longer pins")

    for problem in problems:
        print(f"FAIL {problem}")
    if problems:
        print(f"{len(problems)} problem(s): the pre-adoption checklist is NOT satisfied.")
        return 1
    print(f"OK {len(pins)} pinned package(s): licence verified, defaults audit recorded.")
    return 0


def fetch(requirement_paths, out_path):
    """Resolve the licence of every exact pin and write the evidence file."""
    pins = all_pins(requirement_paths)
    packages = []
    for name, version in pins:
        row = resolve(name, version)
        packages.append(row)
        print(f"{name}=={version}: {row['license']} ({row['license_source']})")
    evidence = {
        "component": out_path.rsplit("/", 1)[-1].replace(".json", ""),
        "requirements": list(requirement_paths),
        "method": (
            "Exact-version licence verification: the SPDX expression the publisher declares for that exact "
            "version, or - when there is none - the licence file read out of the artifact of that exact "
            "version (sha256 recorded). The defaults audit (NFR-2) is a human verdict per package."
        ),
        "packages": packages,
    }
    with open(out_path, "w", encoding="utf-8") as handle:
        json.dump(evidence, handle, indent=2, sort_keys=False)
        handle.write("\n")
    print(f"wrote {out_path} - the defaults audit still has to be filled in")
    return 0


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--fetch", action="append", metavar="REQUIREMENTS", help="resolve the licences of a pinned tree")
    parser.add_argument("--out", metavar="EVIDENCE", help="the evidence file --fetch writes")
    parser.add_argument("--verify", nargs="+", metavar="REQUIREMENTS", help="check the evidence of these trees offline")
    parser.add_argument("--evidence", metavar="EVIDENCE", help="the evidence file --verify reads")
    args = parser.parse_args()

    if args.verify:
        if not args.evidence:
            parser.error("--verify needs --evidence")
        return verify(args.verify, args.evidence)
    if args.fetch:
        if not args.out:
            parser.error("--fetch needs --out")
        return fetch(args.fetch, args.out)
    parser.print_help()
    return 2


if __name__ == "__main__":
    sys.exit(main())
