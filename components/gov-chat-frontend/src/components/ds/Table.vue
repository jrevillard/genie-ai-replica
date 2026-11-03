<!--
  DsTable.vue — sortable table.
  columns: [{ key, label, sortable?, width?, align? }]
  rows:    Array<object>
  rowKey:  string | (row) => string — a row whose key is absent falls
           back to an index key (#79625); pass a real key for reorderable rows.
  hoverable / loading / striped / emptyText
  Slots: default, cell-<key>, empty
  Emits: sort({ key, direction }), rowClick(row)
-->
<template>
  <div class="ds-table" :class="{ 'ds-table--striped': striped, 'ds-table--loading': loading }">
    <table class="ds-table__element">
      <thead>
        <tr>
          <th
            v-for="col in columns"
            :key="col.key"
            :class="thClass(col)"
            :style="col.width ? { width: col.width } : null"
            :aria-sort="ariaSortFor(col)"
            @click="onHeaderClick(col)"
          >
            <span class="ds-table__th-content">
              <slot :name="`th-${col.key}`" :column="col">{{ col.label }}</slot>
              <span v-if="col.sortable" class="ds-table__sort-indicator" aria-hidden="true">{{ sortGlyph(col) }}</span>
            </span>
          </th>
        </tr>
      </thead>
      <tbody>
        <tr v-if="rows.length === 0 && !loading">
          <td :colspan="columns.length" class="ds-table__empty">
            <slot name="empty">{{ emptyText }}</slot>
          </td>
        </tr>
        <tr
          v-for="(row, rowIndex) in rows"
          v-else
          :key="rowKeyValue(row, rowIndex)"
          :class="{ 'ds-table__row--hoverable': hoverable }"
          @click="hoverable && $emit('rowClick', row)"
        >
          <td
            v-for="col in columns"
            :key="col.key"
            :class="tdClass(col)"
            :style="col.width ? { width: col.width } : null"
          >
            <slot :name="`cell-${col.key}`" :row="row" :column="col" :value="row[col.key]">
              {{ row[col.key] }}
            </slot>
          </td>
        </tr>
      </tbody>
    </table>
    <div v-if="loading" class="ds-table__loading-overlay" aria-hidden="true">
      <DsSpinner />
    </div>
  </div>
</template>

<script>
import DsSpinner from './Spinner.vue';

export default {
  name: 'DsTable',
  components: { DsSpinner },
  props: {
    columns: {
      type: Array,
      required: true,
      validator: (arr) =>
        Array.isArray(arr) && arr.every((c) => typeof c.key === 'string' && typeof c.label === 'string')
    },
    rows: { type: Array, default: () => [] },
    rowKey: { type: [String, Function], default: '_key' },
    hoverable: { type: Boolean, default: true },
    striped: { type: Boolean, default: false },
    loading: { type: Boolean, default: false },
    emptyText: { type: String, default: 'No results' },
    sortKey: { type: String, default: null },
    sortDirection: { type: String, default: 'asc', validator: (v) => ['asc', 'desc'].includes(v) }
  },
  emits: ['sort', 'rowClick'],
  methods: {
    thClass(col) {
      return {
        [`ds-table__th--${col.align || 'left'}`]: true,
        'ds-table__th--sortable': !!col.sortable
      };
    },
    tdClass(col) {
      return { [`ds-table__td--${col.align || 'left'}`]: true };
    },
    /**
     * Row identity for Vue's key patching (#79625): a string/function rowKey
     * that resolves to nothing (plain-object rows without the `_key` default
     * field, e.g. OkfMarkdownEditor's `{author, type, uri}` sources) used to
     * return `undefined` for EVERY row — Vue then patched by position with a
     * dev-mode key warning, and row identity broke on reorder/splice. When
     * the configured key is absent from a row we fall back to the INDEX
     * explicitly — the same by-position behavior Vue would apply anyway, but
     * without the warning, and rows carrying a real key keep real identity.
     */
    rowKeyValue(row, index) {
      if (typeof this.rowKey === 'function') {
        const key = this.rowKey(row);
        if (key !== undefined && key !== null) return key;
        return index;
      }
      const value = this.rowKey ? row[this.rowKey] : undefined;
      if (value !== undefined && value !== null) return value;
      return index;
    },
    sortGlyph(col) {
      if (this.sortKey !== col.key) return '↕';
      return this.sortDirection === 'asc' ? '▲' : '▼';
    },
    ariaSortFor(col) {
      if (!col.sortable) return null;
      if (this.sortKey !== col.key) return 'none';
      return this.sortDirection === 'asc' ? 'ascending' : 'descending';
    },
    onHeaderClick(col) {
      if (!col.sortable) return;
      let nextDir = 'asc';
      if (this.sortKey === col.key) {
        nextDir = this.sortDirection === 'asc' ? 'desc' : 'asc';
      }
      this.$emit('sort', { key: col.key, direction: nextDir });
    }
  }
};
</script>

<style scoped>
.ds-table {
  position: relative;
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  background: var(--surface);
  overflow: hidden;
}
.ds-table__element {
  width: 100%;
  border-collapse: collapse;
  font-size: var(--text-sm);
  color: var(--fg);
}
.ds-table thead th {
  background: var(--bg);
  padding: var(--space-sm) var(--space-md);
  text-align: left;
  font-weight: 600;
  border-bottom: 1px solid var(--border);
  color: var(--fg);
}
.ds-table__th-content {
  display: inline-flex;
  align-items: center;
  gap: var(--space-xs);
}
.ds-table__th--sortable {
  cursor: pointer;
  user-select: none;
}
.ds-table__th--sortable:hover {
  background: var(--accent-muted);
}
.ds-table__th--right {
  text-align: right;
}
.ds-table__th--center {
  text-align: center;
}
.ds-table__sort-indicator {
  color: var(--muted);
  font-size: var(--text-xs);
}

.ds-table tbody td {
  padding: var(--space-sm) var(--space-md);
  border-bottom: 1px solid var(--border-light);
}
.ds-table tbody tr:last-child td {
  border-bottom: 0;
}
.ds-table--striped tbody tr:nth-child(odd) td {
  background: var(--bg);
}
.ds-table__row--hoverable {
  cursor: pointer;
}
.ds-table__row--hoverable:hover td {
  background: var(--accent-muted);
}
.ds-table__td--right {
  text-align: right;
}
.ds-table__td--center {
  text-align: center;
}
.ds-table__empty {
  text-align: center;
  color: var(--muted);
  padding: var(--space-xl) var(--space-md);
}
.ds-table__loading-overlay {
  position: absolute;
  inset: 0;
  background: color-mix(in srgb, var(--surface) 60%, transparent);
  display: flex;
  align-items: center;
  justify-content: center;
}
</style>
