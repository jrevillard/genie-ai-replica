#!/usr/bin/env python3
"""The chart's version must move with the chart's content.

Why this exists
---------------
The deploy repo's overlay names the chart it installs
(`spec.chart.spec.version`), and that name is the deploy repo's LABEL of
what the cluster runs: a reader of the overlay sees which chart release is
deployed. A chart change that leaves the label behind names a release the
cluster is not running.

What the version is NOT, for this deployment: Flux does not reconcile on
it. The HelmRelease CRD says the field is "ignored for charts from
v1.GitRepository and v1beta2.Bucket sources" (helm-controller v1.1.0),
and the install decision is the SOURCE's artifact digest — the chart's
GitRepository tracks the branch tip, so a push reaches the cluster with
or without a bump. The rule is a convention this gate makes enforceable,
not a mechanism Flux enforces.

140 of the branch's ~310 chart-touching commits changed the chart's
content without moving the version before this gate existed (adjacent
pairs, measured 2026-10-28).

What is checked
---------------
The last two commits of THIS CHANGE that touched the charts. If the
content changed between them, the umbrella's Chart.yaml version must have
moved too. Two derivations matter:

  * WHICH commits. An MR pipeline checks out the merge result, whose
    history interleaves the target branch's commits with this change's:
    "the two most recent by date" can then be one from each side, and an
    unrelated bump on the other side launders an unbumped change here.
    The diff base (CI_MERGE_REQUEST_DIFF_BASE_SHA, set in every MR
    pipeline) pins the comparison to this change's own commits.
  * WHICH paths. The library chart charts/genieai-common renders INTO the
    umbrella's output, so a library-only fix changes what the umbrella
    installs while leaving the umbrella's version where it was — the
    overlay would name a release whose content is not the one in the
    cluster. Both chart directories are watched; only the umbrella's
    Chart.yaml is exempt (it is the version itself).

Usage: scripts/ci/chart-version-check.py [chart-path]
       CHART=charts/genieai-umbrella scripts/ci/chart-version-check.py
"""

import os
import subprocess
import sys

import yaml

DEFAULT_CHART = "charts/genieai-umbrella"
# The library chart renders into the umbrella's output; a change here is
# a change to what the umbrella installs.
WATCHED = (DEFAULT_CHART, "charts/genieai-common")


def git(*args):
    """(returncode, stdout) for one git invocation."""
    proc = subprocess.run(["git"] + list(args), capture_output=True, text=True)
    return proc.returncode, proc.stdout.strip()


def chart_version(ref, chart):
    """The version declared in <ref>:<chart>/Chart.yaml, or None."""
    rc, out = git("show", f"{ref}:{chart}/Chart.yaml")
    if rc != 0:
        return None
    return (yaml.safe_load(out) or {}).get("version")


def chart_commits():
    """The chart-touching commits of THIS change, newest first.

    No merge commits: an MR pipeline checks out a merge result whose tree
    IS the branch's, so the merge commit would always look like an
    unbumped change. The log is bounded where it can be, so the gate does
    not materialize the branch's whole chart history to read two SHAs.
    """
    base = os.environ.get("CI_MERGE_REQUEST_DIFF_BASE_SHA")
    if base:
        # A merged-result checkout's HEAD is the merge commit: first
        # parent the target branch, second parent THIS change. Walking
        # from HEAD^2 keeps the comparison inside this change's own
        # commits — without it the target branch's chart commits sit in
        # the same range, and an unrelated bump there launders an
        # unbumped change here.
        rc, tip = git("rev-parse", "--verify", "HEAD^2")
        head = tip if rc == 0 and tip else "HEAD"
        rc, out = git(
            "log", "--no-merges", "--format=%H", f"{base}..{head}", "--", *WATCHED
        )
        if rc == 0 and out:
            return out.split("\n")
    rc, out = git("log", "--no-merges", "-2", "--format=%H", "--", *WATCHED)
    return out.split("\n") if rc == 0 and out else []


def main():
    chart = (
        sys.argv[1]
        if len(sys.argv) > 1
        else os.environ.get("CHART", DEFAULT_CHART)
    )
    commits = chart_commits()
    if not commits:
        print("no chart history to compare — nothing to check")
        return 0
    newest = commits[0]
    # With a single chart commit in this change, the state before it is
    # its parent — which may predate the diff base, and is exactly the
    # state the change starts from.
    single = len(commits) == 1
    previous = newest + "^" if single else commits[1]
    previous_label = f"the parent of {newest[:8]}" if single else commits[1][:8]

    rc, changed = git("diff", "--name-only", f"{previous}..{newest}", "--", *WATCHED)
    if rc != 0:
        print("could not diff the chart history — nothing to check")
        return 0
    content = [
        name
        for name in changed.split("\n")
        if name and name != f"{chart}/Chart.yaml"
    ]
    if not content:
        print(
            f"the last chart change ({newest[:8]}) touched no content — "
            "the version need not move"
        )
        return 0

    old = chart_version(previous, chart)
    new = chart_version(newest, chart)
    if old == new:
        print(
            f"FAIL: the chart's content changed without a version bump.\n"
            f"  {previous_label} -> {newest[:8]} changed:\n"
            + "".join(f"    {name}\n" for name in content)
            + f"  but the version is {new!r} on both sides.\n"
            "  The deploy repo names the chart it installs: without a bump, "
            "the overlay names a release the cluster is not running."
        )
        return 1
    print(f"the chart's version moved {old} -> {new} with its content")
    return 0


if __name__ == "__main__":
    sys.exit(main())
