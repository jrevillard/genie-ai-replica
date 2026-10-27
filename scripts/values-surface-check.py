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

Every static `.Values.a.b.c` chain in charts/genieai-umbrella/templates/
(Go template comments stripped first — a key named in a comment is
documentation, not a read) must be present in values.yaml, at any level
(a dict key counts: reading `.Values.opea.gpu` as a map is a declared
read of `opea.gpu`).

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
ALLOWLIST = {
    "services.backend.translation.backend",
}


def template_reads(templates_dir):
    """Static `.Values...` chains across the templates, comments stripped."""
    reads = {}
    for path in sorted(templates_dir.rglob("*")):
        if path.suffix not in (".tpl", ".yaml", ".yml"):
            continue
        text = path.read_text(encoding="utf-8", errors="replace")
        # Go template comments (single- and multi-line). A key named in a
        # comment documents the mechanism; it is not a read.
        text = re.sub(r"\{\{-?\s*/\*.*?\*/\s*-?\}\}", "", text, flags=re.S)
        for lineno, line in enumerate(text.splitlines(), 1):
            for m in re.finditer(r"\.Values((?:\.[a-zA-Z][a-zA-Z0-9_]*)+)", line):
                chain = m.group(1).lstrip(".")
                if not chain:
                    continue
                reads.setdefault(chain, []).append(f"{path.relative_to(CHART)}:{lineno}")
    return reads


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


def main():
    reads = template_reads(CHART / "templates")
    declared = declared_keys(CHART / "values.yaml")
    missing = {
        key: sites
        for key, sites in reads.items()
        if key not in declared and key not in ALLOWLIST
    }
    for key in sorted(missing):
        print(f"UNDECLARED {key} — read at {missing[key][0]}"
              f"{' (+%d more)' % (len(missing[key]) - 1) if len(missing[key]) > 1 else ''}")
    if missing:
        print(
            f"\n{len(missing)} template-read keys are not declared in values.yaml. "
            "Declare each with its template default (so an operator can discover "
            "the knob and its type), or add it to the ALLOWLIST in this script "
            "with the reason if the template consumes it only to reject it."
        )
        return 1
    print(f"all {len(reads)} template-read values keys are declared in values.yaml")
    return 0


if __name__ == "__main__":
    sys.exit(main())
