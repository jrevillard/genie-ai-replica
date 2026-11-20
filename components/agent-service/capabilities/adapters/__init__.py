# Copyright (C) 2026 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0
"""The read-side adapters behind the document capability port (story 1.7).

One adapter per downstream authority: the document repository (legacy
metadata), okf-server (the exact-join concept read) and ArangoDB (the legacy
corpus chunks). The authorization executor drives them; none of them decides
access on its own.
"""
