<!-- ServiceTreePanelComponent.vue with Android keyboard fix -->
<template>
  <div ref="treePanel" class="service-tree-panel">
    <h4>{{ $t('sidebar.governmentServices') }}</h4>

    <div ref="searchContainer" class="search-container">
      <input
        v-model="searchQuery"
        class="search-box"
        type="text"
        :placeholder="$t('sidebar.searchPlaceholder')"
        @input="performSearch"
        @focus="handleInputFocus"
        @blur="handleInputBlur"
      />
      <button
        class="expand-collapse-btn"
        :title="isAnyNodeExpanded ? 'Collapse All' : 'Expand All'"
        @click="toggleAllNodes"
      >
        {{ isAnyNodeExpanded ? '−' : '+' }}
      </button>
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

          <ul v-if="node.expanded && isDocMetaGrouped(node)" class="child-list child-list-metatag-grouped">
            <li v-for="grp in node.metatagGroups" :key="grp.groupKey" class="metatag-group-block">
              <div class="metatag-group-header">
                <span class="toggle-icon metatag-group-chevron" @click.stop="toggleMetatagGroupExpanded(grp)">
                  {{ grp.groupExpanded ? '▼' : '▶' }}
                </span>
                <div
                  class="metatag-group-heading metatag-group-select-all"
                  :class="{
                    'metatag-group-all-selected': isMetatagGroupFullySelected(node, grp)
                  }"
                  :title="$t('sidebar.metatagGroupSelectHint', 'Click to select or clear all items in this group')"
                  @click.stop="toggleMetatagGroupSelectAll(node, grp)"
                >
                  {{ grp.groupName }}
                </div>
              </div>
              <ul v-show="grp.groupExpanded" class="metatag-leaf-list">
                <li
                  v-for="ent in grp.entries"
                  :key="ent.flatIndex"
                  :class="{ selected: isChildSelected(node.catKey, ent.flatIndex) }"
                  @click.stop="toggleChildSelection(node.catKey, ent.text, ent.flatIndex)"
                >
                  <div class="node-label child-row">
                    <span class="toggle-icon placeholder"></span>
                    <span class="node-name">{{ ent.text }}</span>
                  </div>
                </li>
              </ul>
            </li>
          </ul>
          <ul v-else-if="node.expanded && node.children && node.children.length > 0" class="child-list">
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
import serviceTreeService, { DOCUMENT_METATAGS_CAT_KEY } from '../services/serviceTreeService.js';

