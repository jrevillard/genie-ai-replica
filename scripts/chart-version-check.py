#!/usr/bin/env python3
"""The chart's version IS its artifact identity: Flux reconciles the version.

Why this exists
---------------
The deploy repo reconciles the chart from the BRANCH HEAD (the GitRepository
source-ref carries no SHA pin), and the helm-controller compares the
HelmRelease's `spec.chart.spec.version` with the running release. A push
that changes the chart's CONTENT without moving that version therefore
reconciles to "release in-sync with desired state" and installs nothing:
the change is pushed, linted and merged, and the cluster keeps running the
previous revision. `.claude/rules/K8s-WORKFLOW.md` states the rule — "Bump
per push, not per batch" — and this gate makes it enforceable instead of
a habit.

114 of the branch's commits changed the chart without a bump before this
gate existed.

What is checked
---------------
The LAST two commits that touched the chart (merge commits excluded: an MR
pipeline checks out a merge result whose tree IS the branch's, so the merge
commit would always look like an unbumped change). If the chart's CONTENT
changed between them, Chart.yaml's version must have moved too.

Usage: scripts/chart-version-check.py [chart-path]
       CHART=charts/genieai-umbrella scripts/chart-version-check.py
"""

import re
import subprocess
import sys

DEFAULT_CHART = "charts/genieai-umbrella"


def git(*args):
    proc = subprocess.run(["git"] + list(args), capture_output=True, text=True)
    return proc.returncode, proc.stdout.strip(), proc.stderr.strip()


def chart_version(ref, chart):
    """The version declared in <ref>:<chart>/Chart.yaml, or None."""
    rc, out, _ = git("show", f"{ref}:{chart}/Chart.yaml")
    if rc != 0:
        return None
    match = re.search(r"^version:\s*(\S+)", out, re.M)
    return match.group(1) if match else None


def chart_commits(chart):
    """The commits that touched the chart, newest first (no merge commits)."""
    rc, out, _ = git("log", "--no-merges", "--format=%H", "--", chart)
    return out.split("\n") if rc == 0 and out else []


def main():
    chart = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_CHART
    commits = chart_commits(chart)
    if len(commits) < 2:
        print("no chart history to compare — nothing to check")
        return 0
    newest, previous = commits[0], commits[1]

    rc, changed, _ = git("diff", "--name-only", f"{previous}..{newest}", "--", chart)
    if rc != 0:
        print("could not diff the chart history — nothing to check")
        return 0
    content = [
        name
        for name in changed.split("\n")
        if name and not name.endswith("/Chart.yaml")
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
            f"  {previous[:8]} -> {newest[:8]} changed:\n"
            + "".join(f"    {name}\n" for name in content)
            + f"  but the version is {new!r} on both sides.\n"
            "  Flux reconciles the VERSION: without a bump the release reports "
            "'in-sync with desired state' and installs nothing."
        )
        return 1
    print(f"the chart's version moved {old} -> {new} with its content")
    return 0


if __name__ == "__main__":
    sys.exit(main())
