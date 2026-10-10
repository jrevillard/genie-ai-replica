<!-- HeadTestDialog.vue — Story 1-8 (2026-10-08): the OKF Head Tester /
  Routing Lab. One dialog, three tabs (David: "test the tagging/head after
  publishing and before ingesting, then revert to review, modify, publish,
  test again — cycle until the desired accuracy, THEN ingest"):
    Head    — the stored vectorized head: text as per-field tag chips,
              dim/model/version/computed_at + staleness badge, Rebuild
              (admin; hidden in the wizard — no repo mutations there).
    Test    — one query against the two-leg simulation: head scores for
              the repo under test + every sibling, verdict banner, the
              gate breakdown (Floor / Forbidden tags / Margin — 1-8b)
              with its teaching note (veto = fix the tags + republish;
              floor = correct suppression), adversarial expectation
              (expect NOT selected). Story 1-8c closes the teaching gap
              on the claim side: when the head CLAIMS a query it should
              suppress, "Explain & suggest" proposes forbidden tags, the
              curator adds them (shared two-write frontmatter save), and
              one click rebuilds the head and re-runs the same query.
    Suites  — LLM-generated suites (+ forbidden-derived negatives +
              curator free-text), run-all, pass-rate/margin history,
              steal pairs ("kenya stole 3 of 8"). Story 1-8c adds
              user-controlled per-class counts and the BATCH advice
              loop: after a run with failing negatives, one "Explain
              failures" call (ONE LLM call) returns add-all forbidden
              tags + a rebuild/re-run-suite offer — the anti-treadmill.
              Story 1-8d makes the loop GUARDED and reversible after the
              2026-10-09 poisoning (3 cycles applied 'lung-cancer' — the
              repo's OWN entity tag — and positives collapsed while
              negatives went 20/20): the guardrail's rejected proposals
              render as muted chips with their reason, removal_suggestions
              render as one-click danger chips (the inverse affordance),
              positive failures gate the Explain button alongside
              negatives, a same-suite positive-pass-rate drop raises a
              red tripwire strip pointing at the Revert panel, the suite's
              forbidden_snapshot staleness is flagged, and every
              frontmatter save is revertible in place.
  Entry points: StudioDashboard card actions (published + ingested), the
  editor shell actions row, the editor right-rail badge, the wizard
  Publish step (readOnly — view + test only; every write path here is
  hidden). Lifecycle cycle affordances (Unpublish / re-publish note)
  live in the footer, editor context only.
-->
<template>
  <DsDialog
    :visible="visible"
    :title="translate('okf.headTest.title', 'Routing Lab — head test')"
    size="lg"
    :actions="dialogActions"
    @close="$emit('close')"
    @action="onDialogAction"
  >
    <p v-if="repo" class="okf-headtest__repo-line">
      <strong>{{ repo.name || repo.repo_id }}</strong>
      <span class="okf-headtest__meta-inline">
        <DsPill :variant="serving ? 'success' : 'accent'">
          {{ repo.lifecycle_state }}
        </DsPill>
        <DsPill v-if="headStatus === 'present'" variant="success">
          {{ translate('okf.headTest.badge.present', 'head ready') }}
        </DsPill>
        <DsPill v-else-if="headStatus === 'stale'" variant="warning">
          {{ translate('okf.headTest.badge.stale', 'head stale') }}
        </DsPill>
        <DsPill v-else variant="danger">
          {{ translate('okf.headTest.badge.missing', 'no head') }}
        </DsPill>
      </span>
    </p>

    <DsTabs v-model="tab" :tabs="tabDefs" class="okf-headtest__tabs">
      <!-- ───────────────────────── TAB 1: HEAD ───────────────────────── -->
      <div v-show="tab === 'head'" class="okf-headtest__pane">
        <template v-if="head">
          <div v-for="field in headFields" :key="field.key" class="okf-headtest__field">
            <span class="okf-headtest__field-label">{{ field.label }}</span>
            <span v-if="field.values && field.values.length" class="okf-headtest__chips">
              <DsTag v-for="v in field.values" :key="v">{{ v }}</DsTag>
            </span>
            <span v-else class="okf-headtest__empty">—</span>
          </div>
          <div class="okf-headtest__head-meta">
            <span
              >{{ translate('okf.headTest.head.dim', 'Dimensions') }}: <code>{{ head.dim }}</code></span
            >
            <span
              >{{ translate('okf.headTest.head.model', 'Model') }}: <code>{{ head.model || '—' }}</code></span
            >
            <span
              >{{ translate('okf.headTest.head.version', 'Head version') }}: <code>{{ head.version }}</code></span
            >
            <span>{{ translate('okf.headTest.head.computedAt', 'Computed') }}: {{ shortDate(head.computed_at) }}</span>
            <span v-if="headStatus === 'stale'" class="okf-headtest__stale-note">
              {{
                translate(
                  'okf.headTest.head.staleNote',
                  'Tags changed after this head was built — rebuild before trusting the tests.'
                )
              }}
            </span>
          </div>
        </template>
        <p v-else class="okf-headtest__empty-pane">
          {{
            translate(
              'okf.headTest.head.missingNote',
              'No vectorized head yet. It is built at publish; if the embed service was unavailable then, rebuild it now from the stored tags.'
            )
          }}
        </p>
        <div v-if="!readOnly" class="okf-headtest__pane-actions">
          <DsButton variant="secondary" small :disabled="busy" @click="onRebuild">
            {{ translate('okf.headTest.head.rebuild', 'Rebuild head') }}
          </DsButton>
          <DsInfoTip
            :text="
              translate(
                'okf.headTest.head.rebuildTip',
                'Re-embeds the stored tags into a fresh head vector. One embed call per tag field.'
              )
            "
          />
        </div>
        <DsSpinner v-if="busy === 'rebuild'" size="sm" class="okf-headtest__busy">
          {{ translate('okf.headTest.head.rebuildBusy', 'Rebuilding — embedding the tag fields…') }}
        </DsSpinner>
        <p v-if="error" class="okf-headtest__error">{{ error }}</p>
      </div>

      <!-- ───────────────────────── TAB 2: TEST ───────────────────────── -->
      <div v-show="tab === 'test'" class="okf-headtest__pane">
        <div class="okf-headtest__query-row">
          <DsInput
            v-model="query"
            type="text"
            :placeholder="translate('okf.headTest.test.placeholder', 'e.g. cancer screening guidelines')"
            class="okf-headtest__query-input"
            @keyup.enter="onRunTest"
          />
          <DsButton variant="primary" small :disabled="busy !== null || !query.trim()" @click="onRunTest">
            {{ translate('okf.headTest.test.run', 'Run test') }}
          </DsButton>
        </div>
        <label class="okf-headtest__adversarial">
          <input v-model="adversarial" type="checkbox" />
          {{
            translate(
              'okf.headTest.test.adversarial',
              'Adversarial — this query should NOT select this repository (a forbidden/adjacent topic)'
            )
          }}
        </label>

        <DsSpinner v-if="busy === 'test'" size="sm" class="okf-headtest__busy">
          {{ translate('okf.headTest.test.running', 'Embedding the query and scoring the heads…') }}
        </DsSpinner>

        <template v-if="lastResult">
          <p class="okf-headtest__embedded">
            {{ translate('okf.headTest.test.embeddedWith', 'Embedded with') }}:
            <code>{{ lastResult.embedded_with }}</code>
          </p>
          <div class="okf-headtest__verdict" :class="verdictClass">
            {{ verdictText }}
          </div>
          <table class="okf-headtest__scores">
            <thead>
              <tr>
                <th>{{ translate('okf.headTest.test.col.repo', 'Repository') }}</th>
                <th>{{ translate('okf.headTest.test.col.state', 'State') }}</th>
                <th>{{ translate('okf.headTest.test.col.headScore', 'Head score') }}</th>
                <th>{{ translate('okf.headTest.test.col.rank', 'Rank') }}</th>
                <th>{{ translate('okf.headTest.test.col.claimed', 'Claims query') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="row in scoreRows"
                :key="row.repo_id"
                :class="{ 'okf-headtest__row-under-test': row.under_test }"
              >
                <td>
                  {{ row.name }}
                  <span v-if="row.under_test" class="okf-headtest__under-mark">◂</span>
                </td>
                <td>{{ row.state }}</td>
                <td>
                  <span class="okf-headtest__bar"><span :style="{ width: barWidth(row.score) }" /></span>
                  <code>{{ (row.score || 0).toFixed(3) }}</code>
                </td>
                <td>{{ row.rank }}</td>
                <td>
                  <!-- 1-8a/1-8b: the gate column — a head only CLAIMS a
                       query when it clears floor + forbidden-veto + margin;
                       when it is suppressed, name the condition that
                       decided (under-test rows carry head_claim). -->
                  <DsPill v-if="row.claimed === true" variant="success">
                    {{ translate('okf.headTest.test.claimed', 'claims') }}
                  </DsPill>
                  <template v-else-if="row.claimed === false">
                    <DsPill variant="warning">
                      {{ translate('okf.headTest.test.suppressed', 'suppressed') }}
                    </DsPill>
                    <span v-if="row.claim" class="okf-headtest__claim-why">{{ claimLabel(row.claim) }}</span>
                  </template>
                  <span v-else class="okf-headtest__empty">—</span>
                </td>
              </tr>
            </tbody>
          </table>
          <!-- 1-8b: the three gate conditions behind head_claimed — Floor
               (off-domain noise), Forbidden tags (the hard veto), Margin
               (centroid clearance). Thresholds come from the response's
               fidelity.knobs so the display never drifts from the config. -->
          <div v-if="gateChecks.length" class="okf-headtest__gate">
            <span class="okf-headtest__gate-title">{{ translate('okf.headTest.gate.title', 'Gate') }}</span>
            <span v-for="check in gateChecks" :key="check.key" class="okf-headtest__gate-check">
              <span class="okf-headtest__gate-name">{{ check.name }}</span>
              <code v-if="check.value">{{ check.value }}</code>
              <DsTag v-if="check.tag">{{ check.tag }}</DsTag>
              <DsPill :variant="check.state === 'pass' ? 'success' : check.state === 'fail' ? 'danger' : 'neutral'">
                {{
                  check.state === 'pass'
                    ? translate('okf.headTest.gate.pass', 'pass')
                    : check.state === 'fail'
                      ? translate('okf.headTest.gate.fail', 'fail')
                      : translate('okf.headTest.gate.na', 'n/a')
                }}
              </DsPill>
            </span>
          </div>
          <!-- 1-8b: the teaching panel — a veto is FIXABLE (remove the tag,
               republish, rebuild the head); a floor suppression is correct
               behavior, not a defect; a plain claim needs no guidance. -->
          <div v-if="teachNote" class="okf-headtest__teach" :class="'okf-headtest__teach--' + teachNote.kind">
            <span class="okf-headtest__teach-title">{{
              translate('okf.headTest.teach.title', 'What this means')
            }}</span>
            <p class="okf-headtest__teach-text">{{ teachNote.text }}</p>
          </div>
          <!-- 1-8c: claim-side teaching — the gap the veto/floor panels
               don't cover: the head CLAIMS a query it should suppress (all
               three gates passed, no forbidden tag covers the subject).
               The fix loop INSIDE the Lab: explain → suggested forbidden
               tags → add → rebuild → re-run. Hidden in the wizard
               (readOnly — no repo mutations from the wizard, D4). -->
          <div v-if="claimTeachable" class="okf-headtest__suggestion">
            <span class="okf-headtest__teach-title">{{
              translate('okf.headTest.teach.title', 'What this means')
            }}</span>
            <p class="okf-headtest__teach-text">
              {{
                translate(
                  'okf.headTest.teach.claim',
                  'The head CLAIMS this query — it passed all three gates. If it should NOT route here, ask for forbidden tags that exclude its subject, add them, then rebuild the head.'
                )
              }}
            </p>
            <div class="okf-headtest__pane-actions">
              <DsButton variant="secondary" small :disabled="busy !== null" @click="onExplainClaim">
                {{ translate('okf.headTest.teach.explain', 'Explain & suggest') }}
              </DsButton>
              <DsSpinner v-if="busy === 'explain'" size="sm" class="okf-headtest__busy">
                {{ translate('okf.headTest.teach.explainBusy', 'Explaining — the model is proposing forbidden tags…') }}
              </DsSpinner>
            </div>
            <template v-if="explanation && explanation.suggestion">
              <div v-if="suggestedTags.length" class="okf-headtest__chips">
                <DsTag
                  v-for="t in suggestedTags"
                  :key="t"
                  :variant="isTaught(t) ? 'success' : 'accent'"
                  class="okf-headtest__add-chip"
                  role="button"
                  :title="translate('okf.headTest.teach.addTag', 'Add to forbidden tags')"
                  @click="onTeachTag(t)"
                >
                  {{ isTaught(t) ? '✓' : '+' }} {{ t }}
                </DsTag>
              </div>
              <p v-else-if="!suggestedRejected.length" class="okf-headtest__teach-text okf-headtest__empty">
                {{
                  translate(
                    'okf.headTest.teach.suggestNone',
                    'No forbidden tag was suggested — review the query against the declared scope manually.'
                  )
                }}
              </p>
              <!-- 1-8d: the guardrail's screened-out proposals — the curator
                   SEES what was rejected and why (trust through
                   transparency; the 2026-10-09 poisoning happened in the
                   dark). Muted chips, reason as tooltip. -->
              <div v-if="suggestedRejected.length" class="okf-headtest__rejected">
                <p class="okf-headtest__teach-text okf-headtest__empty">
                  {{
                    translate(
                      'okf.headTest.teach.rejected',
                      'Screened out by the guardrail — a forbidden tag must not match this repository’s own subject.'
                    )
                  }}
                </p>
                <div class="okf-headtest__chips">
                  <DsTag
                    v-for="r in suggestedRejected"
                    :key="'rej-' + r.tag"
                    variant="neutral"
                    class="okf-headtest__rejected-chip"
                    :title="r.reason"
                  >
                    ✕ {{ r.tag }}<span v-if="r.reason" class="okf-headtest__rejected-reason"> — {{ r.reason }}</span>
                  </DsTag>
                </div>
              </div>
              <p class="okf-headtest__teach-text okf-headtest__empty">{{ explanation.suggestion.reason }}</p>
              <template v-if="taughtTags.length">
                <p class="okf-headtest__teach-text">
                  {{
                    translate(
                      'okf.headTest.teach.added',
                      'Added to the forbidden tags — rebuild the head to apply them.'
                    )
                  }}
                </p>
                <div class="okf-headtest__pane-actions">
                  <DsButton variant="primary" small :disabled="busy !== null" @click="onRebuildRerun">
                    {{ translate('okf.headTest.teach.rebuildRerun', 'Rebuild head & re-run') }}
                  </DsButton>
                  <DsSpinner
                    v-if="busy === 'save-tag' || busy === 'rebuild-rerun' || busy === 'advisor-apply'"
                    size="sm"
                    class="okf-headtest__busy"
                  >
                    {{ teachBusyLabel }}
                  </DsSpinner>
                </div>
              </template>
            </template>
          </div>
          <p v-if="lastResult.verdict && lastResult.verdict.provenance" class="okf-headtest__provenance">
            {{ translate('okf.headTest.test.provenance', 'Routing provenance') }}:
            <code>{{ lastResult.verdict.provenance }}</code>
          </p>
        </template>
        <p v-else-if="busy !== 'test'" class="okf-headtest__empty-pane">
          {{
            translate(
              'okf.headTest.test.empty',
              'Type a query a user would ask and run it — the lab scores every published repository head exactly as the fan-out would.'
            )
          }}
        </p>
        <p v-if="error" class="okf-headtest__error">{{ error }}</p>
        <!-- 1-8d: the cycle's undo — every frontmatter save is snapshotted
             server-side; one click restores + offers rebuild & re-run.
             Editor only (wizard writes nothing). -->
        <div
          v-if="!readOnly"
          class="okf-headtest__revert"
          :class="{ 'okf-headtest__revert--highlight': revertHighlight }"
        >
          <span class="okf-headtest__teach-title">
            {{ translate('okf.headTest.suites.revertTitle', 'Revert tags') }}
          </span>
          <DsSpinner v-if="busy === 'history'" size="sm" class="okf-headtest__busy">
            {{ translate('okf.headTest.suites.revertBusy', 'Loading save history…') }}
          </DsSpinner>
          <template v-else>
            <ul v-if="revertEntries.length" class="okf-headtest__revert-list">
              <li v-for="e in revertEntries" :key="e.saved_at">
                <span>{{ shortDate(e.saved_at) }}</span>
                <span class="okf-headtest__revert-actor">{{ e.actor }}</span>
                <span v-if="e.forbidden_count !== null" class="okf-headtest__revert-actor">
                  {{
                    translate('okf.headTest.suites.revertForbiddenCount', '{n} forbidden tags').replace(
                      '{n}',
                      String(e.forbidden_count)
                    )
                  }}
                </span>
                <DsButton variant="secondary" small :disabled="busy !== null" @click="onRevertTo(e)">
                  {{ translate('okf.headTest.suites.revertAction', 'Revert') }}
                </DsButton>
              </li>
            </ul>
            <p v-else class="okf-headtest__teach-text okf-headtest__empty">
              {{ translate('okf.headTest.suites.revertEmpty', 'No frontmatter saves recorded yet.') }}
            </p>
          </template>
          <DsSpinner v-if="busy === 'revert'" size="sm" class="okf-headtest__busy">
            {{ translate('okf.headTest.suites.revertSaving', 'Restoring the frontmatter…') }}
          </DsSpinner>
          <template v-if="reverted && query.trim()">
            <p class="okf-headtest__teach-text">
              {{
                translate(
                  'okf.headTest.suites.revertDone',
                  'Frontmatter restored — rebuild the head and re-run to apply it.'
                )
              }}
            </p>
            <div class="okf-headtest__pane-actions">
              <DsButton variant="primary" small :disabled="busy !== null" @click="onRebuildRerun">
                {{ translate('okf.headTest.teach.rebuildRerun', 'Rebuild head & re-run') }}
              </DsButton>
            </div>
          </template>
        </div>
      </div>

      <!-- ─────────────────────── TAB 3: SUITES ─────────────────────── -->
      <div v-show="tab === 'suites'" class="okf-headtest__pane">
        <!-- 1-8f: optional suite name — lands on the suite doc and renders
             in the Saved-suites table (the key stays the identity). -->
        <div class="okf-headtest__pane-actions">
          <input
            v-model="suiteName"
            class="okf-headtest__name-input"
            type="text"
            :placeholder="
              translate('okf.headTest.suites.namePlaceholder', 'Suite name (optional) — e.g. NCD regression set')
            "
            :maxlength="80"
          />
        </div>
        <div class="okf-headtest__pane-actions">
          <DsButton variant="primary" small :disabled="busy !== null" @click="onGenerateSuite">
            {{ translate('okf.headTest.suites.generate', 'Generate test suite') }}
          </DsButton>
          <DsInfoTip
            :text="
              translate(
                'okf.headTest.suites.generateTip',
                'The LLM writes should-route-here queries plus confusable near-miss queries from the competing repositories; the forbidden tags add must-NOT-route queries. Takes 5-15 seconds.'
              )
            "
          />
        </div>
        <!-- 1-8c: user-controlled query counts per class (David: "give the
             lab user the ability to control the number of test queries").
             The forbidden-derived class is deliberately absent — it scales
             with the repo's forbidden tag count, not a user knob. -->
        <div class="okf-headtest__counts">
          <label v-for="c in countControls" :key="c.key" class="okf-headtest__count">
            <span class="okf-headtest__count-label">{{ c.label }}</span>
            <DsInput
              v-model="counts[c.key]"
              type="number"
              size="sm"
              :min="c.min"
              :max="c.max"
              class="okf-headtest__count-input"
            />
          </label>
        </div>
        <p class="okf-headtest__counts-hint">
          {{
            translate(
              'okf.headTest.counts.hint',
              'Forbidden-derived rows scale with the repository’s forbidden tag count — they cannot be set here.'
            )
          }}
        </p>
        <DsSpinner v-if="busy === 'generate'" size="sm" class="okf-headtest__busy">
          {{ translate('okf.headTest.suites.generating', 'Generating — the LLM is writing the queries…') }}
        </DsSpinner>
        <DsSpinner v-if="busy === 'run'" size="sm" class="okf-headtest__busy">
          {{ translate('okf.headTest.suites.running', 'Running every suite query…') }}
        </DsSpinner>

        <div v-if="suite" class="okf-headtest__suite">
          <!-- 1-8g: the click-test summary panel — ALL statistics for the
               probed query: the HEAD verdict, the corpus-coverage verdict
               with its exact reason, reference files, and the rerank-ranked
               chunks. David: "it should popup a panel with a summary of ALL
               the statistics". -->
          <div v-if="probePanel" ref="probePanel" class="okf-headtest__probe-panel">
            <div class="okf-headtest__probe-head">
              <h4 class="okf-headtest__pane-title">
                {{ translate('okf.headTest.probe.title', 'Corpus test — summary') }}
              </h4>
              <button
                type="button"
                class="okf-headtest__row-btn"
                :title="translate('okf.headTest.probe.close', 'Close the summary')"
                @click="probePanel = null"
              >
                ×
              </button>
            </div>
            <p class="okf-headtest__probe-query">
              <code>{{ probePanel.query }}</code>
              <span class="okf-headtest__probe-meta">
                {{ probePanel.docs }} {{ translate('okf.headTest.probe.chunksScanned', 'corpus chunks scanned') }} ·
                {{ probePanel.elapsed_ms }}ms
              </span>
            </p>
            <div class="okf-headtest__probe-legs">
              <div class="okf-headtest__probe-leg">
                <strong>{{ translate('okf.headTest.probe.headLeg', 'Head verdict') }}</strong>
                <DsPill v-if="probePanel.head && probePanel.head.claimed" variant="info">
                  {{ probePanel.head.claim || 'claim' }}
                  <template v-if="probePanel.head.score != null"> · {{ probePanel.head.score }}</template>
                </DsPill>
                <DsPill v-else variant="secondary">
                  {{ translate('okf.headTest.probe.headNotClaimed', 'does not claim') }}
                </DsPill>
              </div>
              <div class="okf-headtest__probe-leg">
                <strong>{{ translate('okf.headTest.probe.corpusLeg', 'Corpus coverage') }}</strong>
                <DsPill v-if="probePanel.verdict === 'answerable'" variant="success">
                  {{ translate('okf.headTest.probe.answerable', 'answerable') }} · {{ probePanel.top_score }}
                </DsPill>
                <DsPill v-else-if="probePanel.verdict === 'weak'" variant="warning">
                  {{ translate('okf.headTest.probe.weak', 'weak match') }} · {{ probePanel.top_score }}
                </DsPill>
                <DsPill v-else-if="probePanel.verdict === 'unanswerable'" variant="danger">
                  {{ translate('okf.headTest.probe.unanswerable', 'not in corpus') }} · {{ probePanel.top_score }}
                </DsPill>
                <DsPill v-else variant="secondary">
                  {{ translate('okf.headTest.probe.unknown', 'unknown') }}
                </DsPill>
              </div>
            </div>
            <p v-if="probePanel.reason" class="okf-headtest__probe-reason">{{ probePanel.reason }}</p>
            <div v-if="probePanel.files && probePanel.files.length" class="okf-headtest__probe-files">
              <strong>{{ translate('okf.headTest.probe.files', 'Reference files') }}</strong>
              <DsTag v-for="f in probePanel.files" :key="f.id"> {{ f.name }} ({{ f.chunks }}) </DsTag>
            </div>
            <table v-if="probePanel.top_chunks && probePanel.top_chunks.length" class="okf-headtest__scores">
              <thead>
                <tr>
                  <th>{{ translate('okf.headTest.probe.colScore', 'Rerank score') }}</th>
                  <th>{{ translate('okf.headTest.probe.colFile', 'File') }}</th>
                  <th>{{ translate('okf.headTest.probe.colContent', 'Chunk content') }}</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="(c, ci) in probePanel.top_chunks" :key="ci">
                  <td>{{ c.score }}</td>
                  <td>{{ c.file || '—' }}</td>
                  <td class="okf-headtest__probe-preview">{{ c.preview }}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <h4 class="okf-headtest__suite-title">
            {{ translate('okf.headTest.suites.current', 'Current suite') }}
            <code>{{ suite.suite_key }}</code>
          </h4>
          <div class="okf-headtest__pane-actions">
            <DsButton variant="secondary" small :disabled="busy !== null" @click="onRunSuite">
              {{ translate('okf.headTest.suites.run', 'Run all queries') }}
            </DsButton>
            <!-- 1-8d: the suite's forbidden rows were derived from the
                 forbidden list AT GENERATION TIME — after any tag change
                 they no longer match the repo (say it, don't hide it). -->
            <span v-if="suiteForbiddenStale" class="okf-headtest__stale-suite">
              {{
                translate(
                  'okf.headTest.suites.staleSnapshot',
                  'Tags changed since this suite was generated — regenerate for fresh forbidden rows.'
                )
              }}
            </span>
            <!-- 2026-10-10 (live 409): say WHY the corpus column cannot fill
                 on a repo that was never ingested. -->
            <span v-if="!corpusAvailable" class="okf-headtest__stale-suite">
              {{
                translate(
                  'okf.headTest.suites.corpusNeedsIngest',
                  'Ingest the repository first — the corpus test searches the ingested corpus'
                )
              }}
            </span>
          </div>
          <table class="okf-headtest__scores">
            <thead>
              <tr>
                <th>{{ translate('okf.headTest.suites.col.query', 'Query') }}</th>
                <th>{{ translate('okf.headTest.suites.col.kind', 'Kind') }}</th>
                <th>{{ translate('okf.headTest.suites.col.outcome', 'Outcome') }}</th>
                <!-- 1-8g: the click-test's corpus-coverage verdict (in-domain
                     is NOT answerable — the asthma/colorectal lesson). -->
                <th v-if="!readOnly">{{ translate('okf.headTest.suites.col.corpus', 'Corpus') }}</th>
                <th v-if="!readOnly">{{ translate('okf.headTest.suites.col.actions', 'Edit') }}</th>
              </tr>
            </thead>
            <tbody>
              <!-- 1-8f: rows are visible + editable BEFORE any run (the old
                   view only rendered post-run). Flip fixes a mislabel (the
                   HIV row); × removes a row; both hit the server and the
                   returned suite becomes the local copy. -->
              <tr v-for="row in suiteEditableRows" :key="row.key">
                <td>{{ row.query }}</td>
                <td>
                  <DsPill v-if="row.kind === 'positive'" variant="info">
                    {{ row.kind }}{{ row.source ? ' · ' + row.source : '' }}
                  </DsPill>
                  <!-- 1-8c: negatives render their CLASS (near-miss /
                       confusable / forbidden / off-domain / meta) — the
                       near-miss chip is the new repo-vocabulary class. -->
                  <DsPill v-else :variant="classVariant(row.cls)">
                    {{ row.cls ? classLabel(row.cls) : row.kind }}{{ row.source ? ' · ' + row.source : '' }}
                  </DsPill>
                </td>
                <td>
                  <DsPill v-if="row.error" variant="danger">{{ row.error }}</DsPill>
                  <DsPill v-else-if="row.pass === true" variant="success">
                    {{ translate('okf.headTest.suites.pass', 'pass') }}
                  </DsPill>
                  <DsPill v-else-if="row.pass === false" variant="danger">
                    {{ row.failLabel }}
                  </DsPill>
                  <DsPill v-else-if="lastRunSummary" variant="info">
                    {{ translate('okf.headTest.suites.notEvaluatable', 'not evaluatable (no competitors)') }}
                  </DsPill>
                  <span v-else>—</span>
                </td>
                <td v-if="!readOnly">
                  <!-- 1-8g click-test result: the corpus-coverage verdict of
                       the last probe of THIS row's query (persisted server-
                       side). In-domain ≠ answerable — the chip says which. -->
                  <DsPill
                    v-if="row.lastProbe && row.lastProbe.verdict === 'answerable'"
                    variant="success"
                    :title="probeTip(row.lastProbe)"
                  >
                    {{ translate('okf.headTest.probe.answerable', 'answerable') }}
                  </DsPill>
                  <DsPill
                    v-else-if="row.lastProbe && row.lastProbe.verdict === 'weak'"
                    variant="warning"
                    :title="probeTip(row.lastProbe)"
                  >
                    {{ translate('okf.headTest.probe.weak', 'weak match') }}
                  </DsPill>
                  <DsPill
                    v-else-if="row.lastProbe && row.lastProbe.verdict === 'unanswerable'"
                    variant="danger"
                    :title="probeTip(row.lastProbe)"
                  >
                    {{ translate('okf.headTest.probe.unanswerable', 'not in corpus') }}
                  </DsPill>
                  <span v-else-if="row.lastProbe" :title="probeTip(row.lastProbe)">
                    {{ translate('okf.headTest.probe.unknown', 'unknown') }}
                  </span>
                  <span v-else>—</span>
                </td>
                <td v-if="!readOnly" class="okf-headtest__row-actions">
                  <!-- 2026-10-10 (live 409): the probe searches the INGESTED
                       corpus — on a published-but-uningested repo every ▶
                       409'd (REPO_NOT_INGESTED). Disabled with the reason,
                       never a dead button. -->
                  <button
                    type="button"
                    class="okf-headtest__row-btn"
                    :disabled="busy !== null || !corpusAvailable"
                    :title="
                      corpusAvailable
                        ? translate('okf.headTest.suites.probeTip', 'Test this query against the live corpus')
                        : translate(
                            'okf.headTest.suites.corpusNeedsIngest',
                            'Ingest the repository first — the corpus test searches the ingested corpus'
                          )
                    "
                    @click="onProbeRow(row)"
                  >
                    ▶
                  </button>
                  <button
                    type="button"
                    class="okf-headtest__row-btn"
                    :disabled="busy !== null"
                    :title="translate('okf.headTest.suites.flipTip', 'Flip should-select / should-NOT-select')"
                    @click="onFlipRow(row)"
                  >
                    ⇄
                  </button>
                  <button
                    type="button"
                    class="okf-headtest__row-btn okf-headtest__row-btn--danger"
                    :disabled="busy !== null"
                    :title="translate('okf.headTest.suites.deleteTip', 'Remove this row from the suite')"
                    @click="onDeleteRow(row)"
                  >
                    ×
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
          <div v-if="lastRunSummary" class="okf-headtest__summary">
            <span>
              {{ translate('okf.headTest.suites.passRate', 'Pass rate') }}:
              <strong>{{ pct(lastRunSummary.pass_rate) }}</strong>
            </span>
            <span>
              {{ translate('okf.headTest.suites.positives', 'Positives') }}:
              <strong>{{ lastRunSummary.positive_passed }}/{{ lastRunSummary.positive_total }}</strong>
            </span>
            <span>
              {{ translate('okf.headTest.suites.negatives', 'Negatives') }}:
              <strong>{{ negLabel }}</strong>
            </span>
            <span v-if="lastRunSummary.avg_margin !== null">
              {{ translate('okf.headTest.suites.avgMargin', 'Avg margin') }}:
              <strong>{{ (lastRunSummary.avg_margin || 0).toFixed(3) }}</strong>
            </span>
            <span v-for="steal in lastRunSummary.steals" :key="steal.by_repo" class="okf-headtest__steal">
              {{
                translate('okf.headTest.suites.steal', '{repo} stole {n} queries')
                  .replace('{repo}', steal.by_repo)
                  .replace('{n}', String(steal.count))
              }}
            </span>
          </div>
          <!-- 1-8d: the positive-regression tripwire — re-running the SAME
               suite after a tag cycle must never silently drop positives
               (the 2026-10-09 collapse was 7/8 -> 2/8 while negatives went
               20/20). Same-suite comparison only; a drop opens the door to
               the Revert panel. -->
          <div v-if="tripwire" class="okf-headtest__tripwire">
            <span>{{ tripwireText }}</span>
            <DsButton variant="secondary" small :disabled="busy !== null" @click="showRevertPanel">
              {{ translate('okf.headTest.suites.tripwireRevert', 'View revert options') }}
            </DsButton>
          </div>
          <!-- 1-8c: BATCH advice — the anti-treadmill (David: this must
               never become a per-query full-time job). One review per run:
               every failing negative, ONE LLM call, add-all chips. 1-8d
               extends the gate to POSITIVE failures (over-suppression —
               the Explain button must not vanish exactly when the added
               tags suppress the repo's own subject). Hidden in the wizard
               (readOnly — the fix writes tags). -->
          <div v-if="!readOnly && hasExplainableFailures" class="okf-headtest__pane-actions">
            <DsButton variant="secondary" small :disabled="busy !== null" @click="onExplainFailures">
              {{ translate('okf.headTest.suites.explainFailures', 'Explain failures') }}
            </DsButton>
            <DsSpinner v-if="busy === 'explain-failures'" size="sm" class="okf-headtest__busy">
              {{
                translate(
                  'okf.headTest.suites.explainBusy',
                  'Explaining the failures — one model call for every failing negative…'
                )
              }}
            </DsSpinner>
          </div>
          <!-- 1-8d: the COMPREHENSIVE advisor — every query class across
               recent runs, simulated against the gate before anything is
               recommended. Independent of the per-run batch advice. -->
          <div v-if="!readOnly" class="okf-headtest__pane-actions">
            <DsButton variant="secondary" small :disabled="busy !== null" @click="onRecommend">
              {{ translate('okf.headTest.advisor.run', 'Advisor: recommend tag changes') }}
            </DsButton>
            <DsSpinner v-if="busy === 'advisor'" size="sm" class="okf-headtest__busy">
              {{ translate('okf.headTest.advisor.busy', 'Simulating tag changes across recent runs…') }}
            </DsSpinner>
          </div>
          <div v-if="advisor" class="okf-headtest__suggestion">
            <span class="okf-headtest__teach-title">{{
              translate('okf.headTest.advisor.title', 'Tag-set recommendation (simulated across recent runs)')
            }}</span>
            <p class="okf-headtest__teach-text">{{ advisorScoreText }}</p>
            <p v-if="advisor.note" class="okf-headtest__teach-text okf-headtest__empty">{{ advisor.note }}</p>
            <div v-if="advisorAddTags.length" class="okf-headtest__chips">
              <DsTag
                v-for="t in advisorAddTags"
                :key="'adv-a-' + t"
                variant="accent"
                class="okf-headtest__add-chip"
                role="button"
                :title="translate('okf.headTest.teach.addTag', 'Add to forbidden tags')"
                @click="onTeachTag(t)"
              >
                {{ isTaught(t) ? '✓' : '+' }} {{ t }}
              </DsTag>
            </div>
            <div v-if="advisorRemoveTags.length" class="okf-headtest__chips">
              <DsTag
                v-for="r in advisorRemoveTags"
                :key="'adv-r-' + r.tag"
                variant="danger"
                class="okf-headtest__remove-chip"
                role="button"
                :title="translate('okf.headTest.suites.removeTag', 'Remove from forbidden tags')"
                @click="onRemoveTag(r.tag)"
              >
                − {{ r.tag }}
              </DsTag>
            </div>
            <!-- 1-8g-c (live: 23 positive veto-kills, remove=[] forever): the
                 removals the advisor may not auto-apply are SURFACED with
                 their predicted gain — the curator confirms, Apply includes
                 them. Not in the predicted scorecard. -->
            <template v-if="advisorBlockedRemovals.length">
              <p class="okf-headtest__teach-text okf-headtest__blocked-title">
                {{ translate('okf.headTest.advisor.blockedTitle', 'Blocked removals — click to include in Apply') }}
              </p>
              <div class="okf-headtest__chips">
                <DsTag
                  v-for="b in advisorBlockedRemovals"
                  :key="'adv-b-' + b.tag"
                  :variant="advisorExtraRemove.includes(b.tag) ? 'danger' : 'neutral'"
                  class="okf-headtest__remove-chip"
                  role="button"
                  :title="blockedReasonText(b.reason)"
                  @click="toggleExtraRemove(b.tag)"
                >
                  {{ advisorExtraRemove.includes(b.tag) ? '✓' : '+' }} − {{ b.tag }} ({{
                    translate('okf.headTest.advisor.blockedGain', 'recovers {n} positive(s)').replace(
                      '{n}',
                      String(b.predicted_positive_gain)
                    )
                  }})
                </DsTag>
              </div>
            </template>
            <template v-if="advisorNarrowOptions.length">
              <p class="okf-headtest__teach-text okf-headtest__blocked-title">
                {{
                  translate(
                    'okf.headTest.advisor.narrowTitle',
                    'Narrower replacements — recover positives without re-admitting negatives'
                  )
                }}
              </p>
              <div class="okf-headtest__chips">
                <DsTag
                  v-for="p in advisorNarrowOptions"
                  :key="'adv-n-' + p.remove + '>' + p.add"
                  :variant="
                    advisorNarrowPairs.some((x) => x.remove === p.remove && x.add === p.add) ? 'accent' : 'neutral'
                  "
                  class="okf-headtest__add-chip"
                  role="button"
                  :title="translate('okf.headTest.advisor.narrowChip', 'Remove the broad tag, add the narrow one')"
                  @click="toggleNarrowPair(p)"
                >
                  {{ advisorNarrowPairs.some((x) => x.remove === p.remove && x.add === p.add) ? '✓' : '+' }}
                  − {{ p.remove }} + {{ p.add }}
                </DsTag>
              </div>
            </template>
            <ul v-if="advisorVerdicts.length" class="okf-headtest__failing">
              <li v-for="v in advisorVerdicts" :key="v.tag + (v.rejected || '')">
                <span>{{ v.rejected ? '✗' : '✓' }} {{ v.tag }}{{ v.rejected ? ' — ' + v.rejected : '' }}</span>
              </li>
            </ul>
            <div class="okf-headtest__pane-actions">
              <DsButton
                v-if="
                  advisorAddTags.length ||
                  advisorRemoveTags.length ||
                  advisorExtraRemove.length ||
                  advisorNarrowPairs.length
                "
                variant="primary"
                small
                :disabled="busy !== null"
                @click="onAdvisorApply"
              >
                {{ translate('okf.headTest.advisor.apply', 'Apply changes & rebuild & re-run suite') }}
              </DsButton>
            </div>
          </div>
          <div v-if="batchAdvice" class="okf-headtest__suggestion">
            <span class="okf-headtest__teach-title">{{ batchTitleText }}</span>
            <p v-if="batchAdvice.note" class="okf-headtest__teach-text">{{ batchAdvice.note }}</p>
            <!-- 1-8d: positive failures are visible on their own terms —
                 the count + the veto attribution (which added tag killed
                 how many positives), not folded into the negative list. -->
            <div v-if="positiveFailures && positiveFailures.count > 0" class="okf-headtest__positive-fail">
              <p class="okf-headtest__teach-text">
                {{
                  translate(
                    'okf.headTest.suites.positiveFailures',
                    '{n} positive test(s) were suppressed this run — the forbidden tags over-match the repository scope.'
                  ).replace('{n}', String(positiveFailures.count))
                }}
              </p>
              <p v-if="vetoCountsText" class="okf-headtest__teach-text okf-headtest__empty">{{ vetoCountsText }}</p>
              <p v-if="positiveFailures.margin_killed > 0" class="okf-headtest__teach-text okf-headtest__empty">
                {{
                  translate(
                    'okf.headTest.suites.marginKilled',
                    '{n} positive test(s) lost on margin (no single veto tag).'
                  ).replace('{n}', String(positiveFailures.margin_killed))
                }}
              </p>
            </div>
            <ul v-if="batchAdvice.failing_queries && batchAdvice.failing_queries.length" class="okf-headtest__failing">
              <li v-for="f in batchAdvice.failing_queries" :key="f.query">
                <span>{{ f.query }}</span>
                <DsPill v-if="f.cls" :variant="classVariant(f.cls)">{{ classLabel(f.cls) }}</DsPill>
              </li>
            </ul>
            <template v-if="batchTags.length">
              <div class="okf-headtest__chips">
                <DsTag
                  v-for="t in batchTags"
                  :key="t"
                  :variant="isTaught(t) ? 'success' : 'accent'"
                  class="okf-headtest__add-chip"
                  role="button"
                  :title="translate('okf.headTest.teach.addTag', 'Add to forbidden tags')"
                  @click="onTeachTag(t)"
                >
                  {{ isTaught(t) ? '✓' : '+' }} {{ t }}
                </DsTag>
              </div>
              <div class="okf-headtest__pane-actions">
                <DsButton variant="secondary" small :disabled="busy !== null" @click="onTeachAllTags">
                  {{ translate('okf.headTest.suites.addAll', 'Add all') }}
                </DsButton>
                <DsButton
                  v-if="taughtTags.length || removedTags.length"
                  variant="primary"
                  small
                  :disabled="busy !== null"
                  @click="onRebuildSuiteRerun"
                >
                  {{ translate('okf.headTest.suites.rebuildRerun', 'Rebuild head & re-run suite') }}
                </DsButton>
                <DsSpinner
                  v-if="busy === 'save-tag' || busy === 'rebuild-rerun' || busy === 'advisor-apply'"
                  size="sm"
                  class="okf-headtest__busy"
                >
                  {{ teachBusyLabel }}
                </DsSpinner>
              </div>
            </template>
            <!-- 1-8d: the guardrail's screened-out proposals — same
                 transparency as the Test tab, and INDEPENDENT of the
                 accepted chips (a fully-screened batch has no add chips
                 but must still show what was refused and why). -->
            <div v-if="batchRejected.length" class="okf-headtest__rejected">
              <p class="okf-headtest__teach-text okf-headtest__empty">
                {{
                  translate(
                    'okf.headTest.teach.rejected',
                    'Screened out by the guardrail — a forbidden tag must not match this repository’s own subject.'
                  )
                }}
              </p>
              <div class="okf-headtest__chips">
                <DsTag
                  v-for="r in batchRejected"
                  :key="'rej-' + r.tag"
                  variant="neutral"
                  class="okf-headtest__rejected-chip"
                  :title="r.reason"
                >
                  ✕ {{ r.tag }}<span v-if="r.reason" class="okf-headtest__rejected-reason"> — {{ r.reason }}</span>
                </DsTag>
              </div>
            </div>
            <!-- 1-8d: the INVERSE affordance — killed positives carry the
                 tag_veto attribution; one click removes the offending tag
                 (the exact inverse of the add chips above). -->
            <div v-if="removalSuggestions.length" class="okf-headtest__removals">
              <p class="okf-headtest__teach-text okf-headtest__empty">
                {{
                  translate(
                    'okf.headTest.suites.removals',
                    'Tags to remove (they veto this repository’s own positives)'
                  )
                }}
              </p>
              <div class="okf-headtest__chips">
                <DsTag
                  v-for="rm in removalSuggestions"
                  :key="'rm-' + rm.tag"
                  :variant="isRemoved(rm.tag) ? 'neutral' : 'danger'"
                  class="okf-headtest__remove-chip"
                  role="button"
                  :title="removalTip(rm)"
                  @click="onRemoveTag(rm.tag)"
                >
                  {{ isRemoved(rm.tag) ? '✓' : '−' }} {{ rm.tag }}
                </DsTag>
              </div>
              <div v-if="removedTags.length && !batchTags.length" class="okf-headtest__pane-actions">
                <DsButton variant="primary" small :disabled="busy !== null" @click="onRebuildSuiteRerun">
                  {{ translate('okf.headTest.suites.rebuildRerun', 'Rebuild head & re-run suite') }}
                </DsButton>
              </div>
            </div>
            <p
              v-if="!batchTags.length && !removalSuggestions.length && !batchRejected.length"
              class="okf-headtest__teach-text okf-headtest__empty"
            >
              {{
                translate(
                  'okf.headTest.suites.batchNone',
                  'No fix was suggested — review the failing queries against the declared scope manually.'
                )
              }}
            </p>
          </div>
        </div>

        <div class="okf-headtest__add-query">
          <DsInput
            v-model="manualQuery"
            type="text"
            :placeholder="translate('okf.headTest.suites.addPlaceholder', 'Your own probe query…')"
            class="okf-headtest__query-input"
          />
          <DsSelect v-model="manualKind" :options="manualKindOptions" class="okf-headtest__kind-select" />
          <DsButton
            variant="secondary"
            small
            :disabled="!suite || busy !== null || !manualQuery.trim()"
            @click="onAddQuery"
          >
            {{ translate('okf.headTest.suites.add', 'Add to suite') }}
          </DsButton>
        </div>

        <!-- 1-8d: Revert tags — the cycle's undo, requirement (3). Every
             frontmatter save is snapshotted (bounded, newest first); one
             click restores and offers the rebuild + re-run. Editor only
             (the wizard writes nothing). -->
        <div
          v-if="!readOnly"
          class="okf-headtest__revert"
          :class="{ 'okf-headtest__revert--highlight': revertHighlight }"
        >
          <span class="okf-headtest__teach-title">
            {{ translate('okf.headTest.suites.revertTitle', 'Revert tags') }}
          </span>
          <DsSpinner v-if="busy === 'history'" size="sm" class="okf-headtest__busy">
            {{ translate('okf.headTest.suites.revertBusy', 'Loading save history…') }}
          </DsSpinner>
          <template v-else>
            <ul v-if="revertEntries.length" class="okf-headtest__revert-list">
              <li v-for="e in revertEntries" :key="e.saved_at">
                <span>{{ shortDate(e.saved_at) }}</span>
                <span class="okf-headtest__revert-actor">{{ e.actor }}</span>
                <span v-if="e.forbidden_count !== null" class="okf-headtest__revert-actor">
                  {{
                    translate('okf.headTest.suites.revertForbiddenCount', '{n} forbidden tags').replace(
                      '{n}',
                      String(e.forbidden_count)
                    )
                  }}
                </span>
                <DsButton variant="secondary" small :disabled="busy !== null" @click="onRevertTo(e)">
                  {{ translate('okf.headTest.suites.revertAction', 'Revert') }}
                </DsButton>
              </li>
            </ul>
            <p v-else class="okf-headtest__teach-text okf-headtest__empty">
              {{ translate('okf.headTest.suites.revertEmpty', 'No frontmatter saves recorded yet.') }}
            </p>
          </template>
          <DsSpinner v-if="busy === 'revert'" size="sm" class="okf-headtest__busy">
            {{ translate('okf.headTest.suites.revertSaving', 'Restoring the frontmatter…') }}
          </DsSpinner>
          <template v-if="reverted && suite">
            <p class="okf-headtest__teach-text">
              {{
                translate(
                  'okf.headTest.suites.revertDone',
                  'Frontmatter restored — rebuild the head and re-run to apply it.'
                )
              }}
            </p>
            <div class="okf-headtest__pane-actions">
              <DsButton variant="primary" small :disabled="busy !== null" @click="onRebuildSuiteRerun">
                {{ translate('okf.headTest.suites.rebuildRerun', 'Rebuild head & re-run suite') }}
              </DsButton>
            </div>
          </template>
        </div>

        <h4 class="okf-headtest__suite-title">
          {{ translate('okf.headTest.suites.history', 'Run history') }}
        </h4>
        <table v-if="runs.length" class="okf-headtest__scores">
          <thead>
            <tr>
              <th>{{ translate('okf.headTest.suites.col.run', 'Run') }}</th>
              <th>{{ translate('okf.headTest.suites.col.when', 'When') }}</th>
              <th>{{ translate('okf.headTest.suites.col.passRate', 'Pass rate') }}</th>
              <th>{{ translate('okf.headTest.suites.col.headVersion', 'Head') }}</th>
              <th>{{ translate('okf.headTest.suites.col.tags', 'Tags') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="r in runs" :key="r._key">
              <td>
                <code>{{ r._key }}</code>
              </td>
              <td>{{ shortDate(r.created_at) }}</td>
              <td>{{ pct(r.summary ? r.summary.pass_rate : null) }}</td>
              <td>{{ r.head_version || '—' }}</td>
              <!-- 1-8e: the tuning identity — same-tags reruns are
                   bit-stable, so a pass-rate difference across runs means
                   THIS set changed. The hash identifies the configuration;
                   the tooltip lists the actual tags. -->
              <td>
                <code
                  v-if="r.tagset && r.tagset.hash"
                  :title="
                    translate('okf.headTest.suites.tagsetTip', 'Forbidden tags for this run') +
                    ': ' +
                    (r.tagset.forbidden || []).join(', ')
                  "
                  >{{ r.tagset.hash }}</code
                >
                <span v-else>—</span>
              </td>
            </tr>
          </tbody>
        </table>
        <p v-else class="okf-headtest__empty-pane">
          {{ translate('okf.headTest.suites.noRuns', 'No runs yet — generate a suite and run it.') }}
        </p>
        <!-- 1-8f: SAVED SUITES — the load targets for "saved, modified and
             rerun". Every generated suite persists; Load pulls its full
             rows back as the editable current suite. -->
        <div v-if="savedSuites.length" class="okf-headtest__saved-suites">
          <h4 class="okf-headtest__pane-title">
            {{ translate('okf.headTest.suites.savedTitle', 'Saved suites') }}
          </h4>
          <table class="okf-headtest__scores">
            <thead>
              <tr>
                <th>{{ translate('okf.headTest.suites.col.name', 'Name') }}</th>
                <th>{{ translate('okf.headTest.suites.col.run', 'Run') }}</th>
                <th>{{ translate('okf.headTest.suites.col.when', 'When') }}</th>
                <th>{{ translate('okf.headTest.suites.positives', 'Positives') }}</th>
                <th>{{ translate('okf.headTest.suites.negatives', 'Negatives') }}</th>
                <th v-if="!readOnly"></th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="s in savedSuites" :key="s._key">
                <td>
                  <!-- 1-8f: inline rename — commit on blur/Enter when changed. -->
                  <input
                    class="okf-headtest__name-input okf-headtest__name-input--compact"
                    type="text"
                    :value="s.name || ''"
                    :placeholder="translate('okf.headTest.suites.namePlaceholder', 'Suite name (optional)')"
                    :maxlength="80"
                    :disabled="busy !== null"
                    @change="onRenameSuite(s, $event.target.value)"
                  />
                </td>
                <td>
                  <code>{{ s._key }}</code>
                </td>
                <td>{{ shortDate(s.created_at) }}</td>
                <td>{{ s.positives != null ? s.positives : '—' }}</td>
                <td>{{ s.negatives != null ? s.negatives : '—' }}</td>
                <td v-if="!readOnly">
                  <DsButton
                    variant="secondary"
                    small
                    :disabled="busy !== null || (suite && suite.suite_key === s._key)"
                    @click="onLoadSuite(s._key)"
                  >
                    {{ translate('okf.headTest.suites.load', 'Load') }}
                  </DsButton>
                  <!-- 1-8g: remove the suite (and its run docs) from the
                       Saved list — including the currently-loaded one
                       (the local copy clears with it). -->
                  <button
                    type="button"
                    class="okf-headtest__row-btn okf-headtest__row-btn--danger"
                    :disabled="busy !== null"
                    :title="translate('okf.headTest.suites.deleteSuiteTip', 'Delete this suite and its run history')"
                    @click="onDeleteSuite(s)"
                  >
                    ×
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <p v-if="error" class="okf-headtest__error">{{ error }}</p>
      </div>
    </DsTabs>
  </DsDialog>
</template>

<script>
import translateMixin from '../../../mixins/translateMixin';
import DsDialog from '../../ds/Dialog.vue';
import DsTabs from '../../ds/Tabs.vue';
import DsButton from '../../ds/Button.vue';
import DsInput from '../../ds/Input.vue';
import DsSelect from '../../ds/Select.vue';
import DsPill from '../../ds/Pill.vue';
import DsTag from '../../ds/Tag.vue';
import DsSpinner from '../../ds/Spinner.vue';
import DsInfoTip from '../../ds/InfoTip.vue';

// The head text is assembled server-side as "Label: v1, v2. …" lines; the
// panel re-renders each frontmatter field from the STORED frontmatter on
// the repo doc (the head text itself stays verbatim in the tooltip).
const HEAD_FIELDS = [
  { key: 'topic', labelKey: 'okf.frontmatter.field.topic', label: 'Topics' },
  { key: 'entity', labelKey: 'okf.frontmatter.field.entity', label: 'Entities' },
  { key: 'keyword', labelKey: 'okf.frontmatter.field.keyword', label: 'Keywords' },
  { key: 'scope', labelKey: 'okf.frontmatter.field.scope', label: 'Scope' },
  { key: 'forbidden', labelKey: 'okf.frontmatter.field.forbidden', label: 'Not about' }
];

export default {
  name: 'OkfHeadTestDialog',
  components: { DsDialog, DsTabs, DsButton, DsInput, DsSelect, DsPill, DsTag, DsSpinner, DsInfoTip },
  mixins: [translateMixin],
  props: {
    visible: { type: Boolean, default: false },
    repo: { type: Object, default: null },
    /** Wizard Publish step mounts this readOnly: viewing + testing is fine,
     * head REBUILD and the lifecycle footer affordances are not (D4 rule —
     * no repo mutations from the wizard). */
    readOnly: { type: Boolean, default: false },
    initialTab: { type: String, default: 'head' }
  },
  emits: ['close', 'changed', 'request-unpublish'],
  data() {
    return {
      tab: this.initialTab,
      busy: null,
      error: '',
      query: '',
      adversarial: false,
      lastResult: null,
      suite: null,
      lastRunSummary: null,
      // 1-8c: per-class row list of the LAST run (kind + cls + outcome).
      lastRunSummaryRows: [],
      manualQuery: '',
      manualKind: 'positive',
      runs: [],
      // 1-8f: persisted suites (kind 'suite') — the Load targets.
      savedSuites: [],
      // 1-8g: the click-test's full result (head verdict + corpus verdict +
      // reason + reference files + rerank-ranked chunks) — rendered as the
      // summary panel at the top of the Suites tab.
      probePanel: null,
      // 1-8f: optional name for the next generated suite.
      suiteName: '',
      // 1-8c: user-controlled per-class query counts (server clamps).
      counts: { n_positive: 8, n_negative: 6, n_negative_random: 4, n_meta: 3, n_near_miss: 4 },
      // 1-8c: claim-side teaching state — the routing-explain result for
      // the current query, the batch advice for the last suite run, and
      // the forbidden tags taught (added) from either panel this session.
      explanation: null,
      batchAdvice: null,
      // 1-8d: the comprehensive advisor's latest result (scorecards +
      // simulated add/remove changes across recent runs).
      advisor: null,
      // 1-8g-c: the curator's confirmation state for the BLOCKED removals
      // (tags to include in Apply) and the accepted narrow pairs
      // (remove+add combos) — reset whenever the recommendation is spent.
      advisorExtraRemove: [],
      advisorNarrowPairs: [],
      taughtTags: [],
      // 1-8d: the guarded cycle — removedTags mirrors taughtTags for the
      // removal chips; tripwire holds a positive-regression detection for
      // the last same-suite re-run (dropped count); the Revert panel's
      // save history + highlight state. lastRunSuiteKey keeps the
      // comparison same-suite only (never across suites).
      removedTags: [],
      tripwire: null,
      lastRunSuiteKey: null,
      fmHistory: [],
      revertHighlight: false,
      reverted: false
    };
  },
  computed: {
    serving() {
      return !!(this.repo && this.repo.ingested_at);
    },
    head() {
      return (this.repo && this.repo.head && this.repo.head.vector && this.repo.head) || null;
    },
    headStatus() {
      if (!this.head) return 'missing';
      const fm = this.repo.frontmatter;
      if (fm && fm.updated_at && this.head.computed_at && fm.updated_at > this.head.computed_at) return 'stale';
      return 'present';
    },
    tabDefs() {
      return [
        { value: 'head', label: this.translate('okf.headTest.tab.head', 'Head') },
        { value: 'test', label: this.translate('okf.headTest.tab.test', 'Test') },
        { value: 'suites', label: this.translate('okf.headTest.tab.suites', 'Suites & analytics') }
      ];
    },
    headFields() {
      const fm = (this.repo && this.repo.frontmatter) || {};
      return HEAD_FIELDS.map((f) => ({
        ...f,
        label: this.translate(f.labelKey, f.label),
        values: Array.isArray(fm[f.key]) ? fm[f.key] : fm[f.key] ? [String(fm[f.key])] : []
      }));
    },
    scoreRows() {
      if (!this.lastResult) return [];
      const ut = this.lastResult.under_test;
      const rows = [
        {
          repo_id: ut.repo_id,
          name: ut.name,
          state: ut.lifecycle_state,
          score: ut.head_score,
          rank: ut.head_rank,
          claimed: ut.head_claimed !== undefined ? ut.head_claimed : null,
          claim: ut.head_claim || null,
          under_test: true
        }
      ];
      for (const s of this.lastResult.siblings || []) {
        rows.push({
          repo_id: s.repo_id,
          name: s.name,
          state: s.lifecycle_state,
          score: s.head_score,
          rank: s.head_rank,
          claimed: s.head_claimed !== undefined ? s.head_claimed : null,
          claim: null, // 1-8b: the deciding condition is under-test telemetry only
          under_test: false
        });
      }
      return rows.sort((a, b) => (b.score || 0) - (a.score || 0));
    },
    verdictClass() {
      if (!this.lastResult) return '';
      const selected = this.headSelected;
      const pass = this.adversarial ? !selected : selected;
      return pass ? 'okf-headtest__verdict--pass' : 'okf-headtest__verdict--fail';
    },
    /** 1-8a: selection = the head CLAIMS the query (top score AND it
     * clears its own forbidden centroid by the margin gate) — the rank
     * alone stops being the verdict, so one-repo universes are honest. */
    headSelected() {
      if (!this.lastResult) return false;
      return !!this.lastResult.verdict.under_test_wins_head;
    },
    headSuppressed() {
      if (!this.lastResult) return false;
      return !!this.lastResult.verdict.head_suppressed;
    },
    /** 1-8b: the three knob values, read from the response's fidelity
     * block so the displayed thresholds always match the server's real
     * config (fallbacks mirror the server defaults). */
    gateKnobs() {
      const k = (this.lastResult && this.lastResult.fidelity && this.lastResult.fidelity.knobs) || {};
      const num = (v, fb) => (typeof v === 'number' ? v : fb);
      return {
        floor: num(k.ROUTE_HEAD_FLOOR, 0.55),
        tagMax: num(k.ROUTE_FORBIDDEN_TAG_MAX, 0.55),
        margin: num(k.ROUTE_HEAD_MARGIN, 0.01)
      };
    },
    /** 1-8b: the three checks of the gate — value string for the code
     * chip, the vetoed tag when present, and pass/fail state ('na' when
     * the head carries no data for that leg: pre-1-8b heads skip the
     * veto, heads without forbidden tags skip the margin). Empty for
     * pre-v2 (1-8a) payloads — they carry no head_claim. */
    gateChecks() {
      const ut = this.lastResult && this.lastResult.under_test;
      if (!ut || !ut.head_claim) return [];
      const has = (v) => v !== null && v !== undefined;
      return [
        {
          key: 'floor',
          name: this.claimLabel('floor'),
          value: has(ut.head_score) ? `${ut.head_score.toFixed(3)} ≥ ${this.gateKnobs.floor.toFixed(2)}` : '',
          tag: '',
          state: has(ut.head_score) ? (ut.floor_pass ? 'pass' : 'fail') : 'na'
        },
        {
          key: 'veto',
          name: this.claimLabel('veto'),
          value: has(ut.max_tag_cosine)
            ? `max ${ut.max_tag_cosine.toFixed(3)} ${ut.tag_veto ? '≥' : '<'} ${this.gateKnobs.tagMax.toFixed(2)}`
            : '',
          tag: ut.tag_veto || '',
          state: has(ut.max_tag_cosine) ? (ut.tag_veto ? 'fail' : 'pass') : 'na'
        },
        {
          key: 'margin',
          name: this.claimLabel('margin'),
          value: has(ut.head_margin) ? `${ut.head_margin.toFixed(3)} > ${this.gateKnobs.margin.toFixed(2)}` : '',
          tag: '',
          state: has(ut.head_margin) ? (ut.head_margin > this.gateKnobs.margin ? 'pass' : 'fail') : 'na'
        }
      ];
    },
    /** 1-8b: the vetoed tag — from the structured field, else parsed out
     * of the provenance string ("head-suppressed (forbidden: <tag>)"). */
    vetoTag() {
      const ut = this.lastResult && this.lastResult.under_test;
      if (ut && ut.tag_veto) return ut.tag_veto;
      const prov = this.lastResult && this.lastResult.verdict && this.lastResult.verdict.provenance;
      const m = typeof prov === 'string' ? prov.match(/^head-suppressed \(forbidden: (.+)\)$/) : null;
      return m ? m[1] : '';
    },
    /** 1-8b teaching note: a veto is actionable (remove the named tag +
     * republish), a floor suppression is correct behavior (no fix), and
     * a claim (or a margin loss, which the breakdown already shows)
     * needs no panel. */
    teachNote() {
      const ut = this.lastResult && this.lastResult.under_test;
      if (!ut) return null;
      if (ut.head_claim === 'veto') {
        return {
          kind: 'veto',
          text: this.translate(
            'okf.headTest.teach.veto',
            'This query strongly matches the forbidden tag "{tag}". If it SHOULD belong to this repository, remove "{tag}" from the forbidden tags in Frontmatter, then republish to rebuild the head.'
          ).replace(/\{tag\}/g, this.vetoTag)
        };
      }
      if (ut.head_claim === 'floor') {
        return {
          kind: 'floor',
          text: this.translate(
            'okf.headTest.teach.floor',
            'The query is unrelated to the subject matter of this repository (score below the domain floor) — no tag change fixes this; it is correct suppression.'
          )
        };
      }
      return null;
    },
    /** 1-8a margin detail, extended by 1-8b with the deciding gate
     * condition (e.g. "… = 0.094 · Forbidden tags: genetics"). */
    gateDetail() {
      const ut = this.lastResult && this.lastResult.under_test;
      if (!ut) return '';
      const bits = [];
      if (typeof ut.head_margin === 'number' && typeof ut.head_score === 'number') {
        bits.push(
          `score ${ut.head_score.toFixed(3)} − forbidden ${ut.forbidden_cosine.toFixed(3)} = ${ut.head_margin.toFixed(3)}`
        );
      }
      if (ut.head_claim) {
        const label = this.claimLabel(ut.head_claim);
        bits.push(ut.head_claim === 'veto' && ut.tag_veto ? `${label}: ${ut.tag_veto}` : label);
      }
      return bits.length ? ` (${bits.join(' · ')})` : '';
    },
    verdictText() {
      if (!this.lastResult) return '';
      const wins = this.lastResult.verdict.under_test_wins_head;
      const winner = this.winnerName(this.lastResult.verdict.head_routing_winner);
      if (this.adversarial) {
        return wins
          ? this.translate(
              'okf.headTest.test.failAdversarial',
              'FAIL — this query routed HERE but it should not: the head claimed it'
            ) + this.gateDetail
          : this.headSuppressed
            ? this.translate(
                'okf.headTest.test.passSuppressed',
                'PASS — suppressed by the forbidden/noise gate: the head does not claim this query'
              ) + this.gateDetail
            : this.translate(
                'okf.headTest.test.passAdversarial',
                'PASS — correctly not selected (winner: {repo}).'
              ).replace('{repo}', winner);
      }
      return wins
        ? this.translate('okf.headTest.test.pass', 'PASS — this repository wins the head routing.') + this.gateDetail
        : this.headSuppressed
          ? this.translate(
              'okf.headTest.test.notSelectedSuppressed',
              'NOT SELECTED — suppressed by the forbidden/noise gate: the query is more like what this repository excludes, or is off-domain noise'
            ) + this.gateDetail
          : this.translate('okf.headTest.test.fail', 'FAIL — {repo} wins the head routing for this query.').replace(
              '{repo}',
              winner
            );
    },
    /** 1-8f: the suite's rows as an editable list — visible BEFORE any run
     * (the old view only rendered after a run), merged with the last run's
     * outcome when one exists. */
    suiteEditableRows() {
      const s = this.suite;
      if (!s || !s.payload) return [];
      const rows = [];
      const push = (arr, kind) =>
        (Array.isArray(arr) ? arr : []).forEach((r) =>
          rows.push({
            query: r.query,
            kind,
            cls: r.cls || null,
            source: r.source || null,
            // 1-8g: the click-test's coverage verdict rides the row —
            // dropping it here blanked the Corpus column (live bug).
            lastProbe: r.lastProbe || null
          })
        );
      push(s.payload.positive, 'positive');
      push(s.payload.negative, 'negative');
      const outcomes = new Map((this.lastRunSummaryRows || []).map((r) => [r.query + '|' + r.kind, r]));
      return rows.map((r, i) => {
        const o = outcomes.get(r.query + '|' + r.kind) || null;
        return {
          key: r.query + '|' + r.kind + ':' + i,
          query: r.query,
          kind: r.kind,
          cls: r.cls,
          source: r.source,
          // 1-8g: the final map REBUILDS the row — dropping lastProbe here
          // blanked the Corpus column even though the push above kept it
          // (the live bug: chips never rendered for anyone).
          lastProbe: r.lastProbe || null,
          pass: o ? o.pass : null,
          failLabel: o ? o.failLabel : null,
          error: o ? o.error : null
        };
      });
    },
    /** 2026-10-10 (live 409): the corpus probe searches the INGESTED
     * corpus — routing/head tests work without ingestion, the ▶ click-test
     * does not. Gate the affordance instead of letting every click 409. */
    corpusAvailable() {
      return !!(this.repo && this.repo.ingested_graph_name);
    },
    negLabel() {
      const s = this.lastRunSummary;
      if (!s) return '—';
      if (s.negative_evaluatable === 0) {
        return this.translate('okf.headTest.suites.noCompetitors', 'n/a — no competing heads yet');
      }
      return `${s.negative_passed}/${s.negative_evaluatable}`;
    },
    manualKindOptions() {
      return [
        { value: 'positive', label: this.translate('okf.headTest.suites.kindPositive', 'should select') },
        { value: 'negative', label: this.translate('okf.headTest.suites.kindNegative', 'should NOT select') }
      ];
    },
    /** 1-8c: the five class-count controls (defaults mirror the server's
     * clampCount fallbacks; mins/maxes mirror its documented ranges). */
    countControls() {
      // Story 1-8f — "any number of tests for any type": the maxes mirror
      // the server's CLASS_MAX ceilings (the old 20/15/12/8/10 caps
      // silently ate David's n_positive=100). The LLM ask is batched
      // server-side, so large numbers no longer truncate.
      return [
        { key: 'n_positive', min: 0, max: 1000, label: this.translate('okf.headTest.counts.positive', 'Positives') },
        { key: 'n_negative', min: 0, max: 500, label: this.translate('okf.headTest.counts.negative', 'Confusable') },
        {
          key: 'n_negative_random',
          min: 0,
          max: 500,
          label: this.translate('okf.headTest.counts.negativeRandom', 'Off-domain')
        },
        { key: 'n_meta', min: 0, max: 500, label: this.translate('okf.headTest.counts.meta', 'Meta') },
        { key: 'n_near_miss', min: 0, max: 500, label: this.translate('okf.headTest.counts.nearMiss', 'Near miss') }
      ];
    },
    /** 1-8c: the claim-side teach block shows when the under-test head
     * CLAIMS the query — the one gate outcome the 1-8b panels don't cover.
     * Hidden in the wizard (readOnly — the fix writes forbidden tags). */
    claimTeachable() {
      if (this.readOnly) return false;
      const ut = this.lastResult && this.lastResult.under_test;
      return !!(ut && ut.head_claimed === true);
    },
    /** 1-8c: forbidden tags the explain call proposed for this query. */
    suggestedTags() {
      const s = this.explanation && this.explanation.suggestion;
      return s && Array.isArray(s.tags) ? s.tags : [];
    },
    /** 1-8c: the consolidated forbidden tags the batch explain proposed. */
    batchTags() {
      return this.batchAdvice && Array.isArray(this.batchAdvice.suggested_tags) ? this.batchAdvice.suggested_tags : [];
    },
    /** 1-8c: show the batch 'Explain failures' affordance when the last
     * run left failing negatives (summary-level, per the run contract). */
    hasNegativeFailures() {
      const s = this.lastRunSummary;
      if (!s || typeof s.negative_passed !== 'number' || typeof s.negative_total !== 'number') return false;
      return s.negative_passed < s.negative_total;
    },
    /** 1-8d: positive failures count as explainable too — over-suppression
     * is the poisoning signature, and the Explain button must not vanish
     * exactly when the added tags suppress the repo's own subject. */
    hasPositiveFailures() {
      const s = this.lastRunSummary;
      if (!s || typeof s.positive_passed !== 'number' || typeof s.positive_total !== 'number') return false;
      return s.positive_passed < s.positive_total;
    },
    /** 1-8d: the Explain gate — either failure kind. Legacy run summaries
     * carrying neither counter keep the button hidden (nothing to explain
     * from). */
    hasExplainableFailures() {
      return this.hasNegativeFailures || this.hasPositiveFailures;
    },
    /** 1-8d: guardrail-screened proposals from the claim-side explain —
     * [{tag, reason}] rendered as muted chips with the reason as tooltip. */
    suggestedRejected() {
      const r = this.explanation && this.explanation.suggestion;
      return r && Array.isArray(r.rejected) ? r.rejected : [];
    },
    /** 1-8d: the batch explain's screened-out proposals. */
    batchRejected() {
      return this.batchAdvice && Array.isArray(this.batchAdvice.rejected) ? this.batchAdvice.rejected : [];
    },
    /** 1-8d: the batch explain's removal advice — [{tag, killed}] from the
     * killed positives' tag_veto attribution. Legacy responses carry no
     * field → empty (never a crash). */
    removalSuggestions() {
      return (
        (this.batchAdvice &&
          Array.isArray(this.batchAdvice.removal_suggestions) &&
          this.batchAdvice.removal_suggestions) ||
        []
      );
    },
    /** 1-8d: the batch explain's positive-failure block — {count,
     * veto_counts, margin_killed}; absent on legacy responses. */
    positiveFailures() {
      return this.batchAdvice && this.batchAdvice.positive_failures ? this.batchAdvice.positive_failures : null;
    },
    /** 1-8d: the veto attribution as one line ("Vetoed by: lung-cancer ×2,
     * non-smoking ×1") — the exact tags that over-suppressed. */
    vetoCountsText() {
      const pf = this.positiveFailures;
      if (!pf || !pf.veto_counts || typeof pf.veto_counts !== 'object') return '';
      const parts = Object.entries(pf.veto_counts).map(([tag, n]) => `${tag} ×${n}`);
      if (!parts.length) return '';
      return this.translate('okf.headTest.suites.vetoedBy', 'Vetoed by') + ': ' + parts.join(', ');
    },
    /** 1-8d: batch panel title — negatives failing get the 1-8c title; a
     * positive-only collapse gets its own (the "why the failing negatives
     * routed here" heading reads absurd with an empty negative list). */
    batchTitleText() {
      if (this.batchAdvice && this.batchAdvice.failing_count > 0) {
        return this.translate('okf.headTest.suites.batchTitle', 'Why the failing negatives routed here');
      }
      return this.translate('okf.headTest.suites.positiveFailuresTitle', 'Why positives stopped passing');
    },
    /** 1-8d: the advisor's recommended additions (not yet applied). */
    advisorAddTags() {
      const add =
        this.advisor && this.advisor.changes && Array.isArray(this.advisor.changes.add) ? this.advisor.changes.add : [];
      return add.filter((t) => !this.isTaught(t));
    },
    /** 1-8d: the advisor's recommended removals still present in the
     * repo's forbidden list — [{tag, killed}]. */
    advisorRemoveTags() {
      const remove =
        this.advisor && this.advisor.changes && Array.isArray(this.advisor.changes.remove)
          ? this.advisor.changes.remove
          : [];
      const fm = (this.repo && this.repo.frontmatter) || {};
      const current = Array.isArray(fm.forbidden) ? fm.forbidden.map((x) => String(x).toLowerCase()) : [];
      return remove
        .map((t) => (typeof t === 'string' ? { tag: t } : t))
        .filter((r) => current.includes(String(r.tag).toLowerCase()));
    },
    /** 1-8d: candidate evaluation verdicts (accepted + rejected) for the
     * advisor transparency list. */
    advisorVerdicts() {
      const addEval = (this.advisor && Array.isArray(this.advisor.add_eval) ? this.advisor.add_eval : []).slice(0, 12);
      const removeEval = (
        this.advisor && Array.isArray(this.advisor.remove_eval) ? this.advisor.remove_eval : []
      ).slice(0, 8);
      return addEval.concat(removeEval);
    },
    /** 1-8g-c: removals the advisor may not auto-apply (curator originals,
     * rotated-baseline writes) that the simulation predicts WOULD recover
     * positives — the one action that moves the positives, surfaced. */
    advisorBlockedRemovals() {
      return this.advisor && Array.isArray(this.advisor.blocked_removals) ? this.advisor.blocked_removals : [];
    },
    /** 1-8g-c: remove-broad/add-narrow pairs that dominate a blocked
     * removal alone (positives up, negatives not re-admitted). */
    advisorNarrowOptions() {
      return this.advisor && Array.isArray(this.advisor.narrow_options) ? this.advisor.narrow_options : [];
    },
    /** 1-8d: the before/after scorecard line for the advisor panel. */
    advisorScoreText() {
      const a = this.advisor;
      if (!a || !a.current_scorecard || !a.recommended_scorecard) return '';
      const cur = a.current_scorecard;
      const rec = a.recommended_scorecard;
      const fmt = (s) =>
        this.translate('okf.headTest.advisor.scorecard', 'positives {p}/{pt} claimed · negatives {n}/{nt} suppressed')
          .replace('{p}', String(s.positive_claimed))
          .replace('{pt}', String(s.positive_total))
          .replace('{n}', String(s.negative_suppressed))
          .replace('{nt}', String(s.negative_total));
      return (
        `${this.translate('okf.headTest.advisor.now', 'Now')}: ${fmt(cur)} → ${this.translate(
          'okf.headTest.advisor.predicted',
          'predicted'
        )}: ${fmt(rec)}` +
        this.translate('okf.headTest.advisor.scope', ' (across {q} queries from the last {r} runs)')
          .replace('{q}', String(a.queries_considered))
          .replace('{r}', String(a.runs_considered)) +
        // 1-8g-b: name the aggregated scope so "which suite / which tag
        // set" is never a guess (older advisor docs carry no scope).
        (a.scope && Array.isArray(a.scope.suites)
          ? ' ' +
            this.translate('okf.headTest.advisor.scopeDetail', 'suites: {s} · tag sets: {t}')
              .replace('{s}', a.scope.suites.join(', ') || '—')
              .replace(
                '{t}',
                [...new Set((a.scope.runs || []).map((r) => r.tagset && r.tagset.hash8).filter(Boolean))].join(', ') ||
                  '—'
              )
          : '')
      );
    },
    /** 1-8d: the suite's forbidden-derived rows were derived from the
     * forbidden list AT GENERATION TIME (payload.forbidden_snapshot) —
     * flag when the stored list has since drifted (set compare,
     * case-insensitive). */
    suiteForbiddenStale() {
      const snap = this.suite && this.suite.payload && this.suite.payload.forbidden_snapshot;
      if (!Array.isArray(snap)) return false;
      const fm = (this.repo && this.repo.frontmatter && this.repo.frontmatter.forbidden) || [];
      const norm = (a) => [...new Set(a.map((x) => String(x).toLowerCase()))].sort();
      const a = norm(snap);
      const b = norm(fm);
      return a.length !== b.length || a.some((x, i) => x !== b[i]);
    },
    /** 1-8d: the Revert panel's entries, display-capped at 10 (the server
     * already bounds its history at 10 — the slice is belt and braces). */
    revertEntries() {
      return (Array.isArray(this.fmHistory) ? this.fmHistory : []).slice(0, 10);
    },
    /** 1-8d: the tripwire strip's text — N positives broke this cycle. */
    tripwireText() {
      const n = this.tripwire ? this.tripwire.dropped : 0;
      return this.translate(
        'okf.headTest.suites.tripwire',
        'This cycle broke {n} positive tests — the added tags over-suppress. Revert?'
      ).replace('{n}', String(n));
    },
    /** 1-8c: label for the teach-flow long actions (tag save / rebuild +
     * re-run) — the same busy-strip pattern as the tabs' own spinners. */
    teachBusyLabel() {
      if (this.busy === 'save-tag') {
        return this.translate('okf.headTest.teach.savingTag', 'Saving the forbidden tag…');
      }
      if (this.busy === 'rebuild-rerun') {
        return this.translate('okf.headTest.teach.rebuildBusy', 'Rebuilding the head and re-running…');
      }
      if (this.busy === 'advisor-apply') {
        return this.translate(
          'okf.headTest.advisor.applying',
          'Applying: saving tags, rebuilding the head, re-running the suite…'
        );
      }
      return '';
    },
    dialogActions() {
      const actions = [];
      if (!this.readOnly && this.repo && this.repo.lifecycle_state === 'publish' && !this.serving) {
        actions.push({
          key: 'unpublish',
          label: this.translate('okf.headTest.footer.unpublish', 'Unpublish to review'),
          variant: 'secondary',
          disabled: this.busy !== null
        });
      }
      actions.push({ key: 'close', label: this.translate('common.close', 'Close'), variant: 'secondary' });
      return actions;
    }
  },
  watch: {
    visible: {
      immediate: true,
      async handler(open) {
        if (open && this.repo) {
          this.tab = this.initialTab;
          this.error = '';
          // 1-8c: teach state is per-open — isTaught still cross-checks the
          // stored frontmatter, so edits made outside the Lab stay honest.
          this.taughtTags = [];
          this.explanation = null;
          this.batchAdvice = null;
          // 1-8d: cycle state is per-open too (the tripwire describes the
          // session's last same-suite comparison; history is cheap).
          this.removedTags = [];
          this.tripwire = null;
          this.revertHighlight = false;
          this.reverted = false;
          this.fmHistory = [];
          this.refreshRuns();
          if (!this.readOnly) this.loadFrontmatterHistory();
        }
      }
    }
  },
  methods: {
    /** 1-8b: translated label for a head_claim token (floor | veto |
     * margin | claim) — used by the claims column, the banner suffix and
     * the gate breakdown. */
    claimLabel(claim) {
      const keys = {
        floor: ['okf.headTest.gate.floor', 'Floor'],
        veto: ['okf.headTest.gate.veto', 'Forbidden tags'],
        margin: ['okf.headTest.gate.margin', 'Margin'],
        claim: ['okf.headTest.gate.claim', 'Claim']
      };
      const hit = keys[claim];
      return hit ? this.translate(hit[0], hit[1]) : claim;
    },
    winnerName(repoId) {
      if (!this.lastResult) return '';
      if (repoId === this.lastResult.under_test.repo_id) return this.lastResult.under_test.name;
      const s = (this.lastResult.siblings || []).find((x) => x.repo_id === repoId);
      return s ? s.name : repoId;
    },
    barWidth(score) {
      const s = Math.max(0, Math.min(1, score || 0));
      return Math.round(s * 100) + '%';
    },
    pct(v) {
      return v === null || v === undefined ? '—' : Math.round(v * 100) + '%';
    },
    shortDate(iso) {
      try {
        return new Date(iso).toLocaleString();
      } catch {
        return iso || '—';
      }
    },
    async onRebuild() {
      this.busy = 'rebuild';
      this.error = '';
      const res = await this.$store.dispatch('okf/headRebuild', { repoId: this.repo.repo_id });
      this.busy = null;
      if (!res.ok) {
        this.error = res.message || this.translate('okf.headTest.error.rebuild', 'Head rebuild failed');
        return;
      }
      this.$emit('changed', { head: res.result });
    },
    async onRunTest() {
      if (!this.query.trim()) return;
      this.busy = 'test';
      this.error = '';
      this.lastResult = null;
      this.explanation = null; // 1-8c: advice belongs to the previous result
      const res = await this.$store.dispatch('okf/headRoutingTest', {
        repoId: this.repo.repo_id,
        query: this.query.trim()
      });
      this.busy = null;
      if (!res.ok) {
        this.error = res.message || this.translate('okf.headTest.error.test', 'Routing test failed');
        return;
      }
      this.lastResult = res.result;
    },
    /** 1-8c: claim-side advice (Story 1-8c routing-explain) — when the
     * head claims a query it should suppress, propose forbidden tags. */
    async onExplainClaim() {
      if (!this.query.trim() || this.busy !== null) return;
      this.busy = 'explain';
      this.error = '';
      const res = await this.$store.dispatch('okf/headRoutingExplain', {
        repoId: this.repo.repo_id,
        query: this.query.trim()
      });
      this.busy = null;
      if (!res.ok) {
        this.error = res.message || this.translate('okf.headTest.error.explain', 'Explain failed');
        return;
      }
      this.explanation = res.result;
    },
    /** 1-8c: the frontmatter shape the Lab's tag writes go through — the
     * doc-field shape (same as FrontmatterPanel), with extraForbidden
     * merged into the stored forbidden list (case-insensitive dedupe) and
     * removeForbidden (1-8d, the removal chips) filtered out of it. The
     * WRITE itself reuses the okf/saveFrontmatter two-write action —
     * no new endpoint. */
    buildFrontmatterShape(extraForbidden = [], removeForbidden = []) {
      const fm = (this.repo && this.repo.frontmatter) || {};
      const arr = (v) => (Array.isArray(v) ? v.slice() : []);
      let forbidden = arr(fm.forbidden);
      for (const t of extraForbidden) {
        if (!forbidden.some((x) => String(x).toLowerCase() === String(t).toLowerCase())) forbidden.push(t);
      }
      if (removeForbidden.length) {
        forbidden = forbidden.filter(
          (x) => !removeForbidden.some((t) => String(x).toLowerCase() === String(t).toLowerCase())
        );
      }
      return {
        topic: arr(fm.topic),
        entity: arr(fm.entity),
        scope: typeof fm.scope === 'string' ? fm.scope : '',
        forbidden,
        summary: typeof fm.summary === 'string' ? fm.summary : '',
        keyword: arr(fm.keyword)
      };
    },
    /** 1-8c: a suggested tag counts as taught when added this session OR
     * already present in the stored frontmatter (the repo prop refreshes
     * asynchronously after a save — taughtTags bridges the gap). */
    isTaught(t) {
      if (this.taughtTags.includes(t)) return true;
      const fm = (this.repo && this.repo.frontmatter) || {};
      return (
        Array.isArray(fm.forbidden) && fm.forbidden.some((x) => String(x).toLowerCase() === String(t).toLowerCase())
      );
    },
    /** 1-8d: a removal chip counts as done when clicked this session OR
     * already absent from the stored forbidden list (mirrors isTaught). */
    isRemoved(t) {
      if (this.removedTags.includes(t)) return true;
      const fm = (this.repo && this.repo.frontmatter) || {};
      return (
        !Array.isArray(fm.forbidden) || !fm.forbidden.some((x) => String(x).toLowerCase() === String(t).toLowerCase())
      );
    },
    /** 1-8d: the removal chip's tooltip — the attribution ("- tag (killed
     * N positives)"), so the curator sees WHY before clicking. */
    removalTip(rm) {
      return this.translate('okf.headTest.suites.removeTip', 'Remove "{tag}" — it vetoed {n} positive test(s)')
        .replace('{tag}', rm.tag)
        .replace('{n}', String(rm.killed));
    },
    /** 1-8d: REMOVE one vetoed tag from the repo's forbidden tags — the
     * inverse of onTeachTag. Same shared two-write save, shape built with
     * the tag excluded. Afterwards the rebuild + re-run offer appears. */
    async onRemoveTag(tag) {
      if (!tag || this.busy !== null) return;
      this.busy = 'save-tag';
      this.error = '';
      const res = await this.$store.dispatch('okf/saveFrontmatter', {
        repoId: this.repo.repo_id,
        shape: this.buildFrontmatterShape([], [tag])
      });
      this.busy = null;
      if (!res || !res.ok) {
        this.error =
          (res && res.message) || this.translate('okf.headTest.error.saveTag', 'Could not save the forbidden tag');
        return;
      }
      if (!this.removedTags.includes(tag)) this.removedTags.push(tag);
      this.taughtTags = this.taughtTags.filter((t) => t !== tag);
      this.$emit('changed', { frontmatter: true });
    },
    /** 1-8d: the positive-regression tripwire — same-suite comparison
     * ONLY. Given the previous run's positive counts (null when there is
     * no comparable run) and the fresh summary, flags a pass-rate drop
     * with a best-effort broken-positive count. */
    checkTripwire(prev, next) {
      this.tripwire = null;
      if (!prev || !next || !prev.total || !next.positive_total) return;
      const prevRate = prev.passed / prev.total;
      const nextRate = next.positive_passed / next.positive_total;
      if (nextRate >= prevRate) return;
      const dropped =
        prev.total === next.positive_total
          ? Math.max(0, prev.passed - next.positive_passed)
          : Math.max(1, Math.round((prevRate - nextRate) * prev.total));
      this.tripwire = { dropped };
    },
    /** 1-8d: load the bounded frontmatter save history for the Revert
     * panel (cheap read; editor sessions only — the panel is hidden in
     * the wizard). */
    async loadFrontmatterHistory() {
      if (this.busy !== null) return;
      this.busy = 'history';
      this.error = '';
      const res = await this.$store.dispatch('okf/frontmatterHistory', { repoId: this.repo.repo_id });
      this.busy = null;
      if (!res.ok) {
        this.error = res.message || this.translate('okf.headTest.error.history', 'Could not load the save history');
        return;
      }
      this.fmHistory = res.entries || [];
    },
    /** 1-8d: the tripwire's "Revert?" affordance — jump to the Revert
     * panel (Suites tab), highlight it, and make sure its data is in. */
    async showRevertPanel() {
      if (this.readOnly) return;
      if (this.tab !== 'suites') this.tab = 'suites';
      this.revertHighlight = true;
      if (!this.fmHistory.length) await this.loadFrontmatterHistory();
    },
    /** 1-8d: restore the frontmatter snapshotted at the entry's saved_at.
     * The server re-enters update(), so the revert itself is snapshotted
     * (revert-of-revert works). Emits changed so the shell refetches the
     * repo, then offers the rebuild + re-run. */
    async onRevertTo(entry) {
      if (!entry || !entry.saved_at || this.busy !== null) return;
      this.busy = 'revert';
      this.error = '';
      const res = await this.$store.dispatch('okf/frontmatterRevert', {
        repoId: this.repo.repo_id,
        savedAt: entry.saved_at
      });
      this.busy = null;
      if (!res.ok) {
        this.error = res.message || this.translate('okf.headTest.error.revert', 'Could not revert the frontmatter');
        return;
      }
      this.reverted = true;
      this.revertHighlight = false;
      this.taughtTags = [];
      this.removedTags = [];
      this.$emit('changed', { frontmatter: true });
      await this.loadFrontmatterHistory();
    },
    /** 1-8c: add ONE suggested tag to the repo's forbidden tags (the
     * shared two-write save), then offer the rebuild + re-run. */
    async onTeachTag(tag) {
      if (!tag || this.isTaught(tag) || this.busy !== null) return;
      this.busy = 'save-tag';
      this.error = '';
      const res = await this.$store.dispatch('okf/saveFrontmatter', {
        repoId: this.repo.repo_id,
        shape: this.buildFrontmatterShape([tag])
      });
      this.busy = null;
      if (!res || !res.ok) {
        this.error =
          (res && res.message) || this.translate('okf.headTest.error.saveTag', 'Could not save the forbidden tag');
        return;
      }
      if (!this.taughtTags.includes(tag)) this.taughtTags.push(tag);
      this.$emit('changed', { frontmatter: true });
    },
    /** 1-8c: add every remaining batch tag in ONE save. */
    async onTeachAllTags() {
      const pending = this.batchTags.filter((t) => !this.isTaught(t));
      if (!pending.length || this.busy !== null) return;
      this.busy = 'save-tag';
      this.error = '';
      const res = await this.$store.dispatch('okf/saveFrontmatter', {
        repoId: this.repo.repo_id,
        shape: this.buildFrontmatterShape(pending)
      });
      this.busy = null;
      if (!res || !res.ok) {
        this.error =
          (res && res.message) || this.translate('okf.headTest.error.saveTag', 'Could not save the forbidden tag');
        return;
      }
      for (const t of pending) if (!this.taughtTags.includes(t)) this.taughtTags.push(t);
      this.$emit('changed', { frontmatter: true });
    },
    /** 1-8d: the COMPREHENSIVE advisor — one call aggregates every query
     * class across the last N runs, simulates tag-set configurations
     * against the gate, and returns the globally-optimal add/remove set
     * under the zero-positive-harm constraint. Pure advice — nothing is
     * written until the curator clicks a chip or Apply. */
    async onRecommend() {
      if (this.busy !== null) return;
      this.busy = 'advisor';
      this.error = '';
      const res = await this.$store.dispatch('okf/headRecommend', { repoId: this.repo.repo_id });
      this.busy = null;
      if (!res.ok) {
        this.error = res.message || this.translate('okf.headTest.error.advisor', 'Advisor failed');
        return;
      }
      this.advisor = res.result;
      this.advisorExtraRemove = [];
      this.advisorNarrowPairs = [];
    },
    /** 1-8g-c: the blocked-removal chips toggle into the Apply set; the
     * narrow chips toggle a remove+add PAIR. Both are curator-confirmed —
     * the advisor itself never auto-applies a curator original. */
    toggleExtraRemove(tag) {
      this.advisorExtraRemove = this.advisorExtraRemove.includes(tag)
        ? this.advisorExtraRemove.filter((t) => t !== tag)
        : [...this.advisorExtraRemove, tag];
    },
    toggleNarrowPair(pair) {
      const has = this.advisorNarrowPairs.some((p) => p.remove === pair.remove && p.add === pair.add);
      this.advisorNarrowPairs = has
        ? this.advisorNarrowPairs.filter((p) => !(p.remove === pair.remove && p.add === pair.add))
        : [...this.advisorNarrowPairs, { remove: pair.remove, add: pair.add }];
    },
    blockedReasonText(reason) {
      if (reason === 'curator_original') {
        return this.translate(
          'okf.headTest.advisor.reasonCurator',
          'you declared this tag originally — confirm before removing'
        );
      }
      if (reason === 'history_rotated') {
        return this.translate(
          'okf.headTest.advisor.reasonRotated',
          'the edit history has rotated past the baseline — confirm before removing'
        );
      }
      return reason || '';
    },
    /** 1-8d: apply the advisor's recommendation in ONE frontmatter save
     * (adds and removes together — never two half-states), then hand off
     * to the standard rebuild + re-run-suite leg so the scorecard
     * refreshes against real runs (the tripwire guards this like any
     * other cycle). */
    async onAdvisorApply() {
      // 1-8g-c: the confirmed blocked removals and narrow pairs join the
      // recommendation's own adds/removes in the ONE save.
      const addTags = [...new Set([...this.advisorAddTags, ...this.advisorNarrowPairs.map((p) => p.add)])];
      const removeTags = [
        ...new Set([
          ...this.advisorRemoveTags.map((r) => r.tag),
          ...this.advisorExtraRemove,
          ...this.advisorNarrowPairs.map((p) => p.remove)
        ])
      ].filter((t) => !addTags.includes(t));
      if ((!addTags.length && !removeTags.length) || this.busy !== null) return;
      // 1-8e race fix: ONE busy token owns the whole leg (save → rebuild →
      // re-run). The previous version handed off through
      // onRebuildSuiteRerun/onRunSuite, whose guard clauses return SILENTLY
      // when a precondition flickers — the curator saw the flow just stop
      // after Apply (2026-10-09 live incident). Every failure now surfaces
      // in the error strip; the re-run runs inline, not via guard chains.
      this.busy = 'advisor-apply';
      this.error = '';
      const save = await this.$store.dispatch('okf/saveFrontmatter', {
        repoId: this.repo.repo_id,
        shape: this.buildFrontmatterShape(addTags, removeTags)
      });
      if (!save || !save.ok) {
        this.busy = null;
        this.error =
          (save && save.message) || this.translate('okf.headTest.error.saveTag', 'Could not save the forbidden tags');
        return;
      }
      for (const t of addTags) if (!this.taughtTags.includes(t)) this.taughtTags.push(t);
      for (const t of removeTags) if (!this.removedTags.includes(t)) this.removedTags.push(t);
      this.advisor = null; // the recommendation is spent — the re-run shows the effect
      this.advisorExtraRemove = [];
      this.advisorNarrowPairs = [];
      this.$emit('changed', { frontmatter: true });
      const reb = await this.$store.dispatch('okf/headRebuild', { repoId: this.repo.repo_id });
      if (!reb || !reb.ok) {
        this.busy = null;
        this.error =
          (reb && reb.message) ||
          this.translate(
            'okf.headTest.error.rebuild',
            'Head rebuild failed — the tags are saved; rebuild from the Head tab.'
          );
        return;
      }
      this.$emit('changed', { head: reb.result });
      if (!this.suite) {
        this.busy = null;
        this.error = this.translate(
          'okf.headTest.error.applyNoSuite',
          'Tags saved and the head rebuilt — generate a suite, then Run all to see the effect.'
        );
        return;
      }
      const res = await this.$store.dispatch('okf/headSuiteRun', {
        repoId: this.repo.repo_id,
        suiteKey: this.suite.suite_key
      });
      this.busy = null;
      if (!res || !res.ok) {
        this.error =
          (res && res.message) ||
          this.translate(
            'okf.headTest.error.run',
            'Suite run failed — the tags are saved; re-run from the Suites tab.'
          );
        return;
      }
      // Same post-run bookkeeping as onRunSuite (tripwire baseline is null —
      // the tag set changed, so cross-tag-set comparison would be noise).
      this.lastRunSummary = res.result.payload.summary;
      this.lastRunSuiteKey = this.suite.suite_key;
      const results = (res.result.payload && res.result.payload.results) || [];
      this.lastRunSummaryRows = results.map((r, i) => ({
        key: r.query + ':' + i,
        query: r.query,
        kind: r.kind,
        cls: r.cls || null,
        source: r.source,
        error: r.error || null,
        pass: this.outcomeOf(r),
        failLabel: this.failLabelOf(r)
      }));
      this.batchAdvice = null;
      this.refreshRuns();
    },
    /** 1-8c: the fix loop's last leg — rebuild the head from the just-
     * saved tags, then re-run the SAME query through routing-test so the
     * gate breakdown + verdict refresh in place. */
    async onRebuildRerun() {
      if (this.busy !== null || !this.query.trim()) return;
      this.busy = 'rebuild-rerun';
      this.error = '';
      const reb = await this.$store.dispatch('okf/headRebuild', { repoId: this.repo.repo_id });
      if (!reb.ok) {
        this.busy = null;
        this.error = reb.message || this.translate('okf.headTest.error.rebuild', 'Head rebuild failed');
        return;
      }
      this.$emit('changed', { head: reb.result });
      const res = await this.$store.dispatch('okf/headRoutingTest', {
        repoId: this.repo.repo_id,
        query: this.query.trim()
      });
      this.busy = null;
      if (!res.ok) {
        this.error = res.message || this.translate('okf.headTest.error.test', 'Routing test failed');
        return;
      }
      this.lastResult = res.result;
      this.explanation = null; // the old advice is spent — re-explain if it still claims
    },
    async onGenerateSuite() {
      this.busy = 'generate';
      this.error = '';
      // 1-8c: per-class counts ride along; undefined lets the server
      // apply its own defaults/clamps. 1-8f: the optional suite name.
      // 1-8f2: generation is ASYNC (202 + poll) — a large ask batches
      // across minutes of LLM calls and the synchronous request died at
      // the gateway before the suite landed (live 2026-10-09).
      const res = await this.$store.dispatch('okf/headSuiteGenerate', {
        repoId: this.repo.repo_id,
        nPositive: this.intOf(this.counts.n_positive),
        nNegative: this.intOf(this.counts.n_negative),
        nNegativeRandom: this.intOf(this.counts.n_negative_random),
        nMeta: this.intOf(this.counts.n_meta),
        nNearMiss: this.intOf(this.counts.n_near_miss),
        name: (this.suiteName || '').trim() || undefined
      });
      this.suiteName = '';
      if (!res.ok) {
        this.busy = null;
        this.error = res.message || this.translate('okf.headTest.error.generate', 'Suite generation failed');
        return;
      }
      let suite = null;
      if (res.result && res.result.status === 'generating' && res.result.suite_key) {
        suite = await this.pollForSuite(res.result.suite_key);
      } else if (res.result && res.result.suite_key) {
        suite = res.result; // legacy synchronous response
      }
      this.busy = null;
      if (!suite) {
        this.error = this.translate(
          'okf.headTest.error.generateTimeout',
          'The suite is taking unusually long — it may still land in Saved suites; check there in a minute.'
        );
        this.refreshRuns();
        return;
      }
      this.suite = suite;
      this.lastRunSummary = null;
      this.lastRunSummaryRows = [];
      this.batchAdvice = null;
      // 1-8d: regeneration creates a NEW benchmark identity — no tripwire
      // carry-over, and the baseline key follows the new suite.
      this.tripwire = null;
      this.lastRunSuiteKey = this.suite ? this.suite.suite_key : null;
      this.refreshRuns();
    },
    /** 1-8f2: poll GET /:suite_key until the async generation lands the
     * doc (2.5s interval, ~4min budget), or give up with null. */
    async pollForSuite(suiteKey) {
      const attempts = 96; // 96 × 2.5s ≈ 4 min
      for (let i = 0; i < attempts; i += 1) {
        // GET first, sleep after — a fast generation lands on attempt 0.
        // The server answers 200 {suite_key, status:'generating'} while the
        // async worker runs (never a 404) — keep waiting on that envelope;
        // only a real suite doc (no status) is adopted.
        const res = await this.$store.dispatch('okf/headSuiteGet', { repoId: this.repo.repo_id, suiteKey });
        const suite = res && res.ok ? res.result : null;
        if (suite && suite.suite_key && suite.status !== 'generating') return suite;
        await new Promise((resolve) => setTimeout(resolve, 2500));
      }
      return null;
    },
    async onRunSuite() {
      if (!this.suite) return;
      this.busy = 'run';
      this.error = '';
      // 1-8d: tripwire baseline — the run being REPLACED, only when it
      // belongs to the SAME suite (never compare across suites).
      const baseline =
        this.lastRunSummary && this.lastRunSuiteKey === this.suite.suite_key
          ? { passed: this.lastRunSummary.positive_passed, total: this.lastRunSummary.positive_total }
          : null;
      const res = await this.$store.dispatch('okf/headSuiteRun', {
        repoId: this.repo.repo_id,
        suiteKey: this.suite.suite_key
      });
      this.busy = null;
      if (!res.ok) {
        this.error = res.message || this.translate('okf.headTest.error.run', 'Suite run failed');
        return;
      }
      this.lastRunSummary = res.result.payload.summary;
      this.lastRunSuiteKey = this.suite.suite_key;
      // Map the summary onto the suite's queries for the outcome column.
      const results = (res.result.payload && res.result.payload.results) || [];
      this.lastRunSummaryRows = results.map((r, i) => ({
        key: r.query + ':' + i,
        query: r.query,
        kind: r.kind,
        cls: r.cls || null, // 1-8c: negative class (near-miss/confusable/…)
        source: r.source,
        error: r.error || null,
        pass: this.outcomeOf(r),
        failLabel: this.failLabelOf(r)
      }));
      // 1-8g: Run All probes every row against the live corpus — merge the
      // verdicts into the suite rows so the Corpus column fills for the
      // whole suite, not only for one-at-a-time click-tests.
      const probes = new Map(results.filter((r) => r.probe).map((r) => [r.query, r.probe]));
      for (const arr of [this.suite.payload.positive, this.suite.payload.negative]) {
        for (const r of arr || []) {
          const p = r && probes.get(r.query);
          if (p) r.lastProbe = p;
        }
      }
      this.batchAdvice = null; // a fresh run makes the previous advice stale
      this.checkTripwire(baseline, this.lastRunSummary);
      this.refreshRuns();
    },
    /** 1-8c: batch advice for the latest run of the current suite — every
     * failing negative, ONE LLM call (the anti-treadmill affordance). */
    async onExplainFailures() {
      if (!this.suite || this.busy !== null) return;
      this.busy = 'explain-failures';
      this.error = '';
      const res = await this.$store.dispatch('okf/headSuiteExplainFailures', {
        repoId: this.repo.repo_id,
        suiteKey: this.suite.suite_key
      });
      this.busy = null;
      if (!res.ok) {
        this.error = res.message || this.translate('okf.headTest.error.explain', 'Explain failed');
        return;
      }
      this.batchAdvice = res.result;
    },
    /** 1-8c: batch fix loop — rebuild the head from the just-saved tags,
     * then re-run the SAME suite against the fresh head. */
    async onRebuildSuiteRerun() {
      if (this.busy !== null) return;
      if (!this.suite) {
        this.error = this.translate('okf.headTest.error.noSuite', 'Generate a suite first, then rebuild + re-run.');
        return;
      }
      this.busy = 'rebuild-rerun';
      this.error = '';
      const reb = await this.$store.dispatch('okf/headRebuild', { repoId: this.repo.repo_id });
      this.busy = null;
      if (!reb.ok) {
        this.error = reb.message || this.translate('okf.headTest.error.rebuild', 'Head rebuild failed');
        return;
      }
      this.$emit('changed', { head: reb.result });
      await this.onRunSuite();
    },
    /** 1-8c: counts inputs hold strings (DsInput emits target.value) —
     * coerce to int; undefined lets the server apply its own default. */
    intOf(v) {
      // 0 is a REQUEST (a positives-only suite) — only empty/garbage is
      // undefined (which lets the server apply its fallback).
      const n = parseInt(v, 10);
      return Number.isFinite(n) && n >= 0 ? n : undefined;
    },
    /** 1-8c: translated label for a negative class token (near-miss |
     * confusable | forbidden | off-domain | meta). */
    classLabel(cls) {
      const keys = {
        'near-miss': ['okf.headTest.cls.nearMiss', 'Near miss'],
        confusable: ['okf.headTest.cls.confusable', 'Confusable'],
        forbidden: ['okf.headTest.cls.forbidden', 'Forbidden'],
        'off-domain': ['okf.headTest.cls.offDomain', 'Off-domain'],
        meta: ['okf.headTest.cls.meta', 'Meta']
      };
      const hit = keys[cls];
      return hit ? this.translate(hit[0], hit[1]) : cls;
    },
    /** 1-8c: pill variant per class — near-miss stands apart (accent) so
     * the new repo-vocabulary class is distinguishable at a glance. */
    classVariant(cls) {
      return (
        {
          'near-miss': 'accent',
          confusable: 'warning',
          forbidden: 'warning',
          'off-domain': 'neutral',
          meta: 'info'
        }[cls] || 'warning'
      );
    },
    /** Pass semantics (server-identical): positive passes when the repo
     * wins the head leg; negative passes when it does NOT — but only if
     * competitors exist (a one-repo race is not a real test → null). */
    outcomeOf(r) {
      if (r.error) return false;
      if (r.kind === 'positive') return !!r.under_test_wins_head;
      // 1-8a: gate-era results know head_claimed — a negative passes when
      // the head does NOT claim the query (works in a one-repo universe).
      // Legacy results (head_claimed null) keep the sibling-gated rank rule.
      if (r.head_claimed !== null && r.head_claimed !== undefined) return r.head_claimed === false;
      if (!r.sibling_count) return null;
      return !r.under_test_wins_head;
    },
    failLabelOf(r) {
      if (r.error) return r.error;
      return this.translate('okf.headTest.suites.fail', 'fail');
    },
    async onAddQuery() {
      if (!this.suite || !this.manualQuery.trim()) return;
      this.busy = 'add';
      this.error = '';
      const res = await this.$store.dispatch('okf/headSuiteAddQueries', {
        repoId: this.repo.repo_id,
        suiteKey: this.suite.suite_key,
        queries: [{ query: this.manualQuery.trim(), kind: this.manualKind, reason: 'curator probe' }]
      });
      this.busy = null;
      if (!res.ok) {
        this.error = res.message || this.translate('okf.headTest.error.add', 'Could not add the query');
        return;
      }
      this.suite = res.result;
      this.manualQuery = '';
    },
    async refreshRuns() {
      const res = await this.$store.dispatch('okf/headSuiteListRuns', { repoId: this.repo.repo_id, kind: 'run' });
      if (res.ok) this.runs = res.runs;
      // 1-8f: the SAVED SUITES list (kind 'suite') — the load targets for
      // "saved, modified and rerun". Cheap read; kept beside the runs
      // refresh so both stay current after generate/run/edit.
      const suites = await this.$store.dispatch('okf/headSuiteListRuns', { repoId: this.repo.repo_id, kind: 'suite' });
      if (suites.ok) this.savedSuites = suites.runs;
    },
    /** 1-8f: rename a saved suite (inline in the Saved-suites table). */
    async onRenameSuite(suite, value) {
      const name = String(value || '').trim();
      if (!name || name === (suite.name || '') || this.busy !== null) return;
      this.busy = 'suite-edit';
      this.error = '';
      const res = await this.$store.dispatch('okf/headSuiteRename', {
        repoId: this.repo.repo_id,
        suiteKey: suite._key,
        name
      });
      this.busy = null;
      if (!res || !res.ok) {
        this.error =
          (res && res.message) || this.translate('okf.headTest.error.suiteRename', 'Could not rename the suite');
        return;
      }
      // Adopt the returned doc and refresh the saved list (order can shift
      // when the name changes — keep it simple and re-read).
      const saved = this.savedSuites.find((s) => s._key === suite._key);
      if (saved) saved.name = res.result.name;
    },
    /** 1-8g: delete a saved suite (and its run docs) from the list. The
     * currently-loaded suite may be deleted too — the local copy clears. */
    async onDeleteSuite(s) {
      if (this.busy !== null || !s) return;
      this.busy = 'suite-delete';
      this.error = '';
      const res = await this.$store.dispatch('okf/headSuiteDelete', {
        repoId: this.repo.repo_id,
        suiteKey: s._key
      });
      this.busy = null;
      if (!res || !res.ok) {
        this.error =
          (res && res.message) || this.translate('okf.headTest.error.suiteDelete', 'Could not delete the suite');
        return;
      }
      this.savedSuites = this.savedSuites.filter((x) => x._key !== s._key);
      if (this.suite && this.suite.suite_key === s._key) {
        this.suite = null;
        this.lastRunSummary = null;
        this.lastRunSuiteKey = null;
      }
    },
    /** 1-8g: the click-test — run THIS row's query against the live corpus
     * (embed → top-K → the pipeline's reranker → coverage verdict). The
     * server persists the probe on every matching row; the local copy is
     * patched from the response. */
    async onProbeRow(row) {
      if (this.busy !== null || !row || !this.suite) return;
      this.busy = 'probe';
      this.error = '';
      const res = await this.$store.dispatch('okf/headSuiteProbe', {
        repoId: this.repo.repo_id,
        suiteKey: this.suite.suite_key,
        query: row.query
      });
      this.busy = null;
      if (!res || !res.ok) {
        this.error = (res && res.message) || this.translate('okf.headTest.error.probe', 'Corpus test failed');
        return;
      }
      const probe = {
        at: res.result.at,
        docs: res.result.docs,
        top_score: res.result.top_score,
        verdict: res.result.verdict,
        note: res.result.note
      };
      for (const arr of [this.suite.payload.positive, this.suite.payload.negative]) {
        for (const r of arr || []) {
          if (r && r.query === row.query) r.lastProbe = probe;
        }
      }
      // 1-8g: popup the summary panel with ALL statistics for this query.
      this.probePanel = res.result;
      this.$nextTick(() => {
        const el = this.$refs.probePanel;
        if (el && el.scrollIntoView) el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      });
    },
    /** 1-8g: hover text for a probe chip — score + doc count + when. */
    probeTip(p) {
      const score = p.top_score != null ? `top=${p.top_score}` : 'no score';
      return `${score} · ${p.docs} docs · ${p.at || ''}${p.note ? ' · ' + p.note : ''}`;
    },
    /** 1-8f: load a saved suite back into the Lab — its rows become the
     * editable current suite (flip kinds, remove rows, re-run). */
    async onLoadSuite(suiteKey) {
      if (this.busy !== null) return;
      this.busy = 'suite-load';
      this.error = '';
      const res = await this.$store.dispatch('okf/headSuiteGet', { repoId: this.repo.repo_id, suiteKey });
      this.busy = null;
      if (!res || !res.ok || !res.result) {
        this.error = (res && res.message) || this.translate('okf.headTest.error.suiteLoad', 'Could not load the suite');
        return;
      }
      this.suite = res.result;
      this.lastRunSummary = null;
      this.lastRunSummaryRows = [];
      this.batchAdvice = null;
      this.tripwire = null;
      this.advisor = null;
      this.advisorExtraRemove = [];
      this.advisorNarrowPairs = [];
      this.lastRunSuiteKey = this.suite ? this.suite.suite_key : null;
    },
    /** 1-8f: flip a row's kind (positive ↔ negative) — THE mislabel fix.
     * The server searches both arrays (a mislabeled row sits in the wrong
     * one) and returns the updated suite, which becomes the new local copy. */
    async onFlipRow(row) {
      if (this.busy !== null || !this.suite) return;
      this.busy = 'suite-edit';
      this.error = '';
      const res = await this.$store.dispatch('okf/headSuiteUpdateRows', {
        repoId: this.repo.repo_id,
        suiteKey: this.suite.suite_key,
        payload: {
          updates: [
            {
              match: { query: row.query, kind: row.kind },
              set: { kind: row.kind === 'positive' ? 'negative' : 'positive' }
            }
          ]
        }
      });
      this.busy = null;
      if (!res || !res.ok) {
        this.error =
          (res && res.message) || this.translate('okf.headTest.error.suiteUpdate', 'Could not update the suite');
        return;
      }
      this.suite = res.result;
    },
    /** 1-8f: remove a row from the suite entirely. */
    async onDeleteRow(row) {
      if (this.busy !== null || !this.suite) return;
      this.busy = 'suite-edit';
      this.error = '';
      const res = await this.$store.dispatch('okf/headSuiteUpdateRows', {
        repoId: this.repo.repo_id,
        suiteKey: this.suite.suite_key,
        payload: { removes: [{ query: row.query, kind: row.kind }] }
      });
      this.busy = null;
      if (!res || !res.ok) {
        this.error =
          (res && res.message) || this.translate('okf.headTest.error.suiteUpdate', 'Could not update the suite');
        return;
      }
      this.suite = res.result;
    },
    onDialogAction(key) {
      if (key === 'close') this.$emit('close');
      if (key === 'unpublish') this.$emit('request-unpublish', this.repo);
    }
  }
};
</script>

<style scoped>
.okf-headtest__repo-line {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--space-sm);
  margin: 0 0 var(--space-md);
}
.okf-headtest__meta-inline {
  display: inline-flex;
  gap: var(--space-xs);
  align-items: center;
}
.okf-headtest__tabs {
  min-height: 320px;
}
.okf-headtest__pane {
  padding-top: var(--space-sm);
  display: flex;
  flex-direction: column;
  gap: var(--space-sm);
}
.okf-headtest__field {
  display: flex;
  align-items: baseline;
  gap: var(--space-sm);
}
.okf-headtest__field-label {
  min-width: 90px;
  font-weight: 600;
  font-size: var(--text-sm);
  color: var(--muted);
}
.okf-headtest__chips {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-xs);
}
.okf-headtest__head-meta {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-md);
  font-size: var(--text-sm);
  color: var(--muted);
}
.okf-headtest__stale-note {
  width: 100%;
  color: var(--warning);
}
.okf-headtest__pane-actions {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
}
.okf-headtest__query-row {
  display: flex;
  gap: var(--space-sm);
}
.okf-headtest__query-input {
  flex: 1;
}
.okf-headtest__adversarial {
  display: flex;
  align-items: center;
  gap: var(--space-xs);
  font-size: var(--text-sm);
  color: var(--muted);
}
.okf-headtest__verdict {
  padding: var(--space-sm) var(--space-md);
  border-radius: var(--radius-sm);
  font-weight: 600;
  font-size: var(--text-sm);
}
.okf-headtest__verdict--pass {
  background: color-mix(in oklab, var(--success) 14%, transparent);
  color: var(--success);
}
.okf-headtest__verdict--fail {
  background: color-mix(in oklab, var(--danger) 14%, transparent);
  color: var(--danger);
}
.okf-headtest__scores {
  width: 100%;
  border-collapse: collapse;
  font-size: var(--text-sm);
}
.okf-headtest__scores th {
  text-align: left;
  color: var(--muted);
  font-weight: 600;
  padding: var(--space-xs) var(--space-sm);
  border-bottom: 1px solid var(--border);
}
.okf-headtest__scores td {
  padding: var(--space-xs) var(--space-sm);
  border-bottom: 1px solid var(--border);
}
.okf-headtest__row-under-test {
  background: color-mix(in oklab, var(--accent) 8%, transparent);
}
/* 1-8f: per-row edit controls (flip kind / remove row). */
.okf-headtest__name-input {
  flex: 1 1 240px;
  min-width: 200px;
  border: 1px solid var(--border);
  background: transparent;
  color: var(--fg);
  border-radius: var(--radius-sm, 4px);
  padding: var(--space-2xs, 2px) var(--space-xs);
  font-size: var(--text-sm);
}
.okf-headtest__name-input--compact {
  min-width: 140px;
  width: 160px;
}
.okf-headtest__row-actions {
  white-space: nowrap;
}
.okf-headtest__row-btn {
  border: 1px solid var(--border);
  background: transparent;
  color: var(--muted);
  border-radius: var(--radius-sm, 4px);
  min-width: var(--space-lg);
  padding: 0 var(--space-xs);
  margin-left: var(--space-2xs, 2px);
  cursor: pointer;
  font-size: var(--text-sm);
  line-height: 1.4;
}
.okf-headtest__row-btn:hover:not(:disabled) {
  color: var(--fg);
  border-color: var(--fg);
}
.okf-headtest__row-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.okf-headtest__row-btn--danger:hover:not(:disabled) {
  color: var(--danger);
  border-color: var(--danger);
}
.okf-headtest__under-mark {
  color: var(--accent);
  margin-left: var(--space-xs);
}
.okf-headtest__bar {
  display: inline-block;
  width: 90px;
  height: 6px;
  border-radius: 3px;
  background: var(--bg);
  margin-right: var(--space-xs);
  vertical-align: middle;
  overflow: hidden;
}
.okf-headtest__bar span {
  display: block;
  height: 100%;
  background: var(--accent);
}
.okf-headtest__embedded,
.okf-headtest__provenance {
  font-size: var(--text-sm);
  color: var(--muted);
  margin: 0;
}
.okf-headtest__claim-why {
  margin-left: var(--space-xs);
  font-size: var(--text-sm);
  color: var(--muted);
}
.okf-headtest__gate {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-sm);
  padding: var(--space-xs) var(--space-sm);
  font-size: var(--text-sm);
  background: var(--bg);
  border-radius: var(--radius-sm);
}
.okf-headtest__gate-title {
  font-weight: 600;
  color: var(--muted);
}
.okf-headtest__gate-check {
  display: inline-flex;
  align-items: center;
  gap: var(--space-xs);
}
.okf-headtest__gate-name {
  color: var(--muted);
}
.okf-headtest__teach {
  padding: var(--space-sm) var(--space-md);
  border-radius: var(--radius-sm);
  font-size: var(--text-sm);
}
.okf-headtest__teach-title {
  display: block;
  font-weight: 600;
  margin-bottom: var(--space-xs);
}
.okf-headtest__teach-text {
  margin: 0;
}
.okf-headtest__teach--veto {
  background: color-mix(in oklab, var(--warning) 14%, transparent);
  color: var(--warning);
}
.okf-headtest__teach--floor {
  background: color-mix(in oklab, var(--info) 14%, transparent);
  color: var(--info);
}
.okf-headtest__suite-title {
  margin: var(--space-sm) 0 0;
  font-size: var(--text-sm);
  font-weight: 600;
}
/* 1-8g — the click-test summary panel (all statistics for one query). */
.okf-headtest__probe-panel {
  margin: var(--space-sm) 0;
  padding: var(--space-sm);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  background: var(--surface-raised);
}
.okf-headtest__probe-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-sm);
}
.okf-headtest__probe-query {
  margin: var(--space-xs) 0;
  word-break: break-word;
}
.okf-headtest__probe-query code {
  font-size: var(--text-sm);
}
.okf-headtest__probe-meta {
  display: block;
  margin-top: var(--space-2xs);
  color: var(--text-muted);
  font-size: var(--text-xs);
}
.okf-headtest__probe-legs {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-md);
  margin: var(--space-xs) 0;
}
.okf-headtest__probe-leg {
  display: flex;
  align-items: center;
  gap: var(--space-xs);
  font-size: var(--text-sm);
}
.okf-headtest__probe-reason {
  margin: var(--space-xs) 0;
  font-size: var(--text-sm);
  color: var(--text-secondary);
}
.okf-headtest__probe-files {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-xs);
  margin: var(--space-xs) 0;
  font-size: var(--text-sm);
}
.okf-headtest__probe-preview {
  max-width: 30rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text-secondary);
  font-size: var(--text-xs);
}
.okf-headtest__summary {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-md);
  font-size: var(--text-sm);
  padding: var(--space-sm);
  background: var(--bg);
  border-radius: var(--radius-sm);
}
.okf-headtest__steal {
  color: var(--danger);
}
.okf-headtest__counts {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-sm);
  align-items: flex-end;
}
.okf-headtest__count {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.okf-headtest__count-label {
  font-size: var(--text-xs);
  color: var(--muted);
}
.okf-headtest__count-input {
  width: 76px;
}
.okf-headtest__counts-hint {
  margin: 0;
  font-size: var(--text-xs);
  color: var(--muted);
}
/* 1-8c: the claim-side teach panel + the suites batch-advice panel —
   neutral surface so the verdict banner keeps the pass/fail color. */
.okf-headtest__suggestion {
  padding: var(--space-sm) var(--space-md);
  border-radius: var(--radius-sm);
  background: var(--bg);
  display: flex;
  flex-direction: column;
  gap: var(--space-sm);
}
.okf-headtest__add-chip {
  cursor: pointer;
}
.okf-headtest__failing {
  margin: 0;
  padding-left: var(--space-md);
  font-size: var(--text-sm);
  display: flex;
  flex-direction: column;
  gap: var(--space-xs);
}
.okf-headtest__failing li {
  display: flex;
  align-items: center;
  gap: var(--space-xs);
}
/* 1-8d: the guardrail's rejected proposals — muted, non-interactive
   chips; the reason rides on the title attribute. */
.okf-headtest__rejected {
  display: flex;
  flex-direction: column;
  gap: var(--space-xs);
}
.okf-headtest__rejected-chip {
  opacity: 0.55;
  cursor: default;
}
/* 1-8f: the rejection reason rides INLINE (naming the offending own tag)
   — buried tooltips read as a wall of unexplained ✕ (David, 2026-10-09). */
.okf-headtest__rejected-reason {
  font-weight: 400;
  text-transform: none;
  letter-spacing: 0;
}
/* 1-8d: the removal chips — the inverse affordance (danger variant,
   clickable like the add chips). */
.okf-headtest__removals {
  display: flex;
  flex-direction: column;
  gap: var(--space-xs);
}
.okf-headtest__remove-chip {
  cursor: pointer;
}
.okf-headtest__blocked-title {
  margin: var(--space-xs) 0 0;
  font-weight: 600;
}
.okf-headtest__positive-fail {
  display: flex;
  flex-direction: column;
  gap: var(--space-xs);
}
/* 1-8d: the positive-regression tripwire — red tint, one clear exit
   (the Revert panel). */
.okf-headtest__tripwire {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--space-sm);
  padding: var(--space-sm) var(--space-md);
  border-radius: var(--radius-sm);
  font-size: var(--text-sm);
  font-weight: 600;
  background: color-mix(in oklab, var(--danger) 14%, transparent);
  color: var(--danger);
}
.okf-headtest__stale-suite {
  font-size: var(--text-xs);
  color: var(--warning);
}
/* 1-8d: the Revert-tags panel — same neutral surface as the advice
   panels; the highlight ring marks the tripwire's jump target. */
.okf-headtest__revert {
  padding: var(--space-sm) var(--space-md);
  border-radius: var(--radius-sm);
  background: var(--bg);
  display: flex;
  flex-direction: column;
  gap: var(--space-sm);
}
.okf-headtest__revert--highlight {
  outline: 2px solid var(--accent);
}
.okf-headtest__revert-list {
  list-style: none;
  margin: 0;
  padding: 0;
  font-size: var(--text-sm);
  display: flex;
  flex-direction: column;
  gap: var(--space-xs);
}
.okf-headtest__revert-list li {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--space-sm);
}
.okf-headtest__revert-actor {
  color: var(--muted);
}
.okf-headtest__add-query {
  display: flex;
  gap: var(--space-sm);
  align-items: center;
}
.okf-headtest__kind-select {
  width: 180px;
}
.okf-headtest__empty,
.okf-headtest__empty-pane {
  color: var(--muted);
  font-size: var(--text-sm);
}
.okf-headtest__busy {
  align-self: flex-start;
}
.okf-headtest__error {
  color: var(--danger);
  font-size: var(--text-sm);
  margin: 0;
}
</style>
