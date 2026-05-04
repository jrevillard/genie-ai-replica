"""AMINA Abuse-Defense Module.

3-phase warning pipeline that catches abuse DIRECTED AT AMINA without
penalising health frustration or distress/crisis signals.

PHASE A (this module today) -- classifier only. No integration, no
state machine, no termination. Pure functions: text in, classification
out. Other phases (state machine, warnings, termination, admin
dashboard) build on top of this without modifying it.

Public surface:
    from src.abuse_defense.classifier import classify, Classification
"""
