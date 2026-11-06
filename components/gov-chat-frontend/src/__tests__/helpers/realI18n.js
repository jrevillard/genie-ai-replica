'use strict';

/**
 * REAL-I18N TEST RIG (round 26, #83614) — the ONE builder for the real
 * vue-i18n instance over the SHIPPED en catalogue, plus the `$i18n`
 * delegation mock component suites mount with. Extracted from the two
 * verbatim copies in AdminDashboard.test.js (the translate-semantics pin
 * and the servingWarn render pin): the rigs used to drift independently
 * (locale, legacy flag, delegation shape), and a drift silently stopped
 * mirroring the real path — the exact failure these pins exist to catch.
 * A FRESH instance per call keeps suites isolated.
 */

const { createI18n } = require('vue-i18n');

/** A real legacy-mode vue-i18n instance over the shipped en.js catalogue. */
function createRealEnI18n() {
  const en = require('../../i18n/locales/en.js').default;
  return createI18n({
    legacy: true,
    locale: 'en',
    fallbackLocale: 'en',
    messages: { en }
  });
}

/**
 * The `$i18n` component mock whose t() delegates to the real instance —
 * the shape the suites mount with (createAdminDashboardWrapper({}, {
 * $i18n: realI18nMock() })). Pass an instance only to share one build.
 */
function realI18nMock(i18n) {
  const instance = i18n || createRealEnI18n();
  return {
    locale: 'en',
    t: (...args) => instance.global.t(...args)
  };
}

/**
 * The shipped en catalogue, raw — what translateMixin walks
 * (`messages[locale][key]`). A `$i18n` mock WITHOUT `messages` makes every
 * translate() call fall back to the component's inline default, so a suite
 * that wants to assert the SHIPPED copy needs this shape.
 */
function enMessages() {
  return { en: require('../../i18n/locales/en.js').default };
}

/**
 * A `$i18n` mock carrying the raw catalogue next to the delegating t() —
 * for components that resolve strings through translateMixin.
 */
function realI18nMessagesMock(i18n) {
  const instance = i18n || createRealEnI18n();
  return {
    locale: 'en',
    t: (...args) => instance.global.t(...args),
    messages: enMessages()
  };
}

module.exports = { createRealEnI18n, realI18nMock, enMessages, realI18nMessagesMock };
