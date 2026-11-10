# Copyright (c) 2024-2026 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0
"""
Tests for build-patches/comps_dataprep_utils_logging_patch.py.

Upstream ``comps/dataprep/src/utils.py`` (OPEA v1.5) ships 15 ``print()``
calls that reach the container console on the standard-loader path — a
``.doc``/``.ppt`` upload routes there when CONTENT_EXTRACTION_METHOD is not
docling, and every crawl/download helper in the same module prints raw too.
That is untyped output with no level, no logger name and no severity in
VictoriaLogs: exactly what issue #514 eliminated from the repository's own
dataprep code, still alive in the vendored half (issue #1662). The patcher
rewrites the 15 calls to the module's existing ``CustomLogger`` at image
build time; the vendored file is not in this repository, so these tests run
the patcher against a fixture carrying the 15 lines VERBATIM (hand-copied
from the upstream v1.5 tag, independent of the patcher's own table — a typo
in either fails here, not at image build).

NON-VACUITY. The fail-loud tests are the load-bearing ones: they prove the
image build FAILS when the patch cannot be applied, rather than shipping an
image that still prints.
"""

import importlib.util
import sys
from pathlib import Path

import pytest

PATCHER = Path(__file__).resolve().parents[1] / "build-patches" / "comps_dataprep_utils_logging_patch.py"


def _load_module():
    """Load the patcher by path — it lives outside the package tree."""
    spec = importlib.util.spec_from_file_location("comps_dataprep_utils_logging_patch", PATCHER)
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


mod = _load_module()

# The 15 print sites, VERBATIM from opea-project/GenAIComps tag v1.5,
# comps/dataprep/src/utils.py (indentation as shipped). Hand-copied, not
# derived from the patcher's table, so the two cannot mask each other's
# typos. Fields: (indent, the print call's source text, expected level,
# expected arguments of the rewritten call — None to keep the print
# arguments verbatim). The multi-argument sites must be rewritten as
# f-strings: the comps CustomLogger's log_message(self, log_level, msg)
# takes no extra args, so a printf-style rewrite would raise TypeError at
# call time; the two raw dumps log at info (the logger is pinned at INFO,
# so debug would never emit).
UPSTREAM_SITES = [
    (12, 'print(f"{name} started ...")', "info", None),
    (12, "print(f'{\"  \" * Timer.level}{self.name} took {timeit.default_timer() - self.start} sec')", "info", None),
    (4, 'print("Converting doc file to docx file...")', "info", None),
    (4, 'print("Converted doc file to docx file.")', "info", None),
    (4, 'print("Converting ppt file to pptx file...")', "info", None),
    (4, 'print("Converted ppt file to pptx file.")', "info", None),
    (
        20,
        'print("fail to fetch %s, response status code: %s", url, response.status_code)',
        "warning",
        'f"fail to fetch {url}, response status code: {response.status_code}"',
    ),
    (16, 'print("fail to fetch %s, caused by %s", url, e)', "warning", 'f"fail to fetch {url}, caused by {e}"'),
    (16, 'print("current depth %s...", depth)', "info", 'f"current depth {depth}..."'),
    (8, 'print("download %s into %s...", url, file_name)', "info", 'f"download {url} into {file_name}..."'),
    (12, 'print("fail to download %s, caused by %s", url, e)', "warning", 'f"fail to download {url}, caused by {e}"'),
    (12, 'print("The given link/str {} cannot be parsed.".format(link))', "warning", None),
    (4, 'print("response", response)', "info", 'f"response {response}"'),
    (8, 'print(f"Write file failed. Exception: {e}")', "warning", None),
    (4, 'print(f"except patterns: {except_patterns}")', "info", None),
]


