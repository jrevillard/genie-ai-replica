<!-- ServiceTreePanelComponent.vue - Updated for Tabbed Interface -->
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
      // Comprehensive fallback data for all languages
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
        // Complete French translations for all categories
        fr: {
          cat1: {
            name: 'Santé et services sociaux',
            children: ['Services médicaux', 'Aide sociale', 'Programmes de santé', 'Santé mentale']
          },
          cat2: {
            name: 'Éducation et apprentissage',
            children: ['Écoles K-12', 'Enseignement supérieur', 'Formation des adultes', 'Ressources éducatives']
          },
          cat3: {
            name: 'Affaires et économie',
            children: ['Enregistrement d\'entreprise', 'Développement économique', 'Commerce', 'Soutien aux petites entreprises']
          },
          cat4: {
            name: 'Environnement et ressources',
            children: ['Ressources naturelles', 'Protection de l\'environnement', 'Parcs et loisirs', 'Faune']
          },
          cat5: {
            name: 'Transport',
            children: ['Services aux conducteurs', 'Transport en commun', 'Routes et autoroutes', 'Aviation']
          },
          cat6: {
            name: 'Sécurité publique et droit',
            children: ['Services de police', 'Tribunaux', 'Services juridiques', 'Services d\'urgence']
          },
          cat7: {
            name: 'Logement et propriétés',
            children: ['Programmes de logement', 'Évaluation des propriétés', 'Aide à la location', 'Accession à la propriété']
          },
          cat8: {
            name: 'Emploi et travail',
            children: ['Recherche d\'emploi', 'Droits du travail', 'Sécurité au travail', 'Développement de carrière']
          },
          cat9: {
            name: 'Culture et loisirs',
            children: ['Arts et culture', 'Patrimoine', 'Sports et loisirs', 'Tourisme']
          },
          cat10: {
            name: 'Impôts et revenus',
            children: ['Impôt sur le revenu', 'Taxe de vente', 'Impôt foncier', 'Crédits d\'impôt']
          },
          cat11: {
            name: 'Gouvernement et démocratie',
            children: ['Élections', 'Agences gouvernementales', 'Registres publics', 'Engagement civique']
          },
          cat12: {
            name: 'Immigration et citoyenneté',
            children: ['Services d\'immigration', 'Demandes de citoyenneté', 'Visas', 'Programmes pour réfugiés']
          }
        },
        // Complete Swahili translations for all categories
        sw: {
          cat1: {
            name: 'Afya na Huduma za Kijamii',
            children: ['Huduma za Matibabu', 'Msaada wa Kijamii', 'Programu za Afya', 'Afya ya Akili']
          },
          cat2: {
            name: 'Elimu na Mafunzo',
            children: ['Shule za K-12', 'Elimu ya Juu', 'Mafunzo ya Watu Wazima', 'Rasilimali za Elimu']
          },
          cat3: {
            name: 'Biashara na Uchumi',
            children: ['Usajili wa Biashara', 'Maendeleo ya Kiuchumi', 'Biashara', 'Msaada wa Biashara Ndogo']
          },
          cat4: {
            name: 'Mazingira na Rasilimali',
            children: ['Rasilimali za Asili', 'Uhifadhi wa Mazingira', 'Mbuga na Burudani', 'Wanyamapori']
          },
          cat5: {
            name: 'Usafiri',
            children: ['Huduma za Dereva', 'Usafiri wa Umma', 'Barabara na Barabara Kuu', 'Usafiri wa Anga']
          },
          cat6: {
            name: 'Usalama wa Umma na Sheria',
            children: ['Huduma za Polisi', 'Mahakama', 'Huduma za Kisheria', 'Huduma za Dharura']
          },
          cat7: {
            name: 'Nyumba na Mali',
            children: ['Programu za Nyumba', 'Tathmini ya Mali', 'Msaada wa Kukodi', 'Umiliki wa Nyumba']
          },
          cat8: {
            name: 'Ajira na Kazi',
            children: ['Utafutaji wa Kazi', 'Haki za Wafanyakazi', 'Usalama Kazini', 'Maendeleo ya Kazi']
          },
          cat9: {
            name: 'Utamaduni na Burudani',
            children: ['Sanaa na Utamaduni', 'Urithi', 'Michezo na Burudani', 'Utalii']
          },
          cat10: {
            name: 'Kodi na Mapato',
            children: ['Kodi ya Mapato', 'Kodi ya Mauzo', 'Kodi ya Mali', 'Punguzo za Kodi']
          },
          cat11: {
            name: 'Serikali na Demokrasia',
            children: ['Uchaguzi', 'Mashirika ya Serikali', 'Kumbukumbu za Umma', 'Ushiriki wa Kiraia']
          },
          cat12: {
            name: 'Uhamiaji na Uraia',
            children: ['Huduma za Uhamiaji', 'Maombi ya Uraia', 'Visa', 'Programu za Wakimbizi']
          }
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
  margin-bottom: 20px;
  height: 100%;
  display: flex;
  flex-direction: column;
  font-size: 8pt; /* Setting base font size to 8pt */
}

.service-tree-panel h4 {
  margin-bottom: 8px;
  font-weight: 600;
  color: #333;
  font-size: 10pt; /* Keeping the header slightly larger for readability */
}

.search-box {
  width: 100%;
  margin-bottom: 8px;
  padding: 6px;
  font-size: 8pt;
  border: 1px solid #ccc;
  border-radius: 4px;
  outline: none;
}

ul {
  list-style: none;
  padding: 0;
  margin: 0;
  overflow-y: auto;
  flex-grow: 1;
}

.node-label {
  display: flex;
  align-items: center;
  cursor: pointer;
  padding: 3px 6px; /* Slightly reduced padding to fit smaller text */
  border-radius: 4px;
  transition: background-color 0.2s;
}
.node-label:hover {
  background-color: #f0f0f0;
}
.toggle-icon {
  width: 16px; /* Slightly reduced width */
  text-align: center;
  margin-right: 4px;
  color: #666;
  font-size: 8pt;
}
.toggle-icon.placeholder {
  visibility: hidden;
}
.node-name {
  flex: 1;
  color: #333;
}

.child-list {
  margin-left: 16px; /* Reduced margin */
  border-left: 1px dashed #ccc;
  padding-left: 6px; /* Reduced padding */
  margin-top: 2px;
}

.selected .node-label {
  background-color: #e6f0ff;
  border-left: 2px solid #1867c0; /* Reduced border */
}
</style>
