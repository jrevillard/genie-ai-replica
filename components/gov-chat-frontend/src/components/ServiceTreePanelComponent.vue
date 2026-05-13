<!-- ServiceTreePanelComponent.vue with Android keyboard fix -->
<template>
  <div ref="treePanel" class="service-tree-panel">
    <h4>{{ $t('sidebar.governmentServices') }}</h4>

    <div ref="searchContainer" class="search-container">
      <DsInput
        v-model="searchQuery"
        class="search-box"
        type="text"
        :placeholder="$t('sidebar.searchPlaceholder')"
        @input="performSearch"
        @focus="handleInputFocus"
        @blur="handleInputBlur"
      />
      <DsButton variant="primary" :title="isAnyNodeExpanded ? 'Collapse All' : 'Expand All'" @click="toggleAllNodes">
        {{ isAnyNodeExpanded ? '−' : '+' }}
      </DsButton>
    </div>

    <div ref="treeListContainer" class="tree-list-container">
      <ul class="service-tree-list">
        <li v-for="node in nodes" :key="node.catKey">
          <div class="node-label" @click="toggleNode(node)">
            <span v-if="node.children && node.children.length > 0" class="toggle-icon">
              {{ node.expanded ? '▼' : '▶' }}
            </span>
            <span class="node-name">{{ node.name }}</span>
          </div>

          <ul v-if="node.expanded && node.children && node.children.length > 0" class="child-list">
            <li
              v-for="(childName, cIndex) in node.children"
              :key="cIndex"
              :class="{ selected: isChildSelected(node.catKey, cIndex) }"
              @click.stop="toggleChildSelection(node.catKey, childName, cIndex)"
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
  </div>
</template>

<script>
import { eventBus } from '../eventBus.js';
import serviceTreeService from '../services/serviceTreeService.js';
import DsButton from './ds/Button.vue';
import DsInput from './ds/Input.vue';

