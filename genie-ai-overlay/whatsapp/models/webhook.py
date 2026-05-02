# Copyright (C) 2025 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0
"""Pydantic models for the Meta WhatsApp Cloud API webhook payload.

Meta sends two kinds of POST events to the same webhook URL:
  1. Inbound user messages (value.messages is non-empty).
  2. Status updates (delivery, read, sent receipts) where value.statuses is set
     and value.messages is absent. These must be acknowledged but not processed.
"""

from typing import Any

from pydantic import BaseModel, ConfigDict, Field


class WhatsAppText(BaseModel):
    body: str


class WhatsAppMessage(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="ignore")

    id: str
    from_: str = Field(alias="from")
    timestamp: str | None = None
    type: str
    text: WhatsAppText | None = None


class WhatsAppContactProfile(BaseModel):
    name: str | None = None


class WhatsAppContact(BaseModel):
    model_config = ConfigDict(extra="ignore")

    profile: WhatsAppContactProfile | None = None
    wa_id: str | None = None


class WhatsAppWebhookValue(BaseModel):
    model_config = ConfigDict(extra="ignore")

    messaging_product: str | None = None
    metadata: dict | None = None
    contacts: list[WhatsAppContact] | None = None
    messages: list[WhatsAppMessage] | None = None
    statuses: list[Any] | None = None


class WhatsAppWebhookChange(BaseModel):
    model_config = ConfigDict(extra="ignore")

    value: WhatsAppWebhookValue
    field: str


class WhatsAppWebhookEntry(BaseModel):
    model_config = ConfigDict(extra="ignore")

    id: str
    changes: list[WhatsAppWebhookChange]


class WhatsAppWebhookPayload(BaseModel):
    model_config = ConfigDict(extra="ignore")

    object: str
    entry: list[WhatsAppWebhookEntry]
