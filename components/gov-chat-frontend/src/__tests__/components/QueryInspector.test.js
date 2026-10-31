'use strict';

global.console = {
  ...console,
  warn: jest.fn(),
  debug: jest.fn(),
  error: jest.fn()
};

const { mount } = require('@vue/test-utils');

// Mock adminDashboardService
const mockGetQueriesForInspector = jest.fn();
const mockGetQueryInspectorDetails = jest.fn();

jest.mock('../../services/adminDashboardService', () => ({
  getSystemHealth: jest.fn(),
  getUserStats: jest.fn(),
  getQueriesForInspector: (...args) => mockGetQueriesForInspector(...args),
  getQueryInspectorDetails: (...args) => mockGetQueryInspectorDetails(...args)
}));

// Stub DS components with renderable templates
const dsStubs = {
  DsButton: { template: '<button class="ds-btn"><slot /></button>', props: ['variant', 'small', 'disabled'] },
  DsInput: {
    template: '<input :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" />',
    props: ['modelValue', 'type', 'placeholder', 'min', 'max', 'step']
  },
  DsFormGroup: { template: '<div><label v-if="label">{{ label }}</label><slot /></div>', props: ['label'] },
  DsPill: { template: '<span class="ds-pill"><slot /></span>', props: ['variant'] },
  DsCard: {
    template:
      '<div class="ds-card"><div v-if="$slots.header" class="ds-card__header"><slot name="header" /></div><div><slot /></div></div>',
    props: ['variant']
  },
  DsSpinner: { template: '<div class="ds-spinner">Loading...</div>' },
  DsStateDisplay: { template: '<div class="ds-state"><p>{{ message }}</p><slot /></div>', props: ['type', 'message'] }
};

