<!--
  OkfAddConceptModal.vue - Story #978 "+ Add concept" dialog.

  Creates a new concept FILE in the repo: title + type + optional pasted
  markdown. The paste is normalized to the OKF standard (frontmatter merged
  over conformant defaults by the shared okfRepoOps library) and, when the
  repo has an index, the new file is auto-appended to the index TOC.
-->
<template>
  <DsDialog
    :visible="visible"
    :title="translate('okf.editor.addConcept.title', 'Add concept file')"
    size="md"
    :actions="actions"
    @close="$emit('close')"
    @action="onAction"
  >
    <div class="okf-acn__grid">
      <DsFormGroup :label="translate('okf.editor.addConcept.titleLabel', 'Title')" input-id="okf-acn-title">
        <DsInput
          id="okf-acn-title"
          v-model="title"
          size="sm"
          :placeholder="translate('okf.editor.addConcept.titlePh', 'e.g. Wildlife in the Mara')"
        />
      </DsFormGroup>
      <DsFormGroup :label="translate('okf.editor.meta.type', 'Type')" input-id="okf-acn-type">
        <DsSelect id="okf-acn-type" v-model="type" size="sm">
          <option v-if="hasIndex" value="index">index</option>
          <option v-for="t in types" :key="t" :value="t">{{ t }}</option>
        </DsSelect>
      </DsFormGroup>
    </div>

    <DsFormGroup
      :label="translate('okf.editor.addConcept.bodyLabel', 'Markdown (paste or leave empty)')"
      input-id="okf-acn-body"
    >
      <DsInput
        id="okf-acn-body"
        v-model="body"
        type="textarea"
        :rows="10"
        size="sm"
        :placeholder="
          translate('okf.editor.addConcept.bodyPh', '# Heading\n\nPaste markdown here - frontmatter is added for you.')
        "
      />
    </DsFormGroup>

    <label v-if="hasIndex" class="okf-acn__check">
      <input v-model="updateIndex" type="checkbox" />
      {{ translate('okf.editor.addConcept.updateIndex', 'Append to the index Contents list') }}
    </label>

    <p v-if="error" class="okf-acn__error">{{ error }}</p>
  </DsDialog>
</template>

<script>
import translateMixin from '../../../mixins/translateMixin';
import DsDialog from '../../ds/Dialog.vue';
import DsFormGroup from '../../ds/FormGroup.vue';
import DsInput from '../../ds/Input.vue';
import DsSelect from '../../ds/Select.vue';

const TYPES = ['topic', 'entity', 'process', 'event', 'source'];

export default {
  name: 'OkfAddConceptModal',
  components: { DsDialog, DsFormGroup, DsInput, DsSelect },
  mixins: [translateMixin],
  props: {
    visible: { type: Boolean, default: false },
    repoId: { type: String, default: null },
    hasIndex: { type: Boolean, default: false }
  },
  emits: ['close', 'created'],
  data() {
    return {
      types: TYPES,
      title: '',
      type: 'topic',
      body: '',
      updateIndex: true,
      creating: false,
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
          disabled: this.creating
        },
        {
          key: 'create',
          label: this.translate('okf.editor.addConcept.create', 'Create file'),
          variant: 'primary',
          disabled: this.creating || !this.title
        }
      ];
    }
  },
  watch: {
    visible(v) {
      if (v) {
        this.title = '';
        this.type = 'topic';
        this.body = '';
        this.updateIndex = true;
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
      if (key !== 'create' || this.creating || !this.title) return;
      this.creating = true;
      this.error = '';
      const result = await this.$store.dispatch('okf/createConcept', {
        repoId: this.repoId,
        title: this.title,
        type: this.type,
        body: this.body,
        updateIndex: this.updateIndex
      });
      this.creating = false;
      if (!result.ok) {
        this.error = result.message || this.translate('okf.editor.addConcept.failed', 'Could not create the file.');
        return;
      }
      this.$emit('created', result.concept_id);
      this.$emit('close');
    }
  }
};
</script>

<style scoped>
.okf-acn__grid {
  display: grid;
  grid-template-columns: 1fr 140px;
  gap: var(--space-md);
}
.okf-acn__check {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  font-size: var(--text-sm);
  color: var(--fg);
  margin-top: var(--space-sm);
  cursor: pointer;
}
.okf-acn__error {
  margin: var(--space-md) 0 0;
  color: var(--danger);
  font-size: var(--text-sm);
}
</style>
