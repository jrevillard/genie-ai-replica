# Copyright (C) 2026 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0

"""The overlay logs through the OPEA CustomLogger, never print().

`print()` bypasses the structured log path (python logging -> stdout ->
fluentd driver -> OTel collector -> VictoriaLogs): no level, no logger name,
and no level control — the reader cannot tell a warning from a crash. The
dataprep service is the only OPEA service that still had `print()` calls
(issue #514); the guard below covers every overlay source file so a print
cannot come back anywhere in the overlay. The guard sees the repository's
own code only — the vendored OPEA tree ships in the image, not in the repo.

The scan is AST-based, not a regex over the source text: a `print(` inside a
docstring or a comment is not a logging call and must not fail the guard,
and `builtins.print(...)` is the same evasion as a bare `print(...)`. The
behavioural assertions cover the messages that replaced the last prints — a
dropped file, a missing dependency, and the startup config dump — so a
regression to `print()` (or to the wrong level, or to an unwired logger) is
caught, not just a reworded string.

The guard's scope is the shared walk's: `overlay_source_files()` skips the
directories OVERLAY_SKIP_DIRS excludes (tests, contracts, build-patches,
reports, site and the virtualenvs) — code there is not covered by this
guard.
"""

import ast
import importlib.util
import sys
from pathlib import Path
from unittest.mock import MagicMock, call, patch

import pytest

from tests.conftest import OVERLAY_ROOT, overlay_source_files

DATAPREP_DIR = OVERLAY_ROOT / "dataprep"
UTILS_PATH = DATAPREP_DIR / "genieai_dataprep_utils.py"


def _is_print_reference(func: ast.expr) -> bool:
    """A bare `print` or the explicit `builtins.print` — the same evasion."""
    if isinstance(func, ast.Name):
        return func.id == "print"
    return (
        isinstance(func, ast.Attribute)
        and func.attr == "print"
        and isinstance(func.value, ast.Name)
        and func.value.id == "builtins"
    )


def _print_call_lines(path: Path) -> list[int]:
    """Line numbers of the `print(...)` calls in a Python source file."""
    tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
    return [node.lineno for node in ast.walk(tree) if isinstance(node, ast.Call) and _is_print_reference(node.func)]


def test_overlay_source_never_prints():
    """No `print()` call survives in any file the shared overlay walk covers.

    The file walk is the shared `overlay_source_files()` helper, not a
    private one: every guard that answers "what is overlay source?" must
    answer it the same way (tests/conftest.py).
    """
    offenders = {
        str(path.relative_to(OVERLAY_ROOT)): lines
        for path in overlay_source_files()
        if (lines := _print_call_lines(path))
    }
    assert offenders == {}


@pytest.mark.asyncio
async def test_unsupported_file_type_is_reported_as_a_warning():
    """A file Docling cannot read is refused — the log says so, at WARNING.

    The ingest caller routes only DOCLING_SUPPORTED_EXTENSIONS files here and
    sends everything else to the standard loader, so this guard is the safety
    net for a direct caller: it refuses the file at WARNING (logger.warning +
    a None return) instead of feeding an unreadable path to the converter
    (issue #1661 — the extension set itself has one owner).
    """
    from dataprep import genieai_dataprep_utils as utils

    with patch.object(utils, "logger") as fake_logger:
        content = await utils.docling_document_loader("report.xyz")

    assert content is None
    fake_logger.warning.assert_called_once()
    assert "not supported by Docling" in fake_logger.warning.call_args.args[0]


def test_environment_dump_respects_logflag(captured_spans):
    """The startup config dump is emitted only when LOGFLAG asks for it.

    The LOGFLAG gate sits INSIDE the span on purpose: the span is an owned
    name whose emission is part of the observability contract, so it must
    exist on every startup even when the dump itself is off. The first
    assertion pins that — it is the only net that catches the gate drifting
    back above the span (a logger-only assertion passes in both shapes).
    """
    import dataprep.genieai_dataprep_arangodb as dp_module

    receiver = dp_module.GenieArangoDataprep.__new__(dp_module.GenieArangoDataprep)

    with patch.object(dp_module, "logflag", False), patch.object(dp_module, "logger") as fake_logger:
        dp_module.GenieArangoDataprep._log_environment_variables(receiver)
    fake_logger.info.assert_not_called()
    assert [span.name for span in captured_spans("dataprep.log_environment_variables")] == [
        "dataprep.log_environment_variables"
    ]

    with patch.object(dp_module, "logflag", True), patch.object(dp_module, "logger") as fake_logger:
        dp_module.GenieArangoDataprep._log_environment_variables(receiver)
    fake_logger.info.assert_called_once()
    assert "GENIE-AI DATAPREP CONFIGURATION" in fake_logger.info.call_args.args[0]


