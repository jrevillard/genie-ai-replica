<!--
  OkfResplitModal.vue — Story #978 "Re-split from source" modal.

  Confirms the destructive re-split (deletes all concepts + graph, re-ingests
  from the linked doc-repo file) and picks the split mode:
    A — one mega-concept (whole crawl)
    B — one concept per `## Source:` page (default, recommended)
    C — LLM topic extraction (Story 10.6 — not built, disabled)
-->
<template>
  <DsDialog
    :visible="visible"
    :title="translate('okf.editor.resplit.title', 'Re-split from source')"
    size="md"
    :actions="actions"
    @close="$emit('close')"
    @action="onAction"
  >
    <p class="okf-resplit__warn">
      {{
        translate(
          'okf.editor.resplit.body',
          'This deletes all current concepts and the derived graph, then re-ingests the source file with the new split. Concept edits are lost.'
        )
      }}
    </p>

    <div class="okf-resplit__modes">
      <label class="okf-resplit__mode">
        <input v-model="mode" type="radio" value="B" />
        <span>
          <strong>{{ translate('okf.editor.resplit.modeB', 'One concept per page') }}</strong>
          <small>{{
            translate('okf.editor.resplit.modeBHint', 'Splits on the crawler’s `## Source:` markers (recommended)')
          }}</small>
        </span>
      </label>
      <label class="okf-resplit__mode">
        <input v-model="mode" type="radio" value="A" />
        <span>
          <strong>{{ translate('okf.editor.resplit.modeA', 'One concept for the whole crawl') }}</strong>
          <small>{{
            translate('okf.editor.resplit.modeAHint', 'Mega-concept — the entire content in a single concept')
          }}</small>
        </span>
      </label>
      <label class="okf-resplit__mode okf-resplit__mode--disabled">
        <input v-model="mode" type="radio" value="C" disabled />
        <span>
          <strong>{{ translate('okf.editor.resplit.modeC', 'Use LLM topic extraction') }}</strong>
          <small>{{ translate('okf.editor.resplit.modeCHint', 'Story 10.6 — coming soon') }}</small>
        </span>
      </label>
    </div>

    <p v-if="error" class="okf-resplit__error">{{ error }}</p>
  </DsDialog>
</template>

<script>
import translateMixin from '../../../mixins/translateMixin';
import DsDialog from '../../ds/Dialog.vue';

export default {
  name: 'OkfResplitModal',
  components: { DsDialog },
  mixins: [translateMixin],
  props: {
    visible: { type: Boolean, default: false },
    repoId: { type: String, default: null },
    fileId: { type: String, default: null }
  },
  emits: ['close', 'done'],
  data() {
    return {
      mode: 'B',
      running: false,
      error: ''
    };
  },
  computed: {
    actions() {
      return [
        {
          key: 'cancel',
          label: this.translate('common.cancel', 'Cancel'),
          variant: 'secondary',
          disabled: this.running
        },
        {
          key: 'confirm',
          label: this.translate('okf.editor.resplit.confirm', 'Re-split'),
          variant: 'primary',
          disabled: this.running
        }
      ];
    }
  },
  watch: {
    visible(v) {
      if (v) {
        this.mode = 'B';
        this.error = '';
      }
    }
  },
  methods: {
    async onAction(key) {
      if (key === 'cancel') {
        this.$emit('close');
        return;
      }
      if (key !== 'confirm' || this.running) return;
      this.running = true;
      this.error = '';
      const result = await this.$store.dispatch('okf/resplitRepo', {
        repoId: this.repoId,
        mode: this.mode,
        fileId: this.fileId
      });
      this.running = false;
      if (!result.ok) {
        this.error =
          result.message ||
          this.translate('okf.editor.resplit.failed', 'Re-split failed — check the source file link.');
        return;
      }
      this.$emit('done', result);
      this.$emit('close');
    }
  }
};
</script>

<style scoped>
.okf-resplit__warn {
  margin: 0 0 var(--space-md);
  font-size: var(--text-sm);
  color: var(--muted);
}
.okf-resplit__modes {
  display: flex;
  flex-direction: column;
  gap: var(--space-sm);
}
.okf-resplit__mode {
  display: flex;
  gap: var(--space-sm);
  align-items: flex-start;
  cursor: pointer;
}
.okf-resplit__mode--disabled {
  cursor: not-allowed;
  opacity: 0.55;
}
.okf-resplit__mode input {
  margin-top: 3px;
}
.okf-resplit__mode span {
  display: flex;
  flex-direction: column;
}
.okf-resplit__mode small {
  color: var(--muted);
  font-size: var(--text-xs);
}
.okf-resplit__error {
  margin: var(--space-md) 0 0;
  color: var(--danger);
  font-size: var(--text-sm);
}
</style>
