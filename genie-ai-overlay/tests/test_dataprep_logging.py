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
dropped file, a missing docling, and the startup config dump — so a
regression to `print()` (or to the wrong level, or to an unwired logger) is
caught, not just a reworded string.
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
    """No `print()` call survives anywhere in the overlay's project source.

    The file walk is the shared `overlay_source_files()` helper, not a
    private one: every guard that answers "what is overlay source?" must
    answer it the same way (tests/conftest.py).
    """
    offenders = {str(path.relative_to(OVERLAY_ROOT)): _print_call_lines(path) for path in overlay_source_files()}
    assert {name: lines for name, lines in offenders.items() if lines} == {}


@pytest.mark.asyncio
async def test_unsupported_file_type_is_reported_as_a_warning():
    """A file Docling cannot read is dropped — the log says so, at WARNING.

    `docling_document_loader` returns None for an unsupported extension and
    the caller turns that into zero chunks, so this message is the only
    trace that the document was skipped.
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
        pytest.raises(ImportError),
    ):
        spec.loader.exec_module(module)

    mock_logger_class.return_value.error.assert_called_once()
    assert "install docling" in mock_logger_class.return_value.error.call_args.args[0]


def test_utils_logger_is_wired_into_the_json_envelope():
    """The utils logger is registered with the trace + JSON wiring like the service loggers.

    An unwired logger emits the OPEA bracket format, which the collector's
    plain-text severity path does not recognise — its records reach
    VictoriaLogs with severity Unspecified and never appear in the admin
    Errors/Warnings tiles. The order matters too: setup_json_logging
    assumes the trace filter is already in place, so trace-before-json is
    part of the contract.
    """
    spec = importlib.util.spec_from_file_location("genieai_dataprep_utils_wiring", UTILS_PATH)
    module = importlib.util.module_from_spec(spec)
    wiring = MagicMock()

    with (
        patch("tracing.setup_trace_logging", wiring.setup_trace_logging),
        patch("tracing.setup_json_logging", wiring.setup_json_logging),
    ):
        spec.loader.exec_module(module)

    assert wiring.mock_calls == [
        call.setup_trace_logging("genie-ai_prepare_doc_util"),
        call.setup_json_logging("genie-ai_prepare_doc_util"),
    ]
