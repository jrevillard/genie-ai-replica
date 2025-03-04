<!-- src/components/ServiceTreePanelComponent.vue -->
<template>
  <div class="service-tree-panel">
    <h4>{{ $t('sidebar.governmentServices') }}</h4>
    <ul>
      <li v-for="(node, index) in nodes" :key="index">
        <div class="node-label" @click="toggleNode(node)">
          <span v-if="hasChildren(node.catKey)" class="toggle-icon">
            {{ node.expanded ? '▼' : '▶' }}
          </span>
          <span class="node-name">{{ getCatName(node.catKey) }}</span>
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
              <span class="node-name">{{ childName }}</span>
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
      ]
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
      return this.$t(`leftPanel.${catKey}.children`, { returnObjects: true }) || []
    },
    hasChildren(catKey) {
      const arr = this.getCatChildren(catKey)
      return arr && arr.length > 0
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
</style>

