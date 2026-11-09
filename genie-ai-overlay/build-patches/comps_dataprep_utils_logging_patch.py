# Copyright (c) 2024-2026 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0
#
# OVERRIDE build-patches.comps_dataprep_utils_logging_patch | disposition: still-needed | reason: upstream comps/dataprep/src/utils.py (v1.5) ships 15 print() calls that reach the container console on the standard-loader path (.doc/.ppt and the crawl/download helpers) — route them through the module's existing CustomLogger, extending the #514 print ban to the vendored half (issue #1662) | test: tests/test_comps_dataprep_utils_logging_patch.py  # noqa: E501

"""comps_dataprep_utils_logging_patch.py — route the vendored comps
``dataprep/src/utils.py`` prints through the module's own ``CustomLogger``.

THE DEFECT (issue #1662)
------------------------
The dataprep image copies the whole upstream OPEA tree
(``COPY --from=opea_base /src/comps/ /app/comps/``) and overwrites only the
files this repository owns. Upstream ``comps/dataprep/src/utils.py`` (v1.5)
ships with 15 bare ``print()`` calls, and the repo's
``genieai_dataprep_utils.py`` imports its ``document_loader`` at runtime:

    from comps.dataprep.src.utils import document_loader as origin_document_loader

The path is production-reachable: a ``.doc``/``.ppt`` upload (absent from
DOCLING_SUPPORTED_EXTENSIONS) is routed to the standard loader, whose
``load_doc``/``load_ppt`` print conversion progress raw to the container
console — and the module's crawl/download helpers print fetch failures and
debug dumps the same way. A ``print()`` bypasses the whole structured log
path (python logging -> stdout -> fluentd driver -> OTel collector ->
VictoriaLogs): no level, no logger name, no severity in the admin logs UI,
and the repository-wide AST guard cannot ever catch it because the vendored
file is not in the repo. Issue #514 removed the prints from the repository's
own dataprep code; this patch does the same for the vendored half.

THE FIX
-------
Each of the 15 calls becomes ``logger.<level>(...)`` on the module's
existing ``CustomLogger("prepare_doc_util")`` (utils.py:50). The arguments
are carried over verbatim — the printf-style calls
(``print("fail to fetch %s, caused by %s", url, e)``) were ALREADY wrong
under ``print()`` (extra positional args are joined with spaces, the
placeholders never substituted) and become correct lazy-format logging
calls for free. Levels follow the message semantics: progress -> info,
fetch/download/write failures -> warning, raw debug dumps -> debug. The one
exception to verbatim args: ``print("response", response)`` has no
placeholder for its second argument, which logging would reject at format
time, so it becomes ``logger.debug("response %s", response)``.

The module is imported in-process by the dataprep service, so the logger is
the wired one (the repo's ``genieai_dataprep_utils.py`` calls
``setup_trace_logging``/``setup_json_logging`` on the same script name).

THREE OUTCOMES, NEVER A SILENT NO-OP
------------------------------------
1. unpatched      -> rewrite all 15 sites, compile-check, re-read and verify
2. already patched -> idempotent no-op, exit 0 (upstream bump re-ships the
   file unpatched; the next build re-applies)
3. anything else  -> ``SystemExit`` so the IMAGE BUILD FAILS LOUDLY rather
   than shipping an image that still prints (a drifted or grown upstream
   file needs the table re-derived — same contract as
   ``unstructured_html_pi_patch.py``)
"""

import re
import sys
from pathlib import Path

DEFAULT_TARGET = Path("/app/comps/dataprep/src/utils.py")

