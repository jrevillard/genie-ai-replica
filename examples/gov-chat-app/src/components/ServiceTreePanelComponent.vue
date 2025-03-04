<!-- ServiceTreePanelComponent.vue -->
<template>
  <div class="service-tree-panel">
    <h4>{{ $t('sidebar.governmentServices') }}</h4>

    <!-- i18n-based search placeholder -->
    <input
      v-model="searchQuery"
      class="search-box"
      type="text"
      :placeholder="$t('sidebar.searchPlaceholder')"
      @input="performSearch"
    />

    <ul>
      <li v-for="(node, index) in nodes" :key="index">
        <div class="node-label" @click="toggleNode(node)">
          <span v-if="hasChildren(node.catKey)" class="toggle-icon">
            {{ node.expanded ? '▼' : '▶' }}
          </span>
          <span
            class="node-name"
            v-html="highlightMatch(getCatName(node.catKey), searchQuery)"
          ></span>
        </div>

        <ul
          v-if="node.expanded && hasChildren(node.catKey)"
          class="child-list"
        >
          <li
            v-for="(childName, cIndex) in getCatChildren(node.catKey)"
            :key="cIndex"
          >
            <div class="node-label">
              <span class="toggle-icon placeholder"></span>
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
  methods: {
    toggleNode(node) {
      node.expanded = !node.expanded
    },

    getCatName(catKey) {
      return this.$t(`leftPanel.${catKey}.name`)
    },

    getCatChildren(catKey) {
      // Attempt to get an array from i18n
      const raw = this.$t(`leftPanel.${catKey}.children`, { returnObjects: true })
      if (!Array.isArray(raw)) {
        // Log a warning if i18n returned something unexpected
        console.warn(
          `getCatChildren for ${catKey} did NOT return an array. Actual:`,
          raw
        )
        return []
      }
      return raw
    },

    hasChildren(catKey) {
      const arr = this.getCatChildren(catKey)
      return arr.length > 0
    },

    performSearch() {
      const q = this.searchQuery.trim().toLowerCase()

      this.nodes.forEach((node) => {
        const catName = this.getCatName(node.catKey).toLowerCase()
        const children = this.getCatChildren(node.catKey).map(c => c.toLowerCase())

        if (!q) {
          node.expanded = false
        } else {
          // Expand if catName or any child includes query
          const nameMatch = catName.includes(q)
          const childMatch = children.some(child => child.includes(q))
          node.expanded = nameMatch || childMatch
        }
      })
    },

    highlightMatch(text, query) {
      if (!query) return text
      // Escape special regex chars in the query
      const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      const re = new RegExp(escaped, 'gi')
      return text.replace(re, (match) => `<mark>${match}</mark>`)
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
  visibility: hidden;
}
.node-name {
  flex: 1;
  color: #333;
}
.child-list {
  margin-left: 20px;
  border-left: 1px dashed #ccc;
  padding-left: 8px;
  margin-top: 2px;
}
mark {
  background-color: yellow;
  color: #000;
}
</style>

