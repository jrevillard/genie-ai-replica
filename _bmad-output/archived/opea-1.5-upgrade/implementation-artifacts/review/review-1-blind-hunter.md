# Review Prompt 1/3 — Blind Adversarial Hunter

> Run this in a **separate session** (ideally a different LLM). Paste back findings.

## Invoke

Use the **`bmad-review-adversarial-general`** skill (adversarial, cynical reviewer).

## Constraints (STRICT)

- You receive the diff **ONLY**.
- **No spec, no project access, no context docs.** Do not read other files.
- Do not assume anything about intent that is not evident in the diff itself.

## Input

The verbatim diff is at:

```
_bmad-output/implementation-artifacts/review/part-b-code-diff.patch
```

Read that file and only that file. It contains changes to:

- `genie-ai-overlay/retriever/config.py`
- `genie-ai-overlay/retriever/genieai_retriever_arangodb.py`
- `genie-ai-overlay/tests/test_retriever.py`
- `env`

## Your Job

Hunt for defects you can prove from the code alone: logic errors, off-by-ones, incorrect fusion math, resource/state bugs, exception-handling gaps, security/escape issues (AQL injection from user input?), incorrect idempotency, unhandled None/empty, broken async/await, naming/contract mismatches, dead code.

For each finding: **file:line**, what's wrong, why it's a defect, severity (blocker/major/minor). Be cynical. If you find nothing, say so explicitly.
