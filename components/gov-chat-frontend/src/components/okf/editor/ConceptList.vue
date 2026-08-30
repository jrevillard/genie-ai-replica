<!--
  OkfConceptList.vue - Story #978 Studio editor TREE sidebar.

  Tree = index.md (bundle root) + its concept files. Per-file quick actions:
  label chip -> inline Knowledge-Hierarchy select (writes immediately);
  X -> delete (parent confirms). Footer: [+ Add concept] + [Re-split].
-->
<template>
  <div class="okf-cl" role="region" :aria-label="translate('okf.editor.concepts.label', 'Concepts')">
    <header class="okf-cl__header">
      <span class="okf-cl__title">{{ translate('okf.editor.concepts.label', 'Files') }}</span>
      <span class="okf-cl__count">{{ filtered.length }}</span>
    </header>

    <DsInput
      v-model="filter"
      class="okf-cl__filter"
      :placeholder="translate('okf.editor.concepts.filter', 'Filter files')"
      size="sm"
    />

    <p v-if="loading" class="okf-cl__empty">
      <DsSpinner size="sm" /> {{ translate('okf.editor.concepts.loading', 'Loading…') }}
    </p>
    <p v-else-if="filtered.length === 0" class="okf-cl__empty">
      {{ translate('okf.editor.concepts.empty', 'No files yet - add a concept or re-split from source.') }}
    </p>

    <template v-else>
      <ul class="okf-cl__list">
        <li v-for="node in tree" :key="node.key">
          <div
            class="okf-cl__row"
            :class="{ 'okf-cl__row--selected': node.concept_id === selectedId }"
            role="button"
            tabindex="0"
            @click="$emit('select', node.concept_id)"
            @keydown.enter="$emit('select', node.concept_id)"
          >
            <span class="okf-cl__twist" :class="{ 'okf-cl__twist--open': expanded }" @click.stop="expanded = !expanded"
              >▸</span
            >
            <span
              class="okf-cl__status"
              :class="'okf-cl__status--' + (node.index_status || 'parsed')"
              :title="node.index_status"
            ></span>
            <span class="okf-cl__body">
              <span class="okf-cl__row-title">
                {{ node.title || node.concept_id }}
                <DsPill v-if="node.is_index" variant="accent">{{
                  translate('okf.editor.concepts.indexBadge', 'index')
                }}</DsPill>
              </span>
              <span v-if="node.sourceUrl" class="okf-cl__row-source">{{ node.sourceUrl }}</span>
            </span>
            <span v-if="!readOnly" class="okf-cl__actions" @click.stop>
              <button
                type="button"
                class="okf-cl__action"
                :title="translate('okf.editor.concepts.addLabel', 'Set label')"
                @click.stop="toggleLabelEdit(node.concept_id)"
              >
                <DsPill v-if="firstLabel(node)" variant="info">{{ firstLabel(node) }}</DsPill>
                <span v-else class="okf-cl__action-glyph">+</span>
              </button>
              <button
                type="button"
                class="okf-cl__action okf-cl__action--danger"
                :title="translate('okf.editor.concepts.delete', 'Delete file')"
                @click.stop="$emit('delete', node)"
              >
                ✕
              </button>
            </span>
          </div>
          <div v-if="labelEditing === node.concept_id" class="okf-cl__label-edit" @click.stop>
            <DsSelect :value="firstLabel(node) || ''" size="sm" @update:model-value="onLabelPicked(node, $event)">
              <option value="">{{ translate('okf.editor.meta.noLabel', 'No label') }}</option>
              <option v-for="opt in labelOptions" :key="opt.value" :value="opt.value">{{ opt.label }}</option>
            </DsSelect>
          </div>
          <ul v-if="expanded && node.children && node.children.length" class="okf-cl__children">
            <li v-for="child in node.children" :key="child.concept_id">
              <div
                class="okf-cl__row okf-cl__row--child"
                :class="{ 'okf-cl__row--selected': child.concept_id === selectedId }"
                role="button"
                tabindex="0"
                @click="$emit('select', child.concept_id)"
                @keydown.enter="$emit('select', child.concept_id)"
              >
                <span
                  class="okf-cl__status"
                  :class="'okf-cl__status--' + (child.index_status || 'parsed')"
                  :title="child.index_status"
                ></span>
                <span class="okf-cl__body">
                  <span class="okf-cl__row-title">{{ child.title || child.concept_id }}</span>
                  <span v-if="child.sourceUrl" class="okf-cl__row-source">{{ child.sourceUrl }}</span>
                </span>
                <span v-if="!readOnly" class="okf-cl__actions" @click.stop>
                  <button
                    type="button"
                    class="okf-cl__action"
                    :title="translate('okf.editor.concepts.addLabel', 'Set label')"
                    @click.stop="toggleLabelEdit(child.concept_id)"
                  >
                    <DsPill v-if="firstLabel(child)" variant="info">{{ firstLabel(child) }}</DsPill>
                    <span v-else class="okf-cl__action-glyph">+</span>
                  </button>
                  <button
                    type="button"
                    class="okf-cl__action okf-cl__action--danger"
                    :title="translate('okf.editor.concepts.delete', 'Delete file')"
                    @click.stop="$emit('delete', child)"
                  >
                    ✕
                  </button>
                </span>
              </div>
              <div v-if="labelEditing === child.concept_id" class="okf-cl__label-edit" @click.stop>
                <DsSelect :value="firstLabel(child) || ''" size="sm" @update:model-value="onLabelPicked(child, $event)">
                  <option value="">{{ translate('okf.editor.meta.noLabel', 'No label') }}</option>
                  <option v-for="opt in labelOptions" :key="opt.value" :value="opt.value">{{ opt.label }}</option>
                </DsSelect>
              </div>
            </li>
          </ul>
        </li>
      </ul>
    </template>

    <footer class="okf-cl__footer">
      <DsButton variant="secondary" small :disabled="readOnly" @click="$emit('add')"
        >+ {{ translate('okf.editor.concepts.add', 'Add concept') }}</DsButton
      >
      <DsButton variant="ghost" small :disabled="readOnly" @click="$emit('resplit')">{{
        translate('okf.editor.concepts.resplit', 'Re-split')
      }}</DsButton>
    </footer>
  </div>
