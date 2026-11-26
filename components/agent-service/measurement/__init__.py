# Copyright (C) 2026 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0
"""The measurement surfaces: the probe and the harness that verify a deployment.

They assemble their own runtime — the port, the client, the transport — to
measure what a deployment serves. They are not core: the core may not
import them, and they may reach the adapters and the host.
"""
