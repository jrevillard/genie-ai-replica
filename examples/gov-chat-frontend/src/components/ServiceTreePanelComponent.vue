<!-- ServiceTreePanelComponent.vue - Fixed to handle missing name property -->
<template>
  <div class="service-tree-panel">
    <h4>{{ $t('sidebar.governmentServices', 'Government Services') }}</h4>

    <div class="search-container">
      <input
        v-model="searchQuery"
        class="search-box"
        type="text"
        :placeholder="$t('sidebar.searchPlaceholder', 'Search services...')"
        @input="performSearch"
      />
      <button 
        class="expand-collapse-btn" 
        @click="toggleAllNodes" 
        :title="isAnyNodeExpanded ? 'Collapse All' : 'Expand All'"
      >
        {{ isAnyNodeExpanded ? '−' : '+' }}
      </button>
    </div>

    <!-- No scrolling in this element, let the parent handle it -->
    <ul class="service-tree-list">
      <li v-for="(node, index) in nodes" :key="node.catKey">
        <div class="node-label" @click="toggleNode(node)">
          <span v-if="node.children && node.children.length > 0" class="toggle-icon">
            {{ node.expanded ? '▼' : '▶' }}
          </span>
          <span class="node-name">{{ node.name }}</span>
        </div>

        <ul
          v-if="node.expanded && node.children && node.children.length > 0"
          class="child-list"
        >
          <li
            v-for="(childName, cIndex) in node.children"
            :key="cIndex"
            @click.stop="toggleChildSelection(node.catKey, childName, cIndex)"
            :class="{ 'selected': isChildSelected(node.catKey, cIndex) }"
          >
            <div class="node-label child-row">
              <span class="toggle-icon placeholder"></span>
              <span class="node-name">{{ childName }}</span>
            </div>
          </li>
        </ul>
      </li>
    </ul>
  </div>
</template>

<script>
import { eventBus } from '../eventBus.js'
import serviceTreeService from '../services/serviceTreeService.js'

export default {
  name: 'ServiceTreePanelComponent',
  
  data() {
    return {
      searchQuery: '',
      selectedNodes: {},
      nodes: [],
      currentLocale: 'en'
    }
  },
  
  computed: {
    isAnyNodeExpanded() {
      return this.nodes.some(node => node.expanded);
    }
  },
  
  created() {
    // Set initial locale
    if (this.$i18n && this.$i18n.locale) {
      this.currentLocale = this.$i18n.locale;
    }
    
    // Watch for locale changes
    if (this.$i18n) {
      this.$watch(() => this.$i18n.locale, (newLocale) => {
        console.log('Locale changed to:', newLocale);
        this.currentLocale = newLocale;
        // Reload categories when locale changes
        this.loadCategories(newLocale);
      });
    }
    
    // Initial load of categories
    this.loadCategories(this.currentLocale);
  },
  
  mounted() {
    console.log('ServiceTreePanel - mounted');
    eventBus.$on('contextItemRemoved', this.handleContextItemRemoved);
  },
  
  beforeUnmount() {
    eventBus.$off('contextItemRemoved', this.handleContextItemRemoved);
  },
  
  methods: {
    // No longer needed
    
    // Load categories from the API
    async loadCategories(locale) {
      try {
        const categories = await serviceTreeService.getAllCategories(locale);
        console.log('Raw API response:', categories);
        
        // Verify each category has the expected properties
        if (!categories || !Array.isArray(categories)) {
          throw new Error('Invalid API response format');
        }
        
        categories.forEach((cat, index) => {
          if (!cat.name) {
            console.warn(`Category at index ${index} is missing name property:`, cat);
          }
        });
        
        // Process the API response - just add expanded property
        this.nodes = categories.map(category => ({
          ...category,
          expanded: false
        }));
        
        console.log('Categories loaded:', this.nodes);
      } catch (error) {
        console.error('Error loading categories:', error);
      }
    },
    
    toggleNode(node) {
      node.expanded = !node.expanded;
    },
    
    toggleAllNodes() {
      const shouldExpand = !this.isAnyNodeExpanded;
      this.nodes.forEach(node => {
        node.expanded = shouldExpand;
      });
    },
    
    handleContextItemRemoved(item) {
      if (!item || !item.category || !item.service) return;
      
      const catKey = item.category;
      const children = this.nodes.find(n => n.catKey === catKey)?.children || [];
      const childIndex = children.findIndex(child => String(child) === String(item.service));
      
      if (childIndex !== -1 && this.selectedNodes[catKey]) {
        // Filter out the removed index
        const nodeSelection = this.selectedNodes[catKey] || [];
        this.selectedNodes[catKey] = nodeSelection.filter(idx => idx !== childIndex);
      }
    },
    
    toggleChildSelection(catKey, childName, childIndex) {
      // Initialize array if needed
      if (!this.selectedNodes[catKey]) {
        this.selectedNodes[catKey] = [];
      }
      
      // Toggle selection
      let isSelected;
      const index = this.selectedNodes[catKey].indexOf(childIndex);
      
      if (index === -1) {
        // Add it
        this.selectedNodes[catKey].push(childIndex);
        isSelected = true;
      } else {
        // Remove it
        this.selectedNodes[catKey].splice(index, 1);
        isSelected = false;
      }
      
      // Notify chat component
      eventBus.$emit('treeNodeSelected', {
        category: catKey,
        service: childName,
        selected: isSelected
      });
    },
    
    isChildSelected(catKey, childIndex) {
      return this.selectedNodes[catKey]?.includes(childIndex) || false;
    },
    
    performSearch() {
      const query = this.searchQuery.toLowerCase();
      
      this.nodes.forEach(node => {
        const categoryName = (node.name || '').toLowerCase();
        const childNames = (node.children || []).map(name => 
          typeof name === 'string' ? name.toLowerCase() : ''
        );
        
        if (!query) {
          node.expanded = false;
        } else {
          const matchesCategory = categoryName.includes(query);
          const matchesChild = childNames.some(name => name.includes(query));
          node.expanded = matchesCategory || matchesChild;
        }
      });
    }
  }
}
</script>

