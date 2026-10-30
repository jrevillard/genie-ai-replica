#!/usr/bin/env python3
"""The data tier's instance counts resolve the way the values say.

Why this exists
---------------

The prod profile used to HARDCODE the Keycloak and Postgres instance
counts (2 and 3) in the templates: `data.keycloak.instances: 5` was
discarded, with no warning and no error — helm template, helm lint,
kubeconform and the CRD gate all stayed green, and an operator who
sized the Keycloak database for prod load got 2 replicas and 3 database
instances anyway.

The counts now resolve through `clusterProfileInstances`, in the same
order every count in the chart resolves: the EXPLICIT value, then the
profile, then 1 — an explicit `data.<tier>.instances` wins over the
profile map, because it is the count the operator sized the database
for. Only an ABSENT value falls back to the profile.

This script renders the three configurations that must hold and checks
the rendered instance counts:

  dev, no override            -> 1 and 1   (the fallback)
  prod, no override           -> 2 and 3   (the profile map)
  prod, explicit override     -> the operator's numbers, not the profile's

Usage: scripts/ci/instance-count-check.py [chart-path]
       CHART=charts/genieai-umbrella scripts/ci/instance-count-check.py
"""

import os
import subprocess
import sys

import yaml

# The two data tiers that carry an instance count, and the tier key the
# resolver reads (`data.<tier>.instances`).
TIERS = ("keycloak", "postgres")


def base_flags(chart_path):
    """The shared CI render fixture, resolved next to the chart."""
    ci_dir = os.path.join(os.path.dirname(os.path.abspath(chart_path)), "ci")
    fixture = os.path.join(ci_dir, "render-base-flags")
    if not os.path.isfile(fixture):
        sys.exit(f"missing render fixture: {fixture}")
    with open(fixture) as handle:
        flags = []
        for line in handle:
            line = line.strip()
            if line:
                flags.extend(line.split())
    return flags


def render(chart_path, extra_flags):
    cmd = [
        "helm",
        "template",
        "test",
        chart_path,
        "-n",
        "genieai",
    ] + base_flags(chart_path) + list(extra_flags)
    proc = subprocess.run(cmd, capture_output=True, text=True)
    if proc.returncode != 0:
        sys.exit("render failed:\n" + proc.stderr[:2000])
    return list(yaml.safe_load_all(proc.stdout))


def rendered_counts(docs):
    """{kind: instances} for every object that carries an instance count."""
    counts = {}
    for doc in docs:
        if not isinstance(doc, dict):
            continue
        kind = doc.get("kind")
        if kind not in ("Keycloak", "Cluster"):
            continue
        spec = doc.get("spec") or {}
        if "instances" not in spec:
            continue
        name = (doc.get("metadata") or {}).get("name", "<unnamed>")
        counts[f"{kind}/{name}"] = spec["instances"]
    return counts


def check(docs, label, expected):
    counts = rendered_counts(docs)
    failures = []
    for key, want in expected.items():
        got = counts.get(key)
        if got != want:
            failures.append(f"  {key}: rendered {got!r}, expected {want!r}")
    if failures:
        print(f"FAIL: {label} — {len(failures)} instance count(s) wrong:")
        for failure in failures:
            print(failure)
        return 1
    print(f"PASS: {label} — {counts}")
    return 0


def main():
    chart_path = (
        sys.argv[1]
        if len(sys.argv) > 1
        else os.environ.get("CHART", "charts/genieai-umbrella")
    )
    failures = 0
    failures += check(
        render(chart_path, []),
        "dev profile, no override",
        {"Keycloak/keycloak": 1, "Cluster/keycloak-db": 1},
    )
    failures += check(
        render(chart_path, ["--set=clusterProfile=prod"]),
        "prod profile, no override",
        {"Keycloak/keycloak": 2, "Cluster/keycloak-db": 3},
    )
    failures += check(
        render(
            chart_path,
            [
                "--set=clusterProfile=prod",
                "--set=data.keycloak.instances=5",
                "--set=data.postgres.instances=7",
            ],
        ),
        "prod profile, explicit operator override wins over the profile",
        {"Keycloak/keycloak": 5, "Cluster/keycloak-db": 7},
    )
    if failures:
        print()
        print("the data tier's instance counts do not resolve the way the values say")
        sys.exit(1)
    print()
    print("the data tier's instance counts follow the values")


if __name__ == "__main__":
    main()
