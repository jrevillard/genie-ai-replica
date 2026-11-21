# Demo Seeding — Agent Instructions (stub)

Runbook + full contracts: `deploy/demo-seed/README.md`
(`genie-demo-seed.py`, data-driven via `demo-seed-config.json`).
Seeds a knowledge hierarchy + document corpus + aligned quickHelp
config into a running instance.

Read the README and run `--dry-run` first, always. Hard rule: never
against production without an explicit operator GO — the run deletes
the existing hierarchy (phase 1) and replaces the frontend runtime
config. The frontend config mount needs a rollout RESTART after the
ConfigMap update (subPath never refreshes — undo TWICE then delete the
CM to restore baseline).
