# Issue Label System — Agent Instructions

The `status::*` label namespace is the machine-readable state of every issue.
**One status label per issue at a time** — the issue comments carry the
reasoning, the label carries the state. This is the whole team's convention
(Jerome's board); every agent follows it.

## The status::* lifecycle

| Label | Meaning |
|---|---|
| `status::backlog` | Filed, triaged, not scheduled. Workers set it ONCE, at creation of an extracted-finding issue — after that, never touched by workers again. |
| `status::ready-for-dev` | Triaged, validated, dispatchable. The queue the orchestrator picks from when a seat frees. |
| `status::in-progress` | A worker owns it (dispatched, working). Set at dispatch. |
| `status::review` | Every automated gate is green (CI success on the MR head, MR mergeable, body has `Closes #iid`, branch rebased) and the only remaining action is the human's: review + merge decision. Set at sweep time, **never before the gates pass** — a label that says "your turn" too early trains the human to ignore it. |
| `status::done` | The merge landed and actually closed the issue (`Closes #iid` in the MR body → auto-close on merge). Verified by the chain check: issue closed + label `status::done`. |
| `status::awaiting-operator` | A question blocking the worker's ACTIVE work right now — needs an operator decision. Never used for filed findings. While parked, the seat is freed (work preserved, resumable). |
| `status::deferred` / `status::closed` / `status::optional` | Won't do now / administrative close / nice-to-have. |
| `status::wont-fix` | Rejected with a written reason. |

## Who touches labels

- **Workers**: set `status::backlog` ONCE at issue creation (extracted
  findings). After that, never touch any `status::*` label — label changes
  are orchestrator/operator territory. A worker's only other label move is
  `status::awaiting-operator`, and only for a live blocker.
- **Orchestrator**: flips backlog→in-progress (dispatch), in-progress→review
  (sweep, gates green), review→done (the merge's auto-close is completed by
  the label check), in-progress→awaiting-operator reverts when a parking is
  stale.
- **Operator (David)**: the human decisions — close, wont-fix, scope changes,
  resolving parked issues.

## Agent application rules

1. **One status label at a time.** Set a new one by REMOVING the old in the
   same request (`?remove_labels[]=status::backlog&add_labels[]=status::in-progress`).
2. **Claiming**: a queued issue carries no status label or `status::backlog`.
   While queued-but-not-yet-started it is `status::ready-for-dev`; the moment
   work starts it flips to `status::in-progress` — and only one issue at a
   time is in-progress per worker.
3. **Claim notes**: claim before starting (a short note on the issue naming
   the MR/branch and the approach) so the team sees what is in flight. The
   comment carries the reasoning; the label carries the state.
4. **Collision discipline**: before claiming, sweep
   `label_name[]=status::in-progress` (and the reviewer's authored issues).
   If the area is someone's active wave, hand back, withdraw the claim note,
   pick non-colliding work.
5. **Close-keyword discipline**: issues are closed by the merge —
   `Closes #iid` goes in the MR **description**, never in a commit message
   (GitLab folds commit-message keywords into the squash close list and
   bypasses body-based gates).
6. **No status labels on merge requests** — MR state is signaled by the draft
   flag + comments.
7. **Sweep → review**: when an MR's gates are all green (CI success on head,
   mergeable, rebased, `Closes #iid` in the body), set the issue to
   `status::review` and prepare the merge GO for David.

Reference: the coordination board is #1216; the post-train work plan is
#1367.
