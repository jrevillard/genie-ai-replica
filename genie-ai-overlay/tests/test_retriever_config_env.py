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


def _load_config(monkeypatch, env_name, env_value):
    """Load retriever/config.py as a fresh module with env_name bound to env_value."""
    if env_value is None:
        monkeypatch.delenv(env_name, raising=False)
    else:
        monkeypatch.setenv(env_name, env_value)
    spec = importlib.util.spec_from_file_location("retriever_config_under_test", CONFIG_PATH)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_filter_strategy_follows_deployment_env_var(monkeypatch):
    module = _load_config(monkeypatch, DEPLOYMENT_ENV_NAME, "AND")
    assert module.ARANGO_FILTER_STRATEGY == "AND"


def test_filter_strategy_defaults_to_or(monkeypatch):
    module = _load_config(monkeypatch, DEPLOYMENT_ENV_NAME, None)
    assert module.ARANGO_FILTER_STRATEGY == "OR"


def test_filter_strategy_value_is_normalized(monkeypatch):
    module = _load_config(monkeypatch, DEPLOYMENT_ENV_NAME, " and ")
    assert module.ARANGO_FILTER_STRATEGY == "AND"


def test_invalid_filter_strategy_is_rejected_when_the_service_starts(monkeypatch):
    # The value comes from the deployment: a typo must fail the service at
    # startup, not turn every filtered query into an error at request time.
    with pytest.raises(ValueError, match="RETRIEVER_ARANGO_FILTER_STRATEGY"):
        _load_config(monkeypatch, DEPLOYMENT_ENV_NAME, "ALL")
