# ADR agentic-009: The core knows nothing of the outside — identifiers are opaque tokens

- **Status**: Proposed
- **Date**: 2026-11-26
- **Decision owners**: GENIE.AI engineering (operator accepts at merge)
- **Binds**: FR-28 (retained data), ADR agentic-004 (runtime port governance by construction), ADR agentic-005 (tool sources and MCP consumption), the architecture spine's hexagonal rule, the S1 slice's dependency rules (C, R1–R3, T, L1, L2)
- **Story**: MR !1088 (agentic iteration 2, S1 — architecture rules and the port assembly)

## Context

The agent service is hexagonal: a core that decides (`agent/`, `noagent/`, `preparation/`, the contract
modules of `capabilities/`), leaf adapters that reach the corpus (`capabilities/adapters/`), and a host
that composes (`app.py`, `assembly.py`). The dependency rules (`tests/test_architecture.py`) enforce the
**direction** of the imports — R1 (no I/O library in the core), R2 (no cross-layer import), R3 (only the
listed modules import the leaf adapters), L1/L2 (the adapters access the ports alone; the capability
accesses the ports and the adapters).

**Those rules police the imports, not the vocabulary.** A core module that never imports an adapter can
still carry a platform's shape in its own text, and the rules stay green. The live E2E suite
(`tests/e2e/chatbot/real-rag-citation.spec.js`) proved it on 2026-11-26: the agentic path answered
`QZK‑7319` (U+2011) where the deployed path answered `QZK-7319` (ASCII), and the trace led to a
core-side guard that refused **every** document id the corpus holds.

### The five leaks

The audit (2026-11-26) of the core's text — not its imports — found five places where the core names
a platform's vocabulary:

| # | The leak | Where | What it cost |
|---|---|---|---|
| **F1** | The **form** of a document id (`[0-9]+`) | `capabilities/identifiers.py:24` | The guard refuses the ids the doc-repo actually mints (`<timestamp>_<uuid-prefix>`), so `read_source` fails with `authorization_failure` on **every** document |
| **F2** | The **Arango adapter** imported by a core module | `capabilities/search_knowledge.py:178` | The port builds its own connector; `capabilities.search_knowledge` had to be added to `KNOWN_ADAPTER_IMPORTERS` for R3 to hold |
| **F3** | The **charset of an Arango graph name** | `capabilities/identifiers.py:68`, `capabilities/executor.py:93` | The core validates a deployment-configuration value against the database's accepted identifier charset |
| **F4** | The **vocabulary of the OKF counterparty** (`repo_id`, `concept_id`, `bundle_version`) | `capabilities/contract.py`, `capabilities/executor.py:208`, `agent/taint.py:79`, `agent/verification.py:135` | The core's *identity model* is the counterparty's data model |
| **F5** | A **display name derived from an id** (`str(file_id).replace("_", " ")`) | `capabilities/citations.py:69,89` | The citation card shows `"1794932396634 ea188888"` — a deformed id, not a name; the E2E's source-card assertion can never hold |

