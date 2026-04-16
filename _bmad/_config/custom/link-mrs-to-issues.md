# Link Merge Requests to GitLab Issues

> Shared custom BMAD task — retroactively links merged Merge Requests to their corresponding GitLab Issues.
> Run once per PRD after `sync-gitlab-issues` has created all issues.
>
> GitLab-first with file-system fallback when GitLab is unavailable.
> No shell script dependency — the AI executes `glab` commands directly.

## Prerequisites

- `glab` CLI authenticated (`glab auth login --hostname <host>`)
- Repository has Issues and Merge Requests enabled
- `sync-gitlab-issues` has already been run (issues exist in GitLab)
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

<step n="1" goal="Detect GitLab project and load PRD key">
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
  <output>WARN: GitLab unavailable — cannot link MRs to issues.</output>
  <action>Skip remaining steps</action>
</check>
<action>Read `prd_key` from `bmm/config.yaml` (field: `gitlab_tracking.prd_key`)</action>
<ask>If prd_key is not configured, ask the user for the PRD key (e.g., "keycloak-idp")</ask>
<note>Store HOST, PROJECT_ID, and prd_key for use in subsequent steps</note>
</step>

<step n="2" goal="Fetch merged MRs and GitLab issues">
<action>Fetch all merged Merge Requests:</action>
```
glab api --paginate "projects/$PROJECT_ID/merge_requests?state=merged&per_page=100&sort=asc&order_by=created_at" --hostname $HOST
```
The AI builds an in-memory list of MRs with their IID, title, description, and source_branch.

<note>The GitLab API returns GitLab Merge Requests only (not local git merge commits). Local merges like "Merge branch 'feature/epic2-backend' into feature/keycloak-idp-integration" only appear as GitLab MRs if they were created via `glab mr create` or the GitLab UI.</note>

<action>Fetch all GitLab Issues for this PRD:</action>
```
glab api --paginate "projects/$PROJECT_ID/issues?labels=prd::$prd_key&state=all&per_page=100" --hostname $HOST
```
The AI builds an in-memory index of issues keyed by their `EPIC.STORY` prefix (extracted from the title) and sprint key (from the `**Sprint Key:**` header in the description).
</step>

<step n="3" goal="Tier 1 — Pattern matching">
<action>For each MR in the list, check if the title or description matches these patterns (case-insensitive):</action>

| Pattern | Extract | Match against |
|---------|---------|---------------|
| `Story N.N` or `story N.N` | `N.N` | Issue title starting with `N.N ` |
| `story N-N` (kebab) | `N-N` → `N.N` | Issue title starting with `N.N ` |
| `Epic N` | `N` | Issue title starting with `Epic N:` |
| `QA` or `qa` | QA-related | Issue title starting with `QA:` |
| `retrospective` or `retro` | Retro-related | Issue title starting with `Retrospective:` |

<check if="match found">
  <action>Mark MR as **matched** with the issue IID. If multiple issues match (e.g., MR title mentions two stories), link to all matched issues.</action>
</check>
<check if="no match">
  <action>Mark MR as **unmatched** (proceeds to Tier 2)</action>
</check>
</step>

<step n="4" goal="Tier 2 — AI context matching">
<action>For each unmatched MR, the AI reads the MR's:</action>
- Title and description
- Source branch name (may contain worktree name → maps to epic, e.g., `feature/epic2-backend` → epic 2)

<action>And checks if context suggests a match:</action>
- MR title mentions "code review findings for story N.N" → match to that story
- MR title mentions "E2E QA fixes" + source branch is `feature/keycloak-idp-integration` → match to QA issue
- MR description references a specific story file or feature → match to that story
- MR source branch contains `epicN-*` → match to epic N

<note>The AI uses its understanding of the project context to make this determination. This is intentionally not a rigid pattern — it requires AI judgment.</note>

<check if="the AI is confident (>80%)">
  <action>Mark as **matched** with the issue IID</action>
</check>
<check if="unsure">
  <action>Mark as **unmatched** (proceeds to Tier 3)</action>
</check>
</step>

<step n="5" goal="Tier 3 — Report unmatched MRs">
<action>List all unmatched MRs with their IID, title, and source branch</action>
<output>
The following MRs could not be automatically matched to a GitLab issue:

  !{MR_IID} | {MR_TITLE} (from {source_branch})
</output>
<ask>Options:
1. Link specific MRs manually (provide "MR_IID=Issue_IID" pairs)
2. Skip all unmatched MRs
3. Cancel</ask>
</step>

<step n="6" goal="Link matched MRs to issues">
<action>For each matched MR:</action>

1. Use the MR description already in memory from Step 2 (no re-fetch needed)
2. Check if the description already contains `Closes #IID` or `Relates to #IID` → if yes, skip this MR
3. Link regardless of the issue's current state (open, closed) — the relationship is valid either way
4. Write the updated description to a temp file at `/tmp/gl-mr-desc-{MR_IID}.md`:
   - If description is empty: write only `Closes #IID`
   - If description is non-empty: prepend `Closes #IID\n\n` to the existing description
   - If linking multiple issues: include all references, e.g., `Closes #IID1\nCloses #IID2\n\n`
5. Update the MR:
   ```
   glab api --method PUT "projects/$PROJECT_ID/merge_requests/$MR_IID" --hostname $HOST \
     -F "description=@/tmp/gl-mr-desc-{MR_IID}.md"
   ```
6. Clean up the temp file after the glab command completes (successful or not)

<note>Use `-F` (file upload with `@` prefix), NOT `-f` (string field). This preserves markdown formatting.</note>
</step>

<step n="7" goal="Report summary">
<action>Display linking results:</action>

```
MR-to-Issue Linking Summary
============================
PRD:            {prd_key}
MRs scanned:    {n}
Tier 1 (pattern):    {n} matched
Tier 2 (AI context): {n} matched
Tier 3 (manual):     {n} matched
Already linked:      {n} skipped
Unmatched (skipped): {n}
```

</step>

</task>
