# Artifact lineage notes (post-run repairs, 2026-11-24)

- The B/C legs ran gated under the signed thresholds artifact digest
  **262e057f8522e6aa** (the registry as of the signature). The leg
  manifests stamp it; `e02.report.json` consumed it (its digest is
  invariant under the credential redaction below — the depth-aware rule
  had already redacted the key on the report's own write).
- AFTER the run, the registry's `sign_off.note` was rewritten (it still
  described the pre-signature M-1-only state) and the gate-compatible
  artifact was RE-DERIVED from the same values: the live
  `signed-thresholds.json` digest is now **ad0dc5bbdf8a89d0**. The delta
  is the note prose ONLY — the five dimensions' agreed values are
  byte-identical. The run-stamped artifact itself is not byte-reconstructable
  (its `created_utc` was the run moment); the manifests' stamped digest is
  the factual record.
- `config-b.rows.json`'s resolved-env snapshot carried the venue's
  VLLM_API_KEY (the driver fix un-crashed the rows write and the raw env
  landed). It is REDACTED in this copy; the venue credential itself lives
  in the cluster secret and the deployment's secretKeyRef only. The
  e02.report digest is unchanged by the redaction (verified: re-derived
  under the pinned created_utc — 15d538d8d300).
- `findings-b.report.json` re-composes the B leg's findings from the
  committed rows (`run_protocol verdicts`); its digest differs from the
  assess-time record (19b46678614e) because the report digest covers
  created_utc and the original stamp was the assess moment — the inputs
  (the rows file) are identical.
