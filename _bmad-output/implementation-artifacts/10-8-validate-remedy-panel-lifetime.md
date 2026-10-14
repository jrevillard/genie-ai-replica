# Story 10.8 — Validate step: remedy panels must outlive the issue they cure

| | |
|---|---|
| **Epic** | Epic 10 — OKF Studio (creation & curation capstone) |
| **GitLab** | !1076 (`okf-server::epic-10`, `prd::okf-server`, `status::backlog`, `type::story`) |
| **Defect** | !1075 (P1) |
| **Status** | backlog — discovered live 2026-10-15 during the concept-doc-ceiling run |
| **Design source** | `okf-studio-ux-design-2026-08-13.md` (Validate step remedy contract); D5 in [`3-10-okf-wizard-ux-remediation.md`](3-10-okf-wizard-ux-remediation.md) keeps the full three-pane editor in Curate |
| **Trigger** | David's field report 2026-10-15, wizard step 7: *"Link suggestions show and when one link suggestion is accepted, they all disappear"* |

## Problem (field report, 2026-10-15)

Link suggestions render for an orphan page. Accepting **one** proposal makes **all**
of them disappear — including every un-accepted proposal and including the one just
accepted.

## Root cause — the panel is a descendant of the issue it remediates

`components/gov-chat-frontend/src/components/okf/steps/Validate.vue`, nesting from `:86`:

```html
<div v-if="issue.type === 'orphan' && !frozenAt">              <!-- :86  the orphan issue ROW -->
  <DsButton @click="onSuggestLinks(issue.concept_id)">Suggest links</DsButton>
  <div v-if="suggestFor === issue.concept_id && suggestion">   <!-- :95  suggestions INSIDE the row -->
    <ul>
      <li v-for="p in suggestion.proposals" :key="p.to_concept_id">   <!-- :103  every proposal -->
        <DsButton v-if="p.accepted" variant="ghost" small disabled>Done</DsButton>  <!-- :106 -->
        <template v-else>
          <DsButton @click="onAcceptLink(issue.concept_id, p)">Accept</DsButton>    <!-- :111 -->
```

`onAcceptLink` (`:615-628`):

```js
if (res && res.ok) {
  proposal.accepted = true;
  this.refresh();   // :627  comment: "the orphan issue clears once the page is linked"
}
```

**Sequence:** the page has no links → it appears as an `orphan` issue → *Suggest
links* renders proposals **inside that row** → accepting the first proposal gives
the page a link, which **cures the orphan** → `refresh()` re-fetches, the orphan
row leaves the report, and the suggestions `<div>` **unmounts as its descendant**.
The proposals are *destroyed*, not cleared — `proposal.accepted` and
`p.dismissed` write to objects that no longer have a subtree.

## Design intent settles it is a defect

`:106` renders a **"Done"** button for an accepted proposal — an explicit
affordance for the accepted row to *stay in the list showing its resolved state*.
That button can never be seen, because the list is torn down one interaction
earlier. The resolved-state view was built and then destroyed.

## Impact — the remaining proposals become unreachable

The orphan row also carries the **"Suggest links"** entry point at `:87-94`. Once
the page has a link it is no longer orphaned, so **that row stops rendering** — and
with it the only UI affordance for creating the remaining links.

So the remediation path this step exists to offer — *orphan → suggest links →
accept* — works **exactly once per page**. The rest must be created by hand in the
editor.

## Task breakdown

| # | Task |
|---|---|
| 1 | Hoist the link-suggestion panel out of the per-issue `v-for`; render once at panel level keyed on `suggestFor` (which already holds a single concept id) |
| 2 | Accepting marks the proposal `accepted` and leaves the remaining proposals rendered — the behaviour `:106` was already written for |
| 3 | Apply the same treatment to `wireExisting` (`:176`) and Sources-page creation (`:181`) — same nesting, same `refresh()` call |
| 4 | Regression test: accepting one of N proposals leaves the other N-1 present, and the accepted one shows `Done` |

## Acceptance criteria

1. Accepting one link suggestion leaves the remaining proposals rendered.
2. The accepted proposal shows its `Done` state rather than disappearing.
3. Reaching remaining proposals does not require re-running *Suggest links* on a
   page that is no longer orphaned.
4. `wireExisting` and Sources-creation panels survive their issue clearing for the
   same reason.

## Related

- !1067 — bundle import opens the wizard on step 9, past the only step with a
  blocking requirement; same "user cannot see what they need" family
- `docs/testing/concept-doc-ceiling-defect-log.md` BUG-10