@pytest.mark.parametrize("missing_module", ["docling", "easyocr"])
def test_missing_dependency_is_reported_before_the_import_error_propagates(missing_module):
    """A missing remedy-named dependency is logged at ERROR — then the ImportError still propagates.

    The message is the operator's remedy ("pip install docling easyocr"),
    and it must be visible: the process dies on the re-raise, so the log
    line is the only place the remedy appears. The easyocr and docling
    imports sit inside the module's try block so this failure is caught
    there — above it, a missing package would die at the top-level import
    before the handler exists. Nulling the module's sys.modules entries
    makes every import of it raise ImportError, which is what a missing
    package does.
    """
    spec = importlib.util.spec_from_file_location("genieai_dataprep_utils_under_test", UTILS_PATH)
    module = importlib.util.module_from_spec(spec)
    # Null every cached entry of the module under test: a from-import
    # consults sys.modules for the full name first, so nulling only the
    # parent package would not raise.
    missing = {
        name: None for name in list(sys.modules) if name == missing_module or name.startswith(missing_module + ".")
    }

    with (
        patch("comps.CustomLogger") as mock_logger_class,
        patch.dict(sys.modules, missing),
        # The wiring calls run at module level before the try — patch them so
        # the fresh exec does not mutate the process-global logging tree.
        patch("tracing.setup_trace_logging", MagicMock()),
        patch("tracing.setup_json_logging", MagicMock()),
        pytest.raises(ImportError),
    ):
        spec.loader.exec_module(module)

    mock_logger_class.return_value.error.assert_called_once()
    assert "install docling" in mock_logger_class.return_value.error.call_args.args[0]


@pytest.mark.parametrize(
    ("env_value", "expected"),
    [("true", True), ("TRUE", True), ("false", False), ("0", False), (None, False)],
    ids=["true", "TRUE", "false", "0", "unset"],
)
def test_loader_logflag_parses_the_documented_boolean(env_value, expected):
    """LOGFLAG=false must mean off for the loader, like it does for arangodb.

    The two dataprep modules gate on the same variable; a truthy-string read
    here made LOGFLAG=false silence arangodb while the loader kept logging.
    """
    loader_path = DATAPREP_DIR / "genieai_dataprep_loader.py"
    spec = importlib.util.spec_from_file_location(f"logflag_parse_{expected}_{env_value}", loader_path)
    module = importlib.util.module_from_spec(spec)
    environ = {"PATH": "/usr/bin"}
    if env_value is not None:
        environ["LOGFLAG"] = env_value

    with (
        patch.dict(sys.modules, {"opea_dataprep_loader": MagicMock()}),
        patch.dict("os.environ", environ, clear=True),
        patch("tracing.setup_trace_logging", MagicMock()),
        patch("tracing.setup_json_logging", MagicMock()),
    ):
        spec.loader.exec_module(module)

    assert module.logflag is expected


@pytest.mark.parametrize(
    ("module_path", "logger_name"),
    [
        (UTILS_PATH, "genie-ai_prepare_doc_util"),
        (DATAPREP_DIR / "genieai_dataprep_loader.py", "genie_dataprep_loader"),
    ],
    ids=["utils", "loader"],
)
def test_service_loggers_are_wired_into_the_json_envelope(module_path, logger_name):
    """The dataprep loggers are registered with the trace + JSON wiring like every service logger.

    An unwired logger emits the OPEA bracket format, which the collector's
    plain-text severity path does not recognise — its records reach
    VictoriaLogs with severity Unspecified and never appear in the admin
    Errors/Warnings tiles. The order matters too: setup_json_logging
    assumes the trace filter is already in place, so trace-before-json is
    part of the contract.
    """
    spec = importlib.util.spec_from_file_location(f"wiring_under_test_{logger_name}", module_path)
    module = importlib.util.module_from_spec(spec)
    wiring = MagicMock()

    with (
        patch.dict(sys.modules, {"opea_dataprep_loader": MagicMock()}),
        patch("tracing.setup_trace_logging", wiring.setup_trace_logging),
        patch("tracing.setup_json_logging", wiring.setup_json_logging),
    ):
        spec.loader.exec_module(module)

    assert wiring.mock_calls == [
        call.setup_trace_logging(logger_name),
        call.setup_json_logging(logger_name),
    ]
