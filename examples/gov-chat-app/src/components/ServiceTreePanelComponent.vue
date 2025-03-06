<!-- ServiceTreePanelComponent.vue -->
<template>
  <div class="service-tree-panel">
    <!-- Title from i18n -->
    <h4>{{ $t('sidebar.governmentServices') }}</h4>

    <!-- Search box with i18n placeholder -->
    <input
      v-model="searchQuery"
      class="search-box"
      type="text"
      :placeholder="$t('sidebar.searchPlaceholder')"
      @input="performSearch"
    />

    <ul>
      <li v-for="(node, index) in nodes" :key="index">
        <!-- Top-level category row -->
        <div class="node-label" @click="toggleNode(node)">
          <!-- Expand/collapse icon if children exist -->
          <span v-if="hasChildren(node.catKey)" class="toggle-icon">
            {{ node.expanded ? '▼' : '▶' }}
          </span>
          <!-- Category name with highlight -->
          <span
            class="node-name"
            v-html="highlightMatch(getCatName(node.catKey), searchQuery)"
          ></span>
        </div>

        <!-- 2nd-level children -->
        <ul
          v-if="node.expanded && hasChildren(node.catKey)"
          class="child-list"
        >
          <li
            v-for="(childName, cIndex) in getCatChildren(node.catKey)"
            :key="cIndex"
            @click.stop="selectChild(node.catKey, childName, cIndex)"
            :class="{ 'selected': isChildSelected(node.catKey, cIndex) }"
          >
            <div class="node-label child-row">
              <!-- Indent placeholder -->
              <span class="toggle-icon placeholder"></span>
              <!-- Child name with highlight -->
              <span
                class="node-name"
                v-html="highlightMatch(childName, searchQuery)"
              ></span>
            </div>
          </li>
        </ul>
      </li>
    </ul>
  </div>
</template>

