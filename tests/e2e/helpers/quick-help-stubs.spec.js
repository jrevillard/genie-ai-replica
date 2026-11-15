// Copyright (C) 2026 International Telecommunication Union (ITU)
// SPDX-License-Identifier: Apache-2.0
const { test, expect } = require('@playwright/test');
const { quickHelpButton } = require('./quick-help-stubs');

/**
 * Unit spec for the fixture-card factory — the single choke point every
 * Quick Help spec's served configuration flows through. A card the
 * factory produces SCHEMA-INVALID is a six-spec blast radius with the
 * failure surfacing at app boot (the config-error screen), far from the
 * fixture — the lesson of the icon-string regression (08da7f3b8). This
 * pins the normalization contract at the site that owns it.
 */
test.describe('the fixture-card factory produces schema-valid cards', () => {
  // The defaults every card shares; a schema-valid card carries each of
  // them as the right TYPE (the icon an object, the title a locale map).
  test('a bare id produces the full card with the defaults', () => {
    expect(quickHelpButton({ id: 'e2e-x' })).toEqual({
      id: 'e2e-x',
      title: { en: 'Just Chat' },
      icon: { type: 'file', value: '/config/quickhelp/just-chat.svg' },
      category: null,
      styles: { backgroundColor: '#fff', hoverColor: '#eee', outlineColor: '#ccc' }
    });
  });

  test('a title STRING is wrapped as the locale map the schema requires', () => {
    expect(quickHelpButton({ id: 'e2e-x', title: 'Grid Card 1' }).title).toEqual({ en: 'Grid Card 1' });
  });

  test('a title locale map passes through verbatim — including the empty map', () => {
    expect(quickHelpButton({ id: 'e2e-x', title: { en: '' } }).title).toEqual({ en: '' });
    expect(quickHelpButton({ id: 'e2e-x', title: { en: 'Registry Help', fr: 'Aide' } }).title).toEqual({
      en: 'Registry Help',
      fr: 'Aide'
    });
  });

  test('an icon PATH STRING is wrapped as the icon object the schema requires', () => {
    expect(quickHelpButton({ id: 'e2e-x', icon: '/config/quickhelp/identity-civil.svg' }).icon).toEqual({
      type: 'file',
      value: '/config/quickhelp/identity-civil.svg'
    });
  });

  test('an icon OBJECT passes through verbatim', () => {
    const icon = { type: 'glyph', value: '<svg/>' };
    expect(quickHelpButton({ id: 'e2e-x', icon }).icon).toBe(icon);
  });

  test('scope and action overrides land on the card verbatim', () => {
    const action = { visibleText: { en: 'Tell me about births' }, hiddenPrompt: { en: 'Tell me about births' } };
    const card = quickHelpButton({
      id: 'e2e-healthy',
      title: 'Healthy card',
      category: 'Civil Registry',
      serviceLabels: ['Births'],
      placement: 'composer',
      action
    });
    expect(card.category).toBe('Civil Registry');
    expect(card.serviceLabels).toEqual(['Births']);
    expect(card.placement).toBe('composer');
    expect(card.action).toBe(action);
  });

  test('the composer entry the scope spec serves is byte-equal to the card it replaced', () => {
    // The regression case: the literal this factory replaced, compared
    // whole — not field by field.
    expect(quickHelpButton({ id: 'e2e-composer', placement: 'composer' })).toEqual({
      id: 'e2e-composer',
      title: { en: 'Just Chat' },
      icon: { type: 'file', value: '/config/quickhelp/just-chat.svg' },
      category: null,
      placement: 'composer',
      styles: { backgroundColor: '#fff', hoverColor: '#eee', outlineColor: '#ccc' }
    });
  });
});