</template>

<script>
import translateMixin from '../../../mixins/translateMixin';
import DsButton from '../../ds/Button.vue';
import DsInput from '../../ds/Input.vue';
import DsPill from '../../ds/Pill.vue';
import DsSelect from '../../ds/Select.vue';
import DsSpinner from '../../ds/Spinner.vue';

export default {
  name: 'OkfConceptList',
  components: { DsButton, DsInput, DsPill, DsSelect, DsSpinner },
  mixins: [translateMixin],
  props: {
    concepts: { type: Array, default: () => [] },
    selectedId: { type: String, default: null },
    loading: { type: Boolean, default: false },
    labelOptions: { type: Array, default: () => [] },
    // READ ONLY (serving repo): add/delete/re-split/label writes are hidden.
    readOnly: { type: Boolean, default: false }
  },
  emits: ['select', 'resplit', 'add', 'delete', 'label'],
  data() {
    return {
      filter: '',
      expanded: true,
      labelEditing: null
    };
  },
  computed: {
    filtered() {
      const s = (this.filter || '').toLowerCase().trim();
      if (!s) return this.concepts;
      return this.concepts.filter((c) => {
        const hay = [c.title, c.concept_id, c.path, this.sourceOf(c)].filter(Boolean).join(' ').toLowerCase();
        return hay.includes(s);
      });
    },
    tree() {
      const list = this.filtered;
      const indexRow = list.find((c) => c.is_index);
      const rest = list.filter((c) => c !== indexRow).map((c) => this.decorate(c));
      if (!indexRow) return rest.map((c) => ({ ...c, children: [] }));
      return [{ ...this.decorate(indexRow), children: rest, key: indexRow.concept_id }];
    }
  },
  methods: {
    decorate(c) {
      return { ...c, sourceUrl: this.sourceOf(c), key: c.concept_id };
    },
    sourceOf(c) {
      const s = (c.sources || []).find((x) => x && x.resource);
      return s ? s.resource : '';
    },
    firstLabel(c) {
      return (c.labels && c.labels[0]) || '';
    },
    toggleLabelEdit(conceptId) {
      this.labelEditing = this.labelEditing === conceptId ? null : conceptId;
    },
    onLabelPicked(node, value) {
      this.labelEditing = null;
      this.$emit('label', { conceptId: node.concept_id, label: value || '' });
    }
  }
};
</script>

