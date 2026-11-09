# Copyright (C) 2026 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0

"""The dataprep package logs through the OPEA CustomLogger, never print().

`print()` bypasses the structured log path (python logging -> stdout ->
fluentd driver -> OTel collector -> VictoriaLogs): no level, no logger name,
and no level control — the reader cannot tell a warning from a crash. The
dataprep service is the only OPEA service that still had `print()` calls
(issue #514).

The scan below is AST-based, not a regex over the source text: a `print(`
inside a docstring or a comment is not a logging call and must not fail the
guard. The behavioural assertions cover the two messages that replaced the
last prints — a dropped file and the startup config dump — so a regression
to `print()` (or to the wrong level) is caught, not just a reworded string.
"""

import ast
from pathlib import Path
from unittest.mock import patch

import pytest

from tests.conftest import OVERLAY_ROOT

DATAPREP_DIR = OVERLAY_ROOT / "dataprep"


def _print_call_lines(path: Path) -> list[int]:
    """Line numbers of the `print(...)` calls in a Python source file."""
    tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
    return [
        node.lineno
        for node in ast.walk(tree)
        if isinstance(node, ast.Call) and isinstance(node.func, ast.Name) and node.func.id == "print"
    ]


@pytest.mark.parametrize("path", sorted(DATAPREP_DIR.glob("*.py")), ids=lambda p: p.name)
def test_dataprep_package_never_prints(path: Path):
    """No `print()` call survives in the dataprep package."""
    assert _print_call_lines(path) == []


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


def test_environment_dump_respects_logflag():
    """The startup config dump is emitted only when LOGFLAG asks for it."""
    import dataprep.genieai_dataprep_arangodb as dp_module

    with patch.object(dp_module, "logflag", False), patch.object(dp_module, "logger") as fake_logger:
        dp_module.GenieArangoDataprep._log_environment_variables(None)
    fake_logger.info.assert_not_called()

    with patch.object(dp_module, "logflag", True), patch.object(dp_module, "logger") as fake_logger:
        dp_module.GenieArangoDataprep._log_environment_variables(None)
    fake_logger.info.assert_called_once()
    assert "GENIE-AI DATAPREP CONFIGURATION" in fake_logger.info.call_args.args[0]


def test_missing_docling_is_reported_before_the_import_error_propagates():
    """A missing docling is logged at ERROR — then the ImportError still propagates.

    The message is the operator's remedy ("pip install docling easyocr"), and
    it must be visible: the process dies on the re-raise, so the log line is
    the only place the remedy appears.
    """
    import importlib.util

    utils_path = DATAPREP_DIR / "genieai_dataprep_utils.py"
    spec = importlib.util.spec_from_file_location("genieai_dataprep_utils_under_test", utils_path)
    module = importlib.util.module_from_spec(spec)

    # The vendored `comps` module is mocked in the test environment, so the
    # docling import never fails on its own — make the converter construction
    # raise the ImportError the module's own `except ImportError` handles.
    # The logger class is patched for the same reason: the shared mock would
    # otherwise carry the calls of every other test in the session.
    with (
        patch("comps.CustomLogger") as mock_logger_class,
        patch("docling.datamodel.pipeline_options.EasyOcrOptions", side_effect=ImportError("no docling")),
        pytest.raises(ImportError),
    ):
        spec.loader.exec_module(module)

    mock_logger_class.return_value.error.assert_called_once()
    assert "install docling" in mock_logger_class.return_value.error.call_args.args[0]