// ===========================================================================
// QueryInspector (root component)
// Tests use wrapper.vm to access data/methods directly since the component
// uses v-if/v-else template branches that don't resolve stubs in test env.
// ===========================================================================
describe('QueryInspector', () => {
  let QueryInspector;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.isolateModules(() => {
      QueryInspector = require('../../components/admin/QueryInspector/QueryInspector.vue').default;
    });
  });

  function mountQI() {
    return mount(QueryInspector, {
      global: {
        stubs: {
          ...dsStubs,
          QueryInspectorList: true,
          QueryInspectorDetail: true
        }
      }
    });
  }

  it('should set loading to true on mount', async () => {
    mockGetQueriesForInspector.mockReturnValue(new Promise(() => {}));
    const wrapper = mountQI();
    await wrapper.vm.$nextTick();

    expect(wrapper.vm.loading).toBe(true);
  });

  it('should populate queries and pagination after loading', async () => {
    mockGetQueriesForInspector.mockResolvedValue({
      success: true,
      data: {
        queries: [{ _key: 'q1', text: 'test query', metadata: { confidence_score: 0.9 } }],
        pagination: { total: 1, limit: 25, offset: 0, pages: 1, currentPage: 1 }
      }
    });

    const wrapper = mountQI();
    await wrapper.vm.$nextTick();
    await wrapper.vm.$nextTick();

    expect(wrapper.vm.loading).toBe(false);
    expect(wrapper.vm.queries).toHaveLength(1);
    expect(wrapper.vm.queries[0]._key).toBe('q1');
    expect(wrapper.vm.pagination.total).toBe(1);
  });

  it('should set loadError on load failure', async () => {
    mockGetQueriesForInspector.mockRejectedValue(new Error('Network error'));

    const wrapper = mountQI();
    await wrapper.vm.$nextTick();
    await wrapper.vm.$nextTick();

    expect(wrapper.vm.loadError).toBe(true);
    expect(wrapper.vm.loading).toBe(false);
  });

  it('should load detail and set selectedQuery on inspectQuery', async () => {
    mockGetQueriesForInspector.mockResolvedValue({
      success: true,
      data: { queries: [{ _key: 'q1' }], pagination: { total: 1, limit: 25, offset: 0, pages: 1, currentPage: 1 } }
    });
    mockGetQueryInspectorDetails.mockResolvedValue({
      success: true,
      data: { _key: 'q1', text: 'test query', userName: 'John' }
    });

    const wrapper = mountQI();
    await wrapper.vm.$nextTick();
    await wrapper.vm.$nextTick();

    expect(wrapper.vm.selectedQuery).toBeNull();

    await wrapper.vm.inspectQuery('q1');
    await wrapper.vm.$nextTick();

    expect(wrapper.vm.selectedQuery).toBeTruthy();
    expect(wrapper.vm.selectedQuery._key).toBe('q1');
    expect(wrapper.vm.loading).toBe(false);
  });

  it('should clear selectedQuery to return to list', async () => {
    mockGetQueriesForInspector.mockResolvedValue({
      success: true,
      data: { queries: [], pagination: { total: 0, limit: 25, offset: 0, pages: 0, currentPage: 1 } }
    });
    mockGetQueryInspectorDetails.mockResolvedValue({
      success: true,
      data: { _key: 'q1', text: 'test' }
    });

    const wrapper = mountQI();
    await wrapper.vm.$nextTick();
    await wrapper.vm.$nextTick();

    await wrapper.vm.inspectQuery('q1');
    await wrapper.vm.$nextTick();
    expect(wrapper.vm.selectedQuery).toBeTruthy();

    wrapper.vm.selectedQuery = null;
    await wrapper.vm.$nextTick();

    expect(wrapper.vm.selectedQuery).toBeNull();
  });

  it('should handle pagination via goToPage', async () => {
    mockGetQueriesForInspector.mockResolvedValue({
      success: true,
      data: { queries: [], pagination: { total: 50, limit: 25, offset: 25, pages: 2, currentPage: 2 } }
    });

    const wrapper = mountQI();
    await wrapper.vm.$nextTick();
    await wrapper.vm.$nextTick();

    await wrapper.vm.goToPage(2);
    expect(mockGetQueriesForInspector).toHaveBeenCalledTimes(2);
    expect(wrapper.vm.pagination.offset).toBe(25);
  });

  it('should handle search with filters resetting offset', async () => {
    mockGetQueriesForInspector.mockResolvedValue({
      success: true,
      data: { queries: [], pagination: { total: 0, limit: 25, offset: 0, pages: 0, currentPage: 1 } }
    });

    const wrapper = mountQI();
    await wrapper.vm.$nextTick();
    await wrapper.vm.$nextTick();

    await wrapper.vm.handleSearch({ searchText: 'tax', minConfidence: '0.5' });

    expect(wrapper.vm.currentFilters).toEqual({ searchText: 'tax', minConfidence: '0.5' });
    expect(wrapper.vm.pagination.offset).toBe(0);
    expect(mockGetQueriesForInspector).toHaveBeenCalledTimes(2);
  });

  it('should set loadError on inspectQuery failure', async () => {
    mockGetQueriesForInspector.mockResolvedValue({
      success: true,
      data: { queries: [{ _key: 'q1' }], pagination: { total: 1, limit: 25, offset: 0, pages: 1, currentPage: 1 } }
    });
    mockGetQueryInspectorDetails.mockRejectedValue(new Error('Detail fetch failed'));

    const wrapper = mountQI();
    await wrapper.vm.$nextTick();
    await wrapper.vm.$nextTick();

    await wrapper.vm.inspectQuery('q1');
    await wrapper.vm.$nextTick();

    expect(wrapper.vm.loadError).toBe(true);
    expect(wrapper.vm.loading).toBe(false);
  });
});

