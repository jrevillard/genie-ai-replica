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
    """Every dotted path in `values` whose value is a YAML boolean.

    Lists are walked too, and a boolean inside one yields an indexed
    path (`foo.bar[0].enabled`). Such a path can never match the schema
    side — JSON Schema types an array's ITEMS, not each index — so
    `main` reports those separately instead of failing on them: they are
    a real coverage gap, but demanding a dotted constraint for them
    would be asking for something the schema cannot express.
    """
    found = set()
    if isinstance(values, dict):
        for key, value in values.items():
            path = f"{prefix}.{key}" if prefix else str(key)
            if isinstance(value, bool):
                found.add(path)
            else:
                found |= boolean_leaves(value, path)
    elif isinstance(values, list):
        for index, value in enumerate(values):
            if isinstance(value, bool):
                found.add(f"{prefix}[{index}]")
            else:
                found |= boolean_leaves(value, f"{prefix}[{index}]")
    return found


def schema_boolean_leaves(schema, prefix=""):
    """Every dotted path the schema constrains to a boolean."""
    found = set()
    if not isinstance(schema, dict):
        return found
    for key, value in (schema.get("properties") or {}).items():
        path = f"{prefix}.{key}" if prefix else str(key)
        if not isinstance(value, dict):
            continue
        if value.get("type") == "boolean":
            found.add(path)
        else:
            found |= schema_boolean_leaves(value, path)
    return found


def no_duplicate_keys(pairs):
    """A JSON object with the same key twice.

    `json.load` keeps the LAST occurrence and says nothing: a schema
    that types a knob twice — once correctly, once wrongly — silently
    loses the first constraint, and the render that was supposed to
    fail with "at '/x/y': got number, want boolean" installs instead.
    """
    seen = set()
    for key, value in pairs:
        if key in seen:
            raise ValueError(f"duplicate key {key!r} in the schema")
        seen.add(key)
    return dict(pairs)


def main(argv):
    if len(argv) != 3:
        print(__doc__)
        return 2
    values_path, schema_path = argv[1], argv[2]
    with open(values_path) as handle:
        values = yaml.safe_load(handle)
    with open(schema_path) as handle:
        try:
            schema = json.load(handle, object_pairs_hook=no_duplicate_keys)
        except ValueError as error:
            print(f"values.schema.json: {error}")
            return 1

    in_values = boolean_leaves(values)
    in_schema = schema_boolean_leaves(schema)

    # Indexed paths live inside an array: the schema types the array's
    # items, not each index, so there is no dotted constraint that could
    # ever match. Reported, never failed on — but no longer invisible.
    indexed = sorted(p for p in in_values if "[" in p)
    dotted = in_values - set(indexed)

    missing = sorted(dotted - in_schema)
    extra = sorted(in_schema - in_values)

    if missing:
        print("values.yaml booleans with no schema type constraint:")
        for path in missing:
            print(f"  - {path}")
    if extra:
        print("schema boolean constraints with no matching values.yaml leaf:")
        for path in extra:
            print(f"  - {path}")
    if indexed:
        print(
            "booleans inside a list — OUTSIDE this gate's reach (JSON Schema types"
        )
        print(
            "  an array's items, not each index), so a wrong type there is not caught:"
        )
        for path in indexed:
            print(f"  - {path}")

    if missing or extra:
        print(
            f"\n{len(missing)} missing, {len(extra)} stale — Helm aborts the render "
            "on a wrongly-typed\nboolean with a message naming a template instead "
            "of the value. Add\nthe constraint (or drop it) so the error points at "
            "the operator's\nactual mistake."
        )
        return 1

    print(
        f"values.schema.json types all {len(dotted)} boolean leaves of values.yaml"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))