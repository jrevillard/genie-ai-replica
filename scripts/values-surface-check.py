#!/usr/bin/env python3
"""Check that every template-read values key is declared in values.yaml.

Why this exists
---------------

values.yaml opens with a claim: the keys below are the ones the current
template surface consumes. A key a template reads through `| default X`
but that values.yaml does not declare is undiscoverable — an operator
tuning the reranker has to read template source to learn the knob exists,
and a fat-fingered key (`rerankingStratagy`) merges into the values and is
silently ignored with lint, the schema gate and the parity checker all
green. One round of review found seventy-eight such keys under `opea.*`
alone; this gate keeps the count at zero.

What is checked
---------------

Two surfaces:

1. Every static `.Values.a.b.c` chain in charts/genieai-umbrella/templates/
   (Go template comments stripped first — a key named in a comment is
   documentation, not a read) must be present in values.yaml, at any level
   (a dict key counts: reading `.Values.opea.gpu` as a map is a declared
   read of `opea.gpu`).

2. Every `$svc.a.b` chain (the per-service alias the service factory and
   the service templates bind to `services.<slug>`) must be covered by
   the union of the per-service keys actually declared under
   `services.*` plus the keys the values.yaml "Per-service entry shape"
   comment block documents. The shape block is the operator-facing
   contract for optional per-service knobs that no single service
   declares; this gate keeps it from drifting off the factory surface.

Reads in the genieai-common library are out of scope: the library is
context-driven (its helpers receive the parent's values as `$ctx`), and
its knobs (`component`) are documented at the call sites that pass them.

Exits non-zero and prints one `UNDECLARED` line per missing key.
"""

import re
import sys
from pathlib import Path

import yaml

CHART = Path(__file__).resolve().parent.parent / "charts" / "genieai-umbrella"

# Keys a template consumes but values.yaml must not declare. Each entry
# is a guard, not a knob: the template reads the key only to REJECT it
# (the fail message names it), so declaring it with a default would
# advertise a setting the chart refuses to honour.
#
# The smtp leaves are the second kind: the BLOCK is declared null because
# its nullness IS the switch ("no mail server declared" — the render then
# fails when verifyEmail or resetPasswordAllowed is on). Declaring a leaf
# would make the block a non-empty map, the guard would see a mail server,
# and the protection would be lost. The block's shape is documented in the
# comment above `smtp: null` (from, host, port, ssl, starttls, auth, user)
# and the operator sets them in the overlay.
ALLOWLIST = {
    "services.backend.translation.backend",
    "data.keycloak.smtp.auth",
    "data.keycloak.smtp.from",
    "data.keycloak.smtp.host",
    "data.keycloak.smtp.port",
    "data.keycloak.smtp.ssl",
    "data.keycloak.smtp.starttls",
    "data.keycloak.smtp.user",
}


def strip_go_comments(text):
    """Go template comments (single- and multi-line). A key named in a
    comment documents the mechanism; it is not a read."""
    return re.sub(r"\{\{-?\s*/\*.*?\*/\s*-?\}\}", "", text, flags=re.S)


# A template that NORMALIZES a block (`{{- $keycloak := .Values.data.keycloak
# | default dict -}}`) reads its leaves through the variable
# (`$keycloak.enabled`), and those reads are invisible to a scan of the
# literal `.Values` chains: the coverage this gate claims would shrink
# with every normalization. The variable's chain is therefore resolved
# back to the values path — `$keycloak.enabled` is read as
# `data.keycloak.enabled` — so a typo in a normalized leaf is still an
# UNDECLARED read.
NORMALIZE = re.compile(
    r"\$(\w+)\s*:=\s*(?:deepCopy\s+)?\.Values((?:\.[a-zA-Z][a-zA-Z0-9_]*)*)"
)


def template_reads(templates_dir):
    """Static `.Values...` chains across the templates, comments stripped."""
    reads = {}
    for path in sorted(templates_dir.rglob("*")):
        if path.suffix not in (".tpl", ".yaml", ".yml"):
            continue
        text = strip_go_comments(path.read_text(encoding="utf-8", errors="replace"))
        # The normalized variables of THIS file: name -> values chain.
        normalized = {}
        for m in NORMALIZE.finditer(text):
            normalized[m.group(1)] = m.group(2).lstrip(".")
        for lineno, line in enumerate(text.splitlines(), 1):
            for m in re.finditer(r"\.Values((?:\.[a-zA-Z][a-zA-Z0-9_]*)+)", line):
                chain = m.group(1).lstrip(".")
                if not chain:
                    continue
                reads.setdefault(chain, []).append(f"{path.relative_to(CHART)}:{lineno}")
            if not normalized:
                continue
            for m in re.finditer(r"\$(\w+)((?:\.[a-zA-Z][a-zA-Z0-9_]*)+)", line):
                base = normalized.get(m.group(1))
                if base is None:
                    continue
                chain = ".".join(part for part in (base, m.group(2).lstrip(".")) if part)
                if not chain:
                    continue
                reads.setdefault(chain, []).append(f"{path.relative_to(CHART)}:{lineno}")
    return reads