def _fixture_module(sites) -> str:
    """A syntactically valid stand-in for upstream utils.py around the sites.

    The patcher compile()s its output, so a bare fragment would not exercise
    the real path. Each site sits in its own function nested to the depth its
    upstream indentation requires (a flat function body cannot legally carry
    both the 4-indent conversion messages and the 20-indent fetch guard).
    """
    parts = [
        "from comps import CustomLogger\n",
        "\n",
        'logger = CustomLogger("prepare_doc_util")\n',
    ]
    for number, (indent, line, _, _) in enumerate(sites):
        parts.append(f"\n\ndef _site_{number}():\n")
        for depth in range(4, indent, 4):
            parts.append(" " * depth + "if True:\n")
        parts.append(" " * indent + line + "\n")
    return "".join(parts)


def _write(tmp_path, text: str) -> Path:
    p = tmp_path / "utils.py"
    # newline="" so the fixture is LF regardless of host OS.
    with p.open("w", encoding="utf-8", newline="") as handle:
        handle.write(text)
    return p


def _print_lines(body: str) -> list[str]:
    return [line for line in body.splitlines() if line.lstrip().startswith("print(")]


def test_patches_all_fifteen_prints(tmp_path):
    body_before = _fixture_module(UPSTREAM_SITES)
    path = _write(tmp_path, body_before)

    assert mod.apply_patch(path) == "patched"
    body = path.read_text(encoding="utf-8")
    assert _print_lines(body) == [], "every print() must be rewritten"
    for indent, line, level, patched_args in UPSTREAM_SITES:
        args = patched_args if patched_args is not None else line[len("print(") : -1]
        expected = " " * indent + f"logger.{level}({args})"
        assert expected in body, f"missing rewritten call: {expected.strip()}"


def test_the_response_dump_becomes_a_formatted_info_call(tmp_path):
    """print("response", response) must not become logger.info("response", response).

    The comps CustomLogger's log_message(self, log_level, msg) takes no
    extra args, so a multi-argument rewrite would raise TypeError at call
    time — the message must be a single pre-formatted value. It logs at
    info because the logger is pinned at INFO (debug never emits).
    """
    path = _write(tmp_path, _fixture_module(UPSTREAM_SITES))
    mod.apply_patch(path)
    assert 'logger.info(f"response {response}")' in path.read_text(encoding="utf-8")


def test_fails_loud_when_the_logger_assignment_is_missing(tmp_path):
    """A renamed logger object must abort the build, not NameError at runtime.

    The rewrite targets the module's `logger` name; an upstream rename of
    the CustomLogger assignment would still let every site match and
    compile, and the image would NameError on the first rewritten call.
    """
    body = _fixture_module(UPSTREAM_SITES).replace('logger = CustomLogger("prepare_doc_util")', "log = object()")
    path = _write(tmp_path, body)

    with pytest.raises(SystemExit, match="GUARD FAILED"):
        mod.apply_patch(path)


def test_is_idempotent_on_a_patched_file(tmp_path):
    path = _write(tmp_path, _fixture_module(UPSTREAM_SITES))
    mod.apply_patch(path)
    assert mod.apply_patch(path) == "already-patched"


def test_fails_loud_when_upstream_restructured_a_site(tmp_path):
    """A drifted line must abort the build, not ship unpatched."""
    drifted_index = next(i for i, (_, line, _, _) in enumerate(UPSTREAM_SITES) if "Converting doc file" in line)
    modified = [
        (indent, line.replace("docx", "document"), level, args) if i == drifted_index else (indent, line, level, args)
        for i, (indent, line, level, args) in enumerate(UPSTREAM_SITES)
    ]
    path = _write(tmp_path, _fixture_module(modified))

    with pytest.raises(SystemExit, match="GUARD FAILED"):
        mod.apply_patch(path)


def test_fails_loud_on_an_unexpected_new_print(tmp_path):
    """A print the table does not know must abort the build, not survive."""
    extra = (4, 'print("a brand new upstream print")', "info", None)
    path = _write(tmp_path, _fixture_module([*UPSTREAM_SITES, extra]))

    with pytest.raises(SystemExit, match="GUARD FAILED"):
        mod.apply_patch(path)


def test_fails_loud_when_the_target_is_missing(tmp_path):
    with pytest.raises(SystemExit, match="GUARD FAILED"):
        mod.apply_patch(tmp_path / "does-not-exist.py")
