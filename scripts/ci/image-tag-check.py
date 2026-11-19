#!/usr/bin/env python3
"""The chart's image-tag resolution: one version, one variant, one pin.

Why this exists
---------------
The chart used to hardcode "main" in every service's image block, so
moving the stack to a release tag meant editing seven lines and the
slim variant had no name at all. The chart now resolves every image tag
through three rules:

  * the VERSION  — the per-service pin, else the global `imageTag`, else
    "main";
  * the VARIANT  — `opea.imageTagSuffix`, applied to the three
    model-serving images (the reranker, the retriever, the dataprep) and
    to nothing else;
  * the PIN      — a per-service tag names the EXACT tag and never
    receives the variant suffix.

Nothing else in the pipeline checks those rules. `helm lint` only knows
whether the template PARSES; the values gates only know whether a value
is DECLARED; the parity gate compares environment variables, not image
tags. A rule that quietly changes — the suffix reaching an image with no
slim build, a pin losing to the global, the pull policy judging the
composed tag instead of its base — renders a valid manifest that pulls
the wrong artifact, and the failure surfaces as an ImagePullBackOff or a
pod that never restarts onto the new build.

The model
---------
A tag is MUTABLE when it moves under its own name (a branch tag, "main")
and IMMUTABLE when it names one build (a release tag, a digest). The
pull policy follows that: a mutable tag pulls Always (IfNotPresent would
serve whatever digest the first deploy cached — a green reconcile over
stale code), an immutable one IfNotPresent. The variant suffix must not
change that verdict: "main-slim" is as mutable as "main", "v2.1.0-slim" as
immutable as "v2.1.0" — so the policy judges the BASE tag.

The GENIE.AI images are the ones under the chart's own registry; the
upstream ones (clamav, redis, vllm, tei, ...) carry their own pinned tags
and are outside the knob.

Usage: scripts/ci/image-tag-check.py <rendered.yaml> [<rendered.yaml>...]
       (the renders are the ones the CI job produced; the script only reads
       them, so the render flags live in the CI job)
"""

import re
import sys

import yaml

# The GENIE.AI image repositories the chart owns: every image under the
# chart's registry is one of these; the upstream images are not.
OWNED = "registry.opensource.unicc.org/un/itu/genie-ai/"

# The images the CI publishes a slim build of. The set is a BUILD FACT —
# the slim lanes in .gitlab-ci.yml exist for exactly these three — so a
# value the operator could set wrong (and break the pull of an image that
# has no slim build) is not a values knob.
SLIM_CAPABLE = (
    "genie-ai-reranker",
    "genie-ai-retriever-arango",
    "genie-ai-dataprep-arango",
)

# The upstream images the chart installs with their own pins. They are
# never affected by the version or the variant.
UPSTREAM = ("clamav/clamav", "redis", "arango", "postgres", "keycloak")

MUTABLE = re.compile(r"^(main|latest|stable.*)$")


def images(rendered):
    """The (repository, tag, pullPolicy) of every container in a render."""
    found = []
    for document in yaml.safe_load_all(rendered):
        if not document:
            continue
        spec = document.get("spec") or {}
        pod_spec = (
            spec.get("template", {}).get("spec", {}) if "template" in spec else spec
        )
        for container in pod_spec.get("containers", []) or []:
            image = container.get("image")
            if not image:
                continue
            repository, _, tag = image.rpartition(":")
            found.append(
                {
                    "repository": repository,
                    "tag": tag,
                    "pullPolicy": container.get("imagePullPolicy"),
                    "kind": document.get("kind"),
                    "name": document.get("metadata", {}).get("name"),
                }
            )
    return found


def owned(entry):
    """The GENIE.AI image name (without the registry prefix), or None."""
    if OWNED not in entry["repository"]:
        return None
    return entry["repository"].split(OWNED, 1)[1]


def check(rendered, expectations, label):
    """Assert every expectation against one render. Returns the failures."""
    failures = []
    entries = [e for e in images(rendered) if owned(e)]
    if not entries:
        failures.append(
            f"{label}: no GENIE.AI image in the render — the check is vacuous"
        )
        return failures

    for entry in entries:
        name = owned(entry)
        expected_tag = expectations.get(name)
        if expected_tag is None:
            failures.append(
                f"{label}: {name} carries {entry['tag']}, which no expectation covers"
            )
            continue
        if entry["tag"] != expected_tag:
            failures.append(
                f"{label}: {name} carries {entry['tag']}, expected {expected_tag}"
            )

        # The pull policy judges the BASE tag: strip the variant suffix.
        base = entry["tag"]
        for suffix in ("-slim",):
            base = base.removesuffix(suffix)
        mutable = bool(MUTABLE.match(base))
        expected_policy = "Always" if mutable else "IfNotPresent"
        if entry["pullPolicy"] != expected_policy:
            failures.append(
                f"{label}: {name} pulls with {entry['pullPolicy']}, expected {expected_policy} "
                f"for the base tag {base}"
            )
    return failures


