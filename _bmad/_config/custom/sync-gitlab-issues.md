# Sync Sprint Status to GitLab Issues

> Shared custom BMAD task — syncs `sprint-status.yaml` to GitLab Issues using `glab` CLI.
> Designed to run after `/bmad-bmm-sprint-planning` or on-demand to reconcile state.
>
> GitLab-first with automatic file-system fallback when GitLab is unavailable.
> No shell script dependency — the AI executes `glab` commands directly.

## Prerequisites

- `glab` CLI authenticated (`glab auth login --hostname <host>`)
- Repository has Issues enabled
- `sprint-status.yaml` exists at `{status_file}`
- `prd_key` configured in `bmm/config.yaml` or passed as argument

## Error Handling

All `glab api` calls may fail (network timeout, 401 unauthorized, 409 conflict, etc.). When a glab command fails:
1. Log a warning to the output (do not halt the workflow)
2. Skip the specific operation that failed
3. Continue with remaining operations

## JSON Parsing

The AI parses JSON responses natively — no `jq` dependency. The AI reads the `glab api` output and extracts fields directly from the JSON text.

## Task Instructions

<task>

<step n="1" goal="Detect GitLab project">
<action>Detect GitLab host and project path from git remote:</action>
  1. Run `git remote get-url origin`
  2. Parse the URL:
     - SSH format `git@HOST:GROUP/PROJECT.git` → HOST and PROJECT_PATH
     - HTTPS format `https://HOST/GROUP/PROJECT.git` → HOST and PROJECT_PATH
<action>Get project numeric ID:</action>
  - Set HOST and PROJECT_PATH from the parsed URL (e.g., `HOST=opensource.unicc.org`, `PROJECT_PATH=un/itu/genie-ai`)
  - Run `glab api "projects/$(printf '%s' "$PROJECT_PATH" | sed 's/\//%2F/g')" --hostname $HOST`
  - The AI extracts `.id` from the JSON response as PROJECT_ID (native JSON parsing)
<action>Verify connectivity:</action>
  - Run `glab auth status --hostname $HOST`
<check if="any step fails">
  <output>WARN: GitLab unavailable — falling back to file-system tracking. No GitLab sync will be performed.</output>
  <action>Skip remaining steps</action>
</check>
<action>Read `prd_key` from `bmm/config.yaml` (field: `gitlab_tracking.prd_key`)</action>
<ask>If prd_key is not configured, ask the user for the PRD key (e.g., "keycloak-idp")</ask>
<action>Read `planning_artifacts` and `story_location` paths from `bmm/config.yaml` (fields: `planning_artifacts` and `implementation_artifacts`)</action>
<action>Verify prd_key matches the current PRD: check if a PRD file exists at `{planning_artifacts}/prd-{prd_key}*.md` or similar naming pattern</action>
<check if="no matching PRD file found">
  <output>WARN: prd_key "{prd_key}" does not match any PRD document in {planning_artifacts}. The sync will target the wrong PRD.</output>
  <ask>Update prd_key in config.yaml to match the current PRD, or cancel the sync?</ask>
</check>
<note>Store HOST, PROJECT_ID, prd_key, planning_artifacts, and story_location for use in subsequent steps</note>
</step>

<step n="2" goal="Ensure labels exist">
<action>Load existing labels: `glab api --paginate "projects/$PROJECT_ID/labels?per_page=100" --hostname $HOST`</action>
<action>For each label below that is NOT in the response, create it:</action>

Create command pattern:
```
glab api --method POST "projects/$PROJECT_ID/labels" --hostname $HOST \
  -f "name=LABEL_NAME" -f "color=COLOR" -f "description=DESCRIPTION"
```
Skip if API returns 409 (already exists) or any error.

**Status labels:**
| Label | Color | Description |
|-------|-------|-------------|
| status::backlog | #E5E5E5 | Story exists in epic only |
| status::ready-for-dev | #FBCA04 | Story file created |
| status::in-progress | #FEF2C7 | Developer actively working |
| status::review | #FF9900 | Ready for code review |
| status::done | #1D7F36 | Story completed |
| status::deferred | #909090 | YAGNI - deferred |
| status::closed | #BFBFBF | Closed - no longer needed |
| status::optional | #EEEEEE | Retrospective - optional |

**Type labels:**
| Label | Color | Description |
|-------|-------|-------------|
| type::prd | #1F78D1 | Product Requirements Document |
| type::epic | #E74C3C | Epic grouping |
| type::story | #6699CC | Implementation story |
| type::qa | #9966CC | QA audit or test coverage |
| type::retrospective | #CC6699 | Epic retrospective |

**PRD label:**
| Label | Color | Description |
|-------|-------|-------------|
| prd::{prd_key} | #428BCA | (empty) |

**Epic labels** (read from sprint-status.yaml, match lines matching pattern `epic-\d+:` but NOT `epic-\d+-retrospective:`):
| Label | Color | Description |
|-------|-------|-------------|
| {prd_key}::epic-N | #428BCA, #44AD8E, #F0AD4E, #D9534F, #6B5CE7, #1ABC9C, #E74C8B, #95A5A6, #3498DB, #E67E22 | Epic N |

