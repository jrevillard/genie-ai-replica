<template>
  <select v-model="currentLocale" @change="changeLanguage">
    <option v-for="locale in $i18n.availableLocales" :key="locale" :value="locale">
      {{ localeNames[locale] || locale }}
    </option>
  </select>
</template>

<script>
import { localeNames } from '../config/languageConfig' // Adjust the path as needed

export default {
  name: 'LanguageSelector',
  data() {
    return {
      currentLocale: this.$i18n.locale,
      localeNames: localeNames,
    }
  },
  watch: {
    '$i18n.locale'(newLocale) {
      this.currentLocale = newLocale
    },
  },
  methods: {
    changeLanguage() {
      if (!this.$i18n) return
      this.$i18n.locale = this.currentLocale
      try {
        localStorage.setItem('userLocale', this.currentLocale)
      } catch (e) {
        console.warn('Unable to save locale preference:', e)
      }
    },
  },
}
</script>

<style scoped>
select {
  padding: 4px 6px;
  border: 1px solid #ccc;
  border-radius: 4px;
  margin-right: 8px;
  cursor: pointer;
}
</style>
