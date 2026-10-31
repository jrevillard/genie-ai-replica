<template>
  <div class="okf-ragas">
    <!-- PANE HEAD — the renamed surface (David, 2026-10-17): the ⓘ glosses
         RAGAS in plain language and links to ragas.io for deeper reading;
         the Help toggle expands the every-control reference below it
         (David, 2026-10-18). -->
    <div class="okf-ragas__pane-head">
      <h4 class="okf-headtest__pane-title">
        {{ translate('okf.ragas.paneTitle', 'RAGAS Benchmarks') }}
      </h4>
      <DsInfoTip
        :text="
          translate(
            'okf.ragas.about',
            'RAGAS scores how well the assistant retrieves and answers — faithfulness, context precision and recall, answer relevancy and more. Run a benchmark suite to measure the repository as a knowledge base.'
          )
        "
        :label="translate('okf.ragas.aboutLabel', 'What is RAGAS?')"
        href="https://www.ragas.io/"
        :link-label="translate('okf.ragas.aboutLink', 'Read more at ragas.io')"
      />
      <button type="button" class="okf-ragas__help-toggle" @click="showGuide = true">
        {{ translate('okf.ragas.guide.open', 'Guide') }}
      </button>
      <button type="button" class="okf-ragas__help-toggle" @click="showHelp = !showHelp">
        {{ showHelp ? translate('okf.ragas.help.hide', 'Hide help') : translate('okf.ragas.help.show', 'Help') }}
      </button>
    </div>
    <!-- GUIDE — the operator playbook (generate → curate → run → models →
         read). Separate from the Help glossary above, which answers "what
         is this control?"; the guide answers "what should I do with it?".
         David, 2026-10-23. -->
    <RagasGuideDialog :visible="showGuide" @close="showGuide = false" />
    <!-- HELP — every field and control on the screen, in one place. -->
    <div v-if="showHelp" class="okf-ragas__section okf-ragas__help">
      <dl class="okf-ragas__help-list">
        <div v-for="item in helpItems" :key="item.key" class="okf-ragas__help-row">
          <dt>{{ item.title }}</dt>
          <dd>{{ item.text }}</dd>
        </div>
      </dl>
      <a class="okf-ragas__help-more" href="https://www.ragas.io/" target="_blank" rel="noopener noreferrer">{{
        translate('okf.ragas.help.more', 'Read more at ragas.io')
      }}</a>
    </div>
    <!-- GENERATION + INTERCHANGE -->
    <div class="okf-ragas__section">
      <h4 class="okf-headtest__pane-title">
        {{ translate('okf.ragas.generate.title', 'Generate a benchmark suite') }}
      </h4>
      <p class="okf-ragas__hint">
        {{
          translate(
            'okf.ragas.generate.hint',
            'Synthesizes questions with expected outputs from the selected repositories — one or more, the current repo alone or with related repos.'
          )
        }}
      </p>
      <div v-if="!readOnly" class="okf-ragas__repos">
        <label v-for="r in repoChoices" :key="r.repo_id" class="okf-ragas__repo-row">
          <input
            v-model="selectedRepoIds"
            type="checkbox"
            :value="r.repo_id"
            :disabled="r.repo_id === (repo && repo.repo_id) || generateBusy"
          />
          <span>{{ r.name }}</span>
          <DsPill v-if="r.repo_id === (repo && repo.repo_id)" variant="accent">{{
            translate('okf.ragas.current', 'current')
          }}</DsPill>
        </label>
      </div>
      <div class="okf-ragas__dims">
        <label class="okf-ragas__dim">
          <span>{{ translate('okf.ragas.generate.size', 'Questions') }}</span>
          <input v-model.number="genSize" type="number" min="1" max="200" :disabled="generateBusy" />
        </label>
        <label class="okf-ragas__dim">
          <span>{{ translate('okf.ragas.generate.single', 'Single-hop %') }}</span>
          <input v-model.number="distSingle" type="number" min="0" max="100" :disabled="generateBusy" />
        </label>
        <label class="okf-ragas__dim">
          <span>{{ translate('okf.ragas.generate.multiAbstract', 'Multi-hop (abstract) %') }}</span>
          <input v-model.number="distAbstract" type="number" min="0" max="100" :disabled="generateBusy" />
        </label>
        <label class="okf-ragas__dim">
          <span>{{ translate('okf.ragas.generate.multiSpecific', 'Multi-hop (specific) %') }}</span>
          <input v-model.number="distSpecific" type="number" min="0" max="100" :disabled="generateBusy" />
        </label>
        <label class="okf-ragas__dim">
          <span>{{ translate('okf.ragas.generate.personas', 'Personas') }}</span>
          <input v-model.number="genPersonas" type="number" min="1" max="10" :disabled="generateBusy" />
        </label>
      </div>
      <!-- 8-7 model configs: the model this GENERATION runs with — an explicit
           pick beats the deployment's active configuration; default = env.
           David 2026-10-25: this row used to be rendered ONLY when the named
           configuration list was non-empty, and the list 403'd for anyone
           without tools-admin — so for a curator the model selection was
           GONE, including the .env default. It renders whenever there is a
           judge to pick, and the env judge is always one of the options.

           David 2026-10-25 (later, live): generating a suite and SCORING it
           are SEPARATE operations with separate models — the generation
           synthesizes questions, the judge scores answers. They shared ONE
           v-model, so the panel could not express "generate with A, score
           with B", and a pick made for one silently governed the other.
           This picker is now the GENERATION model; the run's judge has its
           own picker below, with its own memory. -->
      <div v-if="hasJudgeChoice" class="okf-ragas__judge-row">
        <label class="okf-ragas__dim">
          <span>{{ translate('okf.ragas.generate.config', 'Generation model configuration') }}</span>
          <select v-model="genConfigKey" :disabled="generateBusy" @change="onGenConfigChange">
            <option value="">
              {{ defaultJudgeLabel }}
            </option>
            <option :value="envPickKey">{{ envJudgeLabel }}</option>
            <option v-for="c in modelConfigs" :key="c._key" :value="c._key">
              {{ c.name }}{{ c.active ? ' ★' : '' }}
            </option>
          </select>
        </label>
        <label v-if="genConfigKey !== envPickKey" class="okf-ragas__dim">
          <span>{{ translate('okf.ragas.generate.model', 'Model') }}</span>
          <select v-if="genModels.length" v-model="genModel" :disabled="generateBusy">
            <option value="">{{ translate('okf.ragas.generate.modelPick', 'Configuration default') }}</option>
            <option v-for="m in genModels" :key="m" :value="m">{{ m }}</option>
          </select>
          <input
            v-else
            v-model="genModel"
            type="text"
            :placeholder="translate('okf.ragas.generate.modelDefault', 'configuration default')"
            :disabled="generateBusy"
          />
        </label>
        <DsInfoTip
          :label="translate('okf.ragas.generate.config', 'Generation model configuration')"
          :text="
            translate(
              'okf.ragas.generate.note',
              'The model that synthesizes the suite — it builds the knowledge graph and writes the questions. It does NOT score the benchmark: that is the separate judge picker in the Run section. An active configuration (★, Models tab) applies automatically; picking one here overrides it for this operation only.'
            )
          "
        />
      </div>
      <div class="okf-ragas__actions">
        <DsButton
          v-if="!readOnly"
          variant="primary"
          small
          :disabled="generateBusy || !selectedRepoIds.length"
          @click="onGenerate"
        >
          {{ translate('okf.ragas.generate.button', 'Generate') }}
        </DsButton>
        <DsSpinner v-if="generateBusy" size="sm">
          {{ translate('okf.ragas.generate.working', 'Generating — this takes minutes…') }}
        </DsSpinner>
        <span v-if="generateBusy && genProgressLabel" class="okf-ragas__muted">{{ genProgressLabel }}</span>
        <DsButton
          v-if="generateBusy && generatingKey"
          variant="secondary"
          small
          :disabled="cancelBusy"
          @click="onCancelGenerate"
        >
          {{ translate('okf.ragas.generate.cancel', 'Cancel') }}
        </DsButton>
        <DsSpinner v-if="cancelBusy" size="sm">
          {{ translate('okf.ragas.generate.cancelling', 'Cancelling…') }}
        </DsSpinner>
        <label v-if="!readOnly" class="okf-ragas__file-label">
          <input type="file" accept=".xlsx" :disabled="importBusy" @change="onImportFile" />
          <DsButton variant="secondary" small tag="span" :disabled="importBusy">
            {{ translate('okf.ragas.import.button', 'Import suite (.xlsx)') }}
          </DsButton>
        </label>
        <DsSpinner v-if="importBusy" size="sm">{{ translate('okf.ragas.import.working', 'Importing…') }}</DsSpinner>
      </div>
      <div v-if="generateBusy && genProgress" class="okf-ragas__progress">
        <!-- count-less moments animate instead of sitting at a dead zero —
             honest "working, no counts yet" (2026-10-18). Since 2026-10-20
             the KG phase also streams the ACTIVE transform's own bar
             (step, x/y, ETA, elapsed) — no more one flashing bar for the
             whole (longest) phase. -->
        <!-- A zero count is "no count yet", not a dead determinate bar: the
             bar animates until the first batch completes (2026-10-21). -->
        <DsProgress :value="genProgressPct" :indeterminate="!genProgress.total || !genProgress.done" />
        <span v-if="genProgressDetail" class="okf-ragas__muted okf-ragas__progress-detail">
          {{ genProgressDetail }}
        </span>
        <!-- The model this run is ACTUALLY using, by name (live 2026-10-21:
             the run went to a personal MiniMax key while the panel said
             "deployment default" — the active GLM config. The dropdown is
             the selection; this is the truth. -->
        <span v-if="effectiveGenerationLabel" class="okf-ragas__muted okf-ragas__progress-detail">
          {{ effectiveGenerationLabel }}
        </span>
      </div>
    </div>

    <p v-if="error" class="okf-headtest__error">{{ error }}</p>

    <!-- CURRENT SUITE -->
    <div v-if="suite" class="okf-ragas__section">
      <div class="okf-ragas__suite-head">
        <input
          class="okf-headtest__name-input okf-headtest__name-input--compact"
          type="text"
          :value="suite.name || ''"
          :placeholder="translate('okf.ragas.suite.namePlaceholder', 'Benchmark name (optional)')"
          :maxlength="80"
          :disabled="readOnly || busy !== null"
          @change="onRename($event.target.value)"
        />
        <code>{{ suite.suite_key }}</code>
        <DsPill variant="accent">RAGAS</DsPill>
        <span v-if="suite.payload && suite.payload.generator" class="okf-ragas__muted">{{
          suite.payload.generator
        }}</span>
        <!-- Coverage honesty (2026-10-21): a corpus capped by the chunk
             budget is a property of the SUITE, shown where the suite lives —
             "grounded in 1600 of 5590 chunks" — never a silent slice. -->
        <span v-if="corpusCoverageNote" class="okf-ragas__muted">{{ corpusCoverageNote }}</span>
        <!-- The questions that were LOST (live 2026-10-21: 35 of 100 were
             dropped to upstream 429s and the panel said nothing — the user
             could not tell a short suite from a throttled one). -->
        <span v-if="droppedNote" class="okf-ragas__muted okf-ragas__dropped-note">{{ droppedNote }}</span>
      </div>

      <!-- metrics selection -->
      <div class="okf-ragas__metrics">
        <span class="okf-ragas__muted">{{ translate('okf.ragas.metrics.label', 'Metrics:') }}</span>
        <label v-for="m in metricChoices" :key="m.key" class="okf-ragas__metric">
          <input
            v-model="selectedMetrics"
            type="checkbox"
            :value="m.key"
            :disabled="m.default || readOnly || runBusy"
            @change="metricsTouched = true"
          />
          <span>{{ m.label }}</span>
        </label>
        <!-- 8-7: the run's scoring judge — same shared pick as generation.
             Same rule as the generation row (David 2026-10-25): the picker
             must exist whenever a judge can be chosen, not only when the
             named-configuration list happens to be non-empty. -->
        <label v-if="hasJudgeChoice" class="okf-ragas__metric okf-ragas__judge-inline">
          <span class="okf-ragas__dim">{{ translate('okf.ragas.run.judge', 'Judge model configuration') }}</span>
          <select v-model="judgeConfigKey" :disabled="runBusy" @change="onJudgeConfigChange">
            <option value="">
              {{ defaultJudgeLabel }}
            </option>
            <option :value="envPickKey">{{ envJudgeLabel }}</option>
            <option v-for="c in modelConfigs" :key="c._key" :value="c._key">
              {{ c.name }}{{ c.active ? ' ★' : '' }}
            </option>
          </select>
          <select
            v-if="judgeConfigKey !== envPickKey && judgeModels.length"
            v-model="judgeModel"
            :disabled="runBusy"
            class="okf-ragas__judge-model"
          >
            <option value="">{{ translate('okf.ragas.generate.modelPick', 'Configuration default') }}</option>
            <option v-for="m in judgeModels" :key="m" :value="m">{{ m }}</option>
          </select>
        </label>
      </div>

      <div class="okf-ragas__actions">
        <DsButton v-if="!readOnly" variant="primary" small :disabled="runBusy" @click="onRun">
          {{ translate('okf.ragas.run.button', 'Run benchmark') }}
        </DsButton>
        <DsButton variant="secondary" small :disabled="exportBusy" @click="onExportSuite">
          {{ translate('okf.ragas.export.suite', 'Export suite (.xlsx)') }}
        </DsButton>
        <DsButton v-if="!readOnly" variant="secondary" small :disabled="runBusy" @click="onAddQuery">
          {{ translate('okf.ragas.suite.add', 'Add question') }}
        </DsButton>
        <DsSpinner v-if="runBusy" size="sm">
          {{ runProgressLabel }}
        </DsSpinner>
        <DsButton
          v-if="runBusy && runningRunKey"
          variant="secondary"
          small
          :disabled="runCancelBusy"
          @click="onCancelRun"
        >
          {{ translate('okf.ragas.run.cancel', 'Cancel run') }}
        </DsButton>
      </div>
      <div v-if="runProgress" class="okf-ragas__progress">
        <DsProgress :value="progressPct" />
        <!-- The judge this run is ACTUALLY scoring with — the picker shows the
             selection, this is the truth (David, 2026-10-25: the two must
             never disagree). -->
        <span v-if="effectiveJudgeLabel" class="okf-ragas__muted okf-ragas__progress-detail">
          {{ effectiveJudgeLabel }}
        </span>
      </div>

      <!-- ENTRIES TABLE (management parity) -->
      <table class="okf-headtest__scores okf-ragas__entries">
        <thead>
          <tr>
            <th>#</th>
            <th>{{ translate('okf.ragas.col.query', 'Question') }}</th>
            <th>{{ translate('okf.ragas.col.reference', 'Expected answer') }}</th>
            <th>{{ translate('okf.ragas.col.passages', 'Passages') }}</th>
            <th>{{ translate('okf.ragas.col.scope', 'Scope') }}</th>
            <th v-if="!readOnly"></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="e in entries" :key="e.id">
            <td>
              <code>{{ e.id }}</code>
            </td>
            <td>
              <textarea
                class="okf-ragas__query-input"
                rows="2"
                :value="e.query"
                :disabled="readOnly || busy !== null"
                @change="onEditEntry(e, 'query', $event.target.value)"
              ></textarea>
            </td>
            <td>
              <textarea
                class="okf-ragas__query-input"
                rows="2"
                :value="e.reference_answer"
                :disabled="readOnly || busy !== null"
                @change="onEditEntry(e, 'reference_answer', $event.target.value)"
              ></textarea>
            </td>
            <td>
              <span :title="passagesTitle(e)">{{ (e.reference_passages || []).length }}</span>
              <span v-if="runOutcome(e)" class="okf-ragas__muted">
                · {{ translate('okf.ragas.run.retrieved', 'retrieved') }} {{ runOutcome(e).retrieved }}</span
              >
            </td>
            <td>
              <DsPill :variant="e.oos ? 'warning' : 'success'">{{
                e.oos ? translate('okf.ragas.oos', 'out-of-scope') : translate('okf.ragas.inscope', 'in scope')
              }}</DsPill>
              <DsPill
                v-if="runOutcome(e)"
                :variant="runOutcome(e).ok ? 'success' : 'danger'"
                class="okf-ragas__run-chip"
              >
                {{ runOutcomeLabel(e) }}
              </DsPill>
            </td>
            <td v-if="!readOnly" class="okf-ragas__row-actions">
              <button
                type="button"
                class="okf-headtest__row-btn"
                :disabled="busy !== null"
                :title="translate('okf.ragas.suite.flipTip', 'Flip in-scope / out-of-scope')"
                @click="onFlipEntry(e)"
              >
                ⇄
              </button>
              <button
                type="button"
                class="okf-headtest__row-btn"
                :disabled="busy !== null || probeBusy === e.id"
                :title="translate('okf.ragas.suite.probeTip', 'Probe this question against the live corpus')"
                @click="onProbe(e)"
              >
                ▶
              </button>
              <span v-if="e.lastProbe" class="okf-ragas__muted" :title="(e.lastProbe && e.lastProbe.note) || ''">
                {{ e.lastProbe.verdict }}
                <em v-if="e.lastProbe.verdict === 'error' && e.lastProbe.note" class="okf-ragas__probe-note">{{
                  e.lastProbe.note
                }}</em>
              </span>
              <button
                type="button"
                class="okf-headtest__row-btn okf-headtest__row-btn--danger"
                :disabled="busy !== null"
                :title="translate('okf.ragas.suite.removeTip', 'Remove this question')"
                @click="onRemoveEntry(e)"
              >
                ×
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- RUN RESULTS -->
    <div v-if="runDoc && runDoc.payload" class="okf-ragas__section">
      <!-- INVALID RUN (2026-10-21 review C1/F2): a run whose answers errored,
           or whose judge measured only part of the suite, is NOT a benchmark
           result. It used to render as normal-looking zeros (or as an
           "all passing" pill) — the admin read a broken run as a failing
           system. The banner states the truth before any number is shown. -->
      <div v-if="invalidRunReason" class="okf-ragas__invalid-run">
        <strong>{{ translate('okf.ragas.results.invalidTitle', 'This run is not a valid measurement') }}</strong>
        <span>{{ invalidRunReason }}</span>
      </div>
      <div class="okf-ragas__suite-head">
        <h4 class="okf-headtest__pane-title">
          {{ translate('okf.ragas.results.title', 'Benchmark results') }}
        </h4>
        <DsPill
          v-if="runDoc.payload.summary"
          :variant="invalidRunReason ? 'danger' : runDoc.payload.summary.failing_count ? 'warning' : 'success'"
        >
          {{
            invalidRunReason
              ? translate('okf.ragas.results.invalidPill', 'invalid run')
              : runDoc.payload.summary.failing_count
                ? translate('okf.ragas.results.failing', '{n} failing').replace(
                    '{n}',
                    String(runDoc.payload.summary.failing_count)
                  )
                : translate('okf.ragas.results.allPass', 'all passing')
          }}
        </DsPill>
        <DsButton variant="secondary" small :disabled="pdfBusy" @click="downloadPdf">
          {{ translate('okf.ragas.results.pdf', 'Export PDF report') }}
        </DsButton>
        <DsButton variant="secondary" small :disabled="exportBusy" @click="onExportResults">
          {{ translate('okf.ragas.export.results', 'Export results (.xlsx)') }}
        </DsButton>
        <DsButton v-if="!readOnly" variant="secondary" small :disabled="explainBusy" @click="onExplain">
          {{ translate('okf.ragas.explain.button', 'Explain failures') }}
        </DsButton>
      </div>

      <!-- advisor hint — rows are failing and no advisor output is on screen;
           the admin should not have to discover the Explain button exists -->
      <div v-if="advisorHint" class="okf-ragas__advisor-hint">
        <span>{{ advisorHint }}</span>
        <DsButton v-if="!readOnly" small :disabled="explainBusy" @click="onExplain">
          {{ translate('okf.ragas.explain.button', 'Explain failures') }}
        </DsButton>
      </div>

      <!-- explain progress (2026-10-21): the advisor is ONE reasoning-judge
           call that can legitimately think for minutes — a dead button read
           as broken. Phase + failing count + elapsed clock from the job poll. -->
      <div v-if="explainBusy" class="okf-ragas__explain-progress">
        <DsSpinner size="sm">{{ explainProgressLabel }}</DsSpinner>
      </div>

      <!-- aggregate gauges — every metric chart carries its ⓘ RAGAS note -->
      <div v-if="aggregateRows.length" class="okf-ragas__gauges">
        <div v-for="g in aggregateRows" :key="g.key" class="okf-ragas__gauge">
          <apexchart
            :ref="'gauge-' + g.key"
            type="radialBar"
            height="160"
            :options="gaugeOptions(g)"
            :series="g.series"
          ></apexchart>
          <span class="okf-ragas__gauge-label">
            {{ g.label }}
            <DsInfoTip :label="g.label" :text="metricNote(g.key)" />
            <!-- The gauge is the run's score for this metric. If the judge
                 only scored it on some rows, the gauge covers only those. -->
            <span v-if="g.coverage" class="okf-ragas__muted" :title="g.coverageTitle">{{ g.coverage }}</span>
          </span>
        </div>
      </div>

      <!-- trend across runs -->
      <div v-if="trendSeries.length" class="okf-ragas__trend">
        <div class="okf-ragas__chart-head">
          <span class="okf-ragas__chart-title">{{
            translate('okf.ragas.results.trendTitle', 'Metric trend across runs')
          }}</span>
          <DsPill v-if="trendMixedJudges" variant="warning" class="okf-ragas__trend-warn">{{
            translate(
              'okf.ragas.results.trendMixedJudges',
              'Judges differ across these runs — compare within a judge segment, not across'
            )
          }}</DsPill>
          <DsInfoTip
            :label="translate('okf.ragas.results.trendTitle', 'Metric trend across runs')"
            :text="
              translate(
                'okf.ragas.results.trendNote',
                'Each line is one RAGAS metric’s suite mean per run, oldest to newest, and never crosses a judge boundary — each x-label names the judge that scored it. Judged answers are cached, so equal re-runs differ only where answers or retrieval changed.'
              )
            "
          />
        </div>
        <apexchart ref="trendChart" type="line" height="200" :options="trendOptions" :series="trendSeries"></apexchart>
      </div>

      <!-- status stacked bar -->
      <div v-if="statusSeries.length" class="okf-ragas__status">
        <div class="okf-ragas__chart-head">
          <span class="okf-ragas__chart-title">{{
            translate('okf.ragas.results.statusTitle', 'Per-question outcomes')
          }}</span>
          <DsInfoTip
            :label="translate('okf.ragas.results.statusTitle', 'Per-question outcomes')"
            :text="
              translate(
                'okf.ragas.results.statusNote',
                'Every in-scope question in this run, stacked by outcome: answered, failing (any selected metric below its threshold), abstained (the answerer declined), or errored (the pipeline failed that row). Out-of-scope controls are not counted — they are a control, not a result.'
              )
            "
          />
        </div>
        <apexchart type="bar" height="120" :options="statusOptions" :series="statusSeries"></apexchart>
      </div>

      <!-- per-query table — columns are drag-resizable (grip on each header,
           double-click a header to reset) and answers are selectable/copyable
           like the suite table's cells. The dialog auto-sizes to the content
           (DsModal size "auto"); past the viewport cap this wrapper scrolls
           instead of pushing the table off the side of the dialog. -->
      <div class="okf-ragas__table-scroll">
        <table class="okf-headtest__scores okf-ragas__results">
          <colgroup>
            <col v-for="c in resultCols" :key="c.key" :style="colStyle(c.key)" />
          </colgroup>
          <thead>
            <tr>
              <th
                v-for="c in resultCols"
                :key="c.key"
                class="okf-ragas__th-col"
                :title="colResizeTip"
                @dblclick="resetCol(c.key)"
              >
                {{ c.label }}
                <span
                  class="okf-ragas__col-grip"
                  :title="colResizeTip"
                  @mousedown.prevent="startColResize($event, c.key)"
                ></span>
              </th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="r in runRows"
              :key="r.id"
              :class="{ 'okf-ragas__row--fail': rowFails(r) && !rowAnswerOkButNoisy(r) }"
            >
              <td>
                <code>{{ r.id }}</code>
              </td>
              <td class="okf-ragas__cell-query" :title="r.query">{{ r.query }}</td>
              <td v-for="m in runMetricKeys" :key="m" class="okf-ragas__cell-metric">
                <span class="okf-headtest__bar"
                  ><span :style="{ width: barWidth(r.metrics && r.metrics[m]) }"></span
                ></span>
                <span class="okf-ragas__score">{{ scoreText(r.metrics && r.metrics[m]) }}</span>
              </td>
              <td class="okf-ragas__cell-answer">
                <textarea
                  class="okf-ragas__answer-text"
                  rows="2"
                  readonly
                  :value="r.answer"
                  :title="translate('okf.ragas.results.copy', 'Copy the full answer')"
                ></textarea>
                <button
                  type="button"
                  class="okf-headtest__row-btn"
                  :title="translate('okf.ragas.results.copy', 'Copy the full answer')"
                  @click="copyAnswer(r)"
                >
                  {{ copiedId === r.id ? '✓' : '⧉' }}
                </button>
              </td>
              <td>
                <DsPill v-if="r.error" variant="danger">{{ translate('okf.ragas.results.error', 'error') }}</DsPill>
                <DsPill
                  v-else-if="rowFails(r) && rowAnswerOkButNoisy(r)"
                  variant="warning"
                  :title="
                    translate(
                      'okf.ragas.results.noisyTitle',
                      'The answer passed every answer-quality metric; only the delivered context set (precision/recall) fell below threshold'
                    )
                  "
                >
                  {{ translate('okf.ragas.results.noisy', 'answer OK — retrieval noise') }}
                </DsPill>
                <DsPill
                  v-else-if="r.abstained && !rowJudged(r)"
                  variant="warning"
                  :title="
                    translate(
                      'okf.ragas.results.declinedUnjudgedTitle',
                      'The answerer declined and said nothing, so this row was never handed to the judge. It carries no score and is left out of the averages — and it reduces the measured coverage.'
                    )
                  "
                >
                  {{ translate('okf.ragas.results.declinedUnjudged', 'declined — not judged') }}
                </DsPill>
                <DsPill v-else-if="r.abstained" variant="warning">{{
                  translate('okf.ragas.results.abstained', 'abstained')
                }}</DsPill>
                <DsPill v-else variant="neutral">{{ translate('okf.ragas.results.answered', 'answered') }}</DsPill>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- EXPLAIN / ADVISE -->
    <div v-if="explainDoc" class="okf-ragas__section">
      <h4 class="okf-headtest__pane-title">
        {{ translate('okf.ragas.explain.title', 'Failure attribution and advice') }}
      </h4>
      <!-- The facts the advice cites — visible so the numbers it reasons
           from can be checked, not just believed. -->
      <p v-if="explainFactsLabel" class="okf-ragas__muted">{{ explainFactsLabel }}</p>
      <table v-if="explainDoc.attributions && explainDoc.attributions.length" class="okf-headtest__scores">
        <thead>
          <tr>
            <th>#</th>
            <th>{{ translate('okf.ragas.explain.stage', 'Stage') }}</th>
            <th>{{ translate('okf.ragas.explain.fails', 'Failing metrics') }}</th>
            <th>{{ translate('okf.ragas.explain.recommendation', 'Recommendation') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="a in explainDoc.attributions" :key="a.id">
            <td>
              <code>{{ a.id }}</code>
            </td>
            <td>
              <DsPill :variant="stageVariant(a.stage)">{{ a.stage }}</DsPill>
              <!-- An unfair question (its expected passage is not in the
                   corpus) measures the benchmark, not the assistant. It is
                   called out so nobody tunes the pipeline for it. -->
              <span
                v-if="a.unfair_question"
                class="okf-ragas__muted"
                :title="translate('okf.ragas.explain.unfairTitle', 'The expected passage is not in the corpus')"
              >
                · {{ translate('okf.ragas.explain.unfair', 'unfair question') }}
              </span>
              <!-- Where the passage was lost, proven against the corpus. The
                   counts are only meaningful when the ladder decided the
                   verdict (ladder_applied). -->
              <span v-if="a.evidence && a.evidence.ladder_applied" class="okf-ragas__muted" :title="evidenceTitle(a)">
                · {{ evidenceSummary(a) }}
              </span>
            </td>
            <td>{{ (a.fails || []).join(', ') }}</td>
            <td>{{ a.recommendation }}</td>
          </tr>
        </tbody>
      </table>
      <p v-else class="okf-ragas__muted">{{ translate('okf.ragas.explain.none', 'No failing rows to attribute.') }}</p>
      <div v-if="adviceChips.length" class="okf-headtest__suggestion">
        <div v-for="(chip, i) in adviceChips" :key="i" class="okf-ragas__advice-chip" :title="chip.title">
          <span class="okf-ragas__advice-kind">{{ chip.kind }}</span> {{ chip.text }}
        </div>
        <p v-if="explainDoc.advice && explainDoc.advice.note" class="okf-ragas__muted">{{ explainDoc.advice.note }}</p>
      </div>
      <!-- The configuration adjustment cycle (David 2026-10-27): concrete
           environment changes the SERVER generates from the attribution, so a
           steward can improve the scores by configuration — apply, re-run,
           explain again. The trade-off column is first-class on purpose: a
           knob that helps one metric hurts another, and the operator must see
           the price before turning it. Generated mechanically, never by the
           advisor LLM (which once prescribed retrieval knobs for judge-staged
           rows and intermittently loses its output shape). -->
      <div v-if="explainDoc.advice && (explainDoc.advice.env_changes || []).length" class="okf-headtest__suggestion">
        <h5 class="okf-headtest__pane-title">{{ translate('okf.ragas.advice.env', 'Environment changes') }}</h5>
        <table class="okf-headtest__scores">
          <thead>
            <tr>
              <th>{{ translate('okf.ragas.advice.envComponent', 'Component') }}</th>
              <th>{{ translate('okf.ragas.advice.envChange', 'Change') }}</th>
              <th>{{ translate('okf.ragas.advice.envTargets', 'Targets') }}</th>
              <th>{{ translate('okf.ragas.advice.envWhy', 'Why') }}</th>
              <th>{{ translate('okf.ragas.advice.envTradeOff', 'Trade-off') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="e in explainDoc.advice.env_changes" :key="e.id">
              <td>{{ e.component }}</td>
              <td>
                <!-- A change carries either a value (`to`) or a DIRECTION —
                     an instruction sentence in the value slot would render
                     as if it were a config value. The arrows are
                     language-neutral, like the active-config ★. -->
                <code v-for="c in e.changes" :key="c.env" class="okf-ragas__run-key">
                  {{ c.env
                  }}{{
                    c.direction === 'raise'
                      ? ' ↑'
                      : c.direction === 'lower'
                        ? ' ↓'
                        : c.direction === 'either'
                          ? ' ↕'
                          : ''
                  }}{{ c.to !== undefined && c.to !== null ? ' = ' + c.to : '' }}
                </code>
                <span v-if="!(e.changes || []).length" class="okf-ragas__muted">—</span>
              </td>
              <td>{{ (e.targets || []).join(', ') || '—' }}</td>
              <td>
                {{ e.why }}
                <div class="okf-ragas__muted">
                  {{ translate('okf.ragas.advice.envApply', 'How to apply') }}: {{ e.apply }}
                </div>
                <div class="okf-ragas__muted">
                  {{ translate('okf.ragas.advice.envVerify', 'Verify') }}: {{ e.verify }}
                </div>
              </td>
              <td>{{ e.trade_off }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- RUN HISTORY -->
    <div v-if="runHistory.length" class="okf-ragas__section">
      <h4 class="okf-headtest__pane-title">{{ translate('okf.ragas.history.title', 'Run history') }}</h4>
      <table class="okf-headtest__scores">
        <thead>
          <tr>
            <th>{{ translate('okf.ragas.history.run', 'Run') }}</th>
            <th>{{ translate('okf.ragas.history.when', 'When') }}</th>
            <th>{{ translate('okf.ragas.history.status', 'Status') }}</th>
            <th v-for="m in historyMetricKeys" :key="m">{{ metricLabel(m) }}</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="h in runHistory"
            :key="h._key"
            :class="{ 'okf-ragas__row--selected': runDoc && h._key === runDoc._key }"
          >
            <td>
              <!-- David 2026-10-24: the RUN column names the JUDGE that
                   scored it — "rr1792843333604-268dad" means nothing to an
                   operator. The key stays, small, for support. -->
              <div class="okf-ragas__judge-name">{{ runJudgeLabel(h) }}</div>
              <code class="okf-ragas__run-key">{{ h._key }}</code>
              <div v-if="h.rescore_of" class="okf-ragas__muted">
                {{ translate('okf.ragas.history.rescoreOf', 're-scored from {key}').replace('{key}', h.rescore_of) }}
              </div>
            </td>
            <td>{{ shortDate(h.created_at) }}</td>
            <td>
              <DsPill :variant="h.status === 'done' ? 'success' : h.status === 'failed' ? 'danger' : 'warning'">{{
                h.status
              }}</DsPill>
            </td>
            <td v-for="m in historyMetricKeys" :key="m">
              {{ scoreText(h.summary && h.summary.metrics && h.summary.metrics[m]) }}
              <span
                v-if="coverageText(h.summary, m)"
                class="okf-ragas__muted"
                :title="
                  translate(
                    'okf.ragas.results.coverageTitle',
                    'The judge scored this metric on {n} of {total} rows — the mean covers only those rows.'
                  )
                    .replace('{n}', String((h.summary.coverage[m] || {}).scored))
                    .replace('{total}', String((h.summary.coverage[m] || {}).total))
                "
              >
                {{ coverageText(h.summary, m) }}
              </span>
            </td>
            <td>
              <div class="okf-ragas__row-actions">
                <DsButton variant="secondary" small :disabled="runBusy" @click="onLoadRun(h._key, h.suite_key)">
                  {{ translate('okf.ragas.history.load', 'View') }}
                </DsButton>
                <DsButton
                  v-if="!readOnly"
                  variant="secondary"
                  small
                  :disabled="runBusy || runDeleteBusy || h.status === 'running'"
                  @click="runDeleteAsk = h"
                >
                  {{ translate('okf.ragas.history.delete', 'Delete') }}
                </DsButton>
                <!-- Re-score with another judge (David 2026-10-24): the answers
                     are reused verbatim; a NEW run names its own judge. -->
                <DsButton
                  v-if="!readOnly"
                  variant="secondary"
                  small
                  :disabled="runBusy || rescoreBusy || h.status !== 'done'"
                  @click="onRescoreOpen(h)"
                >
                  {{ translate('okf.ragas.history.rescore', 'Re-score') }}
                </DsButton>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- RUN DELETE (David 2026-10-24): a run leaves the history only on an
         explicit confirm — the cascade also removes its explain doc. A running
         run is never deletable (its button is disabled; the server still
         refuses with 409 as the backstop). -->
    <DsDialog
      :visible="runDeleteAsk !== null"
      :title="translate('okf.ragas.runDelete.title', 'Delete run')"
      size="sm"
      :actions="runDeleteActions"
      @close="runDeleteAsk = null"
      @action="onRunDeleteAction"
    >
      <p>
        {{
          translate(
            'okf.ragas.runDelete.body',
            'This permanently removes the run and its failure explanation. The suite and its queries stay.'
          )
        }}
        <code v-if="runDeleteAsk">{{ runDeleteAsk._key }}</code>
      </p>
    </DsDialog>

    <!-- RE-SCORE (David 2026-10-24): score the SAME answers with a different
         judge. The answers are not regenerated, so the two runs differ ONLY
         by the judge — which is the whole point (a re-run would churn the
         answers and confound the comparison). The result is a separate run
         row that names its judge. -->
    <DsDialog
      :visible="rescoreAsk !== null"
      :title="translate('okf.ragas.rescore.title', 'Re-score with a judge')"
      size="sm"
      :actions="rescoreActions"
      @close="onRescoreClose"
      @action="onRescoreAction"
    >
      <p class="okf-ragas__muted">
        {{
          translate(
            'okf.ragas.rescore.body',
            'The stored answers are re-scored with another judge — they are not regenerated. The result is a separate run.'
          )
        }}
      </p>
      <p v-if="rescoreAsk" class="okf-ragas__muted">
        {{ translate('okf.ragas.rescore.source', 'Source run') }}: <code>{{ rescoreAsk._key }}</code> ({{
          runJudgeLabel(rescoreAsk)
        }})
      </p>
      <label class="okf-ragas__dim">
        <span>{{ translate('okf.ragas.rescore.judge', 'Judge configuration') }}</span>
        <select v-model="rescoreConfigKey" :disabled="rescoreBusy" @change="onRescoreConfigChange">
          <option value="">
            {{ defaultJudgeLabel }}
          </option>
          <option :value="envPickKey">{{ envJudgeLabel }}</option>
          <option v-for="c in modelConfigs" :key="c._key" :value="c._key">
            {{ c.name }}{{ c.active ? ' ★' : '' }}
          </option>
        </select>
      </label>
      <label v-if="rescoreConfigKey !== envPickKey" class="okf-ragas__dim">
        <span>{{ translate('okf.ragas.generate.model', 'Model') }}</span>
        <select v-if="rescoreModels.length" v-model="rescoreModel" :disabled="rescoreBusy">
          <option value="">{{ translate('okf.ragas.generate.modelPick', 'Configuration default') }}</option>
          <option v-for="m in rescoreModels" :key="m" :value="m">{{ m }}</option>
        </select>
        <input
          v-else
          v-model="rescoreModel"
          type="text"
          :placeholder="translate('okf.ragas.generate.modelDefault', 'configuration default')"
          :disabled="rescoreBusy"
        />
      </label>
    </DsDialog>
  </div>
</template>

<script>
import DsButton from '../../ds/Button.vue';
import DsPill from '../../ds/Pill.vue';
import DsSpinner from '../../ds/Spinner.vue';
import DsProgress from '../../ds/Progress.vue';
import DsInfoTip from '../../ds/InfoTip.vue';
import DsDialog from '../../ds/Dialog.vue';
import RagasGuideDialog from './RagasGuideDialog.vue';
import translateMixin from '../../../mixins/translateMixin';
import { translateLabError } from '../../../services/okfRepoOps';
import { useChartTheme } from '@/composables/useChartTheme';

const DEFAULT_METRICS = ['faithfulness', 'context_precision', 'context_recall', 'answer_relevancy'];
// Sentinel the backend's model-config service defines for "System default
// (environment)" — the .env RAGAS_JUDGE_* pair (David 2026-10-24). Mirrored
// here because it is a wire contract, not a shareable module.
const ENV_PICK = '__env__';
const ALL_METRICS = [
  ...DEFAULT_METRICS,
  'context_utilization',
  'context_entities_recall',
  'factual_correctness',
  'answer_correctness',
  'answer_similarity',
  'noise_sensitivity'
];

// Plain-language "what this RAGAS metric actually measures" notes (David
// 2026-10-19: every result chart gets an ⓘ with one). English fallbacks —
// the locales carry okf.ragas.metric.note.<key> overrides. Keep these
// honest about what each metric CANNOT see (answer_relevancy never checks
// correctness; noise_sensitivity is inverted — lower is better).
const METRIC_NOTE_FALLBACKS = {
  faithfulness:
    'How factually grounded the answer is against the retrieved passages — the share of the answer’s claims the sources actually support. Low means the answer says things the retrieved evidence does not (hallucination).',
  context_precision:
    'Whether the passages that matter were ranked at the top of the retrieved set. Low means the right evidence was retrieved but buried under less relevant chunks.',
  context_recall:
    'Whether the retrieved passages cover everything the reference answer requires — each reference claim must be attributable to retrieved context. Low means retrieval missed evidence the question needed.',
  answer_relevancy:
    'How well the answer addresses the question asked: RAGAS regenerates questions from the answer text and compares them to the original by embedding similarity. It does NOT check factual correctness — verbose or off-topic answers score low even when right.',
  context_utilization:
    'Whether the retrieved context is sufficient to produce the reference answer — a retrieval-completeness check against what the ideal answer needs.',
  context_entities_recall:
    'Entity-level recall: the share of named entities in the entry’s reference passages (companies, dates, amounts, places) that also appear in the retrieved chunks. Low means retrieval brought chunks that miss entities the reference names. Judge-sensitive — a low score while context recall passes usually means the judge’s entity extraction missed, not that content is missing.',
  factual_correctness:
    'Claim-level factual agreement with the reference answer — the judge decomposes both into claims and scores the overlap. The strictest correctness metric.',
  answer_correctness:
    'Overall quality versus the reference answer — factual correctness combined with semantic similarity. The closest metric to “did it give the right answer”.',
  answer_similarity:
    'Semantic (embedding) similarity between the generated answer and the reference answer — high means the two convey the same meaning.',
  noise_sensitivity:
    'How much the answer degrades when irrelevant passages are mixed into the retrieved context — a robustness measure. LOWER is better; it is the one metric whose failure threshold is inverted.'
};

export default {
  name: 'OkfRagasPanel',
  components: { DsButton, DsPill, DsSpinner, DsProgress, DsInfoTip, DsDialog, RagasGuideDialog },
  mixins: [translateMixin],
  props: {
    repo: { type: Object, default: null },
    readOnly: { type: Boolean, default: false },
    initialSuiteKey: { type: String, default: '' }
  },
  emits: ['changed'],
  setup() {
    // Registered ONCE here (in setup context) so the composable's
    // MutationObserver actually arms — calling useChartTheme() inside a
    // computed creates throwaway refs whose observers never attach, so
    // theme flips never re-rendered the charts (live 2026-10-18:
    // light/dark breakage). chartTheme is read by the option computeds,
    // making them reactive to mode changes.
    const { theme, getCssVarStrings } = useChartTheme();
    return { chartTheme: theme, chartThemeStrings: getCssVarStrings };
  },
  data() {
    return {
      // Cancel token for every Testing-Lab poll this panel starts (round 16,
      // #80124): the store's pollJob checks it each tick, so unmounting the
      // panel stops the client loop within one cadence. The SERVER job is
      // untouched — reopening the Lab re-adopts it (ragasAdoptRun /
      // ragasAdoptGeneration).
      pollSignal: { aborted: false },
      showHelp: false,
      showGuide: false,
      repoChoices: [],
      selectedRepoIds: [],
      genSize: 20,
      distSingle: 50,
      distAbstract: 25,
      distSpecific: 25,
      genPersonas: 3,
      selectedMetrics: [...DEFAULT_METRICS],
      // The user's metric selection is INTENT: background suite loads must
      // never silently re-seed it (2026-10-28 live: all 10 metrics ticked,
      // a background loadSuite re-seeded the 4 defaults mid-dialog, and the
      // run scored 4 — the judge-picker bug family, metrics edition).
      metricsTouched: false,
      suite: null,
      runDoc: null,
      runHistory: [],
      explainDoc: null,
      error: '',
      busy: null, // shared write lock (the dialog's discipline)
      generateBusy: false,
      generatingKey: null, // suite_key of the in-flight generation (Cancel target)
      cancelBusy: false,
      genProgress: null, // live {phase, done, total} from the generating envelope
      runningRunKey: null, // run_key of the in-flight benchmark (Cancel target)
      runCancelBusy: false,
      runBusy: false,
      runDeleteAsk: null, // the run-history row pending delete-confirm
      runDeleteBusy: false,
      rescoreAsk: null, // the run-history row pending re-score
      rescoreBusy: false,
      rescoreConfigKey: '', // the judge config for the re-score ('' = default)
      rescoreModel: '',
      rescoreModels: [],
      explainBusy: false,
      explainProgress: null, // {phase, failing, elapsed_s} from the explain job's poll
      importBusy: false,
      exportBusy: false,
      pdfBusy: false,
      probeBusy: '',
      runProgress: null,
      colWidths: {}, // per-column px widths for the results table (drag-resize)
      copiedId: '', // row whose answer was just copied (transient ✓)
      modelConfigs: [], // 8-7: named judge configurations (admin-managed)
      // The GENERATION model — the one that synthesizes the suite. SEPARATE
      // from the judge below: generating a suite and scoring it are two
      // operations with two models, and one v-model for both meant a pick for
      // one silently governed the other (David, 2026-10-25).
      genConfigKey: '', // '' = deployment default (active config / env)
      genModel: '', // '' = the configuration's default model
      genModels: [],
      // The JUDGE model — the one that SCORES a run.
      judgeConfigKey: '', // '' = deployment default (active config / env)
      envJudge: null, // {base_url, model} the env/system default resolves to
      judgeLoadFailed: false, // the judge list could not be read (still offer the env pick)
      envPickKey: '__env__', // sentinel: explicit System default (environment) pick
      judgeModel: '', // '' = the configuration's default model
      judgeModels: [],
      suiteEpoch: 0
    };
  },
  computed: {
    /** DsDialog emits the action KEY (RepoEditor's piiBulkAsk discipline). */
    runDeleteActions() {
      return [
        {
          key: 'cancel',
          label: this.translate('common.cancel', 'Cancel'),
          variant: 'secondary',
          disabled: this.runDeleteBusy
        },
        {
          key: 'confirm',
          label: this.translate('okf.ragas.runDelete.confirm', 'Delete'),
          variant: 'danger',
          disabled: this.runDeleteBusy
        }
      ];
    },
    /** Is there a judge to choose?
     *
     * David 2026-10-25: the model selection must exist whenever a judge can
     * be picked. The old rule was "only when the named-configuration list is
     * non-empty", and the list 403'd for anyone without tools-admin — so for
     * a curator the whole dropdown (env option included) disappeared. The
     * env judge alone is enough to make the picker meaningful: the .env
     * default is a selectable judge on its own. */
    hasJudgeChoice() {
      return this.modelConfigs.length > 0 || !!this.envJudge || this.judgeLoadFailed;
    },
    /** What "Deployment default" RESOLVES to, by name (live 2026-10-21:
     * the dropdown said "default" and the operator believed the active
     * GLM config was in use — it was not. The default is now spelled out
     * so the choice is never a guess. */
    defaultJudgeLabel() {
      const active = this.modelConfigs.find((c) => c.active);
      if (!active) return this.translate('okf.ragas.generate.default', 'Deployment default (.env)');
      const model = active.default_model ? ` (${active.default_model})` : '';
      return this.translate('okf.ragas.generate.defaultNamed', 'Active configuration — {name}{model}')
        .replace('{name}', active.name)
        .replace('{model}', model);
    },
    /** David 2026-10-24: "the default LLM configuration for the system [.env]
     * must be selectable". Names the model the env pick resolves to — a
     * default control is never the only statement of what is in use.
     */
    envJudgeLabel() {
      if (!this.envJudge) return this.translate('okf.ragas.generate.envJudgePlain', 'Deployment default (.env)');
      const model = this.envJudge.model ? ` (${this.envJudge.model})` : '';
      return this.translate('okf.ragas.generate.envJudge', 'Deployment default (.env){model}').replace(
        '{model}',
        model
      );
    },
    /** The run-level facts the ADVICE cites. The advice says "run_facts show
     * 0 abstentions and mean_answer_chars of 717" — the reader has to be
     * able to check both numbers, so they are shown next to it. */
    explainFactsLabel() {
      const f = this.explainDoc && this.explainDoc.run_facts;
      if (!f) return '';
      return this.translate(
        'okf.ragas.explain.facts',
        'Run facts: {rows} rows · {abstentions} abstentions · ~{chars} answer chars'
      )
        .replace('{rows}', String(f.rows))
        .replace('{abstentions}', String(f.abstentions))
        .replace('{chars}', String(f.mean_answer_chars));
    },
    /** The re-score dialog's action buttons (DsDialog emits the action KEY). */
    rescoreActions() {
      return [
        {
          key: 'cancel',
          label: this.translate('common.cancel', 'Cancel'),
          variant: 'secondary',
          disabled: this.rescoreBusy
        },
        {
          key: 'confirm',
          label: this.translate('okf.ragas.rescore.confirm', 'Re-score'),
          variant: 'primary',
          disabled: this.rescoreBusy
        }
      ];
    },
    /** The ACTIVE model configuration — what the EMPTY pick resolves to.
     * Its models are choosable: the model select must not be hidden for the
     * default (David, 2026-10-25). */
    activeModelConfig() {
      return this.modelConfigs.find((c) => c.active) || null;
    },
    /** The model the RUNNING generation is actually using, by name. The
     * dropdown shows the SELECTION; for an in-flight generation that
     * selection is reset to "default" (the suite doc does not exist yet),
     * so this is the only honest answer to "which model is this?".
     *
     * It says GENERATING, not judging: a generation synthesizes the suite,
     * it does not score anything (David, 2026-10-25). */
    effectiveGenerationLabel() {
      const j = this.genProgress && this.genProgress.judge;
      if (!j) return '';
      const name =
        j.config || (j.source === 'env' ? this.translate('okf.ragas.generate.envDefault', 'environment default') : '');
      const model = j.model ? ` (${j.model})` : '';
      if (!name && !model) return '';
      return this.translate('okf.ragas.generate.effectiveGenerating', 'Generating with {name}{model}')
        .replace('{name}', name)
        .replace('{model}', model);
    },
    /** The model the RUNNING run is actually scoring with. */
    effectiveJudgeLabel() {
      const j = this.runProgress && this.runProgress.judge;
      if (!j) return '';
      const name =
        j.config || (j.source === 'env' ? this.translate('okf.ragas.generate.envDefault', 'environment default') : '');
      const model = j.model ? ` (${j.model})` : '';
      if (!name && !model) return '';
      return this.translate('okf.ragas.generate.effective', 'Judging with {name}{model}')
        .replace('{name}', name)
        .replace('{model}', model);
    },
    /** The every-control reference rendered by the Help panel — titles and
     *  text straight from i18n so every locale carries the full glossary. */
    helpItems() {
      const keys = [
        'repositories',
        'questions',
        'singleHop',
        'multiAbstract',
        'multiSpecific',
        'personas',
        'generate',
        'importSuite',
        'entries',
        'metrics',
        'run',
        'results',
        'explain',
        'exports'
      ];
      return keys.map((k) => ({
        key: k,
        title: this.translate(`okf.ragas.help.${k}.title`, k),
        text: this.translate(`okf.ragas.help.${k}.text`, '')
      }));
    },
    entries() {
      return (this.suite && this.suite.payload && this.suite.payload.entries) || [];
    },
    metricChoices() {
      return ALL_METRICS.map((m) => ({ key: m, label: this.metricLabel(m), default: DEFAULT_METRICS.includes(m) }));
    },
    runMetricKeys() {
      return (this.runDoc && this.runDoc.metrics) || DEFAULT_METRICS;
    },
    historyMetricKeys() {
      const first = this.runHistory.find((h) => h.summary && h.summary.metrics);
      return (first && Object.keys(first.summary.metrics)) || DEFAULT_METRICS;
    },
    runRows() {
      return (this.runDoc && this.runDoc.payload && this.runDoc.payload.results) || [];
    },
    aggregateRows() {
      const summary = (this.runDoc && this.runDoc.payload && this.runDoc.payload.summary) || {};
      const metrics = summary.metrics || {};
      return Object.entries(metrics)
        .filter(([, v]) => typeof v === 'number')
        .map(([key, v]) => {
          const cov = summary.coverage && summary.coverage[key];
          const partial =
            cov && typeof cov.scored === 'number' && typeof cov.total === 'number' && cov.scored < cov.total;
          return {
            key,
            label: this.metricLabel(key),
            series: [Math.round(v * 100)],
            coverage: partial ? `${cov.scored}/${cov.total}` : '',
            coverageTitle: partial
              ? this.translate(
                  'okf.ragas.results.coverageTitle',
                  'The judge scored this metric on {n} of {total} rows — the score covers only those rows.'
                )
                  .replace('{n}', String(cov.scored))
                  .replace('{total}', String(cov.total))
              : ''
          };
        });
    },
    // The trended history — same filter+order as trendSeries and the
    // x-axis categories, so the three always describe the same slots.
    trendedHistory() {
      return [...this.runHistory].filter((h) => h.summary && h.summary.metrics).reverse();
    },
    // How many DISTINCT judges the trend spans. One judge = the line is a
    // like-for-like sequence; several = each segment only compares runs
    // scored by the same judge (the metric-picker bug family, trend
    // edition: the same 50 answers scored 13/37 under granite and 7/43
    // under glm-5.3 — a continuous line across that boundary reads as a
    // regression that never happened).
    trendMixedJudges() {
      return new Set(this.trendedHistory.map((h) => this.runJudgeLabel(h))).size > 1;
    },
    trendSeries() {
      const history = this.trendedHistory;
      if (history.length < 1) return [];
      const keys = this.historyMetricKeys;
      // Contiguous judge segments: a line never crosses a judge boundary.
      // Each segment is its own series (nulls outside its slot range), so
      // ApexCharts draws separate connected lines; the color is pinned per
      // METRIC in trendOptions so a metric keeps its color across segments.
      const segs = [];
      for (let i = 0; i < history.length; i += 1) {
        const judge = this.runJudgeLabel(history[i]);
        const last = segs[segs.length - 1];
        if (last && last.judge === judge) last.end = i;
        else segs.push({ judge, start: i, end: i });
      }
      const series = [];
      for (const m of keys) {
        for (const s of segs) {
          const data = history.map((h, i) => {
            if (i < s.start || i > s.end) return null;
            const v = h.summary.metrics[m];
            return typeof v === 'number' ? Number(v.toFixed(3)) : null;
          });
          if (data.some((v) => v !== null)) {
            series.push({ name: `${this.metricLabel(m)} · ${this.trendJudgeTag(history[s.start])}`, data, _metric: m });
          }
        }
      }
      return series;
    },
    statusSeries() {
      const s = this.runDoc && this.runDoc.payload && this.runDoc.payload.summary;
      if (!s) return [];
      // The four buckets must PARTITION the in-scope rows — the bar is read
      // as a whole, and a row counted twice makes the segments sum to more
      // than the suite.
      //
      //   error     — the pipeline failed on the row; no answer; never judged
      //   abstained — the answerer declined; it has its own column
      //   failing   — judged, a metric below its threshold, not a decline
      //   answered  — everything else in scope
      //
      // The SERVER computes these over ONE population (the in-scope rows —
      // an out-of-scope control is never a result and never a failure), so
      // the panel must not subtract across populations itself. It used to:
      // n_errors and n_abstained counted out-of-scope rows while
      // n_evaluable and failing_count did not, and the failing bucket was
      // derived as (failing_count − n_abstained), which subtracted a
      // DECLINE that was never judged and so was never in failing_count —
      // relabelling a genuinely failing row as "answered".
      const nErrors = s.n_errors || 0;
      const nAbstained = s.n_abstained || 0;
      // Runs stored before the server computed the buckets fall back to the
      // old arithmetic — the best that can be said about them.
      const nFailing = s.n_failed != null ? s.n_failed : Math.max(0, (s.failing_count || 0) - nAbstained);
      const nAnswered =
        s.n_answered != null ? s.n_answered : Math.max(0, (s.n_evaluable || 0) - nErrors - nAbstained - nFailing);
      return [
        {
          name: this.translate('okf.ragas.results.answered', 'answered'),
          data: [nAnswered]
        },
        { name: this.translate('okf.ragas.results.abstained', 'abstained'), data: [nAbstained] },
        { name: this.translate('okf.ragas.results.failingShort', 'failing'), data: [nFailing] },
        { name: this.translate('okf.ragas.results.error', 'error'), data: [nErrors] }
      ];
    },
    explainProgressLabel() {
      const p = this.explainProgress;
      if (!p) return this.translate('okf.ragas.explain.working', 'Explaining failures…');
      let base;
      if (p.phase === 'advising') {
        base = this.translate('okf.ragas.explain.advising', 'Advisor thinking — {n} failing rows').replace(
          '{n}',
          String(typeof p.failing === 'number' ? p.failing : '?')
        );
      } else if (p.phase === 'guarding') {
        base = this.translate('okf.ragas.explain.guarding', 'Guarding tag suggestions…');
      } else {
        base = this.translate('okf.ragas.explain.working', 'Explaining failures…');
      }
      const elapsed = this.fmtDuration(p.elapsed_s);
      return elapsed ? `${base} · ${elapsed}` : base;
    },
    progressPct() {
      const p = this.runProgress;
      if (!p || !p.total) return 0;
      return Math.min(100, Math.round((p.done / p.total) * 100));
    },
    runProgressLabel() {
      const p = this.runProgress;
      const phase = p && p.phase ? this.translate(`okf.ragas.run.phase.${p.phase}`, p.phase) : '';
      const counts = p ? ` ${p.done}/${p.total}` : '';
      return this.translate('okf.ragas.run.working', 'Running…') + (phase ? ` — ${phase}` : '') + counts;
    },
    genProgressPct() {
      const p = this.genProgress;
      if (!p || !p.total) return 0;
      return Math.min(100, Math.round((p.done / p.total) * 100));
    },
    genProgressLabel() {
      const p = this.genProgress;
      if (!p || !p.phase) return '';
      const phase = this.translate(`okf.ragas.run.phase.${p.phase}`, p.phase);
      // A count of ZERO is "not counted yet", not "nothing happened" (David
      // 2026-10-21: "this has been running for quite some time with no
      // progress bar… completely unacceptable UX"). Printing "0/1075" for
      // 30 minutes reads as a broken benchmark; the phase name plus the
      // step and the elapsed clock below tell the truth. The counts appear
      // as soon as the first batch completes.
      if (!p.total || !p.done) return phase;
      return `${phase} ${p.done}/${p.total}`;
    },
    /** Coverage note for a corpus-capped suite: "grounded in 1600 of 5590
     * chunks" per capped repo (2026-10-21 — a capped corpus is shown, never
     * silently sliced). Empty when every repo fit the budget. */
    corpusCoverageNote() {
      const cov = this.suite && this.suite.payload && this.suite.payload.corpus_coverage;
      if (!Array.isArray(cov)) return '';
      const capped = cov.filter((c) => c && Number(c.total) > Number(c.used));
      if (!capped.length) return '';
      const parts = capped
        .map((c) =>
          this.translate('okf.ragas.corpus.part', '{used} of {total} chunks')
            .replace('{used}', String(c.used))
            .replace('{total}', String(c.total))
        )
        .join(', ');
      return this.translate('okf.ragas.corpus.capped', 'Grounded in {parts} (corpus budget)').replace('{parts}', parts);
    },
    /** The questions the generation LOST, and why (live 2026-10-21: 35 of
     * 100 were dropped to upstream 429s and the panel said NOTHING — the
     * user could not tell a short suite from a throttled one). */
    droppedNote() {
      const dims = this.suite && this.suite.payload && this.suite.payload.dimensions;
      if (!dims) return '';
      const dropped = Number(dims.dropped || 0);
      if (!dropped) return '';
      const kept = Number(dims.testset_size || 0);
      const requested = Number(dims.requested_size || kept + dropped);
      const reasons = dims.dropped_reasons || {};
      const reasonText = Object.keys(reasons)
        .filter((k) => Number(reasons[k]) > 0)
        .map((k) => `${this.translate(`okf.ragas.dropped.reason.${k}`, k.replace(/_/g, ' '))} ×${Number(reasons[k])}`)
        .join(', ');
      let note = this.translate(
        'okf.ragas.dropped.note',
        '{kept} of {requested} questions — {dropped} could not be generated'
      )
        .replace('{kept}', String(kept))
        .replace('{requested}', String(requested))
        .replace('{dropped}', String(dropped));
      if (reasonText) note += ` (${reasonText})`;
      return note;
    },
    /** The sub-step line: active transform + counts + ETA + elapsed
     * (David 2026-10-20: "the user needs more feedback than this" — a
     * flashing bar with no sense of what or how long is not feedback). */
    genProgressDetail() {
      const p = this.genProgress;
      if (!p) return '';
      const parts = [];
      if (p.step) parts.push(p.step);
      // A count of ZERO is "not counted yet", not "nothing happened" (David
      // 2026-10-21: "this has been running for quite a while with no
      // progress bar… completely unacceptable UX"). Printing "0/100" next
      // to a running clock reads as a broken benchmark — the phase name,
      // the call count and the elapsed clock tell the truth. The counts
      // appear as soon as the first item completes.
      else if (p.total && p.done) parts.push(`${p.done}/${p.total}`);
      // The LLM-call count (2026-10-21): the transform's own bar did NOT
      // move during a 20-minute KG phase — the UI showed "0/1075" the whole
      // time while the work was demonstrably running. This counter advances
      // with every model call, so the line always shows MOVEMENT.
      // The count is the calls that REACHED the model (2026-10-26) — the
      // replays the sidecar's on-disk cache answered are counted apart and
      // reported below, because a replay is not an LLM call: on a corpus
      // generated before, the panel climbed to "673 LLM calls" while the
      // remote GPU sat at 0 %.
      if (typeof p.calls === 'number' && p.calls > 0) {
        parts.push(this.translate('okf.ragas.gen.calls', '{n} LLM calls').replace('{n}', String(p.calls)));
      }
      // The REPLAYS — answered from the sidecar's cache, no request, no GPU.
      // Without this number the line reads as if the model did work it did
      // not do.
      if (typeof p.replays === 'number' && p.replays > 0) {
        parts.push(
          this.translate('okf.ragas.gen.replays', '{n} replayed from cache').replace('{n}', String(p.replays))
        );
      }
      // A fully-replayed generation really did reach the model ZERO times
      // (2026-10-26) — and saying so is the point. The zero-is-"not counted
      // yet" rule above applies to a count that was never taken, not to a
      // count that is genuinely zero.
      if (typeof p.replays === 'number' && p.replays > 0 && p.calls === 0) {
        parts.push(this.translate('okf.ragas.gen.calls', '{n} LLM calls').replace('{n}', '0'));
      }
      const eta = this.fmtDuration(p.eta_s);
      if (eta) {
        parts.push(this.translate('okf.ragas.gen.eta', '~{t} left').replace('{t}', eta));
      }
      const elapsed = this.fmtDuration(p.elapsed_s);
      if (elapsed) {
        parts.push(this.translate('okf.ragas.gen.elapsed', 'running {t}').replace('{t}', elapsed));
      }
      return parts.join(' · ');
    },
    /** Column model for the per-query results table: id, question, one per
     *  selected metric, the answer, the state — drives the colgroup and the
     *  per-header drag grips. */
    resultCols() {
      return [
        { key: 'id', label: '#' },
        { key: 'query', label: this.translate('okf.ragas.col.query', 'Question') },
        ...this.runMetricKeys.map((m) => ({ key: `m:${m}`, label: this.metricLabel(m) })),
        { key: 'answer', label: this.translate('okf.ragas.results.answer', 'Answer') },
        { key: 'state', label: this.translate('okf.ragas.results.state', 'State') }
      ];
    },
    colResizeTip() {
      return this.translate(
        'okf.ragas.results.colResizeTip',
        'Drag the grip to resize — double-click the header to reset'
      );
    },
    /** Shown in Results while rows fail and no advisor output is on screen —
     * the entry point to "what actions can I take" (2026-10-19). */
    advisorHint() {
      const summary = this.runDoc && this.runDoc.payload && this.runDoc.payload.summary;
      const failing = (summary && summary.failing_count) || 0;
      if (!failing || this.explainDoc) return '';
      return this.translate(
        'okf.ragas.results.advisorHint',
        '{n} questions are below their metric thresholds. Run the advisor to attribute each failure to a pipeline stage and get concrete actions.'
      ).replace('{n}', String(failing));
    },
    /**
     * Why this run is NOT a valid measurement — empty when it is one.
     * Two causes, both real (2026-10-21 review C1/F2):
     *   - rows errored (the answer leg failed) → the numbers are zeros, not
     *     measurements;
     *   - the judge measured only part of the suite (a judge that died on
     *     some rows) → the mean is over the survivors.
     */
    invalidRunReason() {
      const p = this.runDoc && this.runDoc.payload;
      if (!p) return '';
      const summary = p.summary || {};
      const nErrors = summary.n_errors || 0;
      if (nErrors > 0) {
        return this.translate(
          'okf.ragas.results.invalidErrors',
          '{n} of {total} answers failed — these scores are not a measurement of the system. Re-run the benchmark.'
        )
          .replace('{n}', String(nErrors))
          .replace('{total}', String(summary.n || p.coverage?.total_rows || 0));
      }
      const cov = p.coverage;
      if (cov && cov.total_rows && cov.measured_rows < cov.total_rows) {
        return this.translate(
          'okf.ragas.results.invalidCoverage',
          'The judge measured {measured} of {total} rows — the averages below cover only the rows that scored.'
        )
          .replace('{measured}', String(cov.measured_rows))
          .replace('{total}', String(cov.total_rows));
      }
      return '';
    },
    adviceChips() {
      const advice = this.explainDoc && this.explainDoc.advice;
      if (!advice) return [];
      const chips = [];
      for (const k of advice.knob_changes || [])
        chips.push({ kind: this.translate('okf.ragas.advice.knob', 'knob'), text: k, title: k });
      for (const t of advice.repo_tag_changes || [])
        chips.push({ kind: this.translate('okf.ragas.advice.tag', 'repo tag'), text: t, title: t });
      for (const c of advice.content_curation || [])
        chips.push({
          kind: this.translate('okf.ragas.advice.content', 'content'),
          text: `${c.concept}: ${c.gap}`,
          title: c.gap
        });
      for (const p of advice.prompt_tweaks || [])
        chips.push({ kind: this.translate('okf.ragas.advice.prompt', 'prompt'), text: p, title: p });
      return chips;
    },
    trendOptions() {
      // this.chartTheme read = reactive dependency on mode flips
      const t = this.chartThemeStrings();
      const mode = this.chartTheme === 'dark' ? 'dark' : 'light';
      const history = this.trendedHistory;
      return {
        chart: { toolbar: { show: false }, animations: { enabled: false } },
        theme: { mode },
        // One color per METRIC (pinned by key length, the same formula the
        // gauges use) so a metric keeps its color across its judge segments;
        // the tooltip names the segment's judge.
        colors: this.trendSeries.map((s) => t.chartColors[Math.abs(String(s._metric).length) % t.chartColors.length]),
        // Every x-label names the judge that scored that run — the point is
        // self-describing without a legend (hidden below: one series per
        // metric per judge segment would read as dozens of entries).
        xaxis: {
          categories: history.map((h) => `${String(h.created_at || '').slice(5, 16)} · ${this.trendJudgeTag(h)}`),
          labels: { style: { colors: t.textColor } }
        },
        legend: { show: false },
        yaxis: { min: 0, max: 1, labels: { style: { colors: t.textColor } } },
        stroke: { curve: 'straight', width: 2 },
        // a single-run history is ONE point — without markers the line
        // chart renders empty (live 2026-10-18: first completed run showed
        // an empty trend). Markers make 1..N points always visible.
        markers: { size: 4, strokeWidth: 0, hover: { size: 5 } }
      };
    },
    statusOptions() {
      const t = this.chartThemeStrings();
      const mode = this.chartTheme === 'dark' ? 'dark' : 'light';
      return {
        chart: { type: 'bar', stacked: true, toolbar: { show: false } },
        theme: { mode },
        colors: t.chartColors,
        xaxis: { categories: [''], labels: { style: { colors: t.textColor } } },
        legend: { labels: { colors: t.textColor } },
        plotOptions: { bar: { horizontal: true } }
      };
    }
  },
  watch: {
    /** A pick the dropdown cannot DISPLAY must never travel with the
     * request (live 2026-10-21): the run went to a personal MiniMax key
     * while the panel showed "Deployment default" — the active GLM config
     * the operator believed was in use. A stale key is dropped the moment
     * it stops being an option, so the panel can never lie about the
     * model a run uses. */
    modelConfigs(list) {
      // The env sentinel is not a config doc — a list refresh must never
      // demote an explicit system-default pick to the active-config default.
      if (
        this.judgeConfigKey &&
        this.judgeConfigKey !== ENV_PICK &&
        !list.some((c) => c._key === this.judgeConfigKey)
      ) {
        this.judgeConfigKey = '';
        this.judgeModel = '';
        this.judgeModels = [];
      }
      // The same for the GENERATION pick — it is its own control now.
      if (this.genConfigKey && this.genConfigKey !== ENV_PICK && !list.some((c) => c._key === this.genConfigKey)) {
        this.genConfigKey = '';
        this.genModel = '';
        this.genModels = [];
      }
    },
    /** A RUNNING job's pick is what the job is using — the picker must show
     * it, not the one the panel remembers (David, 2026-10-25: the dropdown
     * said GLM while the job was on granite). The server sends the pick as
     * made in the progress envelope. */
    genProgress(p) {
      if (!p || !p.judge_pick) return;
      const key = p.judge_pick.config_key || '';
      if (key !== this.genConfigKey) this.genConfigKey = key;
      if (p.judge_pick.model) this.genModel = p.judge_pick.model;
    },
    runProgress(p) {
      if (!p || !p.judge_pick) return;
      const key = p.judge_pick.config_key || '';
      if (key !== this.judgeConfigKey) this.judgeConfigKey = key;
      if (p.judge_pick.model) this.judgeModel = p.judge_pick.model;
    }
  },
  mounted() {
    this.selectedRepoIds = this.repo && this.repo.repo_id ? [this.repo.repo_id] : [];
    this.loadRepoChoices();
    this.loadJudgeConfigs();
    if (this.initialSuiteKey) this.loadSuite(this.initialSuiteKey);
    else this.loadLatest();
  },
  beforeUnmount() {
    // Stop every poll this panel owns (round 16, #80124) — without this, a
    // closed Lab kept polling the gateway every 2s for up to the 24h UI
    // horizon. The jobs keep running server-side; the Lab re-adopts them.
    this.pollSignal.aborted = true;
  },
  methods: {
    /** Coarse human duration for ETAs and elapsed clocks. Type-safe: the
     * progress payload is server JSON that evolves — a malformed eta must
     * render as "unknown", never crash the panel. */
    fmtDuration(s) {
      if (typeof s !== 'number' || Number.isNaN(s) || s < 0) return '';
      const m = Math.round(s / 60);
      if (m < 1) return this.translate('okf.ragas.gen.underMin', 'under a minute');
      if (m < 60) return this.translate('okf.ragas.gen.minutes', '{m} min').replace('{m}', String(m));
      const h = Math.floor(m / 60);
      return this.translate('okf.ragas.gen.hours', '{h} h {m} min')
        .replace('{h}', String(h))
        .replace('{m}', String(m % 60));
    },
    /** 8-7: the judge-config dropdown.
     *
     * David 2026-10-25: a failed read must NOT take the model selection
     * away. The env judge is a valid pick on its own (the server resolves
     * the ENV sentinel to the .env-configured judge), so when the list
     * cannot be read the picker still renders with the env option — without
     * a model name, because the server could not tell us which one it is.
     * The list endpoint is readable by every OKF user, so a failure here
     * means something is genuinely broken, not that the caller lacks a role. */
    async loadJudgeConfigs() {
      const res = await this.$store.dispatch('okf/modelConfigList').catch(() => null);
      if (res && res.ok) {
        this.modelConfigs = res.configs || [];
        this.envJudge = res.env_judge || null;
        this.judgeLoadFailed = false;
        if (res.env_pick) this.envPickKey = res.env_pick;
      } else {
        this.judgeLoadFailed = true;
      }
      // pre-select the ACTIVE configuration's model choices? No — the active
      // config applies server-side automatically; the pick here is an
      // explicit OVERRIDE, which starts empty (deployment default).
    },
    async onJudgeConfigChange() {
      this.judgeModel = '';
      this.judgeModels = [];
      // ENV_PICK is not a config _key — no model list to fetch; the env judge
      // carries its own model, named by the run's fidelity/progress envelope.
      if (this.judgeConfigKey === ENV_PICK) return;
      // The EMPTY pick is the ACTIVE configuration, and it has models of its
      // own: an operator must be able to choose one (David, 2026-10-25).
      const key = this.judgeConfigKey || (this.activeModelConfig && this.activeModelConfig._key);
      if (!key) return;
      const res = await this.$store.dispatch('okf/modelConfigModels', { key }).catch(() => null);
      if (res && res.ok) this.judgeModels = res.models || [];
      // listing failure leaves the free-text input — honest fallback
    },
    /** The GENERATION pick: the model that synthesizes the suite. Separate
     * from the judge pick (David, 2026-10-25) — generating a suite and
     * scoring it are two operations with two models. */
    async onGenConfigChange() {
      this.genModel = '';
      this.genModels = [];
      if (this.genConfigKey === ENV_PICK) return;
      const key = this.genConfigKey || (this.activeModelConfig && this.activeModelConfig._key);
      if (!key) return;
      const res = await this.$store.dispatch('okf/modelConfigModels', { key }).catch(() => null);
      if (res && res.ok) this.genModels = res.models || [];
    },
    /** Restore the GENERATION pick: the model this suite was synthesized with
     * (`suite.payload.judge_pick`). The judge pick has its own memory (the
     * latest run's pick) — they are not the same thing. */
    async restoreGenerationPick() {
      if (!this.suite) return;
      if (!this.modelConfigs.length && !this.envJudge) await this.loadJudgeConfigs();
      const pick = (this.suite.payload && this.suite.payload.judge_pick) || null;
      const key = pick && pick.config_key;
      if (key === ENV_PICK) {
        this.genConfigKey = ENV_PICK;
        this.genModel = '';
        this.genModels = [];
        return;
      }
      if (key) {
        this.genConfigKey = key;
        await this.onGenConfigChange();
        if (pick.model && this.genModels.includes(pick.model)) this.genModel = pick.model;
        return;
      }
      this.genConfigKey = '';
      this.genModel = '';
      this.genModels = [];
    },
    /** 8-7 judge memory (David 2026-10-21: the model selection must not fall
     *  back to the deployment default whenever the dialog is left and
     *  re-entered). Restore the JUDGE pick: the viewed run's pick when
     *  loading that run, else the suite's latest run's pick, else the
     *  generation pick (a suite that has never run was scored with whatever
     *  the operator had selected, and there is no run to read it from). A
     *  config deleted since then falls back to default — the dropdown cannot
     *  offer what no longer exists. The GENERATION pick has its own memory
     *  (`restoreGenerationPick`) — the two are separate controls. */
    async restoreJudgePick(preferred) {
      if (!this.suite) return;
      // Mount race: loadJudgeConfigs may still be in flight when a suite
      // loads — without the list we cannot tell "deleted" from "not yet
      // loaded" and would wrongly reset to default.
      if (!this.modelConfigs.length && !this.envJudge) await this.loadJudgeConfigs();
      let pick = null;
      if (preferred && preferred.config_key) {
        pick = preferred;
      } else if (!preferred) {
        // preferred === null/undefined means "no run-specific opinion";
        // a preferred WITHOUT config_key is an explicit default pick and
        // must NOT fall through to older picks.
        const run = (this.runHistory || []).find(
          (r) => r.kind === 'ragas_run' && r.suite_key === this.suite.suite_key && r.judge_pick
        );
        pick = (run && run.judge_pick) || (this.suite.payload && this.suite.payload.judge_pick) || null;
      }
      const key = pick && pick.config_key;
      if (key === ENV_PICK) {
        // An explicit system-default pick is not a config doc — restore it as
        // itself, never demote it to the active-config default.
        this.judgeConfigKey = ENV_PICK;
        this.judgeModel = '';
        return;
      }
      if (key && this.modelConfigs.some((c) => c._key === key)) {
        this.judgeConfigKey = key;
        await this.onJudgeConfigChange();
        if (pick.model && this.judgeModels.includes(pick.model)) this.judgeModel = pick.model;
      } else {
        this.judgeConfigKey = '';
        this.judgeModel = '';
        this.judgeModels = [];
      }
    },
    metricLabel(m) {
      return this.translate(`okf.ragas.metric.${m}`, m.replace(/_/g, ' '));
    },
    /** The plain-language RAGAS meaning for a metric — chart ⓘ + PDF notes. */
    metricNote(m) {
      return this.translate(`okf.ragas.metric.note.${m}`, METRIC_NOTE_FALLBACKS[m] || m.replace(/_/g, ' '));
    },
    barWidth(v) {
      return typeof v === 'number' && v === v ? `${Math.max(2, Math.min(100, Math.round(v * 100)))}%` : '0%';
    },
    scoreText(v) {
      return typeof v === 'number' && v === v ? v.toFixed(2) : '—';
    },
    /** How many rows the judge actually scored for a metric. A mean over a
     * fraction of the rows is NOT the run's score for that metric, and the
     * panel has to say so: a re-score with MiniMax-M3 produced
     * context_entities_recall for 21 of 100 rows and the comparison read as
     * a like-for-like delta over the whole run. */
    coverageText(summary, metric) {
      const c = summary && summary.coverage && summary.coverage[metric];
      if (!c || typeof c.scored !== 'number' || typeof c.total !== 'number') return '';
      if (c.total <= 0 || c.scored >= c.total) return '';
      return `${c.scored}/${c.total}`;
    },
    colStyle(key) {
      const w = this.colWidths[key];
      return w ? { width: `${w}px` } : {};
    },
    /** Drag a header grip to resize that column; widths land on the colgroup
     *  col. Double-click resets (resetCol below). Document-level listeners
     *  because the drag outlives the grip element under the cursor. */
    startColResize(evt, key) {
      const th = evt.target.closest('th');
      if (!th) return;
      const startX = evt.clientX;
      const startW = th.getBoundingClientRect().width;
      const move = (e) => {
        const w = Math.max(48, Math.round(startW + e.clientX - startX));
        this.colWidths = { ...this.colWidths, [key]: w };
      };
      const up = () => {
        document.removeEventListener('mousemove', move);
        document.removeEventListener('mouseup', up);
        document.body.style.cursor = '';
      };
      document.body.style.cursor = 'col-resize';
      document.addEventListener('mousemove', move);
      document.addEventListener('mouseup', up);
    },
    resetCol(key) {
      const next = { ...this.colWidths };
      delete next[key];
      this.colWidths = next;
    },
    /** Copy the FULL answer text — the cell shows it whole in a readonly
     *  textarea (selectable like the suite table); the button is the one
     *  gesture path. execCommand fallback for insecure contexts. */
    async copyAnswer(r) {
      const text = String(r.answer || '');
      try {
        await navigator.clipboard.writeText(text);
      } catch {
        const ta = document.createElement('textarea');
        ta.value = text;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
      }
      this.copiedId = r.id;
      clearTimeout(this._copyTimer);
      this._copyTimer = setTimeout(() => {
        this.copiedId = '';
      }, 2000);
    },
    shortDate(iso) {
      return String(iso || '')
        .slice(0, 16)
        .replace('T', ' ');
    },
    rowFails(r) {
      const s = this.runDoc && this.runDoc.payload && this.runDoc.payload.summary;
      if (!s) return false;
      return (s.failing || []).some((f) => f.id === r.id);
    },
    // Retrieval-set metrics judge the DELIVERED CONTEXT SET, not the answer.
    // A row that fails only those — while every answer-quality metric passed
    // — is "answer OK, retrieval noise" (David, 2026-10-23: a good answer
    // must not read as a red failure and send an admin scurrying to fix
    // nothing). The row keeps its amber noise pill; it loses the red row.
    rowAnswerOkButNoisy(r) {
      const s = this.runDoc && this.runDoc.payload && this.runDoc.payload.summary;
      if (!s) return false;
      const f = (s.failing || []).find((x) => x.id === r.id);
      if (!f || !f.fails || !f.fails.length) return false;
      const ANSWER_METRICS = [
        'faithfulness',
        'answer_relevancy',
        'answer_similarity',
        'answer_correctness',
        'factual_correctness'
      ];
      return f.fails.every((k) => !ANSWER_METRICS.includes(k));
    },
    /** Latest-run outcome for a suite entry, by id (null before any run).
     * Pass/fail comes from the SERVER's summary.failing (the same source
     * the results table uses) — no client-side threshold invention. */
    runOutcome(e) {
      if (!this.runRows || !this.runRows.length) return null;
      const r = this.runRows.find((x) => x.id === e.id);
      if (!r) return null;
      const s = this.runDoc && this.runDoc.payload && this.runDoc.payload.summary;
      const fails = (((s || {}).failing || []).find((f) => f.id === e.id) || {}).fails || [];
      const errored = !!(r.error && r.error.code);
      return {
        retrieved: (r.contexts || []).length,
        abstained: !!r.abstained,
        failed: errored,
        judged: this.rowJudged(r),
        fails,
        ok: !errored && !r.abstained && fails.length === 0
      };
    },
    runOutcomeLabel(e) {
      const o = this.runOutcome(e);
      if (!o) return '';
      if (o.failed) return this.translate('okf.ragas.run.rowError', 'error');
      // A decline that carried no answer was never handed to the judge —
      // a different state from a decline that was judged (whose zeros ARE
      // in the averages). The guide taught the second as if it were the
      // only one; the panel now says which one it is.
      if (o.abstained && !o.judged) {
        return this.translate('okf.ragas.run.declinedUnjudged', 'declined — not judged');
      }
      if (o.abstained) return this.translate('okf.ragas.run.abstained', 'abstained');
      return o.ok
        ? this.translate('okf.ragas.run.pass', 'pass')
        : `${this.translate('okf.ragas.run.fail', 'fail')}: ${o.fails.join(', ')}`;
    },
    /**
     * Was this row handed to the judge?
     *
     * The server writes the flag at submit time; a row with no numeric
     * metric was never measured. A DECLINE that carried no answer was
     * never handed to the judge at all — the case the guide used to
     * describe as if it were judged.
     */
    rowJudged(r) {
      if (r && typeof r.judged === 'boolean') return r.judged;
      const m = (r && r.metrics) || {};
      return Object.keys(m).some((k) => typeof m[k] === 'number' && m[k] === m[k]);
    },
    /**
     * Colour the attribution stage by what it means for the operator:
     * a retrieval-stage failure is a knob to turn (warning), a corpus gap
     * is a benchmark defect (danger), and a judge/llm failure is neither
     * (neutral). 2026-10-23 — the stages came from the evidence ladder,
     * so they now carry real meaning.
     */
    stageVariant(stage) {
      if (stage === 'corpus') return 'danger';
      // The run's own retrieval call failed (rate limit, timeout) — the row
      // has no answer and makes the run invalid. Red, like a corpus gap: it
      // demands action (re-run), not tuning.
      if (stage === 'retrieval-error') return 'danger';
      if (stage === 'judge' || stage === 'pipeline') return 'neutral';
      // The judge returned nothing measurable for the row — a judge-side
      // problem, like the other judge stages, not a knob to turn.
      if (stage === 'unmeasured') return 'neutral';
      return 'warning';
    },
    /**
     * Where the expected passage was lost, in one line: how many passages
     * were found in the corpus, how many made the candidate pool, and how
     * many reached the model. The counts are only shown for rows whose
     * stage came from the retrieval ladder — for the others the judge
     * credited the content as covered, so the counts would mislead.
     */
    evidenceSummary(a) {
      const e = a.evidence;
      if (!e) return '';
      const rank = e.candidate_rank ? `, rank #${e.candidate_rank}` : '';
      return `${e.in_corpus}/${e.passages} in corpus, ${e.in_candidates} candidate, ${e.in_contexts} in context${rank}`;
    },
    evidenceTitle(a) {
      const e = a.evidence;
      if (!e) return '';
      const rank = e.candidate_rank
        ? this.translate(
            'okf.ragas.explain.rankTitle',
            'The passage is in the corpus but outside the candidate pool — it ranks #{n}.'
          ).replace('{n}', String(e.candidate_rank))
        : '';
      return `${this.translate(
        'okf.ragas.explain.evidenceTitle',
        'Passages found in the corpus / candidate pool / delivered to the model. Method: {method}'
      ).replace('{method}', String(e.method || ''))}${rank ? ` ${rank}` : ''}`;
    },
    passagesTitle(e) {
      const ps = e.reference_passages || [];
      const o = this.runOutcome(e);
      const head = ps.length ? String(ps[0]).slice(0, 120) : '';
      return o ? `retrieved ${o.retrieved} — ${head}` : head;
    },
    gaugeOptions(g) {
      const t = this.chartThemeStrings();
      const mode = this.chartTheme === 'dark' ? 'dark' : 'light';
      return {
        chart: { type: 'radialBar', sparkline: { enabled: true } },
        theme: { mode },
        colors: [t.chartColors[Math.abs(g.key.length) % t.chartColors.length]],
        plotOptions: {
          radialBar: {
            hollow: { size: '55%' },
            dataLabels: {
              name: { show: false },
              value: { show: true, formatter: (v) => `${(Number(v) / 100).toFixed(2)}`, color: t.textColor }
            }
          }
        }
      };
    },
    async loadRepoChoices() {
      const res = await this.$store.dispatch('okf/fetchRepos', { silent: true }).catch(() => null);
      const repos = (res && res.ok && res.repos) || [];
      this.repoChoices = repos
        .filter((r) => !this.repo || r.repo_id === this.repo.repo_id || r.head)
        .slice(0, 25)
        .map((r) => ({ repo_id: r.repo_id, name: r.name }));
    },
    async loadLatest() {
      const res = await this.$store.dispatch('okf/ragasListRuns', {
        repoId: this.repo && this.repo.repo_id,
        kind: 'all',
        limit: 20
      });
      if (!res.ok) return;
      this.runHistory = res.runs.filter((r) => r.kind === 'ragas_run');
      const latestSuite = res.runs.find((r) => r.kind === 'ragas_suite');
      if (latestSuite) this.loadSuite(latestSuite.suite_key || latestSuite._key);
      const latestRun = this.runHistory.find((r) => r.status === 'done');
      if (latestRun) this.onLoadRun(latestRun._key, latestRun.suite_key, { silent: true });
    },
    async loadSuite(suiteKey) {
      // A genuinely different suite invalidates the user's selection (the
      // new suite's own memory should load); a re-load of the SAME suite is
      // the clobber path the metricsTouched guard exists for.
      if (this.suite && this.suite.suite_key !== suiteKey) this.metricsTouched = false;
      const epoch = ++this.suiteEpoch;
      const res = await this.$store.dispatch('okf/ragasGetSuite', {
        repoId: this.repo && this.repo.repo_id,
        suiteKey
      });
      if (epoch !== this.suiteEpoch) return;
      // generating check FIRST: the live envelope carries no kind, but any
      // doc shape that ever grows one must still adopt rather than render
      // as an idle suite (live incident 2026-10-18: refresh orphaned a
      // running generation because the branches matched the wrong way).
      if (res.ok && res.result && res.result.status === 'generating') {
        // refresh/reopen adoption (David 2026-10-18): a generating suite
        // must never be orphaned from the UI — restore progress + Cancel
        this.adoptGeneration(suiteKey, res.result);
      } else if (res.ok && res.result && res.result.kind === 'ragas_suite') {
        this.suite = res.result;
        // Seed the picker ONLY while the user has not expressed a choice:
        // a background refresh lands mid-dialog and must not wipe the
        // ticked selection (2026-10-28: all 10 ticked, run scored 4).
        if (!this.metricsTouched) {
          this.selectedMetrics = [
            ...new Set([...DEFAULT_METRICS, ...((this.suite.payload && this.suite.payload.metrics_config) || [])])
          ];
        }
        this.$emit('changed');
        await this.adoptInFlight(suiteKey);
        // Judge memory: reopen/refresh restores the pick this suite was last
        // used with, not the deployment default. Awaited so a run-specific
        // restore (onLoadRun) always runs after and wins. The GENERATION
        // pick has its own memory (the model the suite was synthesized with).
        await this.restoreGenerationPick();
        await this.restoreJudgePick();
      }
    },
    /** Re-attach to server-side work that outlived this page load. */
    async adoptInFlight(suiteKey) {
      if (this.runBusy) return;
      await this.refreshHistory(); // history may not be loaded yet on first mount
      const running = (this.runHistory || []).find(
        (r) => r.status === 'running' && (!r.suite_key || r.suite_key === suiteKey)
      );
      if (!running) return;
      this.runBusy = true;
      this.runningRunKey = running._key;
      this.runProgress = (running && running.progress) || { phase: 'retrieval', done: 0, total: 0 };
      this.$store
        .dispatch('okf/ragasAdoptRun', {
          repoId: this.repo && this.repo.repo_id,
          suiteKey,
          runKey: running._key,
          signal: this.pollSignal,
          onProgress: (p) => {
            this.runProgress = p;
          }
        })
        .then((res) => {
          if (res.ok) {
            this.runDoc = res.result;
            this.refreshHistory();
            this.$emit('changed');
          } else if (res.code !== 'POLL_ABORTED') {
            // POLL_ABORTED means this panel went away — nothing to show.
            // #80805: the store's poll envelopes carry okf.labErrors.* keys.
            this.error = translateLabError(res.message, this.translate);
          }
        })
        .finally(() => {
          this.runBusy = false;
          this.runningRunKey = null;
          this.runProgress = null;
        });
    },
    adoptGeneration(suiteKey, envelope) {
      // Guard on the KEY, not generateBusy: the 409-adoption path arrives
      // from onGenerate with generateBusy already true (and must keep it).
      if (this.generatingKey && this.generatingKey !== suiteKey) return;
      this.generateBusy = true;
      this.generatingKey = suiteKey;
      this.genProgress = (envelope && envelope.progress) || null;
      this.$store
        .dispatch('okf/ragasAdoptGeneration', {
          repoId: this.repo && this.repo.repo_id,
          suiteKey,
          signal: this.pollSignal,
          onProgress: (p) => {
            this.genProgress = p;
          }
        })
        .then((res) => {
          if (res.ok) {
            this.suite = res.result;
            this.$emit('changed');
          } else if (res.code !== 'POLL_ABORTED') {
            // #80805: the store's poll envelopes carry okf.labErrors.* keys.
            this.error = translateLabError(res.message, this.translate);
          }
        })
        .finally(() => {
          this.generateBusy = false;
          this.generatingKey = null;
          this.genProgress = null;
        });
    },
    async onGenerate() {
      this.error = '';
      this.generateBusy = true;
      this.genProgress = null;
      // When the server 409s because a generation is already running, we
      // attach to it — the adoption then OWNS the busy state, so the finally
      // must not stomp it back to idle (that race orphaned the UI once).
      let adopted = false;
      try {
        const dist = [
          { synthesizer: 'single_hop_specific', weight: Number(this.distSingle) || 0 },
          { synthesizer: 'multi_hop_abstract', weight: Number(this.distAbstract) || 0 },
          { synthesizer: 'multi_hop_specific', weight: Number(this.distSpecific) || 0 }
        ].filter((d) => d.weight > 0);
        const res = await this.$store.dispatch('okf/ragasGenerate', {
          repoId: this.repo && this.repo.repo_id,
          options: {
            repo_ids: this.selectedRepoIds,
            testset_size: this.genSize,
            query_distribution: dist,
            num_personas: this.genPersonas,
            // 8-7: explicit GENERATION model pick ('' fields simply omit the
            // override). The generation's model and the run's judge are
            // separate operations with separate picks (David, 2026-10-25).
            judge_config_key: this.genConfigKey || undefined,
            judge_model: this.genConfigKey ? this.genModel || undefined : undefined
          },
          signal: this.pollSignal,
          onStarted: (suiteKey) => {
            this.generatingKey = suiteKey;
          },
          onProgress: (p) => {
            this.genProgress = p;
          }
        });
        if (res.ok) {
          this.suite = res.result;
          this.$emit('changed');
        } else if (res.code === 'GENERATION_IN_FLIGHT') {
          adopted = await this.adoptRunningGeneration();
        } else if (res.code !== 'POLL_ABORTED') {
          // #80805: the store's poll envelopes carry okf.labErrors.* keys.
          this.error = translateLabError(res.message, this.translate);
        }
      } finally {
        if (!adopted) {
          this.generateBusy = false;
          this.generatingKey = null;
          this.genProgress = null;
        }
        this.cancelBusy = false;
      }
    },
    /** A generation is already running for this repo (409 GENERATION_IN_FLIGHT
     * — usually this page lost it to a refresh, or another window started it):
     * find it via the suite list (the server surfaces the live generation as
     * a synthetic newest row) and adopt it — progress bar + Cancel. Returns
     * true when attached. */
    async adoptRunningGeneration() {
      const res = await this.$store.dispatch('okf/ragasListRuns', {
        repoId: this.repo && this.repo.repo_id,
        kind: 'ragas_suite',
        limit: 5
      });
      const gen = ((res && res.runs) || []).find((r) => r.status === 'generating');
      if (!gen) {
        // Stale server without the synthetic row: keep the honest error.
        this.error = this.translate(
          'okf.ragas.generate.inFlight',
          'A benchmark-suite generation is already running for this repository — it will appear in the suite list when it completes.'
        );
        return false;
      }
      await this.loadSuite(gen.suite_key || gen._key);
      return !!this.generatingKey;
    },
    async onCancelGenerate() {
      if (!this.generatingKey) return;
      this.cancelBusy = true;
      const res = await this.$store.dispatch('okf/ragasCancelGeneration', {
        repoId: this.repo && this.repo.repo_id,
        suiteKey: this.generatingKey
      });
      if (!res.ok) this.error = res.message;
      // On ok: nothing to do here — the ragasGenerate poll exits on its next
      // tick with RAGAS_JOB_CANCELLED and clears the busy state.
    },
    async onCancelRun() {
      if (!this.runningRunKey) return;
      this.runCancelBusy = true;
      const res = await this.$store.dispatch('okf/ragasCancelRun', {
        repoId: this.repo && this.repo.repo_id,
        suiteKey: this.suite && this.suite.suite_key,
        runKey: this.runningRunKey
      });
      this.runCancelBusy = false;
      // The run may have landed between the operator's click and the
      // request reaching the server — then there is nothing to cancel, and
      // "no such run is executing" is not a failure the operator can act
      // on. It must not read as an error.
      if (!res.ok && res.code !== 'NO_RUN_IN_FLIGHT') this.error = res.message;
      // On ok: the ragasRun poll observes the cancelled run record next tick.
    },
    async onRename(name) {
      if (!this.suite || !name || !name.trim() || name === this.suite.name) return;
      const res = await this.$store.dispatch('okf/ragasRename', {
        repoId: this.repo && this.repo.repo_id,
        suiteKey: this.suite.suite_key,
        name: name.trim()
      });
      if (res.ok) this.suite = res.result;
      else this.error = res.message;
    },
    // One dispatch-and-apply for every row mutation (review !622 wave 2,
    // #78697 — onEditEntry/onFlipEntry/onRemoveEntry were three copies of
    // this envelope and tail).
    async patchSuite(payload) {
      const res = await this.$store.dispatch('okf/ragasUpdateRows', {
        repoId: this.repo && this.repo.repo_id,
        suiteKey: this.suite.suite_key,
        payload
      });
      if (res.ok) this.suite = res.result;
      else this.error = res.message;
      return res;
    },
    async onEditEntry(entry, field, value) {
      if (value === entry[field]) return;
      await this.patchSuite({ modifications: [{ id: entry.id, [field]: value }] });
    },
    async onFlipEntry(entry) {
      await this.patchSuite({ modifications: [{ id: entry.id, flip_oos: !entry.oos }] });
    },
    async onRemoveEntry(entry) {
      await this.patchSuite({ remove_ids: [entry.id] });
    },
    async onAddQuery() {
      const query = window.prompt(this.translate('okf.ragas.suite.addPrompt', 'Question to add:'));
      if (!query || !query.trim()) return;
      const reference =
        window.prompt(this.translate('okf.ragas.suite.addReference', 'Expected answer (optional):')) || '';
      const res = await this.$store.dispatch('okf/ragasAddQueries', {
        repoId: this.repo && this.repo.repo_id,
        suiteKey: this.suite.suite_key,
        queries: [{ query: query.trim(), reference_answer: reference }]
      });
      if (res.ok) this.suite = res.result && res.result.suite ? res.result.suite : this.suite;
      else this.error = res.message;
    },
    async onProbe(entry) {
      this.probeBusy = entry.id;
      try {
        const res = await this.$store.dispatch('okf/ragasProbe', {
          repoId: this.repo && this.repo.repo_id,
          suiteKey: this.suite.suite_key,
          id: entry.id
        });
        if (res.ok) {
          const e = this.entries.find((x) => x.id === entry.id);
          if (e) e.lastProbe = res.result;
        } else {
          this.error = res.message;
        }
      } finally {
        this.probeBusy = '';
      }
    },
    async onRun() {
      this.error = '';
      this.runBusy = true;
      this.runningRunKey = null;
      this.runProgress = { phase: 'retrieval', done: 0, total: this.entries.length };
      try {
        const res = await this.$store.dispatch('okf/ragasRun', {
          repoId: this.repo && this.repo.repo_id,
          suiteKey: this.suite.suite_key,
          metrics: this.selectedMetrics,
          // 8-7: explicit judge pick ('' fields simply omit the override)
          judge_config_key: this.judgeConfigKey || undefined,
          judge_model: this.judgeConfigKey ? this.judgeModel || undefined : undefined,
          signal: this.pollSignal,
          onStarted: (runKey) => {
            this.runningRunKey = runKey;
          },
          onProgress: (p) => {
            this.runProgress = p;
          }
        });
        if (res.ok) {
          this.runDoc = res.result;
          // The submitted selection is now the run's own record — clear the
          // touched flag so the completion load restores FROM it (the next
          // dialog session starts from the run's metrics, not a stale flag).
          this.metricsTouched = false;
          this.$emit('changed');
        } else if (res.code === 'RUN_CANCELLED') {
          // The user stopped it — not a failure, and it must not read as one.
          // The finally block refreshes the history, so the row turns
          // 'cancelled' on its own.
        } else if (res.code !== 'POLL_ABORTED') {
          // #80805: the store's poll envelopes carry okf.labErrors.* keys.
          this.error = translateLabError(res.message, this.translate);
        }
      } finally {
        this.runBusy = false;
        this.runProgress = null;
        this.runningRunKey = null;
        this.runCancelBusy = false;
        // The history must show the TERMINAL state — a cancelled run lands
        // as 'cancelled' server-side, and its row must say so without a
        // manual refresh.
        await this.refreshHistory();
      }
    },
    async refreshHistory() {
      const res = await this.$store.dispatch('okf/ragasListRuns', {
        repoId: this.repo && this.repo.repo_id,
        kind: 'all',
        limit: 20
      });
      if (res.ok) this.runHistory = res.runs.filter((r) => r.kind === 'ragas_run');
    },
    /** Run-delete confirm handler. The 409 codes get readable text instead of
     *  the raw store message — the admin should know WHY it refused. */
    async onRunDeleteAction(key) {
      if (key === 'cancel') {
        this.runDeleteAsk = null;
        return;
      }
      if (key !== 'confirm' || !this.runDeleteAsk || this.runDeleteBusy) return;
      const target = this.runDeleteAsk;
      this.runDeleteBusy = true;
      const res = await this.$store.dispatch('okf/ragasDeleteRun', {
        repoId: this.repo && this.repo.repo_id,
        suiteKey: target.suite_key,
        runKey: target._key
      });
      this.runDeleteBusy = false;
      if (!res.ok) {
        if (res.code === 'RUN_IN_FLIGHT') {
          this.error = this.translate('okf.ragas.runDelete.inFlight', 'This run is still executing — cancel it first.');
        } else if (res.code === 'EXPLAIN_IN_FLIGHT') {
          this.error = this.translate(
            'okf.ragas.runDelete.explainInFlight',
            'A failure explanation is still running for this run — wait for it to finish.'
          );
        } else {
          this.error = res.message || this.translate('okf.ragas.runDelete.failed', 'Deleting the run failed.');
        }
        return; // dialog stays open — the admin can retry or cancel
      }
      this.runDeleteAsk = null;
      this.error = '';
      // The run on screen may be the one deleted — drop it (and its explain)
      // rather than showing results that no longer exist.
      if (this.runDoc && this.runDoc._key === target._key) {
        this.runDoc = null;
        this.explainDoc = null;
      }
      await this.refreshHistory();
      this.$emit('changed');
    },
    /** Open the re-score dialog for a finished run. The judge starts from the
     * run's OWN judge — the operator usually wants a different one, but the
     * default must be visible, not a mystery. */
    /** The judge that scored a run, by name (David 2026-10-24: the RUN
     * column must name the JUDGE, not the opaque run key). */
    runJudgeLabel(run) {
      if (!run) return '';
      const model = run.judge_model || (run.judge_pick && run.judge_pick.model) || null;
      const config = run.judge_config || null;
      // The ENV judge carries no config name, so the label would read as a
      // bare model id ("ibm-granite/granite-4.1-8b") — indistinguishable
      // from a picked config with the same model, and it does not say WHERE
      // that judge came from. Two runs scored by different judges must be
      // told apart at a glance: this is the whole point of the column.
      if (run.judge_source === 'env') {
        const label = this.translate('okf.ragas.history.judgeEnv', 'system default');
        return model ? `${model} · ${label}` : label;
      }
      if (model && config) return `${model} · ${config}`;
      if (model) return model;
      if (config) return config;
      return this.translate('okf.ragas.history.judgeUnknown', 'Judge not recorded');
    },
    /** Short judge tag for a trend x-label: the bare model name (vendor
     * prefix stripped — `ibm-granite/granite-4.1-8b` renders as
     * `granite-4.1-8b`). Falls back to the full judge label when no model
     * was recorded (older runs). */
    trendJudgeTag(run) {
      const model = String((run && (run.judge_model || (run.judge_pick && run.judge_pick.model))) || '')
        .split('/')
        .pop()
        .trim();
      return model || this.runJudgeLabel(run);
    },
    async onRescoreOpen(run) {
      this.rescoreAsk = run;
      this.rescoreModel = '';
      this.rescoreModels = [];
      const pick = run.judge_pick || null;
      this.rescoreConfigKey = pick && pick.config_key ? pick.config_key : '';
      if (this.rescoreConfigKey) await this.onRescoreConfigChange();
    },
    async onRescoreConfigChange() {
      this.rescoreModel = '';
      this.rescoreModels = [];
      if (this.rescoreConfigKey === ENV_PICK) return;
      // The EMPTY pick is the ACTIVE configuration — its models are choosable
      // too, so a re-score can name the model it re-scores with.
      const key = this.rescoreConfigKey || (this.activeModelConfig && this.activeModelConfig._key);
      if (!key) return;
      const res = await this.$store.dispatch('okf/modelConfigModels', { key }).catch(() => null);
      if (res && res.ok) this.rescoreModels = res.models || [];
    },
    onRescoreClose() {
      this.rescoreAsk = null;
      this.rescoreBusy = false;
    },
    /** Re-score: the same answers, a different judge, a SEPARATE run. */
    async onRescoreAction(key) {
      if (key === 'cancel') {
        this.onRescoreClose();
        return;
      }
      if (key !== 'confirm' || !this.rescoreAsk || this.rescoreBusy) return;
      const source = this.rescoreAsk;
      this.rescoreBusy = true;
      this.error = '';
      // A re-score IS a run: it drives the SAME progress bar and the SAME
      // Cancel button as the run leg (David 2026-10-25: "it also cannot be
      // tracked and does not connect to the UI with a progress bar… I cannot
      // stop the re-scoring"). The re-score's OWN run key is the cancel
      // target — cancelling the source run would stop the wrong thing.
      //
      // The dialog closes NOW: the judge leg runs for minutes to hours and
      // the operator must not sit behind a modal for it. On failure it comes
      // back with the error, so the pick can be retried.
      this.rescoreAsk = null;
      this.runBusy = true;
      this.runningRunKey = null;
      this.runProgress = { phase: 'judge', done: 0, total: 0 };
      try {
        const res = await this.$store.dispatch('okf/ragasRescoreRun', {
          repoId: this.repo && this.repo.repo_id,
          suiteKey: source.suite_key,
          runKey: source._key,
          payload: {
            judge_config_key: this.rescoreConfigKey || undefined,
            judge_model: this.rescoreConfigKey && this.rescoreModel ? this.rescoreModel : undefined
          },
          signal: this.pollSignal,
          onStarted: (newKey) => {
            this.runningRunKey = newKey;
            // The new row shows up in the history as a running re-score, so
            // the operator can see it there and not only in this bar.
            this.refreshHistory();
          },
          onProgress: (p) => {
            this.runProgress = p;
          }
        });
        if (!res.ok) {
          if (res.code === 'RUN_CANCELLED') {
            // The user stopped it — that is not a failure and must not read
            // as one. The history refresh in the finally block shows the row
            // as cancelled.
          } else if (res.code === 'POLL_ABORTED') {
            // The panel went away mid-poll — nothing to show, nothing to retry.
            return;
          } else {
            // #80805: RESCORE_NOT_STARTED/RUN_TIMEOUT/RESCORE_FAILED messages
            // are okf.labErrors.* keys; a server message passes through.
            this.error =
              translateLabError(res.message, this.translate) ||
              this.translate('okf.ragas.rescore.failed', 'Re-scoring the run failed.');
            this.rescoreAsk = source; // back for a retry, with the same pick
          }
          return;
        }
        this.runDoc = res.result;
        this.$emit('changed');
      } finally {
        this.rescoreBusy = false;
        this.runBusy = false;
        this.runProgress = null;
        this.runningRunKey = null;
        this.runCancelBusy = false;
        // The history must show the TERMINAL state — a cancelled re-score
        // lands as 'cancelled', and its row must say so without a manual
        // refresh (David 2026-10-25: the run had to be stoppable AND visible).
        await this.refreshHistory();
      }
    },
    async onLoadRun(runKey, suiteKey, opts = {}) {
      if (suiteKey && (!this.suite || this.suite.suite_key !== suiteKey)) await this.loadSuite(suiteKey);
      const res = await this.$store
        .dispatch('okf/ragasGetRunQuiet', {
          repoId: this.repo && this.repo.repo_id,
          suiteKey: suiteKey || (this.suite && this.suite.suite_key),
          runKey
        })
        .catch(() => null);
      if (res && res.ok) {
        this.runDoc = res.result;
        // Metric memory (judge-pick pattern, 2026-10-28): loading a run
        // restores the metrics THAT RUN was scored with — the picker shows
        // the suite's last real measurement, not the generation defaults.
        // Gated on metricsTouched: the user's live selection wins.
        if (!this.metricsTouched && this.runDoc && Array.isArray(this.runDoc.metrics) && this.runDoc.metrics.length) {
          this.selectedMetrics = [...new Set([...DEFAULT_METRICS, ...this.runDoc.metrics])];
        }
        // The advisor travels with the run: a persisted explain for THIS run
        // loads automatically, so the admin sees "what can I do" with the
        // results instead of having to know the button exists (2026-10-19:
        // "how does the admin user know what possible actions they can take").
        this.explainDoc = null;
        const ex = await this.$store
          .dispatch('okf/ragasGetExplainQuiet', {
            repoId: this.repo && this.repo.repo_id,
            suiteKey: this.suite && this.suite.suite_key,
            runKey
          })
          .catch(() => null);
        if (ex && ex.ok) this.explainDoc = ex.result;
        // Judge memory: viewing a run restores the judge pick THAT run was
        // made with — the selector mirrors the results on screen.
        const fid = this.runDoc && this.runDoc.payload && this.runDoc.payload.fidelity;
        if (fid && fid.judge && fid.judge.pick) this.restoreJudgePick(fid.judge.pick);
      } else if (!opts.silent && res) this.error = res.message;
    },
    async onExplain() {
      this.error = '';
      this.explainBusy = true;
      this.explainProgress = null;
      try {
        const res = await this.$store.dispatch('okf/ragasExplain', {
          repoId: this.repo && this.repo.repo_id,
          suiteKey: this.suite.suite_key,
          runKey: this.runDoc && this.runDoc._key,
          signal: this.pollSignal,
          onProgress: (p) => {
            this.explainProgress = p || null;
          }
        });
        if (res.ok) this.explainDoc = res.result;
        // #80805: EXPLAIN_TIMEOUT/EXPLAIN_FAILED messages are okf.labErrors.* keys.
        else if (res.code !== 'POLL_ABORTED') this.error = translateLabError(res.message, this.translate);
      } finally {
        this.explainBusy = false;
        this.explainProgress = null;
      }
    },
    async onExportSuite() {
      this.exportBusy = true;
      try {
        const res = await this.$store.dispatch('okf/ragasExportSuite', {
          repoId: this.repo && this.repo.repo_id,
          suiteKey: this.suite.suite_key
        });
        if (res.ok) this.downloadBlob(res.data, `${this.suite.name || 'benchmark-suite'}.xlsx`);
        else this.error = res.message;
      } finally {
        this.exportBusy = false;
      }
    },
    async onExportResults() {
      this.exportBusy = true;
      try {
        const res = await this.$store.dispatch('okf/ragasExportResults', {
          repoId: this.repo && this.repo.repo_id,
          suiteKey: this.suite.suite_key,
          runKeys: this.runDoc && this.runDoc._key ? [this.runDoc._key] : this.runHistory.slice(0, 5).map((h) => h._key)
        });
        if (res.ok) this.downloadBlob(res.data, `benchmark-results-${this.suite.suite_key}.xlsx`);
        else this.error = res.message;
      } finally {
        this.exportBusy = false;
      }
    },
    async onImportFile(ev) {
      const file = ev.target.files && ev.target.files[0];
      ev.target.value = '';
      if (!file) return;
      this.importBusy = true;
      try {
        const buf = await file.arrayBuffer();
        const res = await this.$store.dispatch('okf/ragasImportSuite', {
          repoId: this.repo && this.repo.repo_id,
          arrayBuffer: buf
        });
        if (res.ok) {
          this.suite = res.result;
          this.$emit('changed');
        } else {
          this.error = res.message;
        }
      } finally {
        this.importBusy = false;
      }
    },
    downloadBlob(data, filename) {
      const blob = new Blob([data], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
    },
    /** The PDF report: tables + gauge images, built client-side (jsPDF is
     * an existing dependency — no server-side rendering, per the spec). */
    /** PDF report (David 2026-10-19): the per-metric RAGAS notes are IN the
     * report, and the format parallels the offline harness export
     * (tests/rag-benchmarks enrich_xlsx_v2): per-metric aggregates with
     * notes, status counts (n / evaluable / abstained / failing), the
     * gauge + trend + status charts, a compare-across-runs table with
     * delta-vs-first-run, and per-question rows with status flags. */
    async downloadPdf() {
      this.pdfBusy = true;
      try {
        const { jsPDF } = await import('jspdf');
        const doc = new jsPDF({ unit: 'pt', format: 'a4' });
        const W = doc.internal.pageSize.getWidth();
        const H = doc.internal.pageSize.getHeight();
        const M = 40;
        let y = M;
        const need = (h) => {
          if (y + h > H - M) {
            doc.addPage();
            y = M;
          }
        };
        const summary = (this.runDoc && this.runDoc.payload && this.runDoc.payload.summary) || {};

        doc.setFontSize(16);
        doc.text(this.translate('okf.ragas.pdf.title', 'RAGAS benchmark report'), M, y);
        y += 18;
        doc.setFontSize(9);
        doc.text(
          `${this.translate('okf.ragas.pdf.suite', 'Suite')}: ${this.suite ? this.suite.name || this.suite.suite_key : '—'}`,
          M,
          y
        );
        y += 12;
        doc.text(
          `${this.translate('okf.ragas.pdf.run', 'Run')}: ${this.runDoc ? this.runDoc._key : '—'}   ${this.runDoc ? this.shortDate(this.runDoc.created_at) : ''}`,
          M,
          y
        );
        y += 20;

        // Summary: metric value + its plain-language RAGAS note (the same
        // text the chart ⓘ popups show).
        doc.setFontSize(11);
        doc.text(this.translate('okf.ragas.pdf.summary', 'Summary'), M, y);
        y += 14;
        doc.setFontSize(9);
        const noteLines = [];
        for (const [k, v] of Object.entries(summary.metrics || {})) {
          need(28);
          doc.text(`${this.metricLabel(k)}: ${this.scoreText(v)}`, M, y);
          y += 11;
          doc.setFontSize(8);
          doc.setTextColor(90);
          const wrapped = doc.splitTextToSize(this.metricNote(k), W - 2 * M);
          for (const line of wrapped.slice(0, 4)) {
            need(11);
            doc.text(line, M, y);
            y += 10;
          }
          doc.setTextColor(0);
          doc.setFontSize(9);
          y += 4;
          noteLines.push(k);
        }
        y += 6;

        // Status counts — the harness export's n / n_abstained / n_evaluable
        // accounting plus the failing count.
        need(40);
        doc.setFontSize(11);
        doc.text(this.translate('okf.ragas.pdf.status', 'Outcomes'), M, y);
        y += 14;
        doc.setFontSize(9);
        const st = [
          `${this.translate('okf.ragas.pdf.n', 'questions')}: ${summary.n != null ? summary.n : this.runRows.length}`,
          `${this.translate('okf.ragas.pdf.evaluable', 'evaluable')}: ${summary.n_evaluable != null ? summary.n_evaluable : '—'}`,
          `${this.translate('okf.ragas.pdf.abstained', 'abstained')}: ${summary.n_abstained != null ? summary.n_abstained : 0}`,
          `${this.translate('okf.ragas.results.failing', 'failing')}: ${summary.failing_count != null ? summary.failing_count : (summary.failing || []).length}`
        ];
        doc.text(st.join('   ·   '), M, y);
        y += 20;

        // Charts: gauges (two per row — all selected metrics, not just four),
        // then trend + status when present.
        const gauges = [];
        for (const g of this.aggregateRows) {
          const chart = this.$refs[`gauge-${g.key}`];
          const inst = chart && chart[0] && chart[0].chart;
          if (inst) {
            try {
              const img = await inst.dataURI();
              gauges.push(img.imgURI);
            } catch (e) {
              void e;
            }
          }
        }
        for (let i = 0; i < gauges.length; i += 2) {
          need(95);
          doc.addImage(gauges[i], 'PNG', M, y, 160, 85);
          if (gauges[i + 1]) doc.addImage(gauges[i + 1], 'PNG', M + 250, y, 160, 85);
          y += 95;
        }
        const trendInst = this.$refs.trendChart && this.$refs.trendChart.chart;
        if (trendInst && this.trendSeries.length) {
          try {
            const img = await trendInst.dataURI();
            need(220);
            doc.addImage(img.imgURI, 'PNG', M, y, W - 2 * M, ((W - 2 * M) * 200) / 715);
            y += ((W - 2 * M) * 200) / 715 + 12;
          } catch (e) {
            void e;
          }
        }

        // Compare across runs with delta-vs-first — the harness Compare tab.
        const history = [...this.runHistory].filter((h) => h.summary && h.summary.metrics).reverse();
        if (history.length > 1) {
          doc.addPage();
          y = M;
          doc.setFontSize(11);
          doc.text(this.translate('okf.ragas.pdf.compare', 'Compare across runs (delta vs first)'), M, y);
          y += 14;
          doc.setFontSize(8);
          const keys = this.historyMetricKeys;
          const head = ('run  ' + keys.map((m) => this.metricLabel(m).slice(0, 12)).join('  ')).slice(0, 120);
          doc.text(head, M, y);
          y += 10;
          const firstVals = keys.map((m) => history[0].summary.metrics[m]);
          for (const h of history) {
            need(10);
            const cells = keys.map((m, i) => {
              const v = h.summary.metrics[m];
              const d = typeof v === 'number' && typeof firstVals[i] === 'number' ? v - firstVals[i] : null;
              const ds = d === null || Math.abs(d) < 0.005 ? '' : d > 0 ? `+${d.toFixed(2)}` : d.toFixed(2);
              return `${this.scoreText(v)}${ds ? '/' + ds : ''}`;
            });
            // The row names its judge — a delta against a run scored by a
            // different judge is not like-for-like, and the table must say
            // so on every line (the trend chart annotates for the same
            // reason).
            const label =
              (h.created_at || '').slice(0, 10) + ' ' + this.trendJudgeTag(h) + ' ' + String(h._key || '').slice(-6);
            doc.text(`${label}  ${cells.join('  ')}`.slice(0, 120), M, y);
            y += 10;
          }
        }

        // Per-question rows with status flags (A=abstained, E=error,
        // F=failing a threshold) — the harness per-run tab shape.
        doc.addPage();
        y = M;
        doc.setFontSize(11);
        doc.text(this.translate('okf.ragas.pdf.perQuery', 'Per-question scores'), M, y);
        y += 14;
        doc.setFontSize(8);
        const keys = this.runMetricKeys;
        const failingIds = new Set((summary.failing || []).map((f) => f.id));
        doc.text(('# fl  ' + keys.map((m) => this.metricLabel(m).slice(0, 10)).join('  ')).slice(0, 120), M, y);
        y += 10;
        for (const r of this.runRows) {
          need(10);
          const flag = r.error ? 'E' : r.abstained ? 'A' : failingIds.has(r.id) ? 'F' : ' ';
          const q = String(r.query || r.id).slice(0, 44);
          const line = `${String(r.id).slice(0, 10)} ${flag} ${q}  ${keys.map((m) => this.scoreText(r.metrics && r.metrics[m])).join('   ')}`;
          doc.text(line.slice(0, 120), M, y);
          y += 10;
        }
        doc.save(`ragas-report-${(this.runDoc && this.runDoc._key) || 'suite'}.pdf`);
      } finally {
        this.pdfBusy = false;
      }
    }
  }
};
</script>

<style scoped>
.okf-ragas {
  display: flex;
  flex-direction: column;
  gap: 18px;
}

.okf-ragas__pane-head {
  display: flex;
  align-items: center;
  gap: var(--space-xs);
}

.okf-ragas__help-toggle {
  margin-left: auto;
  border: 0;
  background: transparent;
  color: var(--muted);
  font: inherit;
  font-size: var(--text-sm);
  text-decoration: underline;
  cursor: pointer;
  padding: 0 var(--space-xs);
}
.okf-ragas__help-toggle:hover,
.okf-ragas__help-toggle:focus {
  color: var(--accent);
}

.okf-ragas__help-list {
  margin: 0;
}
.okf-ragas__help-row {
  display: grid;
  grid-template-columns: 200px 1fr;
  gap: var(--space-sm);
  padding: var(--space-xs) 0;
  border-bottom: 1px solid var(--border);
}
.okf-ragas__help-row:last-child {
  border-bottom: 0;
}
.okf-ragas__help-row dt {
  font-weight: 600;
  color: var(--fg);
  font-size: var(--text-sm);
}
.okf-ragas__help-row dd {
  margin: 0;
  color: var(--muted);
  font-size: var(--text-sm);
  line-height: 1.5;
}
.okf-ragas__help-more {
  display: inline-block;
  margin-top: var(--space-sm);
  color: var(--accent);
  text-decoration: underline;
  font-size: var(--text-sm);
}
@media (max-width: 720px) {
  .okf-ragas__help-row {
    grid-template-columns: 1fr;
    gap: 2px;
  }
}

.okf-ragas__section {
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 14px;
}

.okf-ragas__advisor-hint {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--surface);
  padding: 10px 12px;
  margin: 8px 0;
}

/* An invalid run (errored answers / partial judge coverage) must not read
   like a result — the banner is deliberately loud (2026-10-21 review C1). */
.okf-ragas__invalid-run {
  display: flex;
  flex-direction: column;
  gap: 4px;
  border: 1px solid var(--danger);
  border-left-width: 4px;
  border-radius: 8px;
  background: var(--danger-bg);
  color: var(--fg);
  padding: 10px 12px;
  margin: 8px 0;
  font-size: 13px;
  line-height: 1.4;
}

.okf-ragas__dropped-note {
  color: var(--warning);
  border: 1px solid var(--warning);
  border-radius: 6px;
  background: var(--warning-bg);
  padding: 2px 8px;
  font-size: 12px;
}

.okf-ragas__judge-row {
  display: flex;
  align-items: flex-end;
  gap: 12px;
  flex-wrap: wrap;
  margin: 6px 0;
}
.okf-ragas__judge-inline select,
.okf-ragas__judge-row select,
.okf-ragas__judge-row input {
  font: inherit;
  font-size: 12px;
  padding: 4px 6px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--surface);
  color: var(--fg);
  max-width: 300px;
}
.okf-ragas__judge-model {
  max-width: 220px;
}

.okf-ragas__hint {
  color: var(--muted);
  font-size: 12px;
  margin: 4px 0 10px;
}

.okf-ragas__repos {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 18px;
  margin-bottom: 10px;
}

.okf-ragas__repo-row {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
}

.okf-ragas__dims {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  margin-bottom: 10px;
}

.okf-ragas__dim {
  display: flex;
  flex-direction: column;
  gap: 3px;
  font-size: 12px;
  color: var(--muted);
}

.okf-ragas__dim input {
  width: 90px;
}

.okf-ragas__actions {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.okf-ragas__file-label {
  position: relative;
  overflow: hidden;
  display: inline-flex;
}

.okf-ragas__file-label input {
  position: absolute;
  inset: 0;
  opacity: 0;
  cursor: pointer;
}

.okf-ragas__suite-head {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  margin-bottom: 10px;
}

.okf-ragas__muted {
  color: var(--muted);
  font-size: 12px;
}

.okf-ragas__probe-note {
  font-style: normal;
  color: var(--danger, #b3261e);
  font-size: 11px;
}

.okf-ragas__metrics {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  margin-bottom: 10px;
}

.okf-ragas__metric {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
}

.okf-ragas__progress {
  margin: 8px 0;
}

.okf-ragas__entries textarea,
.okf-ragas__query-input {
  width: 100%;
  min-width: 220px;
  font: inherit;
  font-size: 12px;
  resize: vertical;
  background: transparent;
  color: inherit;
  border: 1px solid transparent;
  border-radius: 4px;
  padding: 2px 4px;
}

.okf-ragas__query-input:focus {
  border-color: var(--border);
}

.okf-ragas__row-actions {
  white-space: nowrap;
  display: flex;
  align-items: center;
  gap: 6px;
}

.okf-ragas__gauges {
  display: flex;
  flex-wrap: wrap;
  gap: 14px;
  margin: 10px 0;
}

.okf-ragas__gauge {
  display: flex;
  flex-direction: column;
  align-items: center;
}

.okf-ragas__gauge-label {
  font-size: 11px;
  color: var(--muted);
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.okf-ragas__chart-head {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 4px;
}

.okf-ragas__chart-title {
  font-size: 12px;
  color: var(--muted);
}

.okf-ragas__trend,
.okf-ragas__status {
  margin: 10px 0;
}

.okf-ragas__trend-warn {
  margin-left: 8px;
}

.okf-ragas__table-scroll {
  overflow-x: auto; /* past the dialog's auto-size cap, scroll INSIDE — never off the side */
}
.okf-ragas__results th {
  position: relative;
  white-space: nowrap;
}
.okf-ragas__col-grip {
  position: absolute;
  right: 0;
  top: 0;
  bottom: 0;
  width: 8px;
  cursor: col-resize;
  user-select: none;
  touch-action: none;
}
.okf-ragas__col-grip::after {
  content: '';
  position: absolute;
  top: 25%;
  bottom: 25%;
  right: 2px;
  width: 2px;
  background: var(--border);
}
.okf-ragas__col-grip:hover::after,
.okf-ragas__col-grip:active::after {
  background: var(--fg);
}
.okf-ragas__cell-query {
  min-width: 220px;
  max-width: 340px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
}
.okf-ragas__cell-metric {
  min-width: 92px;
  white-space: nowrap;
}
.okf-ragas__cell-answer {
  min-width: 260px;
  max-width: 420px;
}
.okf-ragas__answer-text {
  width: 100%;
  min-width: 240px;
  resize: vertical; /* suite-table parity: drag to grow the cell */
  font: inherit;
  font-size: 12px;
  color: var(--fg);
  background: transparent;
  border: none;
  padding: 2px 0;
}

.okf-ragas__score {
  font-size: 11px;
  margin-left: 6px;
}

.okf-ragas__row--fail td {
  background: color-mix(in srgb, var(--danger, #c0392b) 10%, transparent);
}

.okf-ragas__row--selected td {
  background: color-mix(in srgb, var(--accent, #1f6feb) 12%, transparent);
}

.okf-ragas__row-actions {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
}

/* The RUN column names the judge; the key is secondary (David 2026-10-24). */
.okf-ragas__judge-name {
  font-weight: 600;
  line-height: 1.2;
}

.okf-ragas__run-key {
  font-size: 0.8em;
  opacity: 0.7;
}

.okf-ragas__advice-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border: 1px solid var(--border);
  border-radius: 999px;
  padding: 3px 10px;
  font-size: 12px;
  margin: 2px 6px 2px 0;
}

.okf-ragas__advice-kind {
  font-size: 10px;
  text-transform: uppercase;
  color: var(--muted);
}
</style>
