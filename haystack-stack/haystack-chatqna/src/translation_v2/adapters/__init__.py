"""Adapters that make legacy classes conform to v2 Protocols.

Adapters are thin wrappers — they never modify the legacy classes they
wrap. If an adapter needs to change behavior, that change lives in the
adapter, not in legacy code.
"""