<note>Use the color sequence above: epic-1=#428BCA, epic-2=#44AD8E, epic-3=#F0AD4E, etc.</note>

<action>Ensure BMAD Sprint Board exists (one-time setup, shared across all PRDs):</action>

1. List existing boards: `glab api "projects/$PROJECT_ID/boards" --hostname $HOST`
2. Check if any board is named "BMAD Sprint Board"
3. If found, skip board creation
4. If not found, create it and add lists:

Create board:
```
glab api --method POST "projects/$PROJECT_ID/boards" --hostname $HOST -f "name=BMAD Sprint Board"
```

Create lists (columns) — one per active status label. Omit `done` and `closed` (closed issues are not shown on boards):
```
glab api --method POST "projects/$PROJECT_ID/boards/$BOARD_ID/lists" --hostname $HOST -f "label_id=$LABEL_ID"
```

| Column | Label ID | Label Name |
|--------|----------|------------|
| Backlog | (status::backlog label ID) | status::backlog |
| Ready for Dev | (status::ready-for-dev label ID) | status::ready-for-dev |
| In Progress | (status::in-progress label ID) | status::in-progress |
| Review | (status::review label ID) | status::review |
| Deferred | (status::deferred label ID) | status::deferred |

<note>The board is BMAD-generic (not PRD-specific). To filter by PRD in the GitLab UI, type `prd::{prd_key}` in the board search bar.</note>
</step>

<step n="3" goal="Create PRD issue (if not exists)">
<check if="prd_parent_issue is set in config">
  <note>PRD linked to existing issue #{prd_parent_issue} — skip creation</note>
</check>
<check if="prd_parent_issue is NOT set">
  <action>Search for existing PRD issue: `glab api --paginate "projects/$PROJECT_ID/issues?search=$prd_key&labels=type::prd&state=all&per_page=100" --hostname $HOST`</action>
  <check if="no match found in response">
    <action>Create PRD issue. Read the PRD file at `{planning_artifacts}/prd-{prd_key}*.md` to extract the title (first `#` heading) and a brief description (first paragraph or summary). Format title as `"PRD: {heading text}"`</action>
    <action>Labels: `type::prd,prd::{prd_key}`</action>
    <action>Create command: `glab api --method POST "projects/$PROJECT_ID/issues" --hostname $HOST -f "title={PRD_TITLE}" -f "description={PRD_DESC}" -f "labels=type::prd,prd::{prd_key}"`</action>
  </check>
</check>
</step>

<step n="4" goal="Sync issues (create missing + reconcile statuses)">
<critical>This step combines creation and reconciliation in a single pass — one API fetch, then targeted creates/updates.</critical>

<action>Fetch ALL GitLab issues for this PRD in a single call:</action>
```
glab api --paginate "projects/$PROJECT_ID/issues?labels=prd::{prd_key}&per_page=100&state=all" --hostname $HOST
```
This returns all issues tagged with this PRD — epics, stories, QA, and retrospectives. The AI builds an in-memory index from this response.

<action>Read sprint-status.yaml and parse ALL entries in development_status</action>

<action>Classify each entry by key pattern:</action>
  - **Epic**: key matches `epic-N` (not ending with `-retrospective`) → type::epic
  - **Retrospective**: key ends with `-retrospective` → type::retrospective
  - **QA**: key starts with `qa-` → type::qa
  - **Story**: key matches N-N-* pattern (default) → type::story

<action>Extract the epic number from each entry key:</action>
  - `epic-N` → N (e.g., `epic-2` → 2)
  - `epic-N-retrospective` → N (e.g., `epic-2-retrospective` → 2)
  - `qa-*` → N extracted from the first `epic-N` occurrence in the key (e.g., `qa-audit-epic-1-tests` → 1, `qa-epic-1-important-corrections` → 1). If no `epic-N` pattern exists in the key, infer from context or ask the user.
  - `N-N-*` → first N is the epic number (e.g., `2-3-token-passthrough...` → 2)

<action>For each entry, determine the title:</action>
  - **Epic**: Read the epic file at `{planning_artifacts}/epic-N-*.md`. The title is the first `#` heading text. Format: `"Epic N: {heading text}"`
  - **Story**: Read the story file at `{story_location}/{entry_key}.md`. The first line has format `# Story EPIC.STORY: {title}`. Extract `{title}` from that line. Format: `"EPIC.STORY {title}"` (e.g., `"1.1 Keycloak Container with Pre-configured Realm & OIDC Client"`). If the file does not exist, derive the title from the sprint key: the first two number groups form `EPIC.STORY`, and the remaining kebab-case suffix is converted to title case (e.g., `2-5-kong-multi-issuer-token-validation` → `"2.5 Kong Multi Issuer Token Validation"`)
  - **QA**: No file — derive the title from the sprint key: remove the `qa-` prefix, convert kebab-case to title case. Format: `"QA: {derived title}"` (e.g., `qa-audit-epic-1-tests` → `"QA: Audit Epic 1 Tests"`)
  - **Retrospective**: Read the retrospective file at `{story_location}/epic-N-retrospective.md`. If the file exists, include its full content after the header. If the file does not exist, use only the header. Format: `"Retrospective: Epic N"` where N is the epic number.