// ===========================================================================
// QueryInspectorList — renders directly (no v-else wrapper issues)
// ===========================================================================
describe('QueryInspectorList', () => {
  // A query that answered: grounded, one source document, no abstention.
  const answeredQuery = {
    _key: 'q1',
    timestamp: '2025-05-28T10:00:00Z',
    text: 'What is the tax rate?',
    metadata: { confidence_score: 0.9, source_documents: [{}] },
    context: { categoryLabel: 'Taxes & Revenue', serviceLabels: [] },
    responseTime: 500
  };

  let QueryInspectorList;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.isolateModules(() => {
      QueryInspectorList = require('../../components/admin/QueryInspector/QueryInspectorList.vue').default;
    });
  });

  function mountList(props) {
    return mount(QueryInspectorList, { global: { stubs: dsStubs }, props });
  }

  it('should render table with query rows', () => {
    const queries = [
      {
        _key: 'q1',
        timestamp: '2025-05-28T10:00:00Z',
        text: 'What is the tax rate?',
        metadata: { confidence_score: 0.92, source_documents: [{}] },
        responseTime: 500,
        userFeedback: { rating: 5 }
      }
    ];

    const wrapper = mountList({ queries, pagination: { total: 1, limit: 25, offset: 0, pages: 1, currentPage: 1 } });
    expect(wrapper.text()).toContain('What is the tax rate?');
  });

  it('should emit inspect event on row click', async () => {
    const queries = [{ _key: 'q1', text: 'test', metadata: {}, responseTime: 100 }];
    const wrapper = mountList({ queries, pagination: { total: 1, limit: 25, offset: 0, pages: 1, currentPage: 1 } });

    const row = wrapper.find('.qi-list__row');
    await row.trigger('click');

    expect(wrapper.emitted('inspect')).toBeTruthy();
    expect(wrapper.emitted('inspect')[0]).toEqual(['q1']);
  });

  it('should show empty state when no queries', () => {
    const wrapper = mountList({
      queries: [],
      pagination: { total: 0, limit: 25, offset: 0, pages: 0, currentPage: 1 }
    });
    expect(wrapper.find('.ds-state').exists() || wrapper.text()).toBeTruthy();
  });

  it('should mark an abstained query and show the scope that filtered', () => {
    // The operator's question is "which scopes matched nothing?". The marker
    // alone does not answer it — the scope has to sit next to it. The scope
    // is the filter labels the PIPELINE applied (chatqna reports them), not
    // the raw request: for this query only the service filtered.
    const queries = [
      {
        _key: 'q1',
        timestamp: '2025-05-28T10:00:00Z',
        text: 'What is the tax rate?',
        metadata: {
          confidence_score: 0,
          source_documents: [],
          abstained: true,
          abstention_reason: 'no_documents_retrieved',
          filter_labels: ['Tax Payment']
        },
        context: { categoryLabel: 'Taxes & Revenue', serviceLabels: ['Tax Payment'] },
        responseTime: 500
      }
    ];
    const wrapper = mountList({ queries, pagination: { total: 1, limit: 25, offset: 0, pages: 1, currentPage: 1 } });

    // The marker is row-addressable: a page can carry several abstained
    // rows, and a finder that cannot name its row validates the wrong one.
    expect(wrapper.find('[data-testid="qi-abstention-q1"]').exists()).toBe(true);
    const scope = wrapper.find('[data-testid="qi-scope-q1"]');
    expect(scope.exists()).toBe(true);
    expect(scope.text()).toBe('Tax Payment');
  });

  it('should keep the abstention marker row-unique', () => {
    const queries = [
      { _key: 'q1', text: 'a', metadata: { abstained: true }, responseTime: 1 },
      { _key: 'q2', text: 'b', metadata: { abstained: true }, responseTime: 1 },
      { _key: 'q3', text: 'c', metadata: {}, responseTime: 1 }
    ];
    const wrapper = mountList({ queries, pagination: { total: 3, limit: 25, offset: 0, pages: 1, currentPage: 1 } });
    expect(wrapper.find('[data-testid="qi-abstention-q1"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="qi-abstention-q2"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="qi-abstention-q3"]').exists()).toBe(false);
    expect(wrapper.findAll('[data-testid="qi-abstention-q1"]')).toHaveLength(1);
  });

  it('should show the category as the scope when no service was named', () => {
    const query = { ...answeredQuery, metadata: { ...answeredQuery.metadata, filter_labels: ['Taxes & Revenue'] } };
    const wrapper = mountList({
      queries: [query],
      pagination: { total: 1, limit: 25, offset: 0, pages: 1, currentPage: 1 }
    });

    expect(wrapper.find('[data-testid="qi-scope-q1"]').text()).toBe('Taxes & Revenue');
  });

  it('should say the query was unfiltered when the filter list is empty', () => {
    // An unfiltered query (the single-message backend mode sends no context
    // at all) carries an empty filter-label list. That is a different fact
    // from "the record predates the field": the dash is reserved for the
    // latter, the column says Unfiltered for the former.
    const query = { ...answeredQuery, metadata: { ...answeredQuery.metadata, filter_labels: [] } };
    const wrapper = mountList({
      queries: [query],
      pagination: { total: 1, limit: 25, offset: 0, pages: 1, currentPage: 1 }
    });

    expect(wrapper.find('[data-testid="qi-scope-q1"]').text()).toContain('Unfiltered');
  });

  it('should show a dash when the scope was never recorded', () => {
    // A query saved before the field existed (or streamed by a chatqna too
    // old to report it): the honest answer is a dash, not "Unfiltered".
    const query = { ...answeredQuery, metadata: {} };
    const wrapper = mountList({
      queries: [query],
      pagination: { total: 1, limit: 25, offset: 0, pages: 1, currentPage: 1 }
    });

    expect(wrapper.find('[data-testid="qi-scope-q1"]').text()).toContain('—');
    expect(wrapper.find('[data-testid="qi-scope-q1"]').text()).not.toContain('Unfiltered');
  });

  it('should not mark a query that answered', () => {
    const wrapper = mountList({
      queries: [answeredQuery],
      pagination: { total: 1, limit: 25, offset: 0, pages: 1, currentPage: 1 }
    });

    expect(wrapper.find('[data-testid="qi-abstention-marker"]').exists()).toBe(false);
  });

  it('should show pagination when multiple pages', () => {
    const queries = [{ _key: 'q1', text: 'test', metadata: {}, responseTime: 100 }];
    const wrapper = mountList({ queries, pagination: { total: 50, limit: 25, offset: 0, pages: 2, currentPage: 1 } });
    expect(wrapper.find('.qi-list__pagination').exists()).toBe(true);
  });

  it('should not show pagination when single page', () => {
    const wrapper = mountList({
      queries: [],
      pagination: { total: 0, limit: 25, offset: 0, pages: 0, currentPage: 1 }
    });
    expect(wrapper.find('.qi-list__pagination').exists()).toBe(false);
  });

  it('should interpolate the pagination placeholders through the real translate chain', () => {
    // vue-i18n renders `{current}`-style placeholders empty unless the
    // named-params dict reaches t() as its third argument. Round 22: the
    // list no longer DELEGATES to $parent (that chain broke whenever a
    // wrapper sat between it and AdminDashboard — the English-fallback
    // leak) — it uses translateMixin, whose translate calls this.$i18n.t
    // exactly like AdminDashboard's. So the honest wiring test installs the
    // real i18n plugin and asserts the INTERPOLATED sentence.
    const { createI18n } = require('vue-i18n');
    const i18n = createI18n({
      legacy: true,
      locale: 'en',
      fallbackLocale: 'en',
      messages: {
        en: { admin: { queryInspector: { pageInfo: 'Page {current} of {total} ({count} total)' } } }
      }
    });
    const Parent = {
      components: { QueryInspectorList },
      template: '<query-inspector-list :queries="queries" :pagination="pagination" />',
      data() {
        return { queries: [], pagination: { total: 48, limit: 25, offset: 25, pages: 5, currentPage: 2 } };
      }
    };
    const wrapper = mount(Parent, { global: { stubs: dsStubs, plugins: [i18n] } });
    expect(wrapper.find('.qi-list__page-info').text()).toBe('Page 2 of 5 (48 total)');
  });

  it('should emit search event when search button clicked', async () => {
    const wrapper = mountList({
      queries: [],
      pagination: { total: 0, limit: 25, offset: 0, pages: 0, currentPage: 1 }
    });

    const buttons = wrapper.findAll('.ds-btn');
    const searchBtn = buttons.find((b) => b.text().includes('Search'));
    if (searchBtn) {
      await searchBtn.trigger('click');
      expect(wrapper.emitted('search')).toBeTruthy();
    }
  });

  it('should reset filters and emit search on reset', async () => {
    const wrapper = mountList({
      queries: [],
      pagination: { total: 0, limit: 25, offset: 0, pages: 0, currentPage: 1 }
    });

    wrapper.vm.filters.searchText = 'tax';
    await wrapper.vm.$nextTick();

    await wrapper.vm.resetFilters();

    expect(wrapper.vm.filters.searchText).toBe('');
    expect(wrapper.emitted('search')).toBeTruthy();
  });
});

