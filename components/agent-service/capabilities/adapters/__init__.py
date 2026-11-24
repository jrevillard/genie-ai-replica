# Copyright (C) 2026 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0
"""Adapters of the document capability layer: the OPEA-free implementations.

Each adapter ports one stage of the recorded query path (V02,
``docs/baselines/v02-opea-query-path-contract.md``). The behavior is frozen to
the record; the structure is free (clean-slate).
No adapter imports the OPEA overlay or its ``comps`` package.

The read-side adapters serve ``read_source``: the document repository (legacy
metadata), okf-server (the exact-join concept read) and ArangoDB (the legacy
corpus chunks). The authorization executor drives them; none of them decides
access on its own.
"""