F5 is a **recorded delta**, not an oversight: `capabilities/citations.py`'s own docstring names it
("the deployed legacy branch resolves `document_name`/`url`/`categoryLabels` from doc-repo metadata per
answer … Widening the delta — resolving doc-repo metadata here — is a deliberate future extension, not
silently taken"). The deployed path resolves the metadata per answer
(`genieai_chatqna.py:3749-3757`); the agentic path does not.

### What is NOT a leak

Naming a counterparty in a **port** is the port's job: a port says what it expects from a connector,
and `repo_id`/`concept_id` are the OKF port's own vocabulary. The prohibition is on the **form of an
identifier minted elsewhere**, on the **import of a concrete connector by the core**, and on **deriving
a value from an identifier**.

## Decision

**The core knows nothing of the outside. An identifier is an opaque token; a value that needs a
platform to exist is fetched from that platform, never derived from an identifier.**

1. **An identifier is an opaque token.** The core validates it — a charset and a length — and treats
   it as a token with no structure. It never knows the *form* an identifier has where it was minted:
   the doc-repo's `<timestamp>_<uuid-prefix>`, the OKF server's repository token, an ArangoDB graph
   name. The form belongs to the adapter that resolves the identifier, and the core's guard accepts
   the general token shape.
2. **An identifier never derives a value.** The core does not turn an identifier into a display name,
   a URL, a label or a title. A source carries what the platform knows about it — the doc-repo's
   `file_name`, its labels — resolved **through the adapter**, or nothing at all. The id-derived name
   disappears; where the deployed path resolves metadata per answer, the agentic path resolves it
   through the same port the deployed path uses, and the D1 rule (a source whose metadata does not
   resolve is not surfaced, and contributes no score to the aggregate) holds.
3. **The corpus leg is a label, not a database concept.** The core manipulates an opaque leg label;
   the adapter that serves a leg resolves it to the collection, the view and the identifier the
   platform uses. The core never validates a leg against a database's charset.
4. **The counterparty's vocabulary stays in the port.** A port may name the shape it expects from its
   connector. What the core may not do is carry a *concrete connector* or a *minted identifier's form*.
5. **The rule is enforced by a ratchet, and it is measured before it is shrunk.** The architecture
   test grows a rule that reads the core's **text** for the platform literals named above (the
   collection names, the `ARANGO_` prefix, the doc-repo's API path, the id-derived name, the
   counterparty's vocabulary outside the ports) and asserts the set of findings equals a listed
   ratchet. Every fix removes one finding and shrinks the list in the same commit. A **new** leak
   turns the test red immediately — the ratchet is a floor as well as a ceiling.

### Why the ratchet comes first

Five leaks were found by reading the core's text; the text is where the next one hides. The rules that
exist police imports, and the import direction was never the defect — a core module may hold a
platform's *name* without importing a platform's *module*. The measurement has to exist before the
correction, or the correction is a guess about what "done" means.

## Acceptance scenario

| Phase | Action | Expected |
|---|---|---|
| Measure | The architecture test runs on the tree as it stands | The ratchet names every leak the core's text carries (F1–F5), each with its file and the literal found |
| Fix F1 | A document id in the doc-repo's own form reaches `read_source` | The guard accepts the token; the adapter validates the platform's form; `read_source` resolves the document |
| Fix F2 | The capability no longer builds its own connector | `capabilities.search_knowledge` leaves `KNOWN_ADAPTER_IMPORTERS`; the host injects the connector the capability drives |
| Fix F3 | A deployment misconfigures its corpus leg | The refusal names the deployment's configuration, not a database's charset; the core never sees the charset |
| Fix F5 | An answer cites a legacy document | The citation card carries the document's **name** (resolved through the doc-repo port), not a deformed id; a source whose metadata does not resolve is not surfaced and contributes no score (D1) |

## Alternatives considered

| Alternative | Verdict | Why |
|---|---|---|
| Widen the id guard's regex and stop there | **Rejected** | It fixes F1's symptom and leaves the cause: the core still knows a platform's form, and the next format change silently refuses the corpus again. |
| Move the guard into the adapters, keep the platform's exact forms in the core | **Rejected** | The form would still be a core constant — only the *call site* would move. The core's text would still name the platform. |
| Keep the delta and let the citation card show the deformed id | **Rejected** | The E2E's source-card assertion can never hold, and the user sees an id where a name belongs. The deployed path already resolves the metadata; the agentic path is the one that diverges. |
| Rename the counterparty's vocabulary in the ports (drop `repo_id`/`concept_id`) | **Rejected** | A port names what it expects; the vocabulary is not the leak. Renaming it would churn the contract without moving a boundary. |
| Enforce the rule by review only (no ratchet) | **Rejected** | The five leaks were found by reading text, not by any rule; the next one will be too. A ratchet makes the class visible and the shrinkage measurable. |

## Consequences

- **Positive**: the core stops breaking when a platform changes its id format; the citation card shows
  a document's name; the dependency rules gain a second axis (the vocabulary) next to the first (the
  imports); every future connector is added behind a port without the core learning its vocabulary.
- **Negative**: the ratchet test reads source text, so a reworded comment can trip it — the patterns
  are scoped to code, not prose, and the finding names the literal so the edit is obvious. The
  id-resolution per answer costs a doc-repo round-trip the deployed path already pays.
- **Reconsideration triggers**: a platform that mints identifiers the token charset cannot express (the
  guard would have to widen, in the adapter); a counterparty whose vocabulary must be richer than a
  port's; an identifier the core must *interpret* rather than carry (a version, a partition key) —
  that value belongs in the record, beside the token, not in the token.

## References

- The architecture rules and their ratchets: `components/agent-service/tests/test_architecture.py`.
- The id guard and its consumers: `components/agent-service/capabilities/identifiers.py`,
  `components/agent-service/capabilities/executor.py`.
- The citation envelope and its recorded delta: `components/agent-service/capabilities/citations.py`;
  the deployed resolution: `genie-ai-overlay/chatqna/genieai_chatqna.py:3700-3760`.
- The document repository's minted id: `components/document-repository/src/utils/fileUtils.js:16-21`.
- ADR agentic-004 (runtime port governance by construction), ADR agentic-005 (tool sources and MCP
  consumption), ADR agentic-001 (retained answer visibility — the D1 rule's provenance).
