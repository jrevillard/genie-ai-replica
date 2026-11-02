# Epic C — Cleanup

## C0 — sprint/ scaffold + PLAN.md retirement (DONE — this commit)
sprint/ per plan.md §folder; root PLAN.md → `sprint/attic/PLAN-superseded.md` (secrets
sanitized); D6 rotation carried to decisions.md DEC-10; memory pointer updated to
sprint/plan.md.

## C1 — delete a10 environment (DONE 09-28, commit 1051a7f9)
`rm` `deploy/ansible/inventory/a10.ini` + `deploy/ansible/group_vars/agrivisory_a10/`.
**AC:** gone; `grep -r a10 deploy/` = 0. **Gate:** ansible syntax ×3. **DECIDE:** none (S-4 settled).

## C2 — VM docs consolidation (DONE 09-28, commit 09a77280)
`docs/vm-deploy-general.md` + `docs/vm-deploy-runbook-onvm.md` + `docs/vm-deploy-runbook-wsl.md`
→ ONE `docs/deploy-rtx6000.md`. Survivors: general doc's driver triage + tag anatomy +
troubleshooting; wsl's §1-3 (WSL/ansible/SSH setup) + gotchas format; nothing from onvm
(100% a10-specific). Fix while merging: `-K` contradiction, `agrivisory` placeholder-env
references → rtx6000, Llama-download claim vs granite default, keycloak_public_key fill-list,
deploy_dir actual value. Delete the three sources; update README links.
**AC:** one canonical doc; links resolve; contradictions gone. **Gate:** doc review. **DECIDE:** none.

## C3 — placeholder env fate (DONE 09-28 — DECIDED: delete; rtx6000 is the template)
`deploy/ansible/inventory/agrivisory.ini` + `group_vars/agrivisory/`: decide keep-as-template
(strip to .example) vs delete (rtx6000 is canonical). Tied to DEC-9.
**AC:** no third parallel env dir; B2 preflight would pass the surviving tree shape.
**Gate:** ansible syntax. **DECIDE:** DEC-9.
