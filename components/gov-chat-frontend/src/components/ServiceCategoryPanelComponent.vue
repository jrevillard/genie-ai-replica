<template>
  <div class="category-panel">
    <h4>Public Services</h4>
    <ul>
      <li v-for="(category, index) in categories" :key="index" @click="selectCategory(category)">
        <img :src="category.icon" alt="icon" class="icon" />
        <span>{{ category.name }}</span>
      </li>
    </ul>
  </div>
</template>

<script>
export default {
  name: 'ServiceCategoryPanelComponent',
  emits: ['selectCategory'],
  data() {
    return {
      categories: [
        { name: 'Fire', icon: '/icons/fire.png' },
        { name: 'Police', icon: '/icons/police.png' },
        { name: 'Taxation', icon: '/icons/tax.png' },
        { name: 'Building Services', icon: '/icons/building.png' }
        // etc.
      ]
    };
  },
  methods: {
    selectCategory(category) {
      this.$emit('selectCategory', category.name);
    }
  }
};
</script>

<style scoped>
.category-panel {
  margin-bottom: var(--space-lg);
}

.category-panel h4 {
  margin-bottom: var(--space-sm);
}

.category-panel ul {
  list-style: none;
  padding: 0;
  margin: 0;
}

.category-panel li {
  display: flex;
  align-items: center;
  padding: var(--space-sm);
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: background 0.2s;
}

.category-panel li:hover {
  background: var(--bg);
}

.icon {
  width: 24px;
  height: 24px;
  margin-right: var(--space-sm);
}

.category-panel h4 {
  color: var(--muted);
  font-size: var(--text-base);
  font-weight: 500;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}
</style>
