<template>
  <DsDialog
    class="genie-living-intelligence"
    :visible="visible"
    :title="translate('okf.editor.rename.title', 'Rename repository')"
    size="sm"
    @close="$emit('close')"
  >
    <p v-if="repo" class="okf-rename__hint">{{ bodyHint }}</p>
    <DsFormGroup :label="translate('okf.editor.rename.nameLabel', 'Repository name')" input-id="okf-rename-input">
      <DsInput
        id="okf-rename-input"
        v-model="name"
        :placeholder="translate('okf.editor.rename.namePlaceholder', 'Repository name')"
        @keyup.enter="save"
      />
      <p v-if="error" class="okf-rename__error">{{ error }}</p>
    </DsFormGroup>
    <template #footer>
      <div class="okf-rename__footer">
        <DsButton variant="secondary" small @click="$emit('close')">
          {{ translate('okf.editor.rename.cancel', 'Cancel') }}
        </DsButton>
        <DsButton variant="primary" small :disabled="saveDisabled" @click="save">
          {{ translate('okf.editor.rename.confirm', 'Rename') }}
        </DsButton>
      </div>
    </template>
  </DsDialog>
</template>

<script>
import DsButton from '../../ds/Button.vue';
import DsDialog from '../../ds/Dialog.vue';
import DsFormGroup from '../../ds/FormGroup.vue';
import DsInput from '../../ds/Input.vue';
import translateMixin from '../../../mixins/translateMixin';
import repoOkfService from '../../../services/repoOkfService';

export default {
  name: 'OkfRenameRepoDialog',
  components: { DsButton, DsDialog, DsFormGroup, DsInput },
  mixins: [translateMixin],
  props: {
    visible: { type: Boolean, default: false },
    repo: { type: Object, default: null }
  },
  emits: ['close', 'renamed'],
  data() {
    return {
      name: '',
      busy: false,
      error: ''
    };
  },
  computed: {
    // The hint's fallback carries `<name>`/`<N>` — raw `<` in a template
    // text node breaks the Vue template parser, so the translate call
    // lives here, not inline.
    bodyHint() {
      return this.translate(
        'okf.editor.rename.body',
        'Renaming also renames the repository’s workspace graphs (`OKF_<name>_v<N>`); content, versions and the audit trail are untouched.'
      );
    },
    saveDisabled() {
      const next = (this.name || '').trim();
      return !next || next === (this.repo && this.repo.name) || this.busy;
    }
  },
  watch: {
    visible(v) {
      if (v) {
        this.name = (this.repo && this.repo.name) || '';
        this.error = '';
      }
    }
  },
  methods: {
    async save() {
      const next = (this.name || '').trim();
      if (this.saveDisabled) return;
      this.busy = true;
      this.error = '';
      try {
        await repoOkfService.update(this.repo.repo_id, { name: next });
        this.$emit('renamed', next);
        this.$emit('close');
      } catch (err) {
        const status = err && err.status;
        this.error =
          status === 409
            ? this.translate(
                'okf.editor.rename.conflict',
                'That name is already used by another repository in this domain.'
              )
            : (err && err.message) || this.translate('okf.editor.rename.failed', 'Rename failed');
      } finally {
        this.busy = false;
      }
    }
  }
};
</script>

<style scoped>
.okf-rename__hint {
  margin: 0 0 var(--space-md);
  font-size: var(--text-sm);
  color: var(--muted);
}
.okf-rename__error {
  margin: 0;
  font-size: var(--text-sm);
  color: var(--danger);
}
.okf-rename__footer {
  display: flex;
  gap: var(--space-sm);
  justify-content: flex-end;
}
</style>
