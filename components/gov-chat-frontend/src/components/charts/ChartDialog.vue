<template>
  <DsModal :visible="visible" :title="title" size="xl" scrollable @close="$emit('close')">
    <slot />
  </DsModal>
</template>

<script>
import DsModal from '../ds/Modal.vue';

export default {
  name: 'ChartDialog',
  components: { DsModal },
  props: {
    visible: {
      type: Boolean,
      required: true
    },
    title: {
      type: String,
      required: true
    }
  },
  emits: ['close']
};
</script>
