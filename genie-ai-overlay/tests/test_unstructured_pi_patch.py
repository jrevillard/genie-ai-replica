# Copyright (c) 2024-2026 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0
"""
Tests for build-patches/unstructured_html_pi_patch.py.

The patch exists because an XML processing instruction in a concept body
crashes `unstructured.partition.html` (upstream issue #4358), silently costing
whole concepts from RAG — measured on the local stack 2026-10-13: two concepts,
438 and 231,890 chars, both from a source PDF that teaches XML prologs.

NON-VACUITY. The guard tests below are the load-bearing ones: they prove the
build FAILS when the patch cannot be applied, rather than shipping an image
with the crash still present. A patcher that silently no-ops is worse than no
patcher, because the image builds and the bug ships.
"""

import importlib.util
import sys
from pathlib import Path

import pytest

PATCHER = Path(__file__).resolve().parents[1] / "build-patches" / "unstructured_html_pi_patch.py"


def _load_module():
    """Load the patcher by path — it lives outside the package tree."""
    spec = importlib.util.spec_from_file_location("unstructured_html_pi_patch", PATCHER)
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


mod = _load_module()

UNPATCHED = "html_parser = etree.HTMLParser(remove_comments=True)\n"
PATCHED = "html_parser = etree.HTMLParser(remove_comments=True, remove_pis=True)\n"
INDENTED_UNPATCHED = "    html_parser = etree.HTMLParser(remove_comments=True)\n"

# A minimal but SYNTACTICALLY VALID stand-in for the real parser module: the
# patcher compile()s its output, so a fragment would not exercise the guard.
# The constructor sits at COLUMN 0 exactly as it does in the installed
# unstructured 0.18.32 — verified with `cat -A` on parser.py:929 inside the
# running dataprep image. A fixture that ASSUMED an indent would have let the
# patcher pass its own tests and then failed the image build on first contact
# with the real file.
FAKE_PARSER = (
    "from lxml import etree\n\nclass Flow:\n    pass\n\n" + UNPATCHED + "def build():\n    return html_parser\n"
)


def has_patched_constructor(body: str) -> bool:
    """Assert the exact patched line, not merely that 'remove_pis' appears.

    Checking for the substring alone would pass if remove_pis landed anywhere
    else in the file, which is precisely the mistake the guard exists to catch.
    """
    return "etree.HTMLParser(remove_comments=True, remove_pis=True)" in body


@pytest.fixture
def unpatched_file(tmp_path):
    p = tmp_path / "parser.py"
    # newline="" so the fixture is LF regardless of host OS — a Windows default
    # of CRLF here made six tests fail while the suite summary said otherwise.
    with p.open("w", encoding="utf-8", newline="") as handle:
        handle.write(FAKE_PARSER)
    return p


def test_patches_the_unpatched_constructor(unpatched_file):
    assert mod.apply_patch(unpatched_file) == "patched"
    body = unpatched_file.read_text(encoding="utf-8")
    assert has_patched_constructor(body), "remove_pis=True must be on the constructor line"
    assert UNPATCHED not in body


def test_patch_preserves_line_endings(tmp_path):
    """A one-line patch must not rewrite the file's line endings.

    Regression: the first implementation used read_text/write_text, whose
    newline=None translates LF to os.linesep on write. A dry run on Windows
    turned all 1018 lines of the real parser.py into CRLF, so a single-argument
    change looked like a whole-file rewrite. The image builds on Linux, so CI
    would never have caught it — only a host-agnostic test does.
    """
    p = tmp_path / "parser.py"
    original = FAKE_PARSER.replace("\n", "\r\n").encode("utf-8")
    p.write_bytes(original)
    assert mod.apply_patch(p) == "patched"
    raw = p.read_bytes()
    assert b"\r\n" in raw, "fixture should be CRLF"
    assert b", remove_pis=True)" in raw, "the patch must have been applied"
    # Undo exactly the patch and demand the ORIGINAL BYTES back. Anything else —
    # a re-indent, a rewritten line ending — shows up as a mismatch here.
    assert raw.replace(b", remove_pis=True)", b")") == original
    # And a pure-LF file must stay pure-LF.
    q = tmp_path / "lf.py"
    with q.open("w", encoding="utf-8", newline="") as handle:
        handle.write(FAKE_PARSER)
    mod.apply_patch(q)
    assert b"\r\n" not in q.read_bytes(), "LF input must not be rewritten to CRLF"