<style scoped>
.okf-cl {
  display: flex;
  flex-direction: column;
  gap: var(--space-sm);
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  padding: var(--space-md);
  min-height: 0;
}
.okf-cl__header {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
}
.okf-cl__title {
  font-size: var(--text-sm);
  font-weight: 600;
}
.okf-cl__count {
  background: var(--accent-muted);
  color: var(--accent);
  padding: 1px 8px;
  border-radius: 100px;
  font-size: var(--text-xs);
}
.okf-cl__filter {
  width: 100%;
}
.okf-cl__empty {
  color: var(--muted);
  font-size: var(--text-sm);
  text-align: center;
  padding: var(--space-md) 0;
  margin: 0;
}
.okf-cl__list,
.okf-cl__children {
  list-style: none;
  margin: 0;
  padding: 0;
  overflow-y: auto;
}
.okf-cl__list {
  flex: 1;
}
.okf-cl__children {
  padding-left: var(--space-lg);
}
.okf-cl__row {
  display: flex;
  align-items: flex-start;
  gap: var(--space-xs);
  width: 100%;
  text-align: left;
  background: transparent;
  border: 1px solid transparent;
  border-radius: var(--radius-sm);
  padding: var(--space-xs) var(--space-sm);
  margin-bottom: 2px;
  font: inherit;
  color: var(--fg);
  cursor: pointer;
}
.okf-cl__row:hover {
  background: var(--accent-muted);
}
.okf-cl__row--selected {
  border-color: var(--accent);
  background: var(--accent-muted);
}
.okf-cl__twist {
  color: var(--muted);
  font-size: var(--text-xs);
  transition: transform 0.15s;
  user-select: none;
}
.okf-cl__twist--open {
  transform: rotate(90deg);
}
.okf-cl__status {
  flex: 0 0 auto;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  margin-top: 6px;
  background: var(--muted);
}
.okf-cl__status--indexed {
  background: var(--success);
}
.okf-cl__status--parsed {
  background: var(--warning);
}
.okf-cl__status--failed {
  background: var(--danger);
}
.okf-cl__body {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
  flex: 1;
}
.okf-cl__row-title {
  font-size: var(--text-sm);
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  display: flex;
  align-items: center;
  gap: var(--space-xs);
}
.okf-cl__row-source {
  font-size: var(--text-xs);
  color: var(--muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.okf-cl__actions {
  display: none;
  gap: 2px;
  align-items: center;
}
.okf-cl__row:hover .okf-cl__actions {
  display: inline-flex;
}
.okf-cl__action {
  border: 0;
  background: transparent;
  color: var(--muted);
  cursor: pointer;
  font: inherit;
  font-size: var(--text-xs);
  padding: 0 4px;
  border-radius: var(--radius-sm);
}
.okf-cl__action:hover {
  background: var(--surface);
  color: var(--accent);
}
.okf-cl__action--danger:hover {
  color: var(--danger);
}
.okf-cl__action-glyph {
  font-size: var(--text-sm);
  line-height: 1;
}
.okf-cl__label-edit {
  padding: 0 var(--space-sm) var(--space-xs) var(--space-lg);
}
.okf-cl__footer {
  display: flex;
  gap: var(--space-sm);
  border-top: 1px solid var(--border);
  padding-top: var(--space-sm);
}
</style>
