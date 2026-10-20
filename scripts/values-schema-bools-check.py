#!/usr/bin/env python3
"""Check that values.schema.json types every boolean leaf of values.yaml.

Why
---
Helm's `not`, `and`, `or` and `ternary` are strict about booleans: a knob
set to 0 or to the string "true" aborts the render with

    wrong type for value; expected bool; got int64

which names a template, not the value the operator actually got wrong. The
schema types every boolean leaf so the failure happens up front, with the
offending path:

    at '/observability/traces/enabled': got number, want boolean

That only works if the schema stays in step with values.yaml. A new boolean
knob that nobody typed in the schema silently loses that protection, and
nothing else notices: the chart still lints, still installs, still passes
kubeconform. This script is the guard — it fails the build when the two
lists drift apart in either direction.

Usage:
  values-schema-bools-check.py VALUES.yaml VALUES.schema.json
"""

import json
import sys

import yaml


def boolean_leaves(values, prefix=""):
    """Every dotted path in `values` whose value is a YAML boolean."""
    found = set()
    if isinstance(values, dict):
        for key, value in values.items():
            path = "%s.%s" % (prefix, key) if prefix else str(key)
            if isinstance(value, bool):
                found.add(path)
            else:
                found |= boolean_leaves(value, path)
    return found


def schema_boolean_leaves(schema, prefix=""):
    """Every dotted path the schema constrains to a boolean."""
    found = set()
    if not isinstance(schema, dict):
        return found
    for key, value in (schema.get("properties") or {}).items():
        path = "%s.%s" % (prefix, key) if prefix else str(key)
        if not isinstance(value, dict):
            continue
        if value.get("type") == "boolean":
            found.add(path)
        else:
            found |= schema_boolean_leaves(value, path)
    return found


def main(argv):
    if len(argv) != 3:
        print(__doc__)
        return 2
    values_path, schema_path = argv[1], argv[2]
    with open(values_path) as handle:
        values = yaml.safe_load(handle)
    with open(schema_path) as handle:
        schema = json.load(handle)

    in_values = boolean_leaves(values)
    in_schema = schema_boolean_leaves(schema)

    missing = sorted(in_values - in_schema)
    extra = sorted(in_schema - in_values)

    if missing:
        print("values.yaml booleans with no schema type constraint:")
        for path in missing:
            print("  - %s" % path)
    if extra:
        print("schema boolean constraints with no matching values.yaml leaf:")
        for path in extra:
            print("  - %s" % path)

    if missing or extra:
        print(
            "\n%d missing, %d stale — Helm aborts the render on a wrongly-typed\n"
            "boolean with a message naming a template instead of the value. Add\n"
            "the constraint (or drop it) so the error points at the operator's\n"
            "actual mistake." % (len(missing), len(extra))
        )
        return 1

    print(
        "values.schema.json types all %d boolean leaves of values.yaml"
        % len(in_values)
    )
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))