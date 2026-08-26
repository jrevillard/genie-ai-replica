<!--
  OkfLabelEditor.vue — Story 3-8 label curation dialog (used by Curator panel
  + Expert-mode frontmatter editor). Renders the repo's live label set with
  drag-reorder, add via autocomplete, remove. Saves via okf/updateLabels.
-->
<template>
  <DsDialog
    :visible="visible"
    :title="translate('okf.curator.labels.title', 'Adjust labels')"
    size="md"
    :actions="actions"
    @close="$emit('close')"
    @action="onAction"
  >
    <p class="okf-label-editor__hint">{{ translate('okf.curator.labels.body', 'Labels are the categorical axes of your ontology — what kind of thing is this topic?') }}</p>
    <div class="okf-label-editor__chips">
      <span
        v-for="(l, idx) in local"
        :key="l"
        class="okf-label-editor__chip"
        draggable="true"
        @dragstart="onDragStart(idx)"
        @dragover.prevent
        @drop="onDrop(idx)"
      >
        {{ l }}
        <button type="button" class="okf-label-editor__chip-remove" :aria-label="translate('okf.curator.labels.remove', 'Remove')" @click="remove(idx)">×</button>
      </span>
      <span v-if="local.length === 0" class="okf-label-editor__empty">{{ translate('okf.curator.labels.empty', 'No labels yet.') }}</span>
    </div>
    <div class="okf-label-editor__add">
      <DsInput v-model="newLabel" :placeholder="translate('okf.curator.labels.addPh', 'e.g. Permits')" @enter="addNew" />
      <DsButton variant="primary" :disabled="!newLabel.trim()" @click="addNew">{{ translate('okf.curator.labels.add', 'Add') }}</DsButton>
    </div>
  </DsDialog>
</template>

<script>
import DsDialog from '../ds/Dialog.vue';
import DsInput from '../ds/Input.vue';
import DsButton from '../ds/Button.vue';
import translateMixin from '../../mixins/translateMixin';

export default {
  name: 'OkfLabelEditor',
  components: { DsDialog, DsInput, DsButton },
  mixins: [translateMixin],
  props: {
    visible: { type: Boolean, default: false },
    repoId: { type: String, default: '' },
    labels: { type: Array, default: () => [] }
  },
  emits: ['close', 'save'],
  data() {
    return {
      local: (this.labels || []).slice(),
      newLabel: '',
      dragIndex: -1
    };
  },
  computed: {
    actions() {
      return [
        { key: 'cancel', label: this.translate('common.cancel', 'Cancel'), variant: 'secondary' },
        { key: 'save', label: this.translate('common.save', 'Save'), variant: 'primary' }
      ];
    }
  },
  watch: {
    labels(v) {
      this.local = (v || []).slice();
    },
    visible(v) {
      if (v) this.local = (this.labels || []).slice();
    }
  },
  methods: {
    addNew() {
      const v = (this.newLabel || '').trim();
      if (!v || this.local.indexOf(v) !== -1) return;
      this.local.push(v);
      this.newLabel = '';
    },
    remove(idx) {
      this.local.splice(idx, 1);
    },
    onDragStart(idx) {
      this.dragIndex = idx;
    },
    onDrop(idx) {
      if (this.dragIndex === -1 || this.dragIndex === idx) return;
      const moved = this.local.splice(this.dragIndex, 1)[0];
      this.local.splice(idx, 0, moved);
      this.dragIndex = -1;
    },
    onAction(key) {
      if (key === 'save') this.$emit('save', this.local.slice());
      else this.$emit('close');
    }
  }
};
</script>

<style scoped>
.okf-label-editor__hint { margin: 0 0 var(--space-md) 0; color: var(--muted); font-size: var(--text-sm); }
.okf-label-editor__chips { display: flex; flex-wrap: wrap; gap: var(--space-sm); margin-bottom: var(--space-md); }
.okf-label-editor__chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  background: var(--accent-muted);
  color: var(--accent);
  padding: 4px 10px;
  border-radius: 100px;
  cursor: grab;
  font-size: var(--text-sm);
  border: 1px solid var(--accent);
}
.okf-label-editor__chip-remove {
  border: 0;
  background: transparent;
  color: inherit;
  cursor: pointer;
  font: inherit;
  padding: 0;
}
.okf-label-editor__empty { color: var(--muted); font-size: var(--text-sm); }
.okf-label-editor__add { display: flex; gap: var(--space-sm); align-items: center; }
</style>