def test_patches_an_indented_constructor_preserving_indent(tmp_path):
    """Indentation must be captured and reapplied, not assumed.

    The installed file happens to sit at column 0; an upstream reflow into a
    function body must still patch, and must not lose its indent.
    """
    p = tmp_path / "parser.py"
    p.write_text(
        "from lxml import etree\n\n\ndef build():\n" + INDENTED_UNPATCHED + "    return html_parser\n",
        encoding="utf-8",
    )
    assert mod.apply_patch(p) == "patched"
    body = p.read_text(encoding="utf-8")
    assert "    html_parser = etree.HTMLParser(remove_comments=True, remove_pis=True)" in body
    compile(body, str(p), "exec")


def test_rejects_two_indented_constructors(tmp_path):
    p = tmp_path / "parser.py"
    p.write_text(
        "from lxml import etree\n\n\ndef a():\n"
        + INDENTED_UNPATCHED
        + "    return 1\n\n\ndef b():\n"
        + INDENTED_UNPATCHED
        + "    return 2\n",
        encoding="utf-8",
    )
    with pytest.raises(SystemExit, match="ASSERT-ON-PATCH GUARD FAILED"):
        mod.apply_patch(p)


def test_rejects_duplicate_constructor_lines(tmp_path):
    # An upstream file with the line twice is not something we should guess at.
    p = tmp_path / "parser.py"
    p.write_text("from lxml import etree\n" + UNPATCHED + UNPATCHED, encoding="utf-8")
    with pytest.raises(SystemExit, match="ASSERT-ON-PATCH GUARD FAILED"):
        mod.apply_patch(p)


def test_is_idempotent(unpatched_file):
    mod.apply_patch(unpatched_file)
    # The graceful path that matters once the pin crosses unstructured 0.27.8:
    # re-running must not fail the build.
    assert mod.apply_patch(unpatched_file) == "already-patched"
    assert has_patched_constructor(unpatched_file.read_text(encoding="utf-8"))


def test_guard_fails_when_upstream_restructures(tmp_path):
    """THE LOAD-BEARING TEST.

    A parser.py whose constructor we do not recognise must abort the BUILD.
    Without this, the patcher would no-op and ship an image that still crashes.
    """
    p = tmp_path / "parser.py"
    p.write_text(
        "from lxml import etree\n"
        "\n"
        "def build():\n"
        "    html_parser = etree.HTMLParser(remove_comments=True, huge_tree=True)\n"
        "    return html_parser\n",
        encoding="utf-8",
    )
    with pytest.raises(SystemExit, match="ASSERT-ON-PATCH GUARD FAILED"):
        mod.apply_patch(p)


def test_guard_fails_on_missing_file(tmp_path):
    with pytest.raises(SystemExit, match="ASSERT-ON-PATCH GUARD FAILED"):
        mod.apply_patch(tmp_path / "nope.py")


def test_patch_preserves_surrounding_source(unpatched_file):
    """Only the constructor line may change — nothing else in the file."""
    before = unpatched_file.read_text(encoding="utf-8")
    mod.apply_patch(unpatched_file)
    after = unpatched_file.read_text(encoding="utf-8")
    assert before.replace(UNPATCHED, "") == after.replace(PATCHED, "")


def test_patched_output_is_valid_python(unpatched_file):
    mod.apply_patch(unpatched_file)
    compile(unpatched_file.read_text(encoding="utf-8"), str(unpatched_file), "exec")


# ── Behavioural: does remove_pis actually stop the crash? ───────────────────
#
# Requires the real libraries, so it is skipped where they are absent (e.g. a
# CI job that only lints). In the dataprep image it runs and is the real proof.
@pytest.mark.skipif(
    importlib.util.find_spec("lxml") is None or importlib.util.find_spec("unstructured") is None,
    reason="lxml/unstructured not installed in this environment",
)
def test_processing_instruction_is_dropped_rather_than_crashing():
    """The mechanism the patch relies on, asserted directly.

    Without remove_pis the PI survives parsing as a node that unstructured's
    element-class lookup never maps; with it, the node is never constructed.
    """
    from lxml import etree

    html = "<html><body><p>alpha</p><?xml-stylesheet href='x.xsl'?><p>beta</p></body></html>"

    without = etree.fromstring(html.encode("utf-8"), parser=etree.HTMLParser(remove_comments=True))
    with_pis = [type(child).__name__ for child in without.iter() if "ProcessingInstruction" in type(child).__name__]
    assert with_pis, "expected the unpatched parser to produce a PI node — that IS the bug"

    patched = etree.fromstring(html.encode("utf-8"), parser=etree.HTMLParser(remove_comments=True, remove_pis=True))
    assert not [child for child in patched.iter() if "ProcessingInstruction" in type(child).__name__], (
        "remove_pis=True must prevent the PI node from being constructed"
    )
