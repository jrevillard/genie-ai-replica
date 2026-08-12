#!/usr/bin/env python3
"""lint_overrides.py — validate ``genie-ai-overlay/OVERRIDES.yaml``.

Implements the override-audit contract (architecture pattern 1):

* every entry carries exactly the schema keys ``override`` / ``disposition`` /
  ``owner`` / ``ticket``;
* ``disposition`` is one of ``still-needed`` / ``re-graft-to-new-API`` /
  ``obsolete-remove``;
* every entry is matched by a ``# OVERRIDE <module>.<name> | disposition: ...``
  comment record in the source tree (core/*.py and build-patches/*), and the
  record's disposition agrees with the manifest entry.

Exit code 0 on success, 1 on any violation. No third-party dependencies.
"""

import pathlib
import re
import sys

OVERLAY_ROOT = pathlib.Path(__file__).resolve().parent.parent
MANIFEST = OVERLAY_ROOT / "OVERRIDES.yaml"

VALID_DISPOSITIONS = {"still-needed", "re-graft-to-new-API", "obsolete-remove"}
REQUIRED_KEYS = ("override", "disposition", "owner", "ticket")

# Files scanned for ``# OVERRIDE`` marker records.
SCAN_PATTERNS = ("core/*.py", "build-patches/*")

# Matches ``# OVERRIDE <identifier> | disposition: <value>``
MARKER_RE = re.compile(r"#\s*OVERRIDE\s+(\S+?)\s*\|\s*disposition:\s*(\S+)")

_errors: list[str] = []


def _fail(message: str) -> None:
    _errors.append(message)


def parse_manifest(text: str) -> list[dict]:
    """Parse the constrained OVERRIDES.yaml structure (list of 4-key maps).

    Dependency-free on purpose: PyYAML is not a declared test dependency. The
    schema is locked by this linter, so a line-oriented parser is sufficient.
    """
    entries: list[dict] = []
    current: dict | None = None
    for lineno, raw in enumerate(text.splitlines(), start=1):
        line = raw.rstrip()
        stripped = line.strip()
        if not stripped or stripped.startswith("#"):
            continue
        if stripped == "overrides:":
            continue
        if stripped.startswith("- override: "):
            if current is not None:
                entries.append(current)
            current = {"_line": lineno, "override": stripped[len("- override: ") :].strip()}
            continue
        if current is not None:
            match = re.match(r"^\s+(\S+):\s*(.*)$", line)
            if match:
                current[match.group(1)] = match.group(2).strip()
                continue
        _fail(f"line {lineno}: unparsed manifest line {line!r}")
    if current is not None:
        entries.append(current)
    return entries


def scan_markers() -> dict[str, set[str]]:
    """Collect ``# OVERRIDE <id> | disposition: ...`` markers from source files.

    Returns ``{override_id: set(dispositions)}``.
    """
    found: dict[str, set[str]] = {}
    for pattern in SCAN_PATTERNS:
        for path in OVERLAY_ROOT.glob(pattern):
            if not path.is_file():
                continue
            try:
                content = path.read_text(encoding="utf-8")
            except OSError:
                continue
            for match in MARKER_RE.finditer(content):
                # Skip documentation placeholders (e.g. ``<module>.<name>``).
                if "<" in match.group(1) or ">" in match.group(1):
                    continue
                found.setdefault(match.group(1), set()).add(match.group(2))
    return found


def validate() -> int:
    try:
        manifest_text = MANIFEST.read_text(encoding="utf-8")
    except OSError as exc:
        _fail(f"cannot read {MANIFEST}: {exc}")
        return 1

    entries = parse_manifest(manifest_text)
    if not entries:
        _fail(f"{MANIFEST}: no override entries found")

    seen_ids: dict[str, int] = {}
    for entry in entries:
        override_id = entry.get("override")
        line = entry.get("_line", "?")

        extra_keys = set(entry) - set(REQUIRED_KEYS) - {"_line"}
        if extra_keys:
            _fail(f"line {line}: unexpected key(s) {sorted(extra_keys)}")
        missing_keys = [key for key in REQUIRED_KEYS if key not in entry or not entry.get(key)]
        if missing_keys:
            _fail(f"line {line}: missing or empty key(s) {missing_keys}")

        disposition = entry.get("disposition", "")
        if disposition not in VALID_DISPOSITIONS:
            _fail(f"line {line}: invalid disposition {disposition!r} (expected one of {sorted(VALID_DISPOSITIONS)})")

        if override_id in seen_ids:
            _fail(f"line {line}: duplicate override id {override_id!r} (first at line {seen_ids[override_id]})")
        seen_ids[override_id] = line

    markers = scan_markers()
    for entry in entries:
        override_id = entry.get("override")
        if override_id is None:
            continue
        line = entry.get("_line", "?")
        marker_dispositions = markers.get(override_id)
        if not marker_dispositions:
            _fail(f"line {line}: no matching '# OVERRIDE {override_id} |' record found in source tree")
            continue
        if entry.get("disposition") not in marker_dispositions:
            _fail(
                f"line {line}: '# OVERRIDE {override_id}' records use "
                f"disposition(s) {sorted(marker_dispositions)} but the manifest declares "
                f"{entry.get('disposition')!r}"
            )

    if _errors:
        for message in _errors:
            print(f"lint_overrides: error: {message}", file=sys.stderr)
        return 1
    print(f"lint_overrides: OK ({len(entries)} override entries, all matched by source records)")
    return 0


if __name__ == "__main__":
    sys.exit(validate())
