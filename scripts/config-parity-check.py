#!/usr/bin/env python3
"""Check that the Helm chart and Docker Compose configure a service the same way.

Why this exists
---------------

The stack has two deployment surfaces: `docker-compose.yaml` and the
`charts/genieai-umbrella/` chart. They configure the SAME applications, so
every environment variable an operator can set on one of them must have a
counterpart on the other, with the same default. When they drift, a
deployment behaves differently depending on which surface it runs on — and
the difference is invisible until something misbehaves in one of them.

Nothing else in the pipeline catches this. `helm lint` checks the chart
against itself, the Compose file against itself, and the tests exercise the
code with whatever environment the CI job happens to have. A variable added
to one surface and forgotten in the other is a green pipeline.

The drift is silent and it is easy to produce: a rebase brings in an
upstream commit that adds an environment variable to Compose, and the chart
— which has a fixed, hand-written list of environment rows — never learns
about it. This script is the gate that makes the drift loud.

The model
---------

For every service pair (a Compose service and the chart component that runs
the same application), every variable Compose sets must be configured by the
chart — rendered, or declared in the chart's values. A variable the chart
never mentions is a knob an operator can turn on one surface and not the
other.

The VALUES, on the other hand, are allowed to differ for one class of
variable only: the WIRING — the addresses and topology each surface
addresses. Compose reaches `http://tei:80` where Kubernetes reaches
`https://10.0.0.110:444/embed`; the chart reaches
`arangodb-single.genieai.svc.cluster.local` where Compose reaches
`arango-vector-db`. Those are not drift: they are the adaptation to
Kubernetes, and the point of the gate is to force each of them to be
DECLARED (in the allowlist, with the reason) rather than to be equal. A
wiring variable the chart forgot to set at all is still a gap: the
application needs it whichever surface it runs on.

Everything else — timeouts, retries, feature flags, log levels, identity —
must carry the same effective value on both surfaces. That is the parity
that matters: the same deployment, configured the same way, wherever it
runs.

Three categories in the allowlist, per service:

  * `mayDiffer`  — the variable names an address, a topology fact, or a
                   deliberate policy difference. The chart must set it; its
                   value is the Kubernetes one.
  * `composeOnly` — the variable only makes sense on the Compose surface
                   (Docker GPU passthrough). The chart must not need it.
  * `notRead`    — the variable is read by no code in the repository. It
                   is configuration theatre on both surfaces.
  * `codeDefault` — Compose leaves the variable empty and the code's own
                   default applies when it is unset, so the chart leaving
                   it unset produces the same result.
  * `notApplicable` — the variable has no role in the Kubernetes topology
                   (a development proxy host, when the SPA and the API are
                   served from the same origin).

"Effective value" means what the variable resolves to, not how it is
spelled: Compose's `${NAME:-fallback}` resolves to `fallback` when NAME is
unset, and to a bare `${NAME}` it resolves to nothing at all — the variable
is required, which is a fact the chart has to reproduce (through a Secret).

Usage:
  config-parity-check.py RENDERED.yaml [--compose ...] [--values ...] [--allowlist ...]
                     [--min-compared=N]

Every variable filed under `notRead` is also verified against the source
it claims reads nothing: the run walks shipped application source under
`components/` and `genie-ai-overlay/` (tests, docs and vendored trees
excluded) and fails if the name appears there. A suppression category
nobody checks is a way to make this gate green.

`--min-compared=N` puts a floor on how many variables the run actually
compared. Every allowlist category removes variables from that set, so
without a floor, growing the allowlist is a way to make this gate green
without touching either surface.

Exits non-zero and prints one `GAP` line per difference. A surface the
script cannot compare (a Compose service with no chart counterpart, or the
other way round) is reported and does not fail the run — the pairing is
declared in the allowlist file, and a service absent from it was never
declared comparable.
"""

import json
import os
import re
import sys

import yaml