<action>For each entry, match against the in-memory GitLab issue index:</action>
  1. Primary: find issue whose title exactly matches the expected title (case-sensitive string comparison)
  2. Secondary: find issue whose description body contains the exact sprint key string (e.g., `1-3-backend-auth-middleware-protected-and-public-routes`)
  3. Tertiary: for stories, find issue whose title starts with the same `EPIC.STORY ` prefix (e.g., both `"1.1 Keycloak container..."` and `"1.1 Keycloak Container..."` start with `1.1 `). This handles legacy issues created by a previous script with different casing. Exclude issues whose `closed_as_duplicate_of` field is not null. If multiple issues remain, pick the one with the lowest IID (oldest).

<action>Based on match result, take one of three actions:</action>

  **A) No matching issue found → CREATE:**
  - Determine description content based on entry type:
    - **Story**: The story file is at `{story_location}/{entry_key}.md`. If the file exists, include its full content after the header. If the file does not exist (common for deferred/closed stories), use only the header — do not invent content.
    - **Epic**: The epic file is at `{planning_artifacts}/epic-N-*.md`. Include its full content after the header.
    - **QA**: No content file — use only the header.
    - **Retrospective**: The retrospective file is at `{story_location}/epic-N-retrospective.md`. If the file exists, include its full content after the header. If the file does not exist, use only the header.
  - Write description to a temp file at `/tmp/gl-desc-{entry_key}.md` with format:
    ```
    **Sprint Key:** `{entry_key}`
    **Epic:** {epic_num}
    **PRD:** {prd_key}

    ---

    {full content of the story or epic file}
    ```
    If there is no content file (QA, retrospective, or story without file), omit the `---` separator and content section entirely. The file contains only the three header lines.
  - Create command:
    ```
    glab api --method POST "projects/$PROJECT_ID/issues" --hostname $HOST \
      -f "title={TITLE}" -F "description=@/tmp/gl-desc-{entry_key}.md" \
      -f "labels=type::{TYPE},status::{YAML_STATUS},prd::{prd_key},{prd_key}::epic-{EPIC}"
    ```
    Note: `-f` passes a literal string value; `-F` uploads a file (the `@` prefix before the file path is required by glab).
  - Use the yaml status as-is for the label (e.g., `done` → `status::done`, `deferred` → `status::deferred`, `closed` → `status::closed`)
  - If the yaml status is `done` or `closed`, the issue must be closed after creation (GitLab API creates issues as "opened" by default). Immediately run: `glab api --method PUT "projects/$PROJECT_ID/issues/$IID" --hostname $HOST -f "state_event=close"` where `$IID` is the `iid` from the creation response.
  - Clean up the temp file after the glab command completes (successful or not)

  **B) Matching issue found → UPDATE (if needed):**
  - Check if the issue title exactly matches the expected title (case-sensitive). If not, the title must be updated.
  - Check if the issue's current `status::*` label matches the yaml status. Map yaml status to GitLab label:
    - backlog, ready-for-dev, in-progress, review, done, deferred, closed, optional → status::{same}
    - drafted → status::ready-for-dev
    - contexted → status::in-progress
  - If both title and status match → **SKIP** (no update needed)
  - If title differs and/or status differs → build the update command:
    - Always include `-f "title={EXPECTED_TITLE}"` if title differs
    - If status differs, build the label list:
      1. Take all labels from the issue (e.g., `["type::story", "status::backlog", "prd::keycloak-idp", "keycloak-idp::epic-1"]`)
      2. Remove any label that starts with `status::` (e.g., remove `status::backlog`)
      3. Append the new status label (e.g., add `status::done`)
      4. Join with commas: `type::story,prd::keycloak-idp,keycloak-idp::epic-1,status::done`
    - Determine state_event from the yaml status:
      - done, closed → close
      - in-progress, review, ready-for-dev → reopen
      - backlog, deferred, optional → (omit `state_event` parameter entirely)
    - Update command (include only the parameters that need changing):
      ```
      glab api --method PUT "projects/$PROJECT_ID/issues/$IID" --hostname $HOST \
        -f "title={EXPECTED_TITLE}" \
        -f "labels={UPDATED_LABELS}" -f "state_event={EVENT}"
      ```
      Omit `-f "title=..."` if title already matches. Omit `-f "labels=..."` and `-f "state_event=..."` if status already matches.

<note>yaml is the fallback authority during outage — auto-push yaml status to GitLab</note>
</step>

<step n="5" goal="Report sync summary">
<action>Display sync results:</action>

```
GitLab Issues Sync Summary
==========================
PRD:            {prd_key}
Labels synced:  {n} created/verified
Issues created: {n}
Status updated: {n}
Skipped:        {n} (already in sync)
```

</step>

</task>
