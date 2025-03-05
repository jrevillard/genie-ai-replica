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
      searchQuery: ''
    }
  },
  mounted() {
    // Debug: confirm which locale is active
    console.log("ServiceTreePanel - mounted. Current locale:", this.$i18n.locale)

    // Log the entire leftPanel data for the active locale
    const fullLeftPanel = this.$i18n.getLocaleMessage(this.$i18n.locale)?.leftPanel
    console.log("ServiceTreePanel - leftPanel data:", fullLeftPanel)

    // Check each cat’s children
    this.nodes.forEach(node => {
      const raw = this.$t(`leftPanel.${node.catKey}.children`, { returnObjects: true })
      console.log(`catKey=${node.catKey} =>`, raw)
    })
  },
  methods: {
    // Toggle expand/collapse for a node
    toggleNode(node) {
      node.expanded = !node.expanded
    },

    // Retrieve localized category name
    getCatName(catKey) {
      return this.$t(`leftPanel.${catKey}.name`)
    },

    // Retrieve children from i18n with returnObjects: true
    getCatChildren(catKey) {
      const raw = this.$t(`leftPanel.${catKey}.children`, { returnObjects: true })
      if (!Array.isArray(raw)) {
        console.warn(`getCatChildren for ${catKey} => not an array. raw=`, raw)
        return []
      }
      return raw
    },

    // Check if node has any children
    hasChildren(catKey) {
      return this.getCatChildren(catKey).length > 0
    },

    // Search logic: expand nodes if they match the query
    performSearch() {
      const q = this.searchQuery.trim().toLowerCase()

      this.nodes.forEach((node) => {
        const catName = this.getCatName(node.catKey).toLowerCase()
        const childList = this.getCatChildren(node.catKey).map(c => c.toLowerCase())

        if (!q) {
          // If search is empty, collapse all
          node.expanded = false
        } else {
          const nameMatch = catName.includes(q)
          const childMatch = childList.some(child => child.includes(q))
          node.expanded = nameMatch || childMatch
        }
      })
    },

    // Highlight matched text
    highlightMatch(text, query) {
      if (!query) return text
      const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      const re = new RegExp(escaped, 'gi')
      return text.replace(re, match => `<mark>${match}</mark>`)
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
  cursor: default; /* so clicking a child doesn't toggle anything */
}

/* highlight color for matched text */
mark {
  background-color: yellow;
  color: #000;
}
</style>

