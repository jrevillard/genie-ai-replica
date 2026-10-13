# Copyright (c) 2024-2026 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0
#
# OVERRIDE build-patches.unstructured_html_pi_patch | disposition: still-needed | reason: XML processing instructions crash unstructured 0.18.32 (upstream issue #4358) | test: tests/test_unstructured_pi_patch.py  # noqa: E501

"""unstructured_html_pi_patch.py — stop XML processing instructions from
crashing ``unstructured.partition.html`` on the markdown ingestion path.

THE DEFECT (measured 2026-10-13 on the running local stack)
--------------------------------------------------------
A single concept failed ingestion with:

    Ingestion Error: 'lxml.etree._ProcessingInstruction' object has no
    attribute 'is_phrasing'

``unstructured/partition/html/parser.py:929`` builds the package's only
``etree.HTMLParser(remove_comments=True)``. Immediately after, at line 933, an
``ElementNamespaceClassLookup(fallback)`` registers GENIE's ``Flow``/``Phrasing``
classes for ``_Element`` SUBCLASSES only. An XML processing-instruction node —
an ``_Element`` that is not an ``ElementBase`` — therefore falls through to
lxml's bare class, which has no ``is_phrasing``. Three traversal sites share
that wrong assumption: lines 423, 628 and 750.

On our path this is reachable from ordinary content: ``partition_md`` renders
markdown to an HTML STRING (``md.py:76``) and hands it to ``partition_html``
(``md.py:78``). Python-Markdown passes a literal ``<?xml ... ?>`` line through
unescaped, so any source document that *teaches XML declarations* crashes the
documenter. ``PDS4_DPH_1.26.0.pdf`` does exactly that across 13 of its 155
pages, and its two affected concepts (438 and 231,890 chars) silently never
reach RAG.

WHY NOT A DOWNGRADE OR A SITE GUARD
-----------------------------------
* lxml 4.9.4 and 5.4.0 emit the identical PI node and fail identically —
  measured side by side, so version arithmetic cannot fix this.
* Guarding line 423 alone leaves 5 of 13 PI-bearing documents still crashing at
  lines 628/750, and a break-style guard merely relocates the failure to the
  ``assert not q[0].is_phrasing`` at line 360.
* Sanitising ``<?``/``<!--`` in OUR boundary deletes legitimate content: inside
  a fenced code block a comment is literal TEXT, not an HTML node, so a
  balance-checked DELETE branch strips document content that never crashed.

THE FIX
-------
This is upstream's own repair. ``unstructured`` added ``remove_pis=True`` to
that same constructor in **0.27.8** (absent in 0.18.32 - 0.27.6, present from
0.27.8), with a commit note naming this exact AttributeError as upstream issue
**#4358**. We are pinned to 0.18.32, and upgrading spans 9 minor releases across
a 374-package ``--require-hashes --no-deps`` lock, so we apply the single
constructor argument instead.

Patching the CONSTRUCTION SITE rather than any traversal site makes the module
correct by construction: ``partition.py:17`` binds the name by import and both
``etree.fromstring`` call sites inherit it. There is no next unguarded
attribute for a crash to relocate into.

Measured: 13/13 PI cases pass, and 0 changed outputs across a 138-document
corpus of previously-parsing input.

THREE OUTCOMES, NEVER A SILENT NO-OP
------------------------------------
1. unpatched  -> patch, then RE-READ and verify the on-disk post-state
2. already has ``remove_pis`` -> idempotent no-op, exit 0 (graceful once the
   pin crosses 0.27.8 and this becomes obsolete-remove)
3. neither     -> ``SystemExit`` so the IMAGE BUILD FAILS LOUDLY rather than
   shipping an image with the crash still present
"""

import importlib.metadata
import re
import site
import sys
from pathlib import Path

# The exact line upstream rewrote. Anchored so a cosmetic upstream reflow is
# NOT silently accepted as "already patched" — that is case 3, the loud failure.
UNPATCHED_LINE = "    html_parser = etree.HTMLParser(remove_comments=True)"
PATCHED_LINE = "    html_parser = etree.HTMLParser(remove_comments=True, remove_pis=True)"

# Any construction line at all, used to decide between case 2 and case 3.
ANY_CONSTRUCTION = re.compile(r"^\s*html_parser\s*=\s*etree\.HTMLParser\(", re.MULTILINE)


def parser_path() -> Path:
    """Resolve the installed parser.py via the running interpreter.

    site.getsitepackages() keeps this correct across python3.x layouts instead
    of hardcoding a versioned directory. argv[1] overrides it for tests.
    """
    if len(sys.argv) > 1:
        return Path(sys.argv[1])
    return Path(site.getsitepackages()[0]) / "unstructured" / "partition" / "html" / "parser.py"


def installed_version() -> str:
    """Version banner without importing the package (no side effects, no network)."""
    try:
        return importlib.metadata.version("unstructured")
    except importlib.metadata.PackageNotFoundError:
        return "unknown"


def apply_patch(path: Path) -> str:
    """Patch, verify idempotently, or fail loudly. Returns a short outcome label."""
    if not path.is_file():
        raise SystemExit(f"ASSERT-ON-PATCH GUARD FAILED: {path} does not exist")

    original = path.read_text(encoding="utf-8")

    if UNPATCHED_LINE in original:
        if original.count(UNPATCHED_LINE) != 1:
            raise SystemExit(
                f"ASSERT-ON-PATCH GUARD FAILED: expected exactly one unpatched constructor in {path}, "
                f"found {original.count(UNPATCHED_LINE)}"
            )
        patched = original.replace(UNPATCHED_LINE, PATCHED_LINE, 1)
        # Compile the edited source BEFORE writing it, so a botched edit can
        # never reach disk.
        compile(patched, str(path), "exec")
        path.write_text(patched, encoding="utf-8")
        # Re-read: the file on disk is the artefact that ships, so verify THAT.
        post = path.read_text(encoding="utf-8")
        if PATCHED_LINE not in post or UNPATCHED_LINE in post:
            raise SystemExit(f"ASSERT-ON-PATCH GUARD FAILED: post-write verification failed for {path}")
        return "patched"

    if ANY_CONSTRUCTION.search(original) and "remove_pis" in original:
        return "already-patched"

    raise SystemExit(
        f"ASSERT-ON-PATCH GUARD FAILED: upstream restructured partition/html/parser.py in "
        f"unstructured {installed_version()}. Expected either\n"
        f"  {UNPATCHED_LINE.strip()}\n"
        f"or a constructor already carrying remove_pis. Found neither — re-derive the patch "
        f"for {installed_version()} and update genie-ai-overlay/OVERRIDES.yaml."
    )


def main() -> int:
    path = parser_path()
    outcome = apply_patch(path)
    print(f"unstructured_html_pi_patch: {outcome} {path} (unstructured {installed_version()})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
