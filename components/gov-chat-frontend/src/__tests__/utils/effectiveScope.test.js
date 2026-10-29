'use strict';

import { effectiveScope } from '../../utils/effectiveScope';

describe('effectiveScope', () => {
  it('returns the service labels when the query named one', () => {
    // The service is the narrower scope: the category must not widen the
    // filter into the whole category (build_filter_labels).
    const scope = effectiveScope({
      context: { categoryLabel: 'Taxes & Revenue', serviceLabels: ['Tax Payment'] }
    });
    expect(scope).toBe('Tax Payment');
  });

  it('returns the category when no service was named', () => {
    const scope = effectiveScope({ context: { categoryLabel: 'Taxes & Revenue', serviceLabels: [] } });
    expect(scope).toBe('Taxes & Revenue');
  });

  it('returns the legacy plural category spelling', () => {
    const scope = effectiveScope({ context: { categoryLabels: ['Taxes & Revenue'] } });
    expect(scope).toBe('Taxes & Revenue');
  });

  it('drops empty and null labels, and dedupes', () => {
    const scope = effectiveScope({
      context: { categoryLabels: ['', 'Taxes & Revenue', 'Taxes & Revenue', null] }
    });
    expect(scope).toBe('Taxes & Revenue');
  });

  it('returns nothing when the backend sent no context to the RAG', () => {
    // The single-message mode drops the context: the labels stored on such a
    // query are not a filter.
    const scope = effectiveScope({
      contextOption: 'single-message',
      context: { categoryLabel: 'Taxes & Revenue', serviceLabels: ['Tax Payment'] }
    });
    expect(scope).toBe('');
  });

  it('returns nothing for a query without a context', () => {
    expect(effectiveScope({})).toBe('');
    expect(effectiveScope(null)).toBe('');
  });
});
