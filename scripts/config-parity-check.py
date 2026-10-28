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
from pathlib import Path

import yaml

# The repository root, resolved from THIS FILE. Every default path and
# the source walk below are anchored on it: a relative path only works
# when the script is run from the repository root, and from anywhere
# else the notRead walk found nothing — so every claim passed
# unverified and the gate reported green on a claim that was false.
REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# The defaults are resolved from the repository root, not the working
# directory: the gate is run from the repo root in CI, but a developer
# running it from scripts/ (or any other directory) got a gate that
# could not find its inputs — and, worse, one whose source walk found
# nothing and therefore passed every notRead claim unverified.
DEFAULT_COMPOSE = os.path.join(REPO_ROOT, "docker-compose.yaml")
DEFAULT_VALUES = os.path.join(REPO_ROOT, "charts/genieai-umbrella/values.yaml")
DEFAULT_ALLOWLIST = os.path.join(REPO_ROOT, "scripts/config-parity-allowlist.json")
# Where a codeDefault variable must be DOCUMENTED. A codeDefault variable
# is one the chart leaves unset on purpose — but "unset on purpose" is
# only sound if the operator who wants to set it can find it. The chart
# must mention it somewhere an operator reads: the values file (a comment
# on the knob), the chart README, or the template that would carry the
# env row. Not the allowlist itself — the allowlist is the claim, not the
# documentation.
DEFAULT_CHART_DOC_ROOTS = (os.path.join(REPO_ROOT, "charts/genieai-umbrella"),)

# Source roots and what counts as shipped application source.
#
# The claim being checked is "read by no SERVICE". Tests are excluded
# because that is what the claim says: a variable a test reads is still
# unread by anything a deployment runs, so a test-only read leaves the
# claim true. This filter is correct for THAT claim and would be wrong for
# the opposite one ("must be read somewhere"), where excluding tests turns
# a false pass into a silent one. State the claim first; the filter
# follows from it.
#
# Excluded for the same reason: `contracts/` (the suite that runs against
# the real vendored comps) and vendored/installed trees — node_modules is
# installed in the working tree this script walks, so skipping it is load-
# bearing, not decoration.
SOURCE_ROOTS = (
    os.path.join(REPO_ROOT, "components"),
    os.path.join(REPO_ROOT, "genie-ai-overlay"),
)
SOURCE_SKIP_DIRS = {
    "node_modules", ".git", ".venv", "venv", "__pycache__", ".pytest_cache",
    "dist", "build", "coverage", "tests", "test", "__tests__", ".cache",
    "migrations_backup", "contracts",
}
# `.sh` because the frontend and backend entrypoints write the runtime
# configuration the browser reads (`window.APP_CONFIG`), so they are a
# delivery surface for `VUE_APP_*`, not plumbing.
SOURCE_SUFFIXES = (".js", ".py", ".vue", ".ts", ".mjs", ".cjs", ".sh")
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


def env_file_defaults():
    """NAME -> value from the committed `env` template — the canonical
    default source a `cp env .env` deployment interpolates from."""
    out = {}
    try:
        for line in (Path(REPO_ROOT) / "env").read_text().splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            name, _, val = line.partition("=")
            out[name.strip()] = val.strip().strip('"').strip("'")
    except OSError:
        pass
    return out


_ENV_DEFAULTS = None


def compose_default(value):
    """The value a Compose variable resolves to when the operator sets nothing.

    Returns (resolved, required). `required` is True for a WHOLE-VALUE
    `${NAME}` with no fallback: the operator MUST set it, which the chart
    has to reproduce (through a Secret), so it is not comparable to a
    chart default.

    A value that only CONTAINS an interpolation (`URL=${HOST}:8080`) is
    resolved against the env template — comparing the literal `${...}`
    text compared a string no container ever sees (Compose interpolates
    an unset variable to the empty string).
    """
    global _ENV_DEFAULTS
    text = str(value)
    match = _INTERP.fullmatch(text)
    if match:
        fallback = match.group(2)
        if fallback is None:
            return "", True
        return fallback, False
    if "${" in text:
        if _ENV_DEFAULTS is None:
            _ENV_DEFAULTS = env_file_defaults()

        def sub(m):
            name, fallback = m.group(1), m.group(2)
            if fallback is not None:
                return fallback
            return _ENV_DEFAULTS.get(name, "")

        return _INTERP.sub(sub, text), False
    return text, False