DEFAULT_COMPOSE = "docker-compose.yaml"
DEFAULT_VALUES = "charts/genieai-umbrella/values.yaml"
DEFAULT_ALLOWLIST = "scripts/config-parity-allowlist.json"

# Source roots and what counts as shipped application source. The `notRead`
# claims are checked against these: a variable declared unreadable must not
# appear in any file that actually runs. Tests, docs and vendored trees are
# excluded because they mention configuration without reading it.
SOURCE_ROOTS = ("components", "genie-ai-overlay")
SOURCE_SKIP_DIRS = {
    "node_modules", ".git", ".venv", "venv", "__pycache__", ".pytest_cache",
    "dist", "build", "coverage", "tests", "test", "__tests__", ".cache",
    "migrations_backup",
}
SOURCE_SUFFIXES = (".js", ".py", ".vue", ".ts", ".mjs", ".cjs")
SOURCE_SKIP_RE = re.compile(r"(^|/)(test_[^/]*\.py|[^/]*\.(test|spec)\.js)$")


def iter_source_files(roots):
    """Every file of shipped application source under `roots`."""
    for root in roots:
        if not os.path.isdir(root):
            continue
        for dirpath, dirnames, filenames in os.walk(root):
            dirnames[:] = sorted(d for d in dirnames if d not in SOURCE_SKIP_DIRS)
            for name in filenames:
                path = os.path.join(dirpath, name)
                if not name.endswith(SOURCE_SUFFIXES):
                    continue
                if SOURCE_SKIP_RE.search(path):
                    continue
                yield path


def verify_not_read(names):
    """Map each declared-notRead variable to the source files that read it.

    A claim is wrong when the name appears in shipped source; the gate is
    the point of the claim, so an unverified claim is an untested one.
    """
    names = set(names)
    if not names:
        return {}
    hits = {name: [] for name in names}
    for path in iter_source_files(SOURCE_ROOTS):
        try:
            with open(path, encoding="utf-8", errors="ignore") as handle:
                text = handle.read()
        except OSError:
            continue
        for name in names:
            if name in text:
                hits[name].append(path)
    return {name: paths for name, paths in hits.items() if paths}

# Marker for a variable the chart carries from a Secret: the chart asks the
# operator for it, and its value cannot be compared with Compose's.
SECRET = "(secret)"

# `${NAME}` / `${NAME:-fallback}` / `${NAME-fallback}` inside a Compose value.
_INTERP = re.compile(r"\$\{([A-Za-z_][A-Za-z0-9_]*)(?::?-([^}]*))?\}")


def compose_default(value):
    """The value a Compose variable resolves to when the operator sets nothing.

    Returns (resolved, required). `required` is True for `${NAME}` with no
    fallback: the operator MUST set it, which the chart has to reproduce
    (through a Secret), so it is not comparable to a chart default.
    """
    text = str(value)
    if not text.startswith("${") or not text.endswith("}"):
        return text, False
    match = _INTERP.fullmatch(text)
    if not match:
        return text, False
    fallback = match.group(2)
    if fallback is None:
        return "", True
    return fallback, False


def compose_vars(service):
    """{name: (effective value, required)} for a Compose service."""
    environment = service.get("environment") or []
    if isinstance(environment, dict):
        environment = [f"{k}={v}" for k, v in environment.items()]
    out = {}
    for entry in environment:
        text = str(entry)
        name = text.split("=", 1)[0].strip()
        if not name:
            continue
        raw = text.split("=", 1)[1] if "=" in text else ""
        out[name] = compose_default(raw)
    return out


def chart_rendered(docs):
    """{component: {name: value}} from the rendered chart.

    Deployments and Jobs both carry a pod template with the same shape, so
    both are read: a service the chart runs as a hook Job (the database
    migrations, the Keycloak convergence) is configured just as much as
    one it runs as a Deployment.

    A variable carried by a Secret has no literal value: its value lives in
    a Secret the operator provides, and the rendered row only proves the
    chart asks for it. Those rows are recorded as SECRET so the comparison
    skips them — the chart and Compose then agree that the variable is
    required, and the operator supplies it either way.
    """
    out = {}
    for doc in docs:
        if not isinstance(doc, dict) or doc.get("kind") not in ("Deployment", "Job"):
            continue
        template = doc.get("spec", {}).get("template", {})
        labels = template.get("metadata", {}).get("labels", {})
        component = labels.get("genieai.io/component")
        if not component:
            continue
        rows = out.setdefault(component, {})
        for container in template.get("spec", {}).get("containers", []):
            for entry in container.get("env") or []:
                if "name" in entry:
                    value = entry.get("value")
                    if value is None and "valueFrom" in entry:
                        value = SECRET
                    rows[entry["name"]] = value
    return out


def chart_declared(values):
    """{component: {name: value}} from the chart's own values.

    The chart keeps the operator's environment in `services.<svc>.env` and
    `opea.<svc>.env`, as a MAP (Helm merges maps key by key, so an overlay
    that sets one variable keeps the others — a list would be replaced
    wholesale). A row declared there but not rendered still counts as
    declared: the operator can set it.
    """
    out = {}
    for section in ("services", "opea"):
        for name, block in (values.get(section) or {}).items():
            if not isinstance(block, dict):
                continue
            rows = block.get("env")
            if not rows:
                continue
            if isinstance(rows, dict):
                for var, value in rows.items():
                    out.setdefault(name, {})[var] = value
            else:
                for row in rows:
                    if isinstance(row, dict) and "name" in row:
                        out.setdefault(name, {})[row["name"]] = row.get("value")
    return out


