<!-- OkfRepoEditorShell.vue — Story #978 Studio repo view host.
  Breadcrumb + Wizard | Editor sub-tabs (Editor default). Wizard sub-tab
  mounts the existing 10-step wizard; Editor sub-tab mounts OkfRepoEditor. -->
<template>
  <div class="okf-shell">
    <header class="okf-shell__header">
      <DsButton variant="ghost" small @click="$emit('back')"> ← {{ translate('okf.shell.back', 'Studio') }} </DsButton>
      <h3 class="okf-shell__name">{{ repoName }}</h3>
      <DsStatusTag :variant="repoStateVariant">{{ repoStateLabel }}</DsStatusTag>
    </header>

    <DsTabs :tabs="subTabs" :model-value="subTab" @update:model-value="onSubTab">
      <template #default>
        <OkfStudioWizard v-show="subTab === 'wizard'" :draft="draft" @reset="$emit('back')" />
        <OkfRepoEditor v-show="subTab === 'editor'" :repo-id="repoId" :source-file-id="sourceFileId" />
      </template>
    </DsTabs>
  </div>
</template>

<script>
import { mapGetters } from 'vuex';
import translateMixin from '../../../mixins/translateMixin';
import DsButton from '../../ds/Button.vue';
import DsStatusTag from '../../ds/StatusTag.vue';
import DsTabs from '../../ds/Tabs.vue';
import OkfStudioWizard from '../StudioWizard.vue';
import OkfRepoEditor from './RepoEditor.vue';

export default {
  name: 'OkfRepoEditorShell',
  components: { DsButton, DsStatusTag, DsTabs, OkfStudioWizard, OkfRepoEditor },
  mixins: [translateMixin],
  props: {
    repoId: { type: String, required: true },
    draft: { type: Object, default: null },
    sourceFileId: { type: String, default: null }
  },
  emits: ['back', 'refresh'],
  computed: {
    ...mapGetters('okf', ['editorSubTab', 'repoById']),
    subTab() {
      return this.editorSubTab;
    },
    repo() {
      return this.repoById(this.repoId) || {};
    },
    repoName() {
      return this.repo.name || this.repoId;
    },
    repoStateVariant() {
      const s = this.repo.lifecycle_state;
      if (s === 'published') return 'success';
      if (s === 'review' || s === 'approve') return 'pending';
      return 'info';
    },
    repoStateLabel() {
      const s = this.repo.lifecycle_state;
      if (s === 'published') return this.translate('okf.shell.state.published', 'Published');
      if (s === 'review' || s === 'approve') return this.translate('okf.shell.state.inReview', 'In review');
      return this.translate('okf.shell.state.draft', 'Draft');
    },
    subTabs() {
      return [
        { value: 'editor', label: this.translate('okf.shell.tab.editor', 'Editor') },
        { value: 'wizard', label: this.translate('okf.shell.tab.wizard', 'Wizard') }
      ];
    }
  },
  methods: {
    onSubTab(v) {
      this.$store.dispatch('okf/setEditorSubTab', v);
    }
  }
};
</script>

<style scoped>
.okf-shell__header {
  display: flex;
  align-items: center;
  gap: var(--space-md);
}
.okf-shell__name {
  margin: 0;
  font-size: var(--text-lg);
  font-weight: 600;
  margin-right: auto;
  color: var(--fg);
}
</style>
