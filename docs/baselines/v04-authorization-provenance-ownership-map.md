# V04 — Authorization, provenance and ownership map (as deployed)

| Field | Value |
|---|---|
| Artifact | **V04** — verification gate of PRD `agentic-foundations`, Epic 1 / stage S3 |
| Status | **Recorded** — the premise check is discharged with a scoping clarification (§5.2) |
| Date | 2026-11-19 |
| Story | [#1951](https://opensource.unicc.org/un/itu/genie-ai/-/issues/1951) — story 1.5, "Define the document capability contract (with V04 acceptance)" |
| Binds | FR-2, FR-3, FR-4, FR-5 · AD-3 (premise check), AD-4 · gates the contract's acceptance |
| Method | read-only inspection of the deployed code paths — the questions are structural (who decides, where, and on what field), so a runtime probe would measure the wrong thing |
| Upstream authority | PRD `agentic-foundations`, architecture spine AD-3 (the premise this record checks) and AD-4 |
| Owner | the story 1.5 worker · reviewers: the orchestrator's review chain (the MR for this story) and the operator's merge GO |
| Companion records | [V02](v02-opea-query-path-contract.md) (the frozen query-path behaviour), [V03](v03-deployed-baseline-2026-11-18.md) (the deployed posture) |
| Reconsideration triggers | the okf-server's scope mode leaves `open`/`closed`; a per-repo ACL gains a label dimension; a resolver endpoint appears that maps a caller-supplied `repo_id` to a serving graph; the legacy corpus gains a per-user ACL; the retained-data decision of story 1.7 lands |

### FR-29 traceability

```
use case (the agent reads the authorized corpus and cites what it found)
  -> requirement (FR-2 trusted caller context, FR-3 stable provenance, FR-5 versioning)
    -> decision (architecture spine AD-3: the contract is a port, okf-server stays the read authority)
      -> investigation (this record + the contract module + its tests)
        -> merge request (the story 1.5 MR)
          -> validation evidence (the component suite; the §5 premise table; §6 declared-versus-enforced)
            -> released version (the merge into feat/agentic-foundations/prd)
```

## 1. What this record is, and what it is not

V04 answers one question: **does AD-3's premise survive contact with the deployed code?** The premise is that the document capability contract lives inside the agent service, that okf-server remains the per-user read authority, that the port queries only the caller's authorized set, and that identifiers are validated or resolved server-side.

The answer is a map of how authorization, provenance and ownership actually work today — the evidence the premise is checked against, and the constraints the contract therefore has to carry.

It is not a redesign. Nothing here changes okf-server, the document repository or the BFF; it records what they do, so the contract states obligations that match reality instead of aspirations that contradict it.

## 2. Effective authorization

### 2.1 The OKF read authority is the okf-server

Three services in `components/okf-server` decide who may read what:

| Concern | Where | What it does |
|---|---|---|
| Scope mode | `services/scope-authz-service.js:70` (`currentScopeMode`) | `open` by default; a garbage value degrades to `closed`. `deriveScopeAuthz` (`:88`) turns the caller's `okf:*` scopes into an authorized repository set — `null` means unrestricted (super-role or a `*` repo segment). |
| Per-caller read authorization | `services/scope-authz-service.js:131` (`deriveReadAuthz`) | Returns `{isSuperAdmin, authorizedRepoIds, scopeMode, unrestricted}` — the answer to "may this caller traverse ALL serving repos?". |
| Per-repo fence | `services/access-control-service.js:50` (`callerMayTraverseRepo`), `:66` (`filterServingByAcl`) | A **restricted** repository is fenced from non-privileged callers in **both** scope modes. The fence, not the scope mode, is what keeps restricted content unreachable. |
| The authorized set itself | `services/authz-resolver-service.js:37` (`resolveGraphSet`) | Resolves the caller's serving set: `{graph_names, per_graph_labels, domains, repos[{repo_id, name, domain, graph_name}], ttl_seconds}`. |

The serving reads are registered on their own sub-router (`routes/okf-routes.js:29-64`), behind `requireScope('read', {allowScopelessWhenOpen: true})`: `GET /api/okf/retrieval-config`, `GET /api/okf/authz/graphs`, `GET /api/okf/repos/:repo_id/concepts/:concept_id`, `GET /api/okf/concepts/resolve-repo`, `GET /api/okf/repos/:repo_id/concept-tree`. Everything else — repository CRUD and every mutation — stays behind the strict scope gate that follows (`:66`).

The agents never see raw AQL: the okf-server exposes parameterized, scope-checked operations only ([ADR okf-011](../adr/okf-011-no-raw-aql-to-agents.md)).

### 2.2 The BFF resolves the set server-side and forwards it as structured fields

`components/gov-chat-backend/services/query-service.js` builds the carrier the retriever consumes:

- `:748` — `getAuthorizedGraphs(bearer, …)` calls the okf-server's `/api/okf/authz/graphs` **with the caller's bearer token**. The set is therefore computed per caller, server-side; the BFF never derives it from anything the model produced.
- `:746-752` — the carrier is `authorized_graph_names`, a list of graph names. Structured fields, not the compressed `search_start` string.
- `:766-773` — in `hybrid` posture the **legacy graph is prepended** to the authorized set. The legacy corpus is in the authorized set because of the *deployment posture*, not because of a per-user grant.
- `:778-784` — in `okf_only` posture the legacy graph is never added and `exclude_legacy: true` tells the retriever to refuse the legacy corpus outright.
- `:803-808` — in `legacy` posture (or an unresolved mode) nothing is added and the payload stays byte-identical to the pre-1.1 shape.
- `:810-822` — the failure path. A `401` is rethrown (the request itself is invalid). Any other resolver failure logs `fanout_carrier_failed_fail_closed` and returns the payload unchanged: **no carrier keys are added**, and the request therefore continues on the legacy path. The carrier is fail-closed; the *posture* it degrades to is the legacy corpus.

That last point is the window AD-3 names: a resolver outage does not produce an error, it produces a legacy-corpus answer.

### 2.3 The legacy corpus: no per-user authorization, and one per-repository fence

This is the most consequential finding of this record, and it has two halves that must not be merged.

**There is no per-user authorization on the legacy corpus.**

- `components/document-repository/src/routes/fileRoutes.js:11` — the router's only global gate is `authenticateToken`. The metadata read `router.get('/:fileId', fileController.getMetadata)` at `:356` carries **no** `authorizeRole`, unlike the neighbouring routes (`:66`, `:119`, `:154`, `:205`, `:383`, `:408`, `:433`, `:460`, `:487`), and the handler (`components/document-repository/src/controllers/fileController.js:1250`) performs no ownership check.
- The corpus itself carries no owner: the dataprep and retriever modules contain **zero** occurrences of `user_id` — nothing writes one, so nothing could filter on one.
- The file record has no field derived from the authenticated caller. It does carry an `author` string (`fileController.js:183`), written from the client's own upload payload (`components/document-repository/src/services/fileService.js:267`) and stored as the document's own field (`components/document-repository/src/services/metadataService.js:27`). The metadata read (`fileController.js:1250`) returns that stored record. `author` is **free text the client supplies**: the metadata search filters on it by exact match (`metadataService.js:130-133`, reached through `GET /api/files/search` — `fileRoutes.js:292`), and the file search matches it as a case-insensitive substring (`components/document-repository/src/services/fileService.js:918`). It is not an identity, and it must never be matched as one.

**But the files the okf-server imported do carry a fence — on the serve paths.**

- `okf_restricted` is the okf-server's **local snapshot** of the source repository's restriction, stamped onto each imported source file at import time and re-propagated by the Access-panel toggle (`fileController.js:107-117`, `:240-246`).
- The four serve paths — download, view, viewbrowser, batch-download — refuse a restricted file before any byte moves: `assertServeAllowed` (`fileController.js:145-153`), applied at `:714`, `:765`, `:809`, `:848`. The refusal is `403 OKF_RESTRICTED`, distinct from the delete-protection `403` and from the okf-server's anti-enumeration `404`.
- `mayServeOkfRestricted` (`fileController.js:118-144`) lets `Admin`, `tools-admin` and `okf-service` through, and otherwise parses the caller's `okf:*` scopes **locally**, with the same grammar as `deriveScopeAuthz` — doc-repo must not need okf-server reachable at download time. It fails closed when the file carries no repository id (`:132`).

So the accurate statement is three-part: **no per-user ACL on the legacy corpus; a per-repository fence on the OKF-imported files' serve paths; and the metadata read outside that fence.** The legacy free-form corpus — the files uploaded through doc-repo's own upload path, never imported from an OKF repository — has no fence at all.

Consequence for the contract: `read_source`'s legacy resolution reads the **metadata**, which the fence does not cover, so the port's executor remains the authority for the identity it resolves. The content read goes through a serve path, where the fence applies as defence in depth for the OKF-imported files. The port must not rely on the fence: it is a stamped snapshot rather than a live consultation, and it does not exist for the free-form corpus.

This is not a defect introduced by the agentic work: it is the state AD-4 already states ("the legacy corpus has no per-user ACL"). It is recorded here because the contract's `read_source` obligation for a legacy target is *the executor's re-validation*, and the document repository will not perform it.

### 2.4 Identifier resolution: one server-side mapping, and it is per-caller

AD-3 requires that a caller-supplied identifier is charset-validated or resolved server-side. What exists today:

- **`repo_id` → serving `graph_name`**: the only server-side resolution is the `repos[]` array of `resolveGraphSet` (`authz-resolver-service.js:37`), i.e. the per-caller authorized view. There is **no** endpoint that resolves an arbitrary caller-supplied `repo_id` to its serving graph on demand.
- **The registry anchor is not the serving name.** The graph name is derived from the repository's slug and version (`OKF_{slug}_v{n}`), not from the repository id — a repository id cannot be turned into a graph name by string manipulation.
- **No charset guard exists in okf-server** for `repo_id` or `concept_id`. The only identifier guard in the tree is the retriever's `_GRAPH_NAME_PATTERN` (`genie-ai-overlay/retriever/genieai_retriever_arangodb.py:320`, applied at `:330`), and it guards *graph names* — in a module the OPEA-free path will not use.
- **Concept identity is exact and two-part.** `services/concept-meta-service.js:83` (`findConceptDoc`) requires **both** `repo_id` and `concept_id` against `okf_concepts_meta` (`:37`); the fallback `getConceptMetaFromAnyRepo` returns `LIMIT 2` rows, so a concept id alone is ambiguous when several repositories hold it.

Consequence for the contract: a `repo_id` can only be resolved **inside the caller's authorized set**, and the resolution has to travel with that set. The contract therefore requires the trusted caller context to carry the authorized repositories next to the authorized graph names, and it leaves the charset guard to the port.

### 2.5 There is no per-graph label scope

`resolveGraphSet` returns `per_graph_labels[r.graph_name] = null` for every graph (`authz-resolver-service.js:66`, the "G8 seam — no label-ACL source yet"). Label narrowing exists on the *request* side (the label filter the deployed retriever applies to a query), not as an access-control dimension on the *graph* side. The contract therefore carries the requested labels as narrowing, and asserts no per-graph label scope that does not exist.

## 3. Provenance

### 3.1 The stable-id conventions, and where each field is produced

| Source | Identity | Produced by | Carried as |
|---|---|---|---|
| Legacy corpus | `file_id` | the retriever's file-id enrichment (`genieai_retriever_arangodb.py:193` — `ARANGO_FILE_ID_FIELD = "file_id"`; the enrichment at `:1921-1940`) | `document_id`, **no source marker** (`genieai_chatqna.py:3676-3686`) |
| OKF concept | `concept_id` + `repo_id` + `bundle_version` | the CAP-1 join onto `okf_concepts_meta` (`genieai_retriever_arangodb.py:1941-1975`), carried in the provenance envelope (`_attach_provenance`, `:2345-2377`) | `document_id` = the concept id, `concept_id`, `repo_id`, `bundle_version`, `source: "okf-concept"` (`genieai_chatqna.py:3645-3668`) |

Two details the contract must honour:

- `bundle_version` rides **only when it is not None** (`genieai_chatqna.py:3664`) — a version of `0` rides, an unresolved one does not. The identity join is additive and failure-isolated, so an absent version is a legitimate state, not a defect.
- The legacy branch is distinguished by the **absence** of a source marker. That is why the contract models the two provenances as separate types rather than one type with optional fields.

### 3.2 `chunk_key` is not a citation id

`chunk_key` rides the chunk metadata as a convenience key; the persisted citation identity is the pair `(graph_name, chunk_id)`, and the *source* identity is the one in §3.1. The contract carries no `chunk_key`: a citation resolves through the source identity, and the source identity is what the okf-server and the document repository can actually answer for.

### 3.3 The concept read is a serving read, and it is fenced

`GET /api/okf/repos/:repo_id/concepts/:concept_id` is registered on the serving-reads router (`okf-routes.js`, §2.1), so a citizen's citation card opens the concept under the same default-open posture as retrieval — with the restricted-repository fence applied inside the handler. `GET /api/okf/concepts/resolve-repo` is a serving read for the same reason: it repairs a legacy citation row that lost its repository identity.

The 403-vs-404 policy is **not** the port's business ([ADR okf-006](../adr/okf-006-403-vs-404-unauthorized.md)): 403 for unauthorized, 404 for absent, collapsed to 404 for high-sensitivity bundles. The port reports codes; the HTTP layer maps them.

## 4. Ownership

| Data | Owner | Evidence |
|---|---|---|
| Conversations | an **edge**, not a column: `userConversations` carries `_from: users/<userKey>` and `role: "owner"` | `components/gov-chat-backend/services/chat-history-service.js:128-130`; the read paths traverse the edge (`:343`, `:428`) |
| Messages | inherited from the conversation through the `messages` ↔ `queries` edge | `chat-history-service.js:240` |
| Query records | `userId` on the `queries` document | `components/gov-chat-backend/services/analytics-service.js:50`, `:80` |
| Citation snapshots | **none** — the `conversationFiles` documents carry no owner | `chat-history-service.js:42` |
| OKF audit trail | `actor` on the audit document | `components/okf-server` audit collection |

Two consequences:

1. Ownership in the retained conversation data is **edge-based**, and the citation snapshot rows are reachable by anyone who can reach the conversation. The agentic path must not introduce a weaker rule: a retained agent artefact needs an owner that the existing stores can carry.
2. The agent service persists **nothing** today (`components/agent-service/` has no database client). The owner of the agent's retained evidence — the answer, the citations, the retrieved passages — is therefore **undefined**, and the product decision it needs (what happens to an earlier answer when its source is revoked) is story 1.7's to record.

## 5. Premise check: AD-3 and AD-4

### 5.1 The table

| # | Premise | Verdict | Evidence |
|---|---|---|---|
| P1 | The contract lives inside the agent service | **Confirmed** | The spine's structural seed names `capabilities/` in the agent service; the component exists (`components/agent-service/`), ships dark and is internal-only. |
| P2 | okf-server remains the per-user read authority | **Confirmed for OKF repositories**; the legacy corpus has **no** per-user authority, and the port's executor is it | §2.1, §2.3. Scoping clarification, recorded explicitly — see §5.2. |
| P3 | The port queries only the caller's authorized set (enforcement by construction) | **Confirmed** | The set is computed per caller, server-side, by the okf-server (`authz-resolver-service.js:37`) and forwarded as structured fields (`query-service.js:748`, `:766-784`). The port is handed the set; it can only query it. |
| P4 | Model-generated arguments never widen access | **Confirmed** | Structurally: the operation inputs carry no graph, repository, scope or ACL field — the narrowing travels in the trusted caller context. |
| P5 | A caller-supplied identifier is charset-validated or resolved server-side | **Confirmed, with the resolution located** | The only server-side resolution is inside the caller's authorized set (§2.4). The charset guard does not exist in okf-server today and becomes a port obligation. |
| P6 | No raw AQL reaches an agent | **Confirmed** | ADR okf-011; the okf-server exposes parameterized, scope-checked operations only. |
| P7 | The legacy fail-open window is not replicated | **Confirmed** | The deployed carrier degrades to the legacy corpus on a resolver failure (`query-service.js:810-822`). The contract forbids it: an authorization failure never falls back, and a failure may only degrade *within* the authorized set. |
| P8 | The executor enforces the caller's scope over the registered toolset | **Declared, not yet enforced** | The executor is story 1.7's. §6. |
| P9 | `read_source` re-validates every target against the authorized set | **Declared, not yet enforced** | The executor is story 1.7's. §6. |
| P10 | The legacy corpus has no per-user ACL | **Confirmed** | §2.3 — zero `user_id` occurrences in the dataprep and retriever; the document repository's metadata read authorizes nothing beyond authentication. The per-repository fence on the OKF-imported files' serve paths is a stamped snapshot, not a per-user ACL, and it does not cover the metadata read or the free-form corpus. |

### 5.2 The verdict

**No premise is contradicted. AD-3 and AD-4 are not reopened by this record.**

The premise check is discharged with three qualifications, stated here rather than left implicit:

1. **P2 is scoped.** AD-3's authority claim holds for the OKF repositories, where the okf-server decides. On the legacy path there is no per-user authority to defer to: the corpus is shared, the metadata read authorizes nothing beyond authentication, and the only fence anywhere on that path is the per-repository snapshot on the OKF-imported files' serve paths (§2.3) — a stamped snapshot, not a per-user ACL, and not a live consultation. The authority for a legacy target is therefore the port's own executor, and that executor does not exist yet (story 1.7). If the operator reads this scoping as a divergence from AD-3, AD-3 and AD-4 reopen with it; that is a reading, not a fact, and the record says so rather than deciding it silently.
2. **P5's resolution is located, not assumed.** A repository id is resolved inside the caller's authorized set, and the contract carries that mapping. There is no on-demand resolver, and the registry's `OKF_{repo_id}` anchor is not the serving name.
3. **The label scope of P3 does not exist.** `per_graph_labels` is null everywhere (§2.5); the contract asserts no per-graph label restriction.

## 6. What the contract encodes — declared versus enforced

| Obligation | Declared in the contract | Enforced today | Where it is enforced |
|---|---|---|---|
| The port queries only the authorized set | yes | yes, for the deployed carrier | §2.2 (`query-service.js:746-784`) |
| The inputs cannot widen access | yes | yes, structurally | the input types carry no scope field |
| A `repo_id` resolves inside the authorized set | yes | **no** | story 1.7 (the executor) |
| A restricted OKF file is refused at the serve path | no — the port does not own it | yes, for the serve paths | the document repository's stamped snapshot (§2.3) |
| A charset guard on identifiers | yes | **no** | story 1.7 (the executor) |
| The authorization check precedes resolution | yes | **no** | story 1.7 (the executor) |
| A failure never falls back to a wider corpus | yes | yes, for the deployed carrier | the carrier's own rules (§2.2) |
| A legacy target is authorized by the caller's set | yes | **no** | story 1.7 (the executor) — the document repository authorizes nothing beyond authentication on the metadata read (§2.3) |

**A contract declares; an executor enforces.** Everything marked *no* above is story 1.7's work. Until it lands, the agentic path is the only place where the legacy corpus is protected — and it is dark, so nothing is exposed. That is the risk this record hands to the next story.

## 7. What the contract therefore carries

The constraints the contract module encodes, each traceable to a section above:

1. The trusted caller context carries the authorized graph set **and** the authorized repository → serving-graph mapping (§2.4).
2. The authorization check precedes every resolution, so a refusal reveals nothing about the target's existence (§2.3, §3.3).
3. A failure never falls back to a wider corpus; the legacy fail-open window is not replicated (§2.2, P7).
4. Provenance is either a legacy `file_id` with no source marker, or an OKF concept identity marked `okf-concept`, with the bundle version stated explicitly — present or knowingly absent (§3.1).
5. The requested labels are narrowing, and no per-graph label scope is claimed (§2.5).
6. The document repository's restricted-file fence is defence in depth, not the authority: the port authorizes before it resolves, and it never relies on a stamped snapshot (§2.3).

## 8. Reconsideration triggers

This record is a statement about the deployed code, not about the design. Re-open it when:

- the okf-server's scope mode leaves `open`/`closed`, or a per-repository ACL gains a label dimension;
- an endpoint appears that resolves a **caller-supplied** `repo_id` to a serving graph on demand — it would move the resolution out of the caller context and change constraint 1;
- the legacy corpus gains a per-user ACL, or the document repository starts authorizing a file read;
- the retained-data decision of story 1.7 lands and changes §4;
- the ADR statuses of ADR okf-006 and ADR okf-011 change.
