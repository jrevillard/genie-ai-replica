<!--
  ArtifactsView.vue — W6 / EPIC-6 / CAP-5: the OKF artifacts view.

  WHAT IT IS: the honest surface for the machine artifacts of the published
  repositories. A bundle zip (doc-repo `is_bundle: true`) is the per-version
  ingestion artifact of a published repo — NOT a document a steward uploaded.
  Today they sit in the default document list wearing the costume of
  documents: unlabeled, with a Delete affordance the server refuses
  (WS2: only the okf-service account may delete a bundle — every other
  caller gets 403 BUNDLE_PROTECTED). That is the "deletable in the UI but
  403s" lie CAP-5 names.

  WHAT IT SHOWS, per artifact:
    - the artifact (its file name — the download name);
    - a `repo@version` PROVENANCE pill: the repository's NAME (resolved from
      the okf store by repo_id) and the version the artifact was minted for;
    - the STATE (the doc-repo dataprep status);
    - the ACTIONS that are true for that artifact.

  THE THREE HONESTY RULES THIS VIEW KEEPS:
    1. NO DELETE, EVER. Not for Pending, not for any state. The WS2 guard
       refuses every non-okf-service delete, so an affordance here would be a
       promise the server cannot keep. (The epic offered "make it deletable
       via okf-service OR drop the affordance" — we drop it: a privileged
       write path would build on the very rule W7 is about to reverse.)
    2. NO INVENTED FACTS. A bundle with no `bundle_version` (8 of the 25 live
       ones) says the version is unknown — the version is NOT parsed out of
       the graph name (the banned pattern) and NOT guessed from the file
       name. An artifact whose repository does not resolve says so and
       renders no repository link — a dead link is worse than no link.
    3. THE SERVER'S TRUTH ONLY. The state comes from the artifact's own
       dataprep status; the provenance from the artifact's own repo_id and
       bundle_version.

  THE SHARED VOCABULARY: the state label + variant come from
  utils/documentStatus.js — the same module the document list uses, so the
  two surfaces cannot disagree about what "Ingested" means.