def svc_reads(templates_dir):
    """`$svc.a.b` chains — the per-service alias surface."""
    reads = {}
    for path in sorted(templates_dir.rglob("*")):
        if path.suffix not in (".tpl", ".yaml", ".yml"):
            continue
        text = strip_go_comments(path.read_text(encoding="utf-8", errors="replace"))
        for lineno, line in enumerate(text.splitlines(), 1):
            for m in re.finditer(r"\$svc\.([a-zA-Z][a-zA-Z0-9_.]*)", line):
                chain = m.group(1).rstrip(".")
                if not chain:
                    continue
                reads.setdefault(chain, []).append(f"{path.relative_to(CHART)}:{lineno}")
    return reads


def shape_block_keys(values_text):
    """Keys the `# Per-service entry shape:` comment block documents —
    the lines shaped `#   key:` between that heading and the FIRST blank
    line, which ends the block. Stopping anywhere later would fold
    unrelated commented examples (values.yaml is dense with them) into
    the accepted $svc surface and over-permit undeclared keys."""
    keys = set()
    in_block = False
    for line in values_text.splitlines():
        if "Per-service entry shape:" in line:
            in_block = True
            continue
        if in_block:
            if not line.strip():
                break
            m = re.match(r"#\s+([a-zA-Z][a-zA-Z0-9_.]*):", line)
            if m:
                keys.add(m.group(1))
            elif not line.lstrip().startswith("#"):
                break
    return keys


def declared_keys(values_path):
    values = yaml.safe_load(values_path.read_text()) or {}
    keys = set()

    def walk(node, prefix):
        for name, child in node.items():
            path = f"{prefix}.{name}" if prefix else name
            keys.add(path)
            if isinstance(child, dict):
                walk(child, path)

    walk(values, "")
    return keys


def per_service_surface(values):
    """The accepted `$svc.<key>` surface: the union of the keys declared
    under each services.* entry, plus the shape-comment contract."""
    surface = set()

    def walk(node, prefix):
        for name, child in (node or {}).items():
            path = f"{prefix}.{name}" if prefix else name
            surface.add(path)
            if isinstance(child, dict):
                walk(child, path)

    for svc in (values.get("services") or {}).values():
        walk(svc, "")
    surface |= shape_block_keys(values_path.read_text())
    return surface


values_path = CHART / "values.yaml"


def main():
    reads = template_reads(CHART / "templates")
    declared = declared_keys(values_path)
    missing = {
        key: sites
        for key, sites in reads.items()
        if key not in declared and key not in ALLOWLIST
    }
    for key in sorted(missing):
        print(f"UNDECLARED {key} — read at {missing[key][0]}"
              f"{' (+%d more)' % (len(missing[key]) - 1) if len(missing[key]) > 1 else ''}")

    svc_surface = per_service_surface(yaml.safe_load(values_path.read_text()) or {})
    svc_read_map = svc_reads(CHART / "templates")
    svc_missing = {}
    for key, sites in svc_read_map.items():
        if key in svc_surface:
            continue
        parent = key.rsplit(".", 1)[0]
        if parent in svc_surface:
            continue
        svc_missing[key] = sites
    for key in sorted(svc_missing):
        print(f"UNDECLARED-SHAPE services.<slug>.{key} — read at {svc_missing[key][0]}"
              f"{' (+%d more)' % (len(svc_missing[key]) - 1) if len(svc_missing[key]) > 1 else ''}")

    total = len(missing) + len(svc_missing)
    if total:
        print(
            f"\n{total} template-read keys are not declared. Declare each with its "
            "template default (so an operator can discover the knob and its type), "
            "add per-service knobs to the `Per-service entry shape` block in "
            "values.yaml, or add it to the ALLOWLIST in this script with the reason "
            "if the template consumes it only to reject it."
        )
        return 1
    print(f"all {len(reads)} values reads and {len(svc_read_map)}"
          " per-service reads are declared")
    return 0


if __name__ == "__main__":
    sys.exit(main())