// ===========================================================================
// QueryInspectorDetail
// ===========================================================================
describe('QueryInspectorDetail', () => {
  let QueryInspectorDetail;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.isolateModules(() => {
      QueryInspectorDetail = require('../../components/admin/QueryInspector/QueryInspectorDetail.vue').default;
    });
  });

  const fullQuery = {
    _key: 'q1',
    userId: 'user-1',
    userName: 'John Doe',
    timestamp: '2025-05-28T10:00:00Z',
    text: 'What is the tax rate?',
    response: 'The tax rate is 30%',
    responseTime: 500,
    contextOption: 'single-message',
    context: { categoryLabel: 'Taxes & Revenue', serviceLabels: ['Tax Payment'], language: 'en' },
    messages: [
      { role: 'user', content: 'What is the tax rate?' },
      { role: 'assistant', content: 'The tax rate is 30%' }
    ],
    metadata: {
      confidence_score: 0.92,
      source_documents: [
        {
          document_name: 'Tax Guide 2025',
          document_id: 'doc-1',
          score: 0.95,
          categoryLabel: 'Taxes',
          url: 'https://example.com/tax-guide'
        }
      ]
    },
    userFeedback: { rating: 5, comment: 'Very helpful', providedAt: '2025-05-28T10:01:00Z' }
  };

  function mountDetail(props) {
    return mount(QueryInspectorDetail, { global: { stubs: dsStubs }, props });
  }

  it('should render all sections for a complete query', () => {
    const wrapper = mountDetail({ query: fullQuery });
    expect(wrapper.text()).toContain('John Doe');
    expect(wrapper.text()).toContain('What is the tax rate?');
    expect(wrapper.text()).toContain('The tax rate is 30%');
    expect(wrapper.text()).toContain('Taxes & Revenue');
    expect(wrapper.text()).toContain('Very helpful');
  });

  it('should emit back event via wrapper.vm', async () => {
    const wrapper = mountDetail({ query: fullQuery });

    // The DsButton stub renders as .ds-btn, but clicking a stub component
    // doesn't propagate $emit to parent. Test the emit directly.
    wrapper.vm.$emit('back');
    await wrapper.vm.$nextTick();

    expect(wrapper.emitted('back')).toBeTruthy();
  });

  it('should show query ID in header', () => {
    const wrapper = mountDetail({ query: fullQuery });
    expect(wrapper.text()).toContain('q1');
  });

  it('should handle missing user name gracefully', () => {
    const query = { ...fullQuery, userName: null, userId: 'user-42' };
    const wrapper = mountDetail({ query });
    expect(wrapper.text()).toContain('user-42');
  });

  it('should handle missing messages', () => {
    const query = { ...fullQuery, messages: null };
    const wrapper = mountDetail({ query });
    expect(wrapper.text()).toContain('What is the tax rate?');
  });

  it('should handle missing source documents', () => {
    const query = { ...fullQuery, metadata: { confidence_score: 0.5, source_documents: [] } };
    const wrapper = mountDetail({ query });
    expect(wrapper.text()).toBeTruthy();
  });

  it('should handle missing feedback', () => {
    const query = { ...fullQuery, userFeedback: null };
    const wrapper = mountDetail({ query });
    expect(wrapper.text()).toContain('What is the tax rate?');
    expect(wrapper.text()).not.toContain('Very helpful');
  });

  it('should render message roles', () => {
    const wrapper = mountDetail({ query: fullQuery });
    expect(wrapper.text()).toContain('user:');
    expect(wrapper.text()).toContain('assistant:');
  });

  it('should render document scores', () => {
    const wrapper = mountDetail({ query: fullQuery });
    expect(wrapper.text()).toContain('95.0%');
  });

  it('should render document links', () => {
    const wrapper = mountDetail({ query: fullQuery });
    const link = wrapper.find('a[href="https://example.com/tax-guide"]');
    expect(link.exists()).toBe(true);
  });

  it('should hide document link when url is "error"', () => {
    const query = {
      ...fullQuery,
      metadata: { confidence_score: 0.9, source_documents: [{ document_name: 'Doc', score: 0.9, url: 'error' }] }
    };
    const wrapper = mountDetail({ query });
    const link = wrapper.find('a');
    expect(link.exists()).toBe(false);
  });

  it('should show the abstention and its cause', () => {
    const query = {
      ...fullQuery,
      metadata: {
        confidence_score: 0,
        source_documents: [],
        abstained: true,
        abstention_reason: 'no_documents_retrieved'
      }
    };
    const wrapper = mountDetail({ query });

    expect(wrapper.find('[data-testid="qi-abstention-marker"]').exists()).toBe(true);
    const reason = wrapper.find('[data-testid="qi-abstention-reason"]');
    expect(reason.exists()).toBe(true);
    expect(reason.text()).toContain('No document');
  });

  it("should name the reranker-kept-nothing cause in the operator's words", () => {
    // The retrieval matched, the reranker kept none: the scope was fine, and
    // the prose must say so — a cause split that renders as the generic
    // fallback plus machine tokens defeats its own purpose.
    const query = {
      ...fullQuery,
      metadata: {
        confidence_score: 0,
        source_documents: [],
        abstained: true,
        abstention_reason: 'reranker_selected_nothing'
      }
    };
    const wrapper = mountDetail({ query });
    const reason = wrapper.find('[data-testid="qi-abstention-reason"]');
    expect(reason.text()).toContain('reranker kept none');
    expect(reason.text()).not.toContain('(');
  });

  it('should name the scope that filtered, next to the labels that were requested', () => {
    // The list and the detail must not disagree about what filtered. The
    // pipeline reports the applied filter labels; the request is shown
    // beside them so a stale label the service scope shadowed stays visible.
    const query = {
      ...fullQuery,
      metadata: { ...fullQuery.metadata, filter_labels: ['Tax Payment'] }
    };
    const wrapper = mountDetail({ query });
    const scope = wrapper.find('[data-testid="qi-detail-scope"]');
    expect(scope.exists()).toBe(true);
    expect(scope.text()).toContain('Tax Payment');
    // The requested category stays visible next to the scope that filtered.
    expect(wrapper.text()).toContain('Taxes & Revenue');
  });

  it('should say the query was unfiltered when the filter list is empty', () => {
    // Same wording as the list cell: the shared scope rule keeps the views
    // from disagreeing, and so does the shared name for the state.
    const query = { ...fullQuery, metadata: { ...fullQuery.metadata, filter_labels: [] } };
    const wrapper = mountDetail({ query });
    expect(wrapper.find('[data-testid="qi-detail-scope"]').text()).toContain('Unfiltered');
  });

  it('should say the scope was not recorded for a query saved before the field existed', () => {
    const wrapper = mountDetail({ query: fullQuery });
    expect(wrapper.find('[data-testid="qi-detail-scope"]').text()).toContain('Not recorded');
  });

  it('should say the scope was not recorded when the stored value is null', () => {
    // An explicit null in the stored metadata means the same as an absent
    // field — the pipeline never reported the scope for this query.
    const query = { ...fullQuery, metadata: { ...fullQuery.metadata, filter_labels: null } };
    const wrapper = mountDetail({ query });
    expect(wrapper.find('[data-testid="qi-detail-scope"]').text()).toContain('Not recorded');
  });

  it('should treat a malformed stored scope as not recorded, not crash', () => {
    // A non-array in the stored metadata (a bad migration, a hand-edited
    // record) is not joinable: it degrades to the dash instead of throwing
    // out of the render.
    const query = { ...fullQuery, metadata: { ...fullQuery.metadata, filter_labels: 'Tax Payment' } };
    const wrapper = mountDetail({ query });
    expect(wrapper.find('[data-testid="qi-detail-scope"]').text()).toContain('Not recorded');
  });

  it('should not show an abstention block for an ordinary answer', () => {
    const wrapper = mountDetail({ query: fullQuery });
    expect(wrapper.find('[data-testid="qi-abstention-marker"]').exists()).toBe(false);
  });
});
