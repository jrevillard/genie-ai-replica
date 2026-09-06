"""
DroughtEWS — reads drought_assessments from ArangoDB and dispatches alerts.

Called by the scheduler after drought_monitoring has stored its results.
Handles deduplication via the shared alerts_sent collection.
"""
from __future__ import annotations

import logging
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from app.core.notifier import Notifier
    from app.core.storage import StorageLayer

logger = logging.getLogger(__name__)


class DroughtEWS:
    def __init__(self, storage: "StorageLayer") -> None:
        self._storage = storage

    def dispatch_alerts(self, notifier: "Notifier") -> dict:
        """
        Read all stored drought assessments with tier >= 2 and dispatch
        notifications that have not been sent in the last 12 hours.
        Returns a summary dict.
        """
        assessments = self._storage.get_all_drought_assessments(min_tier=2)
        notified  = 0
        suppressed = 0

        for assessment in assessments:
            location = assessment.get("location", "")
            tier     = assessment.get("tier", 0)

            if self._storage.was_drought_alert_sent(location, tier, within_hours=12):
                suppressed += 1
                logger.debug(
                    "[DROUGHT_EWS] Suppressed duplicate tier-%d alert for %s",
                    tier, location,
                )
                continue

            try:
                notifier.dispatch_drought_alert(assessment)
                self._storage.record_drought_alert_sent(location, tier, "push")
                notified += 1
                logger.warning(
                    "[DROUGHT_EWS] Alert dispatched — tier=%d (%s) location=%s",
                    tier, assessment.get("tier_label"), location,
                )
            except Exception as exc:
                logger.error(
                    "[DROUGHT_EWS] Alert dispatch failed for %s: %s", location, exc
                )

        result = {
            "drought_alerts_dispatched": notified,
            "drought_alerts_suppressed": suppressed,
            "total_assessments":         len(assessments),
        }
        logger.info("[DROUGHT_EWS] dispatch_alerts done: %s", result)
        return result

    def get_active_summary(self, min_tier: int = 1) -> list[dict]:
        """
        Return all drought assessments at or above min_tier.
        Used for correlation with weather/crop alerts.
        """
        return self._storage.get_all_drought_assessments(min_tier=min_tier)
