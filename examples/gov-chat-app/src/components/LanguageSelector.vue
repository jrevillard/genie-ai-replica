<template>
  <select v-model="currentLocale" @change="changeLanguage">
    <option value="en">English</option>
    <option value="fr">Français</option>
    <option value="sw">Kiswahili</option>
  </select>
</template>

<script>
export default {
  name: 'LanguageSelector',
  data() {
    return {
      currentLocale: this.$i18n.locale
    }
  },
  methods: {
    changeLanguage() {
      this.$i18n.locale = this.currentLocale
    }
  }
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

