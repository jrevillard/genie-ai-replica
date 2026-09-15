# Copyright (C) 2025 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0
"""azp policy of the ChatQnA token validator: web, mobile and listed clients."""

import importlib
from unittest.mock import patch

import pytest

MODULE = "chatqna.keycloak_token_validator"


def _load(monkeypatch, **env):
    for key in ("KC_CLIENT_ID", "KC_MOBILE_CLIENT_ID", "KC_ALLOWED_CLIENT_IDS"):
        monkeypatch.delenv(key, raising=False)
    for key, value in env.items():
        monkeypatch.setenv(key, value)
    module = importlib.import_module(MODULE)
    return importlib.reload(module)


def test_default_accepts_only_the_web_client(monkeypatch):
    module = _load(monkeypatch, KC_CLIENT_ID="genie-app")
    assert module.allowed_client_ids() == {"genie-app"}


def test_mobile_client_is_accepted_when_configured(monkeypatch):
    module = _load(monkeypatch, KC_CLIENT_ID="genie-app", KC_MOBILE_CLIENT_ID="genie_ai_mobile")
    assert module.allowed_client_ids() == {"genie-app", "genie_ai_mobile"}


def test_allowed_list_adds_clients_and_ignores_blanks(monkeypatch):
    module = _load(
        monkeypatch,
        KC_CLIENT_ID="genie-app",
        KC_MOBILE_CLIENT_ID="",
        KC_ALLOWED_CLIENT_IDS=" kiosk , , partner-app",
    )
    assert module.allowed_client_ids() == {"genie-app", "kiosk", "partner-app"}


@pytest.mark.asyncio
async def test_validate_token_rejects_foreign_azp(monkeypatch):
    module = _load(monkeypatch, KC_CLIENT_ID="genie-app", KC_MOBILE_CLIENT_ID="genie_ai_mobile")
    with (
        patch.object(module.jwt, "get_unverified_header", return_value={"kid": "k1"}),
        patch.object(module, "_fetch_jwks", return_value=[{"kid": "k1"}]),
        patch.object(module, "_find_key", return_value={"kid": "k1"}),
        patch("jose.jwk.construct", return_value=object()),
        patch.object(module.jwt, "decode", return_value={"sub": "u", "azp": "evil-app"}),
    ):
        assert await module.validate_token("t") is None


@pytest.mark.asyncio
async def test_validate_token_accepts_mobile_azp(monkeypatch):
    module = _load(monkeypatch, KC_CLIENT_ID="genie-app", KC_MOBILE_CLIENT_ID="genie_ai_mobile")
    payload = {"sub": "u", "azp": "genie_ai_mobile"}
    with (
        patch.object(module.jwt, "get_unverified_header", return_value={"kid": "k1"}),
        patch.object(module, "_fetch_jwks", return_value=[{"kid": "k1"}]),
        patch.object(module, "_find_key", return_value={"kid": "k1"}),
        patch("jose.jwk.construct", return_value=object()),
        patch.object(module.jwt, "decode", return_value=payload),
    ):
        assert await module.validate_token("t") == payload