def main():
    if len(sys.argv) < 2:
        print("usage: image-tag-check.py <rendered.yaml> [...]", file=sys.stderr)
        return 2

    # The renders the CI job produces, each with the values that produce
    # them. The expectations are the RULES, written out: the version for
    # every image, the variant for the three, the pin for the pinned one.
    expectations = {
        # Render 1: the global version, no variant.
        "global": {
            "genie-ai-backend": "v2.1.0",
            "genie-ai-frontend": "v2.1.0",
            "genie-ai-document-repository": "v2.1.0",
            "genie-ai-db-migrations": "v2.1.0",
            "genie-ai-chatqna-server": "v2.1.0",
            "genie-ai-embedding": "v2.1.0",
            "genie-ai-okf-server": "v2.1.0",
            "genie-ai-pii-service": "v2.1.0",
            "genie-ai-ragas-service": "v2.1.0",
            "genie-ai-reranker": "v2.1.0",
            "genie-ai-retriever-arango": "v2.1.0",
            "genie-ai-dataprep-arango": "v2.1.0",
        },
        # Render 2: the variant rides on the version, for the three only.
        "variant": {
            "genie-ai-backend": "v2.1.0",
            "genie-ai-frontend": "v2.1.0",
            "genie-ai-document-repository": "v2.1.0",
            "genie-ai-db-migrations": "v2.1.0",
            "genie-ai-chatqna-server": "v2.1.0",
            "genie-ai-embedding": "v2.1.0",
            "genie-ai-okf-server": "v2.1.0",
            "genie-ai-pii-service": "v2.1.0",
            "genie-ai-ragas-service": "v2.1.0",
            "genie-ai-reranker": "v2.1.0-slim",
            "genie-ai-retriever-arango": "v2.1.0-slim",
            "genie-ai-dataprep-arango": "v2.1.0-slim",
        },
        # Render 3: a pin names the EXACT tag and never receives the
        # suffix — whichever image carries it, including the three that
        # would otherwise take the variant.
        "pinned": {
            "genie-ai-backend": "v1.9.8",
            "genie-ai-frontend": "v2.1.0",
            "genie-ai-document-repository": "v2.1.0",
            "genie-ai-db-migrations": "v2.1.0",
            "genie-ai-chatqna-server": "v1.9.9",
            "genie-ai-embedding": "v1.9.7",
            "genie-ai-okf-server": "v1.9.6",
            "genie-ai-pii-service": "v1.9.5",
            "genie-ai-ragas-service": "v1.9.4",
            "genie-ai-reranker": "v1.9.3",
            "genie-ai-retriever-arango": "v2.1.0-slim",
            "genie-ai-dataprep-arango": "v2.1.0-slim",
        },
        # Render 4: a MUTABLE version with the variant — the pull policy
        # follows the BASE tag, so a slim variant of a branch tag pulls
        # Always, like the tag it derives from.
        "mutable-variant": {
            "genie-ai-backend": "main",
            "genie-ai-frontend": "main",
            "genie-ai-document-repository": "main",
            "genie-ai-db-migrations": "main",
            "genie-ai-chatqna-server": "main",
            "genie-ai-embedding": "main",
            "genie-ai-okf-server": "main",
            "genie-ai-pii-service": "main",
            "genie-ai-ragas-service": "main",
            "genie-ai-reranker": "main-slim",
            "genie-ai-retriever-arango": "main-slim",
            "genie-ai-dataprep-arango": "main-slim",
        },
    }

    failures = []
    for path in sys.argv[1:]:
        label = path
        for suffix, key in (
            ("-global.yaml", "global"),
            ("-variant.yaml", "variant"),
            ("-pinned.yaml", "pinned"),
            ("-mutable.yaml", "mutable-variant"),
        ):
            if path.endswith(suffix):
                label = key
        with open(path) as handle:
            rendered = handle.read()
        failures.extend(check(rendered, expectations[label], label))

    if failures:
        for failure in failures:
            print(f"FAIL: {failure}")
        print(
            f"\n{len(failures)} image-tag failures — the render does not match the rules"
        )
        return 1

    print("the version, the variant and the pin resolve as documented")
    return 0


if __name__ == "__main__":
    sys.exit(main())