<script>
export default {
  name: 'ServiceTreePanelComponent',
  data() {
    return {
      // The 12 top-level categories
      nodes: [
        { catKey: 'cat1', expanded: false },
        { catKey: 'cat2', expanded: false },
        { catKey: 'cat3', expanded: false },
        { catKey: 'cat4', expanded: false },
        { catKey: 'cat5', expanded: false },
        { catKey: 'cat6', expanded: false },
        { catKey: 'cat7', expanded: false },
        { catKey: 'cat8', expanded: false },
        { catKey: 'cat9', expanded: false },
        { catKey: 'cat10', expanded: false },
        { catKey: 'cat11', expanded: false },
        { catKey: 'cat12', expanded: false }
      ],
      searchQuery: '',
      selectedChildren: {} // Track selected children: { catKey: [selectedIndices] }
    }
  },
  mounted() {
    // Debug: confirm which locale is active
    console.log("ServiceTreePanel - mounted. Current locale:", this.$i18n.locale)

    // Prefetch all category data to ensure it's available
    this.prefetchCategoryData();
  },
  methods: {
    // Prefetch all category data to ensure proper loading
    prefetchCategoryData() {
      const locale = this.$i18n.locale;
      const leftPanel = this.$i18n.messages[locale]?.leftPanel;
      
      if (!leftPanel) {
        console.error("Left panel data not found for locale:", locale);
        return;
      }
      
      console.log("Full leftPanel data:", leftPanel);
      
      // Check each category's children
      this.nodes.forEach(node => {
        const catData = leftPanel[node.catKey];
        if (!catData) {
          console.warn(`Category data not found for ${node.catKey}`);
          return;
        }
        
        const children = catData.children;
        if (!Array.isArray(children)) {
          console.warn(`Children for ${node.catKey} is not an array:`, children);
        } else {
          console.log(`${node.catKey} has ${children.length} children:`, children);
        }
      });
    },

    // Toggle expand/collapse for a node
    toggleNode(node) {
      node.expanded = !node.expanded;
    },

    // Retrieve localized category name
    getCatName(catKey) {
      try {
        const locale = this.$i18n.locale;
        const name = this.$i18n.messages[locale]?.leftPanel[catKey]?.name;
        return name || `[Missing: leftPanel.${catKey}.name]`;
      } catch (err) {
        console.error(`Error getting name for ${catKey}:`, err);
        return `[Error: ${catKey}]`;
      }
    },

    // Retrieve children directly from i18n messages
    getCatChildren(catKey) {
      try {
        const locale = this.$i18n.locale;
        const children = this.$i18n.messages[locale]?.leftPanel[catKey]?.children;
        
        if (!Array.isArray(children)) {
          console.warn(`getCatChildren for ${catKey} => not an array. Value:`, children);
          return [];
        }
        
        return children;
      } catch (err) {
        console.error(`Error getting children for ${catKey}:`, err);
        return [];
      }
    },

    // Check if node has any children
    hasChildren(catKey) {
      return this.getCatChildren(catKey).length > 0;
    },

    // Handle selection of a child item
    selectChild(catKey, childName, childIndex) {
      // Initialize the array for this category if it doesn't exist
      if (!this.selectedChildren[catKey]) {
        this.selectedChildren[catKey] = [];
      }
      
      // Toggle selection of this child
      const selectedIndices = this.selectedChildren[catKey];
      const index = selectedIndices.indexOf(childIndex);
      
      if (index === -1) {
        // Add to selection
        selectedIndices.push(childIndex);
      } else {
        // Remove from selection
        selectedIndices.splice(index, 1);
      }
      
      // Emit an event with the selected item
      this.$emit('selectService', {
        category: catKey,
        service: childName,
        selected: index === -1 // true if just added, false if just removed
      });
      
      console.log(`Selected child: ${childName} (${catKey}, ${childIndex})`);
    },
    
    // Check if a child is currently selected
    isChildSelected(catKey, childIndex) {
      return this.selectedChildren[catKey]?.includes(childIndex) || false;
    },

    // Search logic: expand nodes if they match the query
    performSearch() {
      const q = this.searchQuery.trim().toLowerCase();

      this.nodes.forEach((node) => {
        const catName = this.getCatName(node.catKey).toLowerCase();
        const childList = this.getCatChildren(node.catKey).map(c => c.toLowerCase());

        if (!q) {
          // If search is empty, collapse all
          node.expanded = false;
        } else {
          const nameMatch = catName.includes(q);
          const childMatch = childList.some(child => child.includes(q));
          node.expanded = nameMatch || childMatch;
        }
      });
    },

    // Highlight matched text
    highlightMatch(text, query) {
      if (!query) return text;
      const safeText = String(text || ''); // Ensure text is a string
      const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const re = new RegExp(escaped, 'gi');
      return safeText.replace(re, match => `<mark>${match}</mark>`);
    }
  }
}
</script>

<style scoped>
.service-tree-panel {
  margin-bottom: 20px;
}
.service-tree-panel h4 {
  margin-bottom: 8px;
  font-weight: 600;
  color: #333;
}

/* The search box styling */
.search-box {
  width: 100%;
  margin-bottom: 8px;
  padding: 6px;
  font-size: 0.95rem;
  border: 1px solid #ccc;
  border-radius: 4px;
  outline: none;
}

ul {
  list-style: none;
  padding: 0;
  margin: 0;
}

/* Category row styling */
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
  width: 20px;
  text-align: center;
  margin-right: 4px;
  color: #666;
  font-size: 12px;
}
.toggle-icon.placeholder {
  visibility: hidden; /* aligns child items with parent toggle icon */
}
.node-name {
  flex: 1;
  color: #333;
}

/* 2nd-level children indentation */
.child-list {
  margin-left: 20px;
  border-left: 1px dashed #ccc;
  padding-left: 8px;
  margin-top: 2px;
}
.child-row {
  cursor: pointer; /* Make child rows clickable */
}

/* Selected child items */
.selected .node-label {
  background-color: #e6f0ff;
  border-left: 3px solid #1867c0;
}

/* highlight color for matched text */
mark {
  background-color: yellow;
  color: #000;
}
</style>
