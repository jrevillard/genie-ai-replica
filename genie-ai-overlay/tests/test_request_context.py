# Copyright (C) 2026 ITU
# SPDX-License-Identifier: Apache-2.0
"""Tests for the chat request context contract (``core.genieai_api_protocol``).

The backend sends the category filter under the singular key ``categoryLabel``
(see ``components/gov-chat-backend/services/query-service.js``). The overlay
model declares only the plural ``categoryLabels``, and Pydantic drops unknown
keys — so the category filter was silently discarded before it ever reached
chatqna's label builder. These tests pin the field that carries it.
"""

from core.genieai_api_protocol import RequestContext


class TestRequestContextCategoryLabel:
    def test_the_singular_category_label_survives_validation(self):
        """The singular key the backend sends must not be dropped by the model."""
        context = RequestContext.model_validate(
            {"categoryLabel": "Taxes & Revenue", "serviceLabels": ["Birth Registration"], "language": "en"}
        )
        dumped = context.model_dump(exclude_unset=True)
        assert dumped["categoryLabel"] == "Taxes & Revenue"
        assert dumped["serviceLabels"] == ["Birth Registration"]

    def test_an_absent_category_label_stays_unset(self):
        """A request without a category must not gain one."""
        context = RequestContext.model_validate({"serviceLabels": ["Maize"]})
        assert "categoryLabel" not in context.model_dump(exclude_unset=True)