export default {
  name: 'ServiceTreePanelComponent',
  components: {
    DsButton,
    DsInput
  },

  data() {
    return {
      searchQuery: '',
      selectedNodes: {},
      nodes: [],
      currentLocale: 'en',
      isAndroid: false
    };
  },

  computed: {
    isAnyNodeExpanded() {
      return this.nodes.some((node) => node.expanded);
    }
  },

  created() {
    // Set initial locale
    if (this.$i18n && this.$i18n.locale) {
      this.currentLocale = this.$i18n.locale;
    }

    // Watch for locale changes
    if (this.$i18n) {
      this.$watch(
        () => this.$i18n.locale,
        (newLocale) => {
          this.currentLocale = newLocale;
          // Reload categories when locale changes
          this.loadCategories(newLocale);
        }
      );
    }

    // Initial load of categories
    this.loadCategories(this.currentLocale);

    // Detect Android
    this.isAndroid = /Android/i.test(navigator.userAgent);
  },

  mounted() {
    eventBus.$on('contextItemRemoved', this.handleContextItemRemoved);

    // Add Android keyboard detection
    if (/Android/i.test(navigator.userAgent)) {
      const originalHeight = window.innerHeight;

      // Listen for resize events (keyboard opening/closing)
      window.addEventListener('resize', () => {
        // If keyboard is likely open (height decreased significantly)
        if (window.innerHeight < originalHeight * 0.75) {
          // Force sidebar open
          const sideBar = document.querySelector('.side-bar');
          if (sideBar) {
            sideBar.classList.add('side-bar-open');
            sideBar.style.transform = 'translateX(0)';
            sideBar.style.display = 'block';
            sideBar.style.position = 'fixed';
            sideBar.style.top = '60px'; // Adjust based on your header height
            sideBar.style.bottom = '0';
            sideBar.style.zIndex = '9999';
          }

          // Add fixed position to sidebar content
          const sidebarContent = document.querySelector('.sidebar-content');
          if (sidebarContent) {
            sidebarContent.style.display = 'block';
            sidebarContent.style.overflow = 'auto';
            sidebarContent.style.height = 'auto';
            sidebarContent.style.maxHeight = '70vh';
          }

          // Hide any elements that might interfere
          const weatherContainer = document.querySelector('.weather-container');
          if (weatherContainer) {
            weatherContainer.style.display = 'none';
          }
        } else {
          // Restore normal state
          const sideBar = document.querySelector('.side-bar');
          if (sideBar) {
            sideBar.style.position = '';
            sideBar.style.top = '';
            sideBar.style.bottom = '';
            sideBar.style.zIndex = '';
          }

          const sidebarContent = document.querySelector('.sidebar-content');
          if (sidebarContent) {
            sidebarContent.style.overflow = '';
            sidebarContent.style.height = '';
            sidebarContent.style.maxHeight = '';
          }

          const weatherContainer = document.querySelector('.weather-container');
          if (weatherContainer) {
            weatherContainer.style.display = '';
          }
        }
      });
    }
  },

  beforeUnmount() {
    eventBus.$off('contextItemRemoved', this.handleContextItemRemoved);
  },

  methods: {
    // Load categories from the API
    async loadCategories(locale) {
      try {
        const categories = await serviceTreeService.getAllCategories(locale);

        // Verify each category has the expected properties
        if (!categories || !Array.isArray(categories)) {
          throw new Error('Invalid API response format');
        }

        // Process the API response - just add expanded property, filter null children
        this.nodes = categories.map((category) => ({
          ...category,
          children: (category.children || []).filter(Boolean),
          expanded: false
        }));
      } catch (error) {
        console.error('Error loading categories:', error);
      }
    },

    // Handle focus on search input - for Android keyboard issues
    handleInputFocus() {
      // Only apply on Android
      if (this.isAndroid) {
        // Force the sidebar content to remain visible
        const sidebarContent = document.querySelector('.sidebar-content');
        if (sidebarContent) {
          sidebarContent.style.position = 'fixed';
          sidebarContent.style.top = '60px';
          sidebarContent.style.bottom = '0';
          sidebarContent.style.left = '0';
          sidebarContent.style.width = '85%';
          sidebarContent.style.maxWidth = '320px';
          sidebarContent.style.zIndex = '9999';
          sidebarContent.style.backgroundColor = 'var(--surface)';
          sidebarContent.style.overflowY = 'auto';
        }

        // Show the weather container
        const weatherContainer = document.querySelector('.weather-container');
        if (weatherContainer) {
          weatherContainer.style.display = 'none';
        }
      }
    },

    // Handle blur on search input
    handleInputBlur() {
      // Reset styles after delay to ensure keyboard closed
      if (this.isAndroid) {
        setTimeout(() => {
          // Reset sidebar content position
          const sidebarContent = document.querySelector('.sidebar-content');
          if (sidebarContent) {
            sidebarContent.style.position = '';
            sidebarContent.style.top = '';
            sidebarContent.style.bottom = '';
            sidebarContent.style.left = '';
            sidebarContent.style.width = '';
            sidebarContent.style.maxWidth = '';
            sidebarContent.style.zIndex = '';
            sidebarContent.style.backgroundColor = '';
            sidebarContent.style.overflowY = '';
          }

          // Show the weather container
          const weatherContainer = document.querySelector('.weather-container');
          if (weatherContainer) {
            weatherContainer.style.display = '';
          }
        }, 300);
      }
    },

    toggleNode(node) {
      node.expanded = !node.expanded;
    },

    toggleAllNodes() {
      const shouldExpand = !this.isAnyNodeExpanded;
      this.nodes.forEach((node) => {
        node.expanded = shouldExpand;
      });
    },

    handleContextItemRemoved(item) {
      if (!item || !item.category || !item.service) return;

      const catKey = item.category;
      const children = this.nodes.find((n) => n.catKey === catKey)?.children || [];
      const childIndex = children.findIndex((child) => String(child) === String(item.service));

      if (childIndex !== -1 && this.selectedNodes[catKey]) {
        // Filter out the removed index
        const nodeSelection = this.selectedNodes[catKey] || [];
        this.selectedNodes[catKey] = nodeSelection.filter((idx) => idx !== childIndex);
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

      this.nodes.forEach((node) => {
        const categoryName = (node.name || '').toLowerCase();
        const childNames = (node.children || [])
          .filter(Boolean)
          .map((name) => (typeof name === 'string' ? name.toLowerCase() : ''));

        if (!query) {
          node.expanded = false;
        } else {
          const matchesCategory = categoryName.includes(query);
          const matchesChild = childNames.some((name) => name.includes(query));
          node.expanded = matchesCategory || matchesChild;
        }
      });
    }
  }
};
</script>

<style scoped>
.service-tree-panel {
  margin-bottom: 0;
  height: 100%;
  display: flex;
  flex-direction: column;
  font-size: inherit; /* CHANGED from 0.625rem */
  overflow-y: auto;
  position: relative;
  z-index: 10;
}

.service-tree-panel h4 {
  margin-bottom: var(--space-sm);
  font-weight: 600;
  color: var(--fg);
  font-size: var(--text-sm); /* This can remain as it's a title */
  flex-shrink: 0;
}

.search-container {
  position: relative;
  display: flex;
  gap: var(--space-xs);
  margin-bottom: var(--space-sm);
  flex-shrink: 0;
  position: sticky;
  top: 0;
  z-index: 20;
  background-color: var(--bg-sidebar);
  padding: var(--space-xs) 0;
}

.expand-collapse-btn {
}

.tree-list-container {
  flex-grow: 1;
  overflow-y: auto;
  min-height: 200px;
  transition: height 0.3s ease;
}

.service-tree-list {
  list-style: none;
  padding: 0;
  margin: 0;
}

.service-tree-list li {
  list-style: none;
}

.node-label {
  display: flex;
  align-items: center;
  cursor: pointer;
  padding: var(--space-xs) var(--space-sm);
  border-radius: var(--radius-sm);
  transition: background-color 0.2s;
}

.node-label:hover {
  background-color: var(--bg);
}

.toggle-icon {
  width: 18px;
  text-align: center;
  margin-right: var(--space-xs);
  color: var(--muted);
  font-size: inherit; /* CHANGED from 0.625rem */
}

.toggle-icon.placeholder {
  visibility: hidden;
}

.node-name {
  flex: 1;
  color: var(--fg);
  font-size: inherit; /* CHANGED from 0.625rem */
}

.child-list {
  margin-left: 18px;
  border-left: 1px dashed var(--border-light);
  padding-left: var(--space-sm);
  margin-top: 2px;
  list-style-type: none;
}

.child-list li {
  list-style-type: none;
}

.child-list li::before {
  content: none;
}

.selected .node-label {
  background-color: var(--accent-muted);
  border-left: 2px solid var(--accent);
}

ul {
  list-style-type: none;
}

li {
  list-style-type: none;
}

/* Mobile specific styles */
@media screen and (max-width: 768px) {
  .search-container {
    position: sticky;
    top: 0;
    z-index: 30;
    padding: var(--space-sm) 0;
    box-shadow: var(--shadow-sm);
  }

  .tree-list-container {
    min-height: 200px;
  }
}
</style>
