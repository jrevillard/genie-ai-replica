# Rollout records — the canonical home

Every delivered stage of the agentic-foundations initiative rolls out with a
**rollout record**. This directory is the record's only home: one record per
stage, committed in the repository, written before the stage is called
delivered. "Rollback is possible" is accountability, not hope (Epic 3, AD-9):
the record is what makes the claim auditable.

- **One record per stage.** A stage's record is `docs/rollouts/<stage>-rollout.md`
  (stage id, lowercase: `v08-rollout.md`). A re-rehearsal of the same stage
  APPENDS to that stage's record (a new dated evidence section); it never opens
  a second file for the same stage, and it never edits an earlier evidence
  section — the record is append-only evidence history.
- **The record structure follows FR-16 verbatim.** Every field below is
  mandatory; a record missing one is not a record.
- **The rehearsal is re-run per stage** (V08, Epic 3 story 3.3): the procedure
  in [`v08-rehearsal-runbook.md`](v08-rehearsal-runbook.md) is re-executed for
  every later delivered stage, and its fresh evidence lands in that stage's
  record. A stage whose rehearsal has not run is not a delivered stage.
- **The named responsible operator** in every record is the initiative owner —
  recorded by name, never defaulted silently.

## The record template

Copy this skeleton into `docs/rollouts/<stage>-rollout.md` and fill every
field. Nothing in the template may be removed; sections may gain stage-specific
subsections but never lose one.

```markdown
# <STAGE> rollout record

- **Stage:** <stage id — the PRD story / acceptance scope the stage delivered>
- **Date:** <YYYY-MM-DD of the rehearsal>
- **Named responsible operator:** <the person who pulls the rollback trigger>
- **Venue:** <the deployment the rehearsal ran against>

## 1. Selected consumers and capabilities

What this stage activates, and for whom: the consumers (request paths, entry
points) routed to the new capability, the capabilities themselves, and what
stays on the legacy path. Flag-off behavior is stated explicitly ("flag off
means exactly today").

## 2. Artifact and configuration versions

The exact versions the rehearsal ran: image references with digests (the
`pending-<sha>` build tags of the branch the stage delivered), the source
commit, model ids served, flag values, budget knobs — everything an operator
needs to reproduce the deployed combination.

## 3. Activation procedure

The exact commands that activate the stage's routing on a deployment.

## 4. Rollback procedure

The exact commands that return the deployment to the legacy path — the
documented switch semantic (a flag change takes effect on process restart),
not an in-place flip.

## 5. In-flight treatment

The observed treatment of a request in flight at switch time, with
timestamps (ADR agentic-003 is the policy; the record carries what the
rehearsal actually saw).

## 6. Rollback triggers and the named responsible operator

The conditions under which the rollback procedure is executed, and the person
who executes it — named, not a role.

## 7. Rehearsal evidence

Transcript excerpts of the rehearsal phases (pair validation, both routing
directions, in-flight switch), each with its verdict. Known venue defects that
bounded the rehearsal are recorded here with their issue references — recorded,
never silently turned into requirements (FR-26).

## 8. Stage-gate FR-21 check (executed)

The OPEA-free gate run on the tree this stage delivers, with its result, and
the explicit review verdict: no new OPEA coupling was added that makes the
deferred OPEA exit harder (FR-21). A stage gate that cannot show this check
green does not exit.
```

## The stage-gate FR-21 item (FR-20 / FR-21, AD-1)

Every stage-gate review explicitly checks: **no new OPEA coupling was added
that makes the deferred OPEA exit harder.** The mechanical half is the
OPEA-free structural gate (`tests/config-validator`, job `config:validate`) run
against the stage's tree — the dependency audit over
`scripts/ci/agent-path-packages.json`; the review half names the audited scope
(the agent-path packages) and records the result in the stage's record §8. The
original instrument (`docs/baselines/s3-exit-checklist.md`) carries the same
item explicitly since story 3.3; later stage gates inherit the item from this
page and from the checklist's example.

## Records

| Stage | Record                             | Rehearsal                                                                         |
| ----- | ---------------------------------- | --------------------------------------------------------------------------------- |
| V08   | [`v08-rollout.md`](v08-rollout.md) | [`v08-rehearsal-runbook.md`](v08-rehearsal-runbook.md) evidence, §7 of the record |
