<!-- ServiceTreePanelComponent.vue - Enhanced Translation Support -->
<template>
  <div class="service-tree-panel">
    <h4>{{ $t('sidebar.governmentServices', 'Government Services') }}</h4>

    <input
      v-model="searchQuery"
      class="search-box"
      type="text"
      :placeholder="$t('sidebar.searchPlaceholder', 'Search services...')"
      @input="performSearch"
    />

    <ul>
      <li v-for="(node, index) in nodes" :key="index">
        <div class="node-label" @click="toggleNode(node)">
          <span v-if="hasChildren(node.catKey)" class="toggle-icon">
            {{ node.expanded ? '▼' : '▶' }}
          </span>
          <span class="node-name">{{ removeNumberPrefix(getCatName(node.catKey)) }}</span>
        </div>

        <ul
          v-if="node.expanded && hasChildren(node.catKey)"
          class="child-list"
        >
          <li
            v-for="(childName, cIndex) in getCatChildren(node.catKey)"
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
import { watch } from 'vue'

export default {
  name: 'ServiceTreePanelComponent',
  
  data() {
    return {
      searchQuery: '',
      selectedNodes: {},
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
      // Fallback data for English
      fallbackData: {
        en: {
          cat1: {
            name: 'Health & Social Services',
            children: ['Medical Services', 'Social Assistance', 'Healthcare Programs', 'Mental Health']
          },
          cat2: {
            name: 'Education & Learning',
            children: ['K-12 Schools', 'Higher Education', 'Adult Learning', 'Educational Resources']
          },
          cat3: {
            name: 'Business & Economy',
            children: ['Business Registration', 'Economic Development', 'Trade', 'Small Business Support']
          },
          cat4: {
            name: 'Environment & Resources',
            children: ['Natural Resources', 'Environmental Protection', 'Parks & Recreation', 'Wildlife']
          },
          cat5: {
            name: 'Transportation',
            children: ['Driver Services', 'Public Transit', 'Roads & Highways', 'Aviation']
          },
          cat6: {
            name: 'Public Safety & Law',
            children: ['Police Services', 'Courts', 'Legal Services', 'Emergency Services']
          },
          cat7: {
            name: 'Housing & Properties',
            children: ['Housing Programs', 'Property Assessment', 'Rental Assistance', 'Homeownership']
          },
          cat8: {
            name: 'Employment & Labor',
            children: ['Job Search', 'Labor Rights', 'Workplace Safety', 'Career Development']
          },
          cat9: {
            name: 'Culture & Recreation',
            children: ['Arts & Culture', 'Heritage', 'Sports & Recreation', 'Tourism']
          },
          cat10: {
            name: 'Taxes & Revenue',
            children: ['Income Tax', 'Sales Tax', 'Property Tax', 'Tax Credits']
          },
          cat11: {
            name: 'Government & Democracy',
            children: ['Elections', 'Government Agencies', 'Public Records', 'Civic Engagement']
          },
          cat12: {
            name: 'Immigration & Citizenship',
            children: ['Immigration Services', 'Citizenship Applications', 'Visas', 'Refugee Programs']
          }
        },
        // French translations (basic examples)
        fr: {
          cat1: {
            name: 'Santé et services sociaux',
            children: ['Services médicaux', 'Aide sociale', 'Programmes de santé', 'Santé mentale']
          },
          cat2: {
            name: 'Éducation et apprentissage',
            children: ['Écoles K-12', 'Enseignement supérieur', 'Formation des adultes', 'Ressources éducatives']
          },
          // Add other categories with French translations
        },
        // Swahili translations (basic examples)
        sw: {
          cat1: {
            name: 'Afya na Huduma za Kijamii',
            children: ['Huduma za Matibabu', 'Msaada wa Kijamii', 'Programu za Afya', 'Afya ya Akili']
          },
          cat2: {
            name: 'Elimu na Mafunzo',
            children: ['Shule za K-12', 'Elimu ya Juu', 'Mafunzo ya Watu Wazima', 'Rasilimali za Elimu']
          },
          // Add other categories with Swahili translations
        }
      },
      currentLocale: 'en'
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
      });
    }
  },
  
  mounted() {
    console.log('ServiceTreePanel - mounted');
    console.log('Current locale:', this.currentLocale);
    eventBus.$on('contextItemRemoved', this.handleContextItemRemoved);
  },
  
  beforeUnmount() {
    eventBus.$off('contextItemRemoved', this.handleContextItemRemoved);
  },
  
  methods: {
    toggleNode(node) {
      node.expanded = !node.expanded;
    },
    
    handleContextItemRemoved(item) {
      if (!item || !item.category || !item.service) return;
      
      const catKey = item.category;
      const children = this.getCatChildren(catKey);
      const childIndex = children.findIndex(child => String(child) === String(item.service));
      
      if (childIndex !== -1 && this.selectedNodes[catKey]) {
        // Filter out the removed index
        const nodeSelection = this.selectedNodes[catKey] || [];
        this.selectedNodes[catKey] = nodeSelection.filter(idx => idx !== childIndex);
      }
    },
    
    // Remove number prefix from category names (e.g. "1. Health" -> "Health")
    removeNumberPrefix(text) {
      if (!text) return '';
      // This regex matches patterns like "1. ", "12. ", etc., at the beginning of the string
      return text.replace(/^\d+\.\s*/, '');
    },
    
    getCurrentLocale() {
      return this.$i18n ? this.$i18n.locale : this.currentLocale;
    },
    
    getCatName(catKey) {
      const locale = this.getCurrentLocale();
      console.log('Getting category name:', catKey, 'Locale:', locale);
      
      try {
        // Try getting from i18n first
        const i18nKey = `leftPanel.${catKey}.name`;
        const i18nName = this.$t(i18nKey);
        
        // Check if it's a valid translation (not just the key repeated)
        if (i18nName && typeof i18nName === 'string' && i18nName !== i18nKey) {
          console.log('Found i18n translation:', i18nName);
          return i18nName;
        }
        
        // Try getting from fallback data
        const fallback = this.fallbackData[locale]?.[catKey]?.name || 
                         this.fallbackData['en']?.[catKey]?.name;
        
        if (fallback) {
          console.log('Using fallback translation:', fallback);
          return fallback;
        }
        
        // Last resort: return the key itself
        console.log('No translation found, using key:', catKey);
        return catKey;
      } catch (error) {
        console.error(`Error getting name for ${catKey}:`, error);
        return this.fallbackData['en']?.[catKey]?.name || catKey;
      }
    },
    
    getCatChildren(catKey) {
      const locale = this.getCurrentLocale();
      
      try {
        // Try getting from i18n first
        const i18nKey = `leftPanel.${catKey}.children`;
        const i18nChildren = this.$t(i18nKey);
        
        // Check if it's a valid array of translations
        if (i18nChildren && Array.isArray(i18nChildren) && i18nChildren.length > 0) {
          return i18nChildren;
        }
        
        // Try getting from fallback data
        const fallback = this.fallbackData[locale]?.[catKey]?.children || 
                         this.fallbackData['en']?.[catKey]?.children;
        
        if (fallback && Array.isArray(fallback)) {
          return fallback;
        }
        
        // Last resort: return an empty array
        return [];
      } catch (error) {
        console.error(`Error getting children for ${catKey}:`, error);
        return this.fallbackData['en']?.[catKey]?.children || [];
      }
    },
    
    hasChildren(catKey) {
      const children = this.getCatChildren(catKey);
      return Array.isArray(children) && children.length > 0;
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
      
      console.log(`${isSelected ? 'Selected' : 'Deselected'} child: ${childName}`);
    },
    
    isChildSelected(catKey, childIndex) {
      return this.selectedNodes[catKey]?.includes(childIndex) || false;
    },
    
    performSearch() {
      const query = this.searchQuery.toLowerCase();
      
      this.nodes.forEach(node => {
        // Remove number prefix for search
        const catName = this.removeNumberPrefix(this.getCatName(node.catKey)).toLowerCase();
        const childNames = this.getCatChildren(node.catKey).map(name => 
          typeof name === 'string' ? name.toLowerCase() : ''
        );
        
        if (!query) {
          node.expanded = false;
        } else {
          const matchesCategory = catName.includes(query);
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

.selected .node-label {
  background-color: #e6f0ff;
  border-left: 3px solid #1867c0;
}
</style>
