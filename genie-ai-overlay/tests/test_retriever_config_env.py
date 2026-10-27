# Copyright (C) 2025 ITU
# SPDX-License-Identifier: Apache-2.0
"""The retriever must read its ArangoDB knobs under the names the deployment sets.

The deployment sets ``RETRIEVER_ARANGO_FILTER_STRATEGY`` (docker-compose.yaml,
deploy/ansible/templates/env.j2) and the install guide documents that name.
Reading a different name leaves the knob inert: the operator sets it, the
retriever ignores it, and the label filter silently falls back to OR.
"""

import importlib.util
from pathlib import Path

import pytest

CONFIG_PATH = Path(__file__).resolve().parents[1] / "retriever" / "config.py"
DEPLOYMENT_ENV_NAME = "RETRIEVER_ARANGO_FILTER_STRATEGY"


def _load_config(monkeypatch, env_value):
    """Load retriever/config.py as a fresh module with the knob bound to env_value."""
    if env_value is None:
        monkeypatch.delenv(DEPLOYMENT_ENV_NAME, raising=False)
    else:
        monkeypatch.setenv(DEPLOYMENT_ENV_NAME, env_value)
    spec = importlib.util.spec_from_file_location("retriever_config_under_test", CONFIG_PATH)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@pytest.mark.parametrize(
    ("env_value", "expected"),
    [
        ("AND", "AND"),
        (" and ", "AND"),
        (None, "OR"),
    ],
    ids=["and", "normalised", "unset"],
)
def test_filter_strategy_follows_deployment_env_var(monkeypatch, env_value, expected):
    module = _load_config(monkeypatch, env_value)
    strategy = module.ARANGO_FILTER_STRATEGY
    assert strategy == expected


def test_invalid_filter_strategy_is_rejected_when_the_service_starts(monkeypatch):
    # The value comes from the deployment: a typo must fail the service at
    # startup, not turn every filtered query into an error at request time.
    with pytest.raises(ValueError, match="RETRIEVER_ARANGO_FILTER_STRATEGY"):
        _load_config(monkeypatch, "ALL")
