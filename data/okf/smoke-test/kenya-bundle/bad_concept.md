---
title: "Deliberately Non-Conforming Concept"
description: "Fixture that MUST produce exactly two conformance issues: MISSING_TYPE (no type) and BAD_ACTOR_PREFIX (generated.by lacks a valid prefix)."
status: stable
tags: [fixture, conformance]
labels: [t:smoke]
generated:
  by: "robot:unknown-compiler"
---

# Deliberately Non-Conforming Concept

This fixture exists so the smoke test can prove the conformance pipeline
end-to-end on live data: the writer must persist its issues and the metrics
aggregate must report a non-zero conformance_issue_count. It intentionally
violates two OKF §11 rules:

1. No `type` in frontmatter (MISSING_TYPE).
2. `generated.by` does not start with a valid actor prefix
   (BAD_ACTOR_PREFIX).

Everything else about the document is well-formed.
