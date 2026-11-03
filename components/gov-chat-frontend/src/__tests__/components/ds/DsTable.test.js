'use strict';

/**
 * DsTable — row identity contract (#79625): `rowKey` defaulted to '_key', but
 * in-repo consumers pass plain objects without that field (OkfMarkdownEditor's
 * provenance.sources rows are {author, type, uri}) — `rowKeyValue` returned
 * undefined for EVERY row, Vue fell back to position patching with a dev-mode
 * key warning, and row identity broke on reorder/splice. The contract now:
 * absent key → explicit INDEX key (same behavior, no warning); present key →
 * real identity. The component had no test file before this one.
 */

const { mount } = require('@vue/test-utils');
const DsTable = require('@/components/ds/Table.vue').default;

const COLS = [
  { key: 'author', label: 'author' },
  { key: 'uri', label: 'uri' }
];

describe('DsTable rowKeyValue — the #79625 identity contract', () => {
  it('an absent key field falls back to the INDEX (never undefined)', () => {
    const rows = [
      { author: 'a', uri: 'u1' },
      { author: 'b', uri: 'u2' }
    ];
    const wrapper = mount(DsTable, { props: { columns: COLS, rows } });
    expect(wrapper.vm.rowKeyValue(rows[0], 0)).toBe(0);
    expect(wrapper.vm.rowKeyValue(rows[1], 1)).toBe(1);
  });

  it('a present key field keeps REAL row identity', () => {
    const rows = [
      { author: 'a', uri: 'u1', _key: 'k1' },
      { author: 'b', uri: 'u2', _key: 'k2' }
    ];
    const wrapper = mount(DsTable, { props: { columns: COLS, rows, rowKey: '_key' } });
    expect(wrapper.vm.rowKeyValue(rows[0], 0)).toBe('k1');
    expect(wrapper.vm.rowKeyValue(rows[1], 1)).toBe('k2');
  });

  it('a function rowKey returning a value keeps REAL row identity', () => {
    const rows = [{ author: 'a', uri: 'u1' }];
    const wrapper = mount(DsTable, { props: { columns: COLS, rows, rowKey: (r) => r.uri } });
    expect(wrapper.vm.rowKeyValue(rows[0], 0)).toBe('u1');
  });

  it('a function rowKey returning nothing falls back to the index too', () => {
    const rows = [{ author: 'a' }];
    const wrapper = mount(DsTable, { props: { columns: COLS, rows, rowKey: (r) => r.missing } });
    expect(wrapper.vm.rowKeyValue(rows[0], 4)).toBe(4);
  });

  it('rows still render (and the empty slot shows) end to end', () => {
    const rows = [{ author: 'a', uri: 'u1' }];
    const withRows = mount(DsTable, { props: { columns: COLS, rows } });
    expect(withRows.findAll('tbody tr')).toHaveLength(1);
    const empty = mount(DsTable, { props: { columns: COLS, rows: [] } });
    expect(empty.findAll('tbody tr')).toHaveLength(1); // the empty row
    expect(empty.text()).toContain('No results');
  });
});
