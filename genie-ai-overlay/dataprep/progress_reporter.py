# Copyright (C) 2025 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0

"""
Progress Reporter for the Dataprep Pipeline.

Reports ingestion stage transitions and sub-step progress to the Document Repository
via HTTP PATCH. All reporting is fire-and-forget: failures are logged as warnings
and never interrupt the ingestion pipeline.
"""

import time
import os

import aiohttp

from comps import CustomLogger

logger = CustomLogger("progress_reporter")

# Request timeout for progress updates (seconds)
PROGRESS_REQUEST_TIMEOUT = 5

# Minimum interval between sub-step progress updates (seconds)
PROGRESS_MIN_INTERVAL = 30


class ProgressReporter:
    """
    Reports ingestion progress to the Document Repository.

    Sends HTTP PATCH requests to /api/files/{fileId}/ingestion-progress with
    stage transitions, sub-step progress, completion, and error signals.

    All methods are fire-and-forget: exceptions are caught and logged as warnings,
    never raised or retried.
    """

    def __init__(self, file_id: str, doc_repo_url: str, auth_token_getter):
        """
        Args:
            file_id: The unique file identifier being ingested.
            doc_repo_url: Base URL of the Document Repository (e.g. http://document-repository:3001).
            auth_token_getter: An async callable that returns a JWT token string (or None).
        """
        self.file_id = file_id
        self.base_url = f"{doc_repo_url}/api/files/{file_id}/ingestion-progress"
        self._get_token = auth_token_getter
        self._last_report_time = 0
        self._min_interval = PROGRESS_MIN_INTERVAL

    async def _send_update(self, payload: dict) -> None:
        """
        Sends an HTTP PATCH to the ingestion-progress endpoint.

        Fire-and-forget: logs warnings on any failure (network, timeout, non-2xx),
        never raises exceptions or retries.
        """
        try:
            token = await self._get_token()
            if not token:
                logger.warning(
                    f"[ progress ] Skipping progress update for {self.file_id}: no auth token available."
                )
                return

            headers = {
                "Authorization": f"Bearer {token}",
                "Content-Type": "application/json",
            }

            timeout = aiohttp.ClientTimeout(total=PROGRESS_REQUEST_TIMEOUT)

            async with aiohttp.ClientSession(timeout=timeout) as session:
                async with session.patch(
                    self.base_url, json=payload, headers=headers
                ) as response:
                    if response.status < 200 or response.status >= 300:
                        body = await response.text()
                        logger.warning(
                            f"[ progress ] Non-2xx response ({response.status}) updating progress "
                            f"for {self.file_id}: {body}"
                        )
        except aiohttp.ClientError as e:
            logger.warning(
                f"[ progress ] Network error updating progress for {self.file_id}: {e}"
            )
        except TimeoutError:
            logger.warning(
                f"[ progress ] Timeout updating progress for {self.file_id} (>{PROGRESS_REQUEST_TIMEOUT}s)."
            )
        except Exception as e:
            logger.warning(
                f"[ progress ] Unexpected error updating progress for {self.file_id}: {e}"
            )

    async def report_stage_transition(self, stage: str, stages_completed: int) -> None:
        """
        Reports a stage transition to the Document Repository.

        Sends immediately (not throttled) with stage_progress_percent reset to 0.

        Args:
            stage: The new stage name (e.g. "Extraction", "Chunking", "Graph").
            stages_completed: Number of stages fully completed so far.
        """
        payload = {
            "current_stage": stage,
            "stages_completed": stages_completed,
            "stage_progress_percent": 0,
        }
        await self._send_update(payload)
        # Reset throttle timer on stage transition so first sub-step in new stage can report
        self._last_report_time = 0

    async def report_progress(self, stage_progress_percent: int, message: str = None) -> None:
        """
        Reports sub-step progress within the current stage.

        Throttled to a minimum interval of 30 seconds between updates.
        If called more frequently, the update is silently skipped.

        Args:
            stage_progress_percent: Integer 0-100 representing progress within current stage.
            message: Optional human-readable message (e.g. "Processed 5/20 pages").
        """
        now = time.time()
        if (now - self._last_report_time) < self._min_interval:
            return

        payload = {"stage_progress_percent": stage_progress_percent}
        if message is not None:
            payload["message"] = message

        await self._send_update(payload)
        self._last_report_time = now

    async def report_completion(self) -> None:
        """
        Reports successful ingestion completion.

        Sends immediately (not throttled).
        """
        payload = {"status": "completed"}
        await self._send_update(payload)

    async def report_error(self) -> None:
        """
        Reports ingestion failure.

        Sends immediately (not throttled).
        """
        payload = {"status": "error"}
        await self._send_update(payload)
