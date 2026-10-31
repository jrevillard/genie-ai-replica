# Copyright (C) 2025 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0
"""Cross-service base URLs shared by more than one module of a service.

Each entry is read from the environment ONCE per process; modules import the
constant instead of re-reading the env var with their own default, so two
call sites of the same service can never drift apart.
"""

import os

# Document Repository: the doc store every ingestion talks to (status
# callbacks, ingestion-log writes, and dataprep's startup stuck-ingest
# recovery all target it).
DOCUMENT_REPOSITORY_URL = os.getenv("DOCUMENT_REPOSITORY_URL", "http://document-repository:3001")