-->
<template>
  <section class="okf-artifacts" data-test-id="okf-artifacts-view">
    <header class="okf-artifacts__header">
      <div class="okf-artifacts__heading">
        <h4 class="okf-artifacts__title">{{ translate('okf.artifacts.title', 'OKF artifacts') }}</h4>
        <p class="okf-artifacts__lead">
          {{ translate('okf.artifacts.lead', 'One artifact per published version, managed by the OKF lifecycle.') }}
        </p>
      </div>
      <DsButton variant="ghost" small :disabled="loading" @click="load">
        {{ translate('common.refresh', 'Refresh') }}
      </DsButton>
    </header>

    <p v-if="error" class="okf-artifacts__error" role="alert" data-test-id="okf-artifacts-error">
      {{ error }}
    </p>

    <DsTable
      :columns="columns"
      :rows="rows"
      row-key="file_id"
      :loading="loading"
      :empty-text="translate('okf.artifacts.empty', 'No OKF artifacts yet.')"
    >
      <template #cell-artifact="{ row }">
        <span class="okf-artifacts__name" :title="row.file_name" :data-test-id="'okf-artifact-' + row.file_id">{{
          row.file_name
        }}</span>
      </template>

      <!-- The `repo@version` provenance pill. The tooltip is RAW DATA (the
           artifact's own file name) — no invented string, no extra key. -->
      <template #cell-repository="{ row }">
        <DsPill variant="info" :title="row.file_name" :data-test-id="'okf-artifact-provenance-' + row.file_id">{{
          provenanceLabel(row)
        }}</DsPill>
      </template>

      <template #cell-state="{ row }">
        <DsStatusTag :variant="stateVariant(row)" :data-test-id="'okf-artifact-state-' + row.file_id">{{
          stateLabel(row)
        }}</DsStatusTag>
      </template>

      <template #cell-actions="{ row }">
        <div class="okf-artifacts__actions" :data-test-id="'okf-artifact-actions-' + row.file_id">
          <!-- The download goes through the AUTHENTICATED client: doc-repo's
               download route sits behind `authenticateToken` and is not on the
               public-path list, so a plain `<a href>` navigation — which
               carries no Authorization header — answers 401 TOKEN_INVALID.
               Verified live against the running stack. -->
          <DsButton
            variant="ghost"
            small
            :disabled="downloading === row.file_id"
            :data-test-id="'okf-artifact-download-' + row.file_id"
            @click="download(row)"
          >
            {{ translate('okf.versions.bundleDownload', 'Download zip') }}
          </DsButton>
          <!-- The repository link renders ONLY when the repository resolves —
               an unresolvable repo gets no link, never a dead one. -->
          <DsButton
            v-if="repoFor(row)"
            variant="ghost"
            small
            :data-test-id="'okf-artifacts-open-' + row.file_id"
            @click="openRepository(row)"
          >
            {{ translate('okf.artifacts.openRepo', 'Open repository') }}
          </DsButton>
        </div>
      </template>
    </DsTable>

    <div v-if="total > 0" class="okf-artifacts__pager">
      <DsButton variant="ghost" small :disabled="loading || page <= 1" @click="goToPage(page - 1)">
        {{ translate('admin.userManagementSection.previous', 'Previous') }}
      </DsButton>
      <span class="okf-artifacts__page-label">
        {{ translate('admin.userManagementSection.showing', 'Showing') }}
        {{ (page - 1) * limit + 1 }}-{{ Math.min(page * limit, total) }}
        {{ translate('admin.userManagementSection.of', 'of') }}
        {{ total }}
      </span>
      <DsButton variant="ghost" small :disabled="loading || page >= pageCount" @click="goToPage(page + 1)">
        {{ translate('admin.userManagementSection.next', 'Next') }}
      </DsButton>
    </div>
  </section>
</template>

<script>
import translateMixin from '../../mixins/translateMixin';
import DsButton from '../ds/Button.vue';
import DsPill from '../ds/Pill.vue';
import DsStatusTag from '../ds/StatusTag.vue';
import DsTable from '../ds/Table.vue';
import documentFileService from '../../services/documentFileService';
import { eventBus } from '../../eventBus.js';
import { saveBlob } from '../../utils/fileDownload';
import { statusVariant, statusKey, displayStatus } from '../../utils/documentStatus';

/** The artifact list's columns — the same shape DsTable takes elsewhere. */
const COLUMNS = [
  { key: 'artifact', label: 'Artifact' },
  { key: 'repository', label: 'Repository' },
  { key: 'state', label: 'State' },
  { key: 'actions', label: 'Actions' }
];

export default {
  name: 'OkfArtifactsView',
  components: { DsButton, DsPill, DsStatusTag, DsTable },
  mixins: [translateMixin],
  data() {
    return {
      artifacts: [],
      loading: false,
      error: '',
      page: 1,
      limit: 25,
      total: 0,
      // The file_id whose download is in flight (the button disables itself).
      downloading: null
    };
  },
  computed: {
    columns() {
      // The CONCATENATION form (not a template literal) so the i18n contract
      // test recognises the dynamic PREFIX and validates it — the house
      // pattern for a key whose last segment is computed.
      return COLUMNS.map((c) => ({
        ...c,
        label: this.translate('okf.artifacts.column.' + c.key, c.label)
      }));
    },
    rows() {
      return this.artifacts;
    },
    pageCount() {
      return Math.max(1, Math.ceil(this.total / this.limit));
    }
  },
  mounted() {
    this.load();
    // The repository names come from the okf store. It is populated when the
    // Studio has been visited; on a fresh session the artifacts would fall
    // back to raw repo ids, so fetch it once when it is empty.
    this.ensureRepos();
  },
  methods: {
    /**
     * Load ONE page of artifacts. `is_bundle: true` is the whole filter:
     * the backend already supports it (fileController.js:165 →
     * fileService.js:693), so the artifacts view is a request parameter, not
     * a new endpoint.
     */
    async load() {
      this.loading = true;
      this.error = '';
      try {
        const res = await documentFileService.getFiles({
          page: this.page,
          limit: this.limit,
          is_bundle: true
        });
        const files = (res && res.data) || [];
        this.artifacts = Array.isArray(files) ? files : [];
        const pagination = (res && res.pagination) || {};
        this.total = Number(pagination.totalFiles ?? pagination.total ?? this.artifacts.length) || 0;
      } catch (err) {
        // A failed read must not leave the PREVIOUS page on screen next to
        // the error — an operator would read it as the current truth.
        console.error('[ArtifactsView] the OKF artifacts could not be read:', err);
        this.artifacts = [];
        this.total = 0;
        this.error = this.translate('okf.artifacts.loadFailed', 'Could not read the OKF artifacts.');
      } finally {
        this.loading = false;
      }
    },
    goToPage(page) {
      const target = Math.min(Math.max(1, page), this.pageCount);
      if (target === this.page) return;
      this.page = target;
      this.load();
    },
    /** The okf store's repositories — the source of the repository NAME. */
    repoFor(row) {
      const state = (this.$store && this.$store.state && this.$store.state.okf) || null;
      const map = (state && state.reposById) || {};
      return map[row.repo_id] || null;
    },
    async ensureRepos() {
      const state = (this.$store && this.$store.state && this.$store.state.okf) || null;
      if (!state) return; // the okf module is not registered (OKF parked)
      if (Object.keys(state.reposById || {}).length) return;
      try {
        // The action catches its own failures and answers { ok: false } — it
        // never rejects, so the RESULT is what says whether the names are
        // there. A silent miss would leave every provenance pill on the raw
        // repo id and every "Open repository" button unrendered, with
        // nothing on screen to explain it.
        //
        // KNOWN LIMIT (inherited from repoOkfService.list): the list endpoint
        // answers its FIRST page (the server caps the page at 50) and the
        // frontend follows no cursor. On a deployment with more repositories
        // than that, the older ones do not resolve and their artifacts fall
        // back to the raw repo id — honest, and the same limit the Studio's
        // own repository list has.
        const res = await this.$store.dispatch('okf/fetchRepos', { stage: 'all' });
        if (res && res.ok === false) {
          console.warn('[ArtifactsView] the repository list could not be read:', res.code || res.message);
        }
      } catch (err) {
        console.warn('[ArtifactsView] the repository list could not be read:', err);
      }
    },
    /**
     * The `repo@version` provenance label.
     * - the repository NAME when the store resolves it, the raw repo id
     *   otherwise (honest — never a blank);
     * - the version when the artifact carries one, the translated
     *   "unknown version" otherwise (never parsed out of the graph name —
     *   the banned pattern — and never guessed from the file name).
     */
    provenanceLabel(row) {
      const repo = this.repoFor(row);
      const name = (repo && (repo.name || repo.repo_name)) || row.repo_id || '';
      const version = row.bundle_version;
      const versionText =
        version === null || version === undefined || version === ''
          ? this.translate('okf.artifacts.unknownVersion', 'unknown version')
          : `v${version}`;
      return `${name}@${versionText}`;
    },
    stateVariant(row) {
      return statusVariant(row.dataprep && row.dataprep.status);
    },
    stateLabel(row) {
      const status = row.dataprep && row.dataprep.status;
      const known = statusKey(status);
      // The English label comes from the shared vocabulary: the catalogue's
      // own fallback for a known status, the raw status for an unknown one
      // (there is no leaf for it — the status itself is the truth), and
      // 'Unknown' when the artifact carries no status at all.
      const label = displayStatus(status);
      return known ? this.translate('admin.documents.' + known, label) : label;
    },
    /** The artifact's own export (WS3: exports live forever).
     *
     *  The content comes through the AUTHENTICATED client: doc-repo's
     *  download route sits behind `authenticateToken` and is not on the
     *  public-path list, so a browser navigation (which carries no
     *  Authorization header — the SPA keeps its token in memory) answers
     *  401 TOKEN_INVALID. The blob is then handed to the browser as a file.
     */
    async download(row) {
      if (!row || !row.file_id || this.downloading) return;
      this.downloading = row.file_id;
      try {
        const { blob, fileName } = await documentFileService.downloadFile(row.file_id);
        saveBlob(blob, fileName || row.file_name);
      } catch (err) {
        // A failed download is reported, never silent: the operator clicked
        // an action and must see that it did not happen.
        console.error('[ArtifactsView] the artifact could not be downloaded:', err);
        eventBus.$emit('notification:show', {
          message: this.translate('okf.artifacts.downloadFailed', 'The artifact could not be downloaded.'),
          type: 'error'
        });
      } finally {
        this.downloading = null;
      }
    },
    /**
     * The artifact → repository direction. The deep link reuses the
     * `?tab=…&file=` pattern's sibling: `?tab=studio&repo=<repo_id>`, which
     * the dashboard's route handler turns into a Studio resume (the same
     * `okf/openEditor` path the repo cards use).
     */
    openRepository(row) {
      const repo = this.repoFor(row);
      if (!repo) return;
      this.$router
        .push({ path: '/admin', query: { ...(this.$route.query || {}), tab: 'studio', repo: repo.repo_id } })
        .catch(() => {});
    }
  }
};
</script>

<style scoped>
.okf-artifacts {
  display: flex;
  flex-direction: column;
  gap: var(--space-sm);
  padding: var(--space-md);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  background: var(--surface);
}
.okf-artifacts__header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--space-sm);
  flex-wrap: wrap;
}
.okf-artifacts__title {
  margin: 0;
  font-size: var(--text-md);
  font-weight: 600;
}
.okf-artifacts__lead {
  margin: 0;
  font-size: var(--text-xs);
  color: var(--muted);
}
.okf-artifacts__name {
  font-size: var(--text-xs);
  word-break: break-all;
}
.okf-artifacts__actions {
  display: flex;
  align-items: center;
  gap: var(--space-xs);
  flex-wrap: wrap;
}

.okf-artifacts__error {
  margin: 0;
  color: var(--danger);
  font-size: var(--text-xs);
}
.okf-artifacts__pager {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
}
.okf-artifacts__page-label {
  font-size: var(--text-xs);
  color: var(--muted);
}
</style>
