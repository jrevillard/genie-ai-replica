<!-- ServiceTreePanelComponent.vue with comprehensive scrollbar fix and no bullet points -->
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
        { catKey: 'cat12', expanded: false },
        { catKey: 'cat13', expanded: false }
      ],
      // CORRECTED DATA: Categories properly aligned based on the first child node
      fallbackData: {
        en: {
          cat1: {
            name: 'Identity & Civil Registration',
            children: ['Birth Registration', 'National ID Cards', 'Passport Services', 'Vital Records']
          },
          cat2: {
            name: 'Healthcare & Social Services',
            children: ['Medical Services', 'Social Assistance', 'Healthcare Programs', 'Mental Health']
          },
          cat3: {
            name: 'Education & Learning',
            children: ['K-12 Schools', 'Higher Education', 'Adult Learning', 'Educational Resources']
          },
          cat4: {
            name: 'Employment & Labor Services',
            children: ['Job Search', 'Labor Rights', 'Workplace Safety', 'Career Development']
          },
          cat5: {
            name: 'Taxes & Revenue',
            children: ['Income Tax', 'Sales Tax', 'Property Tax', 'Tax Credits']
          },
          cat6: {
            name: 'Public Safety & Justice',
            children: ['Police Services', 'Courts', 'Legal Services', 'Emergency Services']
          },
          cat7: {
            name: 'Transportation & Mobility',
            children: ['Driver Services', 'Public Transit', 'Roads & Highways', 'Aviation']
          },
          cat8: {
            name: 'Business & Trade',
            children: ['Housing Programs', 'Property Assessment', 'Rental Assistance', 'Homeownership']
          },
          cat9: {
            name: 'Housing & Urban Development',
            children: ['Natural Resources', 'Environmental Protection', 'Parks & Recreation', 'Wildlife']
          },
          cat10: {
            name: 'Utilities & Environment',
            children: ['Business Registration', 'Economic Development', 'Trade', 'Small Business Support']
          },
          cat11: {
            name: 'Culture & Recreation',
            children: ['Arts & Culture', 'Heritage', 'Sports & Recreation', 'Tourism']
          },
          cat12: {
            name: 'Immigration & Citizenship',
            children: ['Immigration Services', 'Citizenship Applications', 'Visas', 'Refugee Programs', 'Elections and Voting']
          },
          cat13: {
            name: 'Social Security & Pensions',
            children: ['Retirement benefits', 'Pension fund management', 'Survivor benefits', 'Disability pensions']
          }
        },
        // French translations with corrected alignment
        fr: {
          cat1: {
            name: 'Identité et état civil',
            children: ['Enregistrement des naissances', 'Cartes d\'identité nationale', 'Services de passeport', 'État civil']
          },
          cat2: {
            name: 'Santé et services sociaux',
            children: ['Services médicaux', 'Aide sociale', 'Programmes de santé', 'Santé mentale']
          },
          cat3: {
            name: 'Éducation et apprentissage',
            children: ['Écoles K-12', 'Enseignement supérieur', 'Formation des adultes', 'Ressources éducatives']
          },
          cat4: {
            name: 'Emploi et services du travail',
            children: ['Recherche d\'emploi', 'Droits du travail', 'Sécurité au travail', 'Développement de carrière']
          },
          cat5: {
            name: 'Impôts et revenus',
            children: ['Impôt sur le revenu', 'Taxe de vente', 'Impôt foncier', 'Crédits d\'impôt']
          },
          cat6: {
            name: 'Sécurité publique et justice',
            children: ['Services de police', 'Tribunaux', 'Services juridiques', 'Services d\'urgence']
          },
          cat7: {
            name: 'Transport et mobilité',
            children: ['Services aux conducteurs', 'Transport en commun', 'Routes et autoroutes', 'Aviation']
          },
          cat8: {
            name: 'Affaires et commerce',
            children: ['Programmes de logement', 'Évaluation des propriétés', 'Aide à la location', 'Accession à la propriété']
          },
          cat9: {
            name: 'Logement et développement urbain',
            children: ['Ressources naturelles', 'Protection de l\'environnement', 'Parcs et loisirs', 'Faune']
          },
          cat10: {
            name: 'Services publics et environnement',
            children: ['Enregistrement d\'entreprise', 'Développement économique', 'Commerce', 'Soutien aux petites entreprises']
          },
          cat11: {
            name: 'Culture et loisirs',
            children: ['Arts et culture', 'Patrimoine', 'Sports et loisirs', 'Tourisme']
          },
          cat12: {
            name: 'Immigration et citoyenneté',
            children: ['Services d\'immigration', 'Demandes de citoyenneté', 'Visas', 'Programmes pour réfugiés', 'Élections et vote']
          },
          cat13: {
            name: 'Sécurité sociale et retraites',
            children: ['Allocations de retraite', 'Gestion des fonds de pension', 'Allocations de survivant', 'Pensions pour invalidité']
          }
        },
        // Swahili translations with corrected alignment
        sw: {
          cat1: {
            name: 'Utambulisho na Usajili wa Raia',
            children: ['Usajili wa Kuzaliwa', 'Vitambulisho vya Kitaifa', 'Huduma za Pasipoti', 'Kumbukumbu za Muhimu']
          },
          cat2: {
            name: 'Afya na Huduma za Kijamii',
            children: ['Huduma za Matibabu', 'Msaada wa Kijamii', 'Programu za Afya', 'Afya ya Akili']
          },
          cat3: {
            name: 'Elimu na Mafunzo',
            children: ['Shule za K-12', 'Elimu ya Juu', 'Mafunzo ya Watu Wazima', 'Rasilimali za Elimu']
          },
          cat4: {
            name: 'Ajira na Huduma za Kazi',
            children: ['Utafutaji wa Kazi', 'Haki za Wafanyakazi', 'Usalama Kazini', 'Maendeleo ya Kazi']
          },
          cat5: {
            name: 'Kodi na Mapato',
            children: ['Kodi ya Mapato', 'Kodi ya Mauzo', 'Kodi ya Mali', 'Punguzo za Kodi']
          },
          cat6: {
            name: 'Usalama wa Umma na Haki',
            children: ['Huduma za Polisi', 'Mahakama', 'Huduma za Kisheria', 'Huduma za Dharura']
          },
          cat7: {
            name: 'Usafiri na Usafiri',
            children: ['Huduma za Dereva', 'Usafiri wa Umma', 'Barabara na Barabara Kuu', 'Usafiri wa Anga']
          },
          cat8: {
            name: 'Biashara na Biashara',
            children: ['Programu za Nyumba', 'Tathmini ya Mali', 'Msaada wa Kukodi', 'Umiliki wa Nyumba']
          },
          cat9: {
            name: 'Nyumba na Maendeleo ya Mjini',
            children: ['Rasilimali za Asili', 'Uhifadhi wa Mazingira', 'Mbuga na Burudani', 'Wanyamapori']
          },
          cat10: {
            name: 'Huduma na Mazingira',
            children: ['Usajili wa Biashara', 'Maendeleo ya Kiuchumi', 'Biashara', 'Msaada wa Biashara Ndogo']
          },
          cat11: {
            name: 'Utamaduni na Burudani',
            children: ['Sanaa na Utamaduni', 'Urithi', 'Michezo na Burudani', 'Utalii']
          },
          cat12: {
            name: 'Uhamiaji na Uraia',
            children: ['Huduma za Uhamiaji', 'Maombi ya Uraia', 'Visa', 'Programu za Wakimbizi', 'Uchaguzi na Kupiga Kura']
          },
          cat13: {
            name: 'Hifadhi ya Jamii na Pensheni',
            children: ['Manufaa ya kustaafu', 'Usimamizi wa mfuko wa pensheni', 'Manufaa ya warithi', 'Pensheni za ulemavu']
          }
        }
      },
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
    
    toggleAllNodes() {
      const shouldExpand = !this.isAnyNodeExpanded;
      this.nodes.forEach(node => {
        node.expanded = shouldExpand;
      });
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
      
      // Special case for cat11 to ensure it shows the correct name
      if (catKey === 'cat11') {
        return locale === 'fr' ? 'Culture et loisirs' : 
               locale === 'sw' ? 'Utamaduni na Burudani' : 
               'Culture & Recreation';
      }
      
      try {
        // Try getting from i18n first
        const i18nKey = `leftPanel.${catKey}.name`;
        const i18nName = this.$t(i18nKey);
        
        // Check if it's a valid translation (not just the key repeated)
        if (i18nName && typeof i18nName === 'string' && i18nName !== i18nKey) {
          return i18nName;
        }
        
        // Try getting from fallback data
        const fallback = this.fallbackData[locale]?.[catKey]?.name || 
                         this.fallbackData['en']?.[catKey]?.name;
        
        if (fallback) {
          return fallback;
        }
        
        // Last resort: return the key itself
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
        
        // Try getting from fallback data for current locale
        const currentLocaleFallback = this.fallbackData[locale]?.[catKey]?.children;
        if (currentLocaleFallback && Array.isArray(currentLocaleFallback)) {
          return currentLocaleFallback;
        }
        
        // Fallback to English
        const englishFallback = this.fallbackData['en']?.[catKey]?.children;
        if (englishFallback && Array.isArray(englishFallback)) {
          return englishFallback;
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
  margin-bottom: 0;
  height: 100%; /* Change from auto to 100% */
  display: flex;
  flex-direction: column;
  font-size: 10pt;
  overflow-y: auto; /* Changed from visible to auto */
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
  flex-shrink: 0; /* Prevent shrinking */
}

.search-container {
  position: relative;
  display: flex;
  margin-bottom: 8px;
  flex-shrink: 0; /* Prevent shrinking */
}

.search-box {
  flex: 1;
  padding: 6px;
  font-size: 10pt;
  border: 1px solid #ccc;
  border-radius: 4px;
  outline: none;
  padding-right: 30px; /* Make room for the button */
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
  overflow: visible !important; /* Force no scrolling */
  flex-grow: 1;
}

.service-tree-list li {
  list-style: none !important; /* Remove bullets at every level */
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
  list-style-type: none !important; /* Remove bullets from the child list */
}

.child-list li {
  list-style-type: none !important; /* Remove bullets from each child list item */
}

.child-list li::before {
  content: none !important; /* Ensure no pseudo-element adds bullets */
}

.selected .node-label {
  background-color: #e6f0ff;
  border-left: 2px solid #1867c0;
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
  color: #333; /* Replace with var(--text-primary) */
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