export default {
  name: 'ServiceTreePanelComponent',

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
    isDocMetaGrouped(node) {
      return (
        node &&
        node.catKey === DOCUMENT_METATAGS_CAT_KEY &&
        Array.isArray(node.metatagGroups) &&
        node.metatagGroups.length > 0
      );
    },

    // Load categories from the API
    async loadCategories(locale) {
      try {
        const categories = await serviceTreeService.getAllCategories(locale);

        // Verify each category has the expected properties
        if (!categories || !Array.isArray(categories)) {
          throw new Error('Invalid API response format');
        }

        // Check categories without using unused index variable
        categories.forEach((cat) => {
          if (!cat.name && cat.catKey !== DOCUMENT_METATAGS_CAT_KEY) {
            console.warn(`Category ${cat.catKey || 'unknown'} is missing name property:`, cat);
          }
        });

        // Process the API response - add expanded property and metatag group UI state
        this.nodes = categories.map((category) => {
          const node = {
            ...category,
            name:
              category.catKey === DOCUMENT_METATAGS_CAT_KEY
                ? this.$t('sidebar.documentMetatags', 'From your documents')
                : category.name,
            expanded: false
          };
          if (Array.isArray(node.metatagGroups)) {
            node.metatagGroups = node.metatagGroups.map((g) => ({
              ...g,
              groupExpanded: g.groupExpanded !== false
            }));
          }
          return node;
        });
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
          sidebarContent.style.backgroundColor = 'var(--bg-sidebar, #222)';
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

    toggleAllNodes(forceExpand) {
      const shouldExpand = typeof forceExpand === 'boolean' ? forceExpand : !this.isAnyNodeExpanded;
      this.nodes.forEach((node) => {
        node.expanded = shouldExpand;
        if (this.isDocMetaGrouped(node) && node.metatagGroups) {
          node.metatagGroups.forEach((g) => {
            g.groupExpanded = shouldExpand;
          });
        }
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

    toggleMetatagGroupExpanded(grp) {
      if (!grp || typeof grp !== 'object') {
        return;
      }
      grp.groupExpanded = !grp.groupExpanded;
    },

    isMetatagGroupFullySelected(node, grp) {
      const catKey = node.catKey;
      const entries = grp.entries || [];
      if (!entries.length) {
        return false;
      }
      return entries.every((e) => this.isChildSelected(catKey, e.flatIndex));
    },

    toggleMetatagGroupSelectAll(node, grp) {
      const catKey = node.catKey;
      const entries = grp.entries || [];
      if (!entries.length) {
        return;
      }
      const allOn = entries.every((e) => this.isChildSelected(catKey, e.flatIndex));
      const target = !allOn;
      for (const ent of entries) {
        this.setChildSelection(catKey, ent.text, ent.flatIndex, target);
      }
    },

    setChildSelection(catKey, childName, childIndex, selected) {
      if (!this.selectedNodes[catKey]) {
        this.selectedNodes[catKey] = [];
      }
      const arr = this.selectedNodes[catKey];
      const ix = arr.indexOf(childIndex);
      const isOn = ix !== -1;
      if (selected && !isOn) {
        arr.push(childIndex);
        eventBus.$emit('treeNodeSelected', {
          category: catKey,
          service: childName,
          selected: true
        });
      } else if (!selected && isOn) {
        arr.splice(ix, 1);
        eventBus.$emit('treeNodeSelected', {
          category: catKey,
          service: childName,
          selected: false
        });
      }
    },

    toggleChildSelection(catKey, childName, childIndex) {
      const turnOn = !this.isChildSelected(catKey, childIndex);
      this.setChildSelection(catKey, childName, childIndex, turnOn);
    },

    isChildSelected(catKey, childIndex) {
      return this.selectedNodes[catKey]?.includes(childIndex) || false;
    },

    /**
     * Used by ServiceTreeContainer to restore saved preferences.
     * @param {string} catKey - Category key (including synthetic document metatags key).
     * @returns {string[]} Child labels for the category.
     */
    getCatChildren(catKey) {
      const node = this.nodes.find((n) => n.catKey === catKey);
      return node && Array.isArray(node.children) ? node.children : [];
    },

    performSearch() {
      const query = this.searchQuery.toLowerCase();

      this.nodes.forEach((node) => {
        const categoryName = (node.name || '').toLowerCase();

        const matchesChild = this.isDocMetaGrouped(node)
          ? node.metatagGroups.some(
              (g) =>
                String(g.groupName || '')
                  .toLowerCase()
                  .includes(query) ||
                (g.entries || []).some((e) =>
                  String(e.text || '')
                    .toLowerCase()
                    .includes(query)
                )
            )
          : (node.children || [])
              .map((name) => (typeof name === 'string' ? name.toLowerCase() : ''))
              .some((name) => name.includes(query));

        if (!query) {
          node.expanded = false;
        } else {
          const matchesCategory = categoryName.includes(query);
          node.expanded = matchesCategory || matchesChild;
          if (this.isDocMetaGrouped(node) && query) {
            node.metatagGroups.forEach((g) => {
              const gMatch =
                String(g.groupName || '')
                  .toLowerCase()
                  .includes(query) ||
                (g.entries || []).some((e) =>
                  String(e.text || '')
                    .toLowerCase()
                    .includes(query)
                );
              if (gMatch) {
                g.groupExpanded = true;
              }
            });
          }
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
  margin-bottom: 8px;
  font-weight: 600;
  color: #333;
  font-size: 0.75rem; /* This can remain as it's a title */
  flex-shrink: 0;
}

.search-container {
  position: relative;
  display: flex;
  margin-bottom: 8px;
  flex-shrink: 0;
  position: sticky;
  top: 0;
  z-index: 20;
  background-color: var(--bg-sidebar, #fff);
  padding: 4px 0;
}

.search-box {
  flex: 1;
  padding: 6px;
  font-size: inherit; /* CHANGED from 0.625rem */
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
  font-size: 1rem;
  font-weight: bold;
  color: #555;
  padding: 0;
  transition: background-color 0.2s;
}

.expand-collapse-btn:hover {
  background-color: #e5e5e5;
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
  font-size: inherit; /* CHANGED from 0.625rem */
}

.toggle-icon.placeholder {
  visibility: hidden;
}

.node-name {
  flex: 1;
  color: #333;
  font-size: inherit; /* CHANGED from 0.625rem */
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

.child-list-metatag-grouped {
  padding-left: 4px;
}

.metatag-group-block {
  list-style: none !important;
  margin-bottom: 10px;
}

.metatag-group-header {
  display: flex;
  align-items: center;
  gap: 2px;
  margin: 4px 0 4px 0;
}

.metatag-group-chevron {
  cursor: pointer;
  flex-shrink: 0;
  user-select: none;
}

.metatag-group-heading {
  font-size: 0.68rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: #666;
}

.metatag-group-select-all {
  flex: 1;
  cursor: pointer;
  padding: 4px 6px;
  border-radius: 4px;
  transition: background-color 0.15s ease;
}

.metatag-group-select-all:hover {
  background-color: rgba(0, 0, 0, 0.06);
}

.metatag-group-all-selected {
  background-color: rgba(78, 151, 209, 0.22);
}

.metatag-leaf-list {
  list-style: none !important;
  margin: 0;
  padding: 0 0 0 4px;
  border-left: 1px dashed #ccc;
}

.metatag-leaf-list li {
  list-style: none !important;
}

.selected .node-label {
  background-color: rgba(78, 151, 209, 0.3);
  border-left: 2px solid var(--accent-color);
}

ul {
  list-style-type: none !important;
}

li {
  list-style-type: none !important;
}

/* Dark mode specific styles */
[data-theme='dark'] .service-tree-panel h4 {
  color: rgba(255, 255, 255, 0.7);
  font-size: 0.75rem; /* Ensure consistency */
}

[data-theme='dark'] .search-container {
  background-color: var(--bg-sidebar);
}

[data-theme='dark'] .search-box {
  background-color: var(--bg-input) !important;
  color: var(--text-primary) !important;
  border: 1px solid var(--border-input) !important;
}

[data-theme='dark'] .expand-collapse-btn {
  background-color: var(--bg-button-secondary) !important;
  color: var(--text-button-secondary) !important;
  border: 1px solid var(--border-light);
  border-radius: 4px;
}

[data-theme='dark'] .node-name {
  color: var(--text-primary);
}

[data-theme='dark'] .metatag-group-heading {
  color: rgba(255, 255, 255, 0.55);
}

[data-theme='dark'] .metatag-group-select-all:hover {
  background-color: rgba(255, 255, 255, 0.08);
}

[data-theme='dark'] .metatag-group-all-selected {
  background-color: rgba(78, 151, 209, 0.35);
}

[data-theme='dark'] .metatag-leaf-list {
  border-left-color: rgba(255, 255, 255, 0.2);
}

/* Restored missing dark mode styles */
[data-theme='dark'] .service-tree-list,
[data-theme='dark'] .service-tree-list * {
  color: rgba(255, 255, 255, 0.85) !important;
}

[data-theme='dark'] .node-label {
  color: rgba(255, 255, 255, 0.85) !important;
}

[data-theme='dark'] .toggle-icon {
  color: rgba(255, 255, 255, 0.6) !important;
}

/* Mobile specific styles */
@media screen and (max-width: 768px) {
  .search-container {
    position: sticky;
    top: 0;
    z-index: 30;
    padding: 8px 0;
    box-shadow: 0 2px 5px rgba(0, 0, 0, 0.1);
  }

  .tree-list-container {
    min-height: 200px;
  }
}

/* Additional dark mode title styles */
[data-theme='dark'] h4,
[data-theme='dark'] .service-tree-panel h4,
[data-theme='dark'] .service-categories-title,
[data-theme='dark'] .knowledge-areas-title {
  color: rgba(255, 255, 255, 0.7) !important;
}

[data-theme='dark'] .sidebar-section-title,
[data-theme='dark'] .sidebar-header h3 {
  color: rgba(255, 255, 255, 0.7) !important;
}

[data-theme='dark'] .node-label:hover {
  background-color: #4a4a4a !important;
}
</style>