<style scoped>
.service-tree-panel {
  margin-bottom: 0;
  height: 100%;
  display: flex;
  flex-direction: column;
  font-size: 10pt;
  overflow-y: auto;
}

/* Dark mode specific scrollbar */
[data-theme="dark"] .service-tree-panel::-webkit-scrollbar {
  width: 8px;
  background-color: var(--bg-sidebar);
}

[data-theme="dark"] .service-tree-panel::-webkit-scrollbar-thumb {
  background-color: rgba(150, 150, 150, 0.2);
  border-radius: 4px;
}

[data-theme="dark"] .service-tree-panel {
  scrollbar-color: rgba(150, 150, 150, 0.2) var(--bg-sidebar);
  scrollbar-width: thin;
}

.service-tree-panel h4 {
  margin-bottom: 8px;
  font-weight: 600;
  color: #333;
  font-size: 12pt;
  flex-shrink: 0;
}

.search-container {
  position: relative;
  display: flex;
  margin-bottom: 8px;
  flex-shrink: 0;
}

.search-box {
  flex: 1;
  padding: 6px;
  font-size: 10pt;
  border: 1px solid #ccc;
  border-radius: 4px;
  outline: none;
  padding-right: 30px;
}

.expand-collapse-btn {
  position: absolute;
  right: 0;
  height: 100%;
  width: 28px;
  background: #f5f5f5;
  border: 1px solid #ccc;
  border-left: none;
  border-top-right-radius: 4px;
  border-bottom-right-radius: 4px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 16px;
  font-weight: bold;
  color: #555;
  padding: 0;
  transition: background-color 0.2s;
}

.expand-collapse-btn:hover {
  background-color: #e5e5e5;
}

/* Main tree list - NO SCROLLING, parent handles it */
.service-tree-list {
  list-style: none;
  padding: 0;
  margin: 0;
  overflow: visible !important;
  flex-grow: 1;
}

.service-tree-list li {
  list-style: none !important;
}

.node-label {
  display: flex;
  align-items: center;
  cursor: pointer;
  padding: 4px 8px;
  border-radius: 4px;
  transition: background-color 0.2s;
}

.node-label:hover {
  background-color: #f0f0f0;
}
.toggle-icon {
  width: 18px;
  text-align: center;
  margin-right: 4px;
  color: #666;
  font-size: 10pt;
}
.toggle-icon.placeholder {
  visibility: hidden;
}
.node-name {
  flex: 1;
  color: #333;
}

.child-list {
  margin-left: 18px;
  border-left: 1px dashed #ccc;
  padding-left: 8px;
  margin-top: 2px;
  list-style-type: none !important;
}

.child-list li {
  list-style-type: none !important;
}

.child-list li::before {
  content: none !important;
}

.selected .node-label {
  background-color: rgba(78, 151, 209, 0.3);
  border-left: 2px solid var(--accent-color);
}

/* Ensure all browser-specific list styling is removed */
ul {
  list-style-type: none !important;
}

li {
  list-style-type: none !important;
}

/* Add these styles to the component's scoped CSS */
h4,
.service-tree-panel h4,
.service-categories-title,
.knowledge-areas-title {
  margin: 0;
  font-size: 0.8rem;
  font-weight: 500;
  color: var(--text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.5px;
  padding: 10px 16px;
}

[data-theme="dark"] h4,
[data-theme="dark"] .service-tree-panel h4,
[data-theme="dark"] .service-categories-title,
[data-theme="dark"] .knowledge-areas-title,
html[data-theme="dark"] h4,
html[data-theme="dark"] .service-tree-panel h4,
html[data-theme="dark"] .service-categories-title,
html[data-theme="dark"] .knowledge-areas-title {
  color: rgba(255, 255, 255, 0.7) !important;
}

.service-tree-panel h4 {
  color: #333;
}

[data-theme="dark"] .service-tree-panel {
  scrollbar-color: rgba(100, 100, 100, 0.3) var(--bg-sidebar);
  scrollbar-width: thin;
}

[data-theme="dark"] .service-tree-panel::-webkit-scrollbar {
  width: 8px;
  background-color: var(--bg-sidebar);
}

[data-theme="dark"] .service-tree-panel::-webkit-scrollbar-thumb {
  background-color: rgba(150, 150, 150, 0.2);
  border-radius: 4px;
}

[data-theme="dark"] .search-container {
  background-color: transparent;
}

[data-theme="dark"] .search-box {
  background-color: var(--bg-input) !important;
  color: var(--text-primary) !important;
  border: 1px solid var(--border-input) !important;
}

[data-theme="dark"] .expand-collapse-btn,
[data-theme="dark"] .search-container .add-btn,
[data-theme="dark"] .search-container .plus-btn {
  background-color: var(--bg-button-secondary) !important;
  color: var(--text-button-secondary) !important;
  border: 1px solid var(--border-light);
  border-radius: 4px;
}

[data-theme="dark"] .search-container .expand-collapse-btn:hover,
[data-theme="dark"] .search-container .add-btn:hover,
[data-theme="dark"] .search-container .plus-btn:hover {
  background-color: rgba(150, 150, 150, 0.2) !important;
}
</style>