def compose_vars(service):
    """{name: (effective value, required)} for a Compose service."""
    environment = service.get("environment") or []
    if isinstance(environment, dict):
        # A YAML null in dict form (`KEY:` with no value) is an UNSET
        # variable, which Compose resolves to the empty string. f-string
        # interpolation turned it into the literal text "None", and the
        # gate then compared that text against the chart's value.
        environment = [f"{k}=" if v is None else f"{k}={v}" for k, v in environment.items()]
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
    envfrom = {}
    for doc in docs:
        if not isinstance(doc, dict) or doc.get("kind") not in ("Deployment", "Job"):
            continue
        template = doc.get("spec", {}).get("template", {})
        labels = template.get("metadata", {}).get("labels", {})
        component = labels.get("genieai.io/component")
        if not component:
            continue
        rows = out.setdefault(component, {})
        mounts = envfrom.setdefault(component, set())
        for container in template.get("spec", {}).get("containers", []):
            for entry in container.get("env") or []:
                if "name" in entry:
                    value = entry.get("value")
                    if value is None and "valueFrom" in entry:
                        value = SECRET
                    rows[entry["name"]] = value
            for entry in container.get("envFrom") or []:
                ref = entry.get("secretRef") or {}
                if ref.get("name"):
                    mounts.add(ref["name"])
    return out, envfrom


# A service's values key can differ from the pod LABEL the chart gives
# its workload. The declared env rows are indexed by that label (the
# caller looks them up by component), so the mapping has to be explicit
# for the services where the two differ.
VALUES_KEY_TO_COMPONENT = {
    "redisCache": "redis-cache",
}


