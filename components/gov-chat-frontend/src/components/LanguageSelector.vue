<template>
  <DsSelect v-model="currentLocale" aria-label="Language">
    <option v-for="locale in $i18n.availableLocales" :key="locale" :value="locale">
      {{ localeNames[locale] || locale }}
    </option>
  </DsSelect>
</template>

<script>
import { localeNames } from '../config/languageConfig';
import DsSelect from './ds/Select.vue';

export default {
  name: 'LanguageSelector',
  components: {
    DsSelect
  },
  data() {
    return {
      currentLocale: this.$i18n.locale,
      localeNames: localeNames
    };
  },
  watch: {
    '$i18n.locale'(newLocale) {
      this.currentLocale = newLocale;
    },
    currentLocale(newLocale) {
      if (newLocale && this.$i18n && newLocale !== this.$i18n.locale) {
        this.$i18n.locale = newLocale;
        try {
          localStorage.setItem('userLocale', newLocale);
        } catch {
          // Silently handle localStorage errors
        }
      }
    }
  }
};
</script>

<style scoped>
/* Styling handled by DsSelect */
</style>
