"""
AMINA v2.0 — Multi-Agent Constellation

Tier 4 #14: Decompose single-agent into specialized agents
coordinated by an orchestrator.

Architecture (inspired by Microsoft Healthcare Agent Orchestrator
+ Hippocratic AI's Polaris constellation):

  Orchestrator → routes to the right specialist
    ├── ClinicalAgent    → health advice, WHO protocols, triage
    ├── SafetyAgent      → checks responses for medical accuracy
    ├── CulturalAgent    → Gambian context, tone, Mandinka
    └── MemoryAgent      → patient history, learning, context

The orchestrator receives the patient message, gathers context from
MemoryAgent, routes to ClinicalAgent for the response, passes through
SafetyAgent for verification, and CulturalAgent for tone adaptation.

Each agent is a focused class with a single responsibility.
The Orchestrator coordinates them via deterministic message passing
(not LLM-based routing — that's too slow and unreliable).
"""