# (print-call arguments between `print(` and `)`, level, replacement
# arguments or None to keep verbatim). Content-matched so indentation is
# captured and reapplied, and reflow-tolerant the same way
# unstructured_html_pi_patch.py is.
SITES = [
    (r'f"{name} started ..."', "info", None),
    (r"""f'{"  " * Timer.level}{self.name} took {timeit.default_timer() - self.start} sec'""", "info", None),
    (r'"Converting doc file to docx file..."', "info", None),
    (r'"Converted doc file to docx file."', "info", None),
    (r'"Converting ppt file to pptx file..."', "info", None),
    (r'"Converted ppt file to pptx file."', "info", None),
    (r'"fail to fetch %s, response status code: %s", url, response.status_code', "warning", None),
    (r'"fail to fetch %s, caused by %s", url, e', "warning", None),
    (r'"current depth %s...", depth', "info", None),
    (r'"download %s into %s...", url, file_name', "info", None),
    (r'"fail to download %s, caused by %s", url, e', "warning", None),
    (r'"The given link/str {} cannot be parsed.".format(link)', "warning", None),
    # print() joins extra positional args with spaces; logging formats them,
    # so the message needs the placeholder print never substituted.
    (r'"response", response', "debug", r'"response %s", response'),
    (r'f"Write file failed. Exception: {e}"', "warning", None),
    (r'f"except patterns: {except_patterns}"', "debug", None),
]

# Any bare print call left in the file — the guard for upstream lines the
# table does not know about.
ANY_PRINT_RE = re.compile(r"^[ \t]*print\(", re.MULTILINE)


def target_path() -> Path:
    """The vendored utils.py in the image; argv[1] overrides it for tests."""
    if len(sys.argv) > 1:
        return Path(sys.argv[1])
    return DEFAULT_TARGET


def _read(path: Path) -> str:
    """Read WITHOUT newline translation (see unstructured_html_pi_patch.py)."""
    with path.open("r", encoding="utf-8", newline="") as handle:
        return handle.read()


def _write(path: Path, text: str) -> None:
    with path.open("w", encoding="utf-8", newline="") as handle:
        handle.write(text)


def apply_patch(path: Path) -> str:
    """Patch, verify idempotently, or fail loudly. Returns a short outcome label."""
    if not path.is_file():
        raise SystemExit(f"ASSERT-ON-PATCH GUARD FAILED: {path} does not exist")

    text = _read(path)
    patched_call_counts = 0
    for args, level, override in SITES:
        effective_args = override if override is not None else args
        patched_call = f"logger.{level}({effective_args})"
        if re.search(r"^[ \t]*" + re.escape(patched_call) + r"[ \t\r]*$", text, re.MULTILINE):
            patched_call_counts += 1
            continue
        pattern = re.compile(
            r"^(?P<indent>[ \t]*)print\(" + re.escape(args) + r"\)(?P<eol>[ \t\r]*)$",
            re.MULTILINE,
        )
        found = len(pattern.findall(text))
        if found != 1:
            raise SystemExit(
                f"ASSERT-ON-PATCH GUARD FAILED: expected exactly one `print({args})` in {path}, found {found}. "
                f"Upstream restructured comps/dataprep/src/utils.py — re-derive the site table for the new "
                f"version and update genie-ai-overlay/OVERRIDES.yaml."
            )
        # Re-emit the matched indent AND the matched line ending: dropping
        # the trailing CR would silently rewrite a CRLF file's line terminator.
        text = pattern.sub(lambda m, call=patched_call: f"{m.group('indent')}{call}{m.group('eol')}", text)

    if patched_call_counts == len(SITES):
        leftover = ANY_PRINT_RE.search(text)
        if leftover:
            raise SystemExit(
                f"ASSERT-ON-PATCH GUARD FAILED: all known sites are logger calls but an unexpected "
                f"`print(` survives in {path} — upstream grew a new print; add it to the site table."
            )
        return "already-patched"

    leftover = ANY_PRINT_RE.search(text)
    if leftover:
        raise SystemExit(
            f"ASSERT-ON-PATCH GUARD FAILED: an unexpected `print(` survives in {path} after patching — "
            f"upstream grew a print the table does not know; add it to the site table."
        )
    # Compile the edited source BEFORE writing it, so a botched edit can
    # never reach disk.
    compile(text, str(path), "exec")
    _write(path, text)
    # Re-read: the file on disk is the artefact that ships, so verify THAT.
    post = _read(path)
    if ANY_PRINT_RE.search(post):
        raise SystemExit(f"ASSERT-ON-PATCH GUARD FAILED: post-write verification failed for {path}")
    return "patched"


def main() -> int:
    path = target_path()
    outcome = apply_patch(path)
    print(f"comps_dataprep_utils_logging_patch: {outcome} {path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