def main(argv):
    if len(argv) < 2:
        print(__doc__)
        return 2

    args = argv[1:]
    rendered_path = args[0]
    compose_path = DEFAULT_COMPOSE
    values_path = DEFAULT_VALUES
    allowlist_path = DEFAULT_ALLOWLIST
    min_compared = 0
    for arg in args[1:]:
        if arg.startswith("--compose="):
            compose_path = arg.split("=", 1)[1]
        elif arg.startswith("--values="):
            values_path = arg.split("=", 1)[1]
        elif arg.startswith("--allowlist="):
            allowlist_path = arg.split("=", 1)[1]
        elif arg.startswith("--min-compared="):
            min_compared = int(arg.split("=", 1)[1])

    with open(rendered_path) as handle:
        docs = [d for d in yaml.safe_load_all(handle) if d]
    with open(compose_path) as handle:
        compose = yaml.safe_load(handle) or {}
    with open(values_path) as handle:
        values = yaml.safe_load(handle) or {}
    with open(allowlist_path) as handle:
        allowlist = json.load(handle)

    rendered = chart_rendered(docs)
    declared = chart_declared(values)
    services = allowlist.get("services") or {}

    gaps = []
    unjudged = []
    checked = 0
    for component, pair in sorted(services.items()):
        compose_name = pair.get("compose")
        chart_name = pair.get("chart", component)
        service = (compose.get("services") or {}).get(compose_name)
        if service is None:
            print(f"  SKIPPED {component}: no Compose service named {compose_name!r}")
            continue
        rendered_rows = rendered.get(chart_name, {})
        declared_rows = declared.get(chart_name, {})
        if not rendered_rows:
            # The chart rendered no row for this component — a tier that is
            # off for this render (the OPEA services with `opea.enabled:
            # false`). Reporting each of its variables as "absent from the
            # chart" would bury a real gap under noise and teach the reader
            # to ignore the output. Say the pair was not judged instead; CI
            # renders with the full tier on, which is the render the claim
            # is about.
            unjudged.append(
                f"{component}: not rendered in this chart render — nothing compared "
                "(render with the tier enabled to judge it)"
            )
            continue
        may_differ = pair.get("mayDiffer") or {}
        compose_only = pair.get("composeOnly") or {}
        not_read = pair.get("notRead") or {}
        code_default = pair.get("codeDefault") or {}
        secret_provided = pair.get("secretProvided") or {}
        not_applicable = pair.get("notApplicable") or {}

        for name, (value, required) in sorted(compose_vars(service).items()):
            if (
                name in compose_only
                or name in not_read
                or name in code_default
                or name in not_applicable
            ):
                continue
            if name in secret_provided:
                # The chart asks the operator for the value through a
                # Secret; there is no literal to compare.
                continue
            checked += 1
            if name in rendered_rows:
                chart_value = rendered_rows[name]
            elif name in declared_rows:
                chart_value = declared_rows[name]
            else:
                reason = (
                    "required in Compose, so the chart must carry it in a Secret"
                    if required
                    else "absent from the chart"
                )
                gaps.append(f"{component}.{name}: {reason} (Compose resolves to {value!r})")
                continue
            if name in may_differ:
                # The chart must set it; the value is the Kubernetes one.
                continue
            if required:
                # Compose has no default for it: the operator MUST set it
                # on that surface. The chart has the variable, so both
                # surfaces take it from the operator; the two values are
                # the operator's business, not a drift.
                continue
            if chart_value == SECRET:
                # Carried by a Secret on the chart side: the operator
                # supplies it, so the value cannot be compared.
                continue
            if str(chart_value) != str(value):
                gaps.append(
                    f"{component}.{name}: chart has {chart_value!r}, "
                    f"Compose resolves to {value!r} — declare it under mayDiffer if "
                    "the difference is the Kubernetes adaptation"
                )

    # The `notRead` claims, checked against the source they describe. They
    # remove variables from the compared set, and a claim nobody verifies is
    # a way to make this gate green. Every name must be absent from shipped
    # application source — tests and docs are excluded because they mention
    # configuration without reading it.
    for component, pair in sorted(services.items()):
        for name in sorted(pair.get("notRead") or {}):
            readers = verify_not_read([name]).get(name) or []
            if readers:
                gaps.append(
                    f"{component}.{name}: declared notRead, but {readers[0]} reads it "
                    f"(reclassify it, or delete the claim)"
                )

    for line in unjudged:
        print(f"  not judged: {line}")
    print(
        f"{compose_path} vs {rendered_path}: {len(services)} service pairs "
        f"({len(services) - len(unjudged)} judged), {checked} variables compared"
    )

    # Every Compose service must be accounted for: paired with a chart
    # component, or declared as having no comparable counterpart. A service
    # that is neither is a silent hole in the coverage — the gate would
    # report green while comparing nothing for it.
    unpaired = allowlist.get("unpaired") or {}
    paired_compose = {pair.get("compose") for pair in services.values()}
    for compose_name in sorted((compose.get("services") or {})):
        if compose_name in paired_compose:
            continue
        if compose_name not in unpaired:
            gaps.append(
                f"compose service {compose_name!r}: no chart counterpart declared — "
                "pair it under `services` or declare it under `unpaired` with the reason"
            )
        else:
            print(f"  not compared: {compose_name} — {unpaired[compose_name]}")
    for gap in gaps:
        print(f"  GAP {gap}")
    if checked < min_compared:
        # Every suppression category (mayDiffer, notRead, codeDefault,
        # notApplicable, composeOnly) removes variables from the compared
        # set, so growing the allowlist is a way to turn this gate green
        # without touching either surface. A floor on the number actually
        # compared makes that move visible.
        print(
            f"\nonly {checked} variables were compared, below the floor of "
            f"{min_compared}. Either the chart stopped configuring something "
            "Compose configures, or the allowlist grew. Both deserve a look."
        )
        return 1
    if gaps:
        print(
            f"\n{len(gaps)} variable(s) are configured on one surface and not the other, "
            "or configured differently. A deployment must behave the same on both. Set the "
            "variable on the missing surface, or record why it is deliberately different "
            f"in {allowlist_path}."
        )
        return 1
    print("every variable Compose sets is configured the same way by the chart")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