def chart_declared(values):
    """{component: {name: value}} from the chart's own values.

    The chart keeps the operator's environment in `services.<svc>.env` and
    `opea.<svc>.env`, as a MAP (Helm merges maps key by key, so an overlay
    that sets one variable keeps the others — a list would be replaced
    wholesale). A row declared there but not rendered still counts as
    declared: the operator can set it.

    The rows are indexed by the COMPONENT LABEL, which is how the caller
    looks them up — and a values key can differ from it (the redis
    service: values key `redisCache`, pod label `redis-cache`). Without
    the mapping below the lookup always came up empty for that service,
    so its declared rows were unreachable and an operator setting one
    got a false "absent from the chart" gap instead of a comparison.
    """
    out = {}
    for section in ("services", "opea"):
        for name, block in (values.get(section) or {}).items():
            if not isinstance(block, dict):
                continue
            rows = block.get("env")
            if not rows:
                continue
            component = VALUES_KEY_TO_COMPONENT.get(name, name)
            if isinstance(rows, dict):
                for var, value in rows.items():
                    out.setdefault(component, {})[var] = value
            else:
                for row in rows:
                    if isinstance(row, dict) and "name" in row:
                        out.setdefault(component, {})[row["name"]] = row.get("value")
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

    # One pass over the chart's operator-facing text: values.yaml, the
    # chart README, and every template. A codeDefault variable must be
    # mentioned in at least one of them. `files/` is EXCLUDED: it holds
    # vendored data copies (the realm import, the inlined dashboards) —
    # a name appearing there is data flowing through, not documentation
    # an operator would find.
    chart_doc_text = ""
    for root in DEFAULT_CHART_DOC_ROOTS:
        for path in Path(root).rglob("*"):
            if "files" in path.relative_to(root).parts:
                continue
            # .json too: values.schema.json carries the operator-facing
            # descriptions the schema gate maintains — a knob documented
            # only there is discoverable and must not fail this check.
            # (Chart.lock is also .json; its URLs cannot collide with a
            # variable name in practice.)
            if path.is_file() and path.suffix in (".yaml", ".yml", ".md", ".tpl", ".json"):
                try:
                    chart_doc_text += path.read_text(encoding="utf-8", errors="replace")
                except OSError:
                    pass

    rendered, rendered_envfrom = chart_rendered(docs)
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
        if chart_name not in rendered:
            # The chart rendered no POD for this component — a tier that
            # is off for this render (the OPEA services with
            # `opea.enabled: false`). Reporting each of its variables as
            # "absent from the chart" would bury a real gap under noise
            # and teach the reader to ignore the output. Say the pair was
            # not judged instead; CI renders with the full tier on, which
            # is the render the claim is about. A rendered pod with ZERO
            # env rows is a different case and stays judged: Compose
            # configuring a service the chart runs bare is exactly the
            # divergence this gate exists for.
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
                or name in not_applicable
            ):
                continue
            if name in code_default:
                # Unset on purpose is only sound if the operator who wants
                # the knob can find it. The chart must mention the name
                # somewhere an operator reads. The match is token-exact:
                # a bare substring would let `PORT` ride on every
                # `EX-PORT`/`EMAIL_PORT`/prose `passports` in the corpus,
                # which is precisely the not-findable-knob failure this
                # check exists to catch.
                if not re.search(rf"(?<![A-Za-z0-9_]){re.escape(name)}(?![A-Za-z0-9_])", chart_doc_text):
                    gaps.append(
                        f"{component}.{name}: filed codeDefault, but the chart never mentions "
                        "the name (values.yaml / README / templates) — document the knob, "
                        "or file it under another category if it is not an operator knob"
                    )
                # The claim has TWO halves and only the first (the name
                # is documented) was checked: Compose must leave the
                # variable unset AND the chart must leave it unset too.
                # A chart that renders a real value (OPEA_SSL_SKIP_VERIFY:
                # 1) while Compose resolves it empty is exactly the
                # divergence this category exists to catch — and the
                # `continue` below skipped it.
                if value not in ("", None):
                    gaps.append(
                        f"{component}.{name}: filed codeDefault, but Compose resolves "
                        f"{value!r} — a code default applies only when the variable is "
                        "unset (reclassify it under mayDiffer)"
                    )
                chart_value = rendered_rows.get(name, declared_rows.get(name))
                if chart_value not in (None, ""):
                    gaps.append(
                        f"{component}.{name}: filed codeDefault, but the chart renders "
                        f"{chart_value!r} — a code default applies only when the chart "
                        "leaves the variable unset (reclassify it under mayDiffer)"
                    )
                continue
            if name in secret_provided:
                # The chart asks the operator for the value through a
                # Secret; there is no literal to compare. The WIRING is
                # still asserted: a category that only suppresses the
                # comparison is the suppression-nobody-checks failure —
                # a refactor that removes the Secret mount leaves the
                # variable undelivered while the gate stays green.
                spec = secret_provided[name]
                if not isinstance(spec, dict) or "via" not in spec or "secret" not in spec:
                    gaps.append(
                        f"{component}.{name}: secretProvided entry must be an object "
                        "with 'why', 'secret' and 'via' (envFrom | secretKeyRef) — "
                        "an uncheckable string is the suppression nobody checks"
                    )
                elif spec["via"] == "envFrom":
                    if spec["secret"] not in rendered_envfrom.get(chart_name, set()):
                        gaps.append(
                            f"{component}.{name}: filed secretProvided via envFrom on "
                            f"Secret '{spec['secret']}', but the rendered {chart_name} "
                            "pod mounts no such Secret — the wiring was removed"
                        )
                else:  # secretKeyRef
                    if rendered_rows.get(name) is not SECRET:
                        gaps.append(
                            f"{component}.{name}: filed secretProvided via secretKeyRef, "
                            f"but the rendered {chart_name} pod carries no such env row "
                            "— the wiring was removed"
                        )
                continue
            if name in rendered_rows:
                chart_value = rendered_rows[name]
            elif name in declared_rows:
                chart_value = declared_rows[name]
            else:
                checked += 1
                reason = (
                    "required in Compose, so the chart must carry it in a Secret"
                    if required
                    else "absent from the chart"
                )
                gaps.append(f"{component}.{name}: {reason} (Compose resolves to {value!r})")
                continue
            if name in may_differ:
                # The chart must set it; the value is the Kubernetes one.
                # Not counted toward the floor: the floor exists so a
                # growing allowlist cannot quietly green the gate, and
                # this category is exactly the comparison the floor is
                # meant to notice losing.
                #
                # The category used to assert NOTHING: it skipped the
                # comparison and moved on, so an entry filed "the
                # addresses differ" could carry a behavioural switch
                # (a chart that POINTS at a service Compose never
                # names) and the gate reported green. The claim in the
                # docstring — "the chart must set it" — is now
                # asserted: the chart renders its own Kubernetes value,
                # and it is not empty.
                chart_value = rendered_rows.get(name, declared_rows.get(name))
                if chart_value in (None, ""):
                    gaps.append(
                        f"{component}.{name}: filed mayDiffer — the chart must SET its "
                        f"Kubernetes value, but it renders {chart_value!r} (a variable "
                        "nobody sets is not a difference: file it under codeDefault, "
                        "which asserts the chart leaves it unset)"
                    )
                continue
            checked += 1
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
    not_read_names = [
        name
        for _, pair in sorted(services.items())
        for name in sorted(pair.get("notRead") or {})
    ]
    readers_by_name = verify_not_read(not_read_names)
    for component, pair in sorted(services.items()):
        for name in sorted(pair.get("notRead") or {}):
            readers = readers_by_name.get(name) or []
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
    # The other direction: a chart component with no Compose counterpart
    # is outside the gate's coverage — the docstring says a surface is
    # reported whichever way it points, and only the Compose side was
    # walked. The component identity is the pod LABEL the chart renders
    # (a values key can differ: the redis service's values key is
    # `redisCache`, its pod label `redis-cache`).
        # The same expression the comparison loop uses: a pair without an
    # explicit `chart` key resolves to the compose component name, and
    # reading it as None made the "other direction" loop report the
    # pair's OWN chart component as unpaired.
    paired_chart = {pair.get("chart", component) for component, pair in services.items()}
    for chart_component in sorted(rendered.keys()):
        if chart_component in paired_chart:
            continue
        if chart_component in unpaired:
            print(f"  not compared: {chart_component} (chart) — {unpaired[chart_component]}")
            continue
        gaps.append(
            f"chart component {chart_component!r}: no Compose counterpart declared — pair it "
            "under `services` or declare it under `unpaired` with the reason"
        )
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
