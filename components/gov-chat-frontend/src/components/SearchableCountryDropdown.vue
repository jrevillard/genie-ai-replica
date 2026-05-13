<template>
  <div class="searchable-dropdown">
    <label v-if="label">{{ label }}</label>
    <DsCombobox
      ref="combobox"
      :model-value="value"
      :options="sortedCountries"
      option-label="name"
      option-value="code"
      :placeholder="placeholder"
      :search-placeholder="searchPlaceholder"
      :no-results-text="noResultsText"
      @update:model-value="handleSelect"
    />
    <div v-if="debug" class="debug-info">
      <p>
        <strong>Debug:</strong>
        value: {{ value }}, selectedOption: {{ selectedOption }}
      </p>
      <p>Countries loaded: {{ allCountries.length }}</p>
      <p>Last update: {{ debugInfo.lastUpdated }}</p>
    </div>
  </div>
</template>

<script>
import DsCombobox from './ds/Combobox.vue';

export default {
  name: 'SearchableCountrydropdown',
  components: {
    DsCombobox
  },
  props: {
    value: {
      type: String,
      default: ''
    },
    label: {
      type: String,
      default: ''
    },
    placeholder: {
      type: String,
      default: 'Select a country'
    },
    searchPlaceholder: {
      type: String,
      default: 'Search countries...'
    },
    noResultsText: {
      type: String,
      default: 'No matching countries found'
    },
    debug: {
      type: Boolean,
      default: false
    }
  },
  emits: ['update:name', 'input', 'change'],
  data() {
    return {
      selectedOption: '',
      allCountries: [],
      codeToNameMap: {
        // Default mapping for common countries - more will be added when loadCountries() is called
        AF: 'Afghanistan',
        AU: 'Australia',
        US: 'United States',
        CA: 'Canada',
        GB: 'United Kingdom',
        DE: 'Germany',
        FR: 'France',
        JP: 'Japan',
        CN: 'China',
        IN: 'India',
        BR: 'Brazil',
        RU: 'Russia',
        ZA: 'South Africa',
        ID: 'Indonesia'
      },
      debugInfo: {
        renderCount: 0,
        lastUpdated: '',
        valueHistory: []
      },
      isInitialized: false,
      mutationObserver: null
    };
  },
  computed: {
    displayCode() {
      if (!this.value) return '';
      const countryName = this.getCountryNameByCode(this.value);
      return countryName || this.value;
    },
    sortedCountries() {
      return [...this.allCountries];
    }
  },
  watch: {
    value: {
      handler(newVal, oldVal) {
        this.debugInfo.valueHistory.push(`value changed: ${oldVal} -> ${newVal}`);

        if (newVal !== oldVal && this.isInitialized) {
          if (newVal) {
            // Add a slight delay to ensure all data is ready
            this.$nextTick(() => {
              this.manuallySetCountryName(newVal);
            });
          } else {
            this.selectedOption = '';
            this.$emit('update:name', '');
          }
        }
      }
    },
    allCountries: {
      handler(newCountries) {
        // Update the code-to-name map
        newCountries.forEach((country) => {
          if (country && country.code) {
            this.codeToNameMap[country.code] = country.name;
          }
        });

        // Try to update selected option if we have a value
        if (this.value) {
          this.$nextTick(() => {
            this.manuallySetCountryName(this.value);
          });
        }
      }
    }
  },
  created() {
    this.debugInfo.valueHistory.push(`created: ${this.value}`);

    // Load countries first
    this.loadCountries();
  },
  mounted() {
    this.debugInfo.valueHistory.push(`mounted: ${this.value}`);

    // Set initial value after mounting
    if (this.value) {
      this.$nextTick(() => {
        this.manuallySetCountryName(this.value);
      });
    }

    // Mark component as initialized
    this.isInitialized = true;

    // Add mutation observer to detect when this component is re-attached to DOM
    this.setupMutationObserver();
  },

  beforeUnmount() {
    // Clean up the mutation observer
    if (this.mutationObserver) {
      this.mutationObserver.disconnect();
    }
  },
  updated() {
    this.debugInfo.renderCount++;
    this.debugInfo.lastUpdated = new Date().toISOString();
  },
  methods: {
    setupMutationObserver() {
      // Create a mutation observer to detect when the component is re-attached to DOM
      if (window.MutationObserver) {
        this.mutationObserver = new MutationObserver((mutations) => {
          for (const mutation of mutations) {
            if (mutation.type === 'childList' && mutation.addedNodes.length) {
              // Check if our component or any parent is being added back to DOM
              let containsSelf = false;
              mutation.addedNodes.forEach((node) => {
                if ((node.contains && node.contains(this.$el)) || node === this.$el) {
                  containsSelf = true;
                }
              });

              if (containsSelf && this.value) {
                this.$nextTick(() => {
                  this.manuallySetCountryName(this.value);
                });
              }
            }
          }
        });

        // Observe changes to the body element
        this.mutationObserver.observe(document.body, {
          childList: true,
          subtree: true
        });
      }
    },

    manuallySetCountryName(code) {
      if (!code) return;

      const countryName = this.getCountryNameByCode(code);

      if (countryName) {
        this.selectedOption = countryName;
        this.$emit('update:name', countryName);
      }
    },
    getCountryNameByCode(code) {
      if (!code) return '';

      // Normalize the code to uppercase for consistent lookup
      const normalizedCode = code.toUpperCase();

      // Try to find in code-to-name map first (should be fastest)
      if (this.codeToNameMap[normalizedCode]) {
        return this.codeToNameMap[normalizedCode];
      }

      // Then try to find in loaded countries
      const country = this.allCountries.find((c) => c && c.code && c.code.toUpperCase() === normalizedCode);

      if (country) {
        // Update the map for future lookups
        this.codeToNameMap[normalizedCode] = country.name;
        return country.name;
      }

      return '';
    },
    loadCountries() {
      try {
        let loadedCountries = [];

        // Try to get translations if i18n is available
        const hasI18n = this.$i18n && typeof this.$i18n.t === 'function';
        const hasTeMethod = this.$te && typeof this.$te === 'function';

        if (hasI18n && hasTeMethod && this.$te('countries')) {
          try {
            const translatedCountries = this.$t('countries');
            if (typeof translatedCountries === 'object' && translatedCountries !== null) {
              loadedCountries = Object.keys(translatedCountries).map((code) => ({
                code,
                name: translatedCountries[code]
              }));
            } else {
              loadedCountries = this.getDefaultCountries();
            }
          } catch {
            loadedCountries = this.getDefaultCountries();
          }
        } else {
          loadedCountries = this.getDefaultCountries();
        }

        // Sort countries by name with safe locale fallback
        const locale = hasI18n && this.$i18n.locale ? this.$i18n.locale : 'en';

        try {
          loadedCountries.sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase(), locale));
        } catch {
          loadedCountries.sort((a, b) => a.name.localeCompare(b.name));
        }

        // Build complete code to name map for faster lookup
        loadedCountries.forEach((country) => {
          if (country && country.code) {
            this.codeToNameMap[country.code] = country.name;
          }
        });

        // Update the component data
        this.allCountries = loadedCountries;
      } catch {
        this.allCountries = this.getDefaultCountries();
      }
    },
    handleSelect(code) {
      const name = this.getCountryNameByCode(code);
      this.selectedOption = name;
      this.$emit('input', code);
      this.$emit('update:name', name);
      this.$emit('change', code);
    },
    getDefaultCountries() {
      return [
        { code: 'AF', name: 'Afghanistan' },
        { code: 'AL', name: 'Albania' },
        { code: 'DZ', name: 'Algeria' },
        { code: 'AD', name: 'Andorra' },
        { code: 'AO', name: 'Angola' },
        { code: 'AG', name: 'Antigua and Barbuda' },
        { code: 'AR', name: 'Argentina' },
        { code: 'AM', name: 'Armenia' },
        { code: 'AU', name: 'Australia' },
        { code: 'AT', name: 'Austria' },
        { code: 'AZ', name: 'Azerbaijan' },
        { code: 'BS', name: 'Bahamas' },
        { code: 'BH', name: 'Bahrain' },
        { code: 'BD', name: 'Bangladesh' },
        { code: 'BB', name: 'Barbados' },
        { code: 'BY', name: 'Belarus' },
        { code: 'BE', name: 'Belgium' },
        { code: 'BZ', name: 'Belize' },
        { code: 'BJ', name: 'Benin' },
        { code: 'BT', name: 'Bhutan' },
        { code: 'BO', name: 'Bolivia' },
        { code: 'BA', name: 'Bosnia and Herzegovina' },
        { code: 'BW', name: 'Botswana' },
        { code: 'BR', name: 'Brazil' },
        { code: 'BN', name: 'Brunei Darussalam' },
        { code: 'BG', name: 'Bulgaria' },
        { code: 'BF', name: 'Burkina Faso' },
        { code: 'BI', name: 'Burundi' },
        { code: 'CV', name: 'Cabo Verde' },
        { code: 'KH', name: 'Cambodia' },
        { code: 'CM', name: 'Cameroon' },
        { code: 'CA', name: 'Canada' },
        { code: 'CF', name: 'Central African Republic' },
        { code: 'TD', name: 'Chad' },
        { code: 'CL', name: 'Chile' },
        { code: 'CN', name: 'China' },
        { code: 'CO', name: 'Colombia' },
        { code: 'KM', name: 'Comoros' },
        { code: 'CG', name: 'Congo' },
        { code: 'CD', name: 'Congo (the Democratic Republic of the)' },
        { code: 'CR', name: 'Costa Rica' },
        { code: 'CI', name: "Cote d'Ivoire" },
        { code: 'HR', name: 'Croatia' },
        { code: 'CU', name: 'Cuba' },
        { code: 'CY', name: 'Cyprus' },
        { code: 'CZ', name: 'Czech Republic' },
        { code: 'DK', name: 'Denmark' },
        { code: 'DJ', name: 'Djibouti' },
        { code: 'DM', name: 'Dominica' },
        { code: 'DO', name: 'Dominican Republic' },
        { code: 'EC', name: 'Ecuador' },
        { code: 'EG', name: 'Egypt' },
        { code: 'SV', name: 'El Salvador' },
        { code: 'GQ', name: 'Equatorial Guinea' },
        { code: 'ER', name: 'Eritrea' },
        { code: 'EE', name: 'Estonia' },
        { code: 'ET', name: 'Ethiopia' },
        { code: 'FI', name: 'Finland' },
        { code: 'FJ', name: 'Fiji' },
        { code: 'FR', name: 'France' },
        { code: 'GA', name: 'Gabon' },
        { code: 'GM', name: 'Gambia' },
        { code: 'GE', name: 'Georgia' },
        { code: 'DE', name: 'Germany' },
        { code: 'GH', name: 'Ghana' },
        { code: 'GR', name: 'Greece' },
        { code: 'GD', name: 'Grenada' },
        { code: 'GT', name: 'Guatemala' },
        { code: 'GN', name: 'Guinea' },
        { code: 'GW', name: 'Guinea-Bissau' },
        { code: 'GY', name: 'Guyana' },
        { code: 'HT', name: 'Haiti' },
        { code: 'HN', name: 'Honduras' },
        { code: 'HU', name: 'Hungary' },
        { code: 'IS', name: 'Iceland' },
        { code: 'IN', name: 'India' },
        { code: 'ID', name: 'Indonesia' },
        { code: 'IR', name: 'Iran (the Islamic Republic of)' },
        { code: 'IQ', name: 'Iraq' },
        { code: 'IE', name: 'Ireland' },
        { code: 'IL', name: 'Israel' },
        { code: 'IT', name: 'Italy' },
        { code: 'JM', name: 'Jamaica' },
        { code: 'JP', name: 'Japan' },
        { code: 'JO', name: 'Jordan' },
        { code: 'KZ', name: 'Kazakhstan' },
        { code: 'KE', name: 'Kenya' },
        { code: 'KI', name: 'Kiribati' },
        { code: 'KP', name: 'Korea (North)' },
        { code: 'KR', name: 'Korea (South)' },
        { code: 'KW', name: 'Kuwait' },
        { code: 'KG', name: 'Kyrgyzstan' },
        { code: 'LA', name: 'Laos' },
        { code: 'LV', name: 'Latvia' },
        { code: 'LB', name: 'Lebanon' },
        { code: 'LS', name: 'Lesotho' },
        { code: 'LR', name: 'Liberia' },
        { code: 'LY', name: 'Libya' },
        { code: 'LI', name: 'Liechtenstein' },
        { code: 'LT', name: 'Lithuania' },
        { code: 'LU', name: 'Luxembourg' },
        { code: 'MG', name: 'Madagascar' },
        { code: 'MW', name: 'Malawi' },
        { code: 'MY', name: 'Malaysia' },
        { code: 'MV', name: 'Maldives' },
        { code: 'ML', name: 'Mali' },
        { code: 'MT', name: 'Malta' },
        { code: 'MH', name: 'Marshall Islands' },
        { code: 'MR', name: 'Mauritania' },
        { code: 'MU', name: 'Mauritius' },
        { code: 'MX', name: 'Mexico' },
        { code: 'FM', name: 'Micronesia' },
        { code: 'MD', name: 'Moldova' },
        { code: 'MC', name: 'Monaco' },
        { code: 'MN', name: 'Mongolia' },
        { code: 'ME', name: 'Montenegro' },
        { code: 'MA', name: 'Morocco' },
        { code: 'MZ', name: 'Mozambique' },
        { code: 'MM', name: 'Myanmar' },
        { code: 'NA', name: 'Namibia' },
        { code: 'NR', name: 'Nauru' },
        { code: 'NP', name: 'Nepal' },
        { code: 'NL', name: 'Netherlands' },
        { code: 'NZ', name: 'New Zealand' },
        { code: 'NI', name: 'Nicaragua' },
        { code: 'NE', name: 'Niger' },
        { code: 'NG', name: 'Nigeria' },
        { code: 'MK', name: 'North Macedonia' },
        { code: 'NO', name: 'Norway' },
        { code: 'OM', name: 'Oman' },
        { code: 'PK', name: 'Pakistan' },
        { code: 'PW', name: 'Palau' },
        { code: 'PS', name: 'Palestine' },
        { code: 'PA', name: 'Panama' },
        { code: 'PG', name: 'Papua New Guinea' },
        { code: 'PY', name: 'Paraguay' },
        { code: 'PE', name: 'Peru' },
        { code: 'PH', name: 'Philippines' },
        { code: 'PL', name: 'Poland' },
        { code: 'PT', name: 'Portugal' },
        { code: 'QA', name: 'Qatar' },
        { code: 'RO', name: 'Romania' },
        { code: 'RU', name: 'Russia' },
        { code: 'RW', name: 'Rwanda' },
        { code: 'KN', name: 'Saint Kitts and Nevis' },
        { code: 'LC', name: 'Saint Lucia' },
        { code: 'VC', name: 'Saint Vincent and the Grenadines' },
        { code: 'WS', name: 'Samoa' },
        { code: 'SM', name: 'San Marino' },
        { code: 'ST', name: 'Sao Tome and Principe' },
        { code: 'SA', name: 'Saudi Arabia' },
        { code: 'SN', name: 'Senegal' },
        { code: 'RS', name: 'Serbia' },
        { code: 'SC', name: 'Seychelles' },
        { code: 'SL', name: 'Sierra Leone' },
        { code: 'SG', name: 'Singapore' },
        { code: 'SK', name: 'Slovakia' },
        { code: 'SI', name: 'Slovenia' },
        { code: 'SB', name: 'Solomon Islands' },
        { code: 'SO', name: 'Somalia' },
        { code: 'ZA', name: 'South Africa' },
        { code: 'SS', name: 'South Sudan' },
        { code: 'ES', name: 'Spain' },
        { code: 'LK', name: 'Sri Lanka' },
        { code: 'SD', name: 'Sudan' },
        { code: 'SR', name: 'Suriname' },
        { code: 'SE', name: 'Sweden' },
        { code: 'CH', name: 'Switzerland' },
        { code: 'SY', name: 'Syria' },
        { code: 'TW', name: 'Taiwan' },
        { code: 'TJ', name: 'Tajikistan' },
        { code: 'TZ', name: 'Tanzania' },
        { code: 'TH', name: 'Thailand' },
        { code: 'TL', name: 'Timor-Leste' },
        { code: 'TG', name: 'Togo' },
        { code: 'TO', name: 'Tonga' },
        { code: 'TT', name: 'Trinidad and Tobago' },
        { code: 'TN', name: 'Tunisia' },
        { code: 'TR', name: 'Turkey' },
        { code: 'TM', name: 'Turkmenistan' },
        { code: 'TV', name: 'Tuvalu' },
        { code: 'UG', name: 'Uganda' },
        { code: 'UA', name: 'Ukraine' },
        { code: 'AE', name: 'United Arab Emirates' },
        { code: 'GB', name: 'United Kingdom' },
        { code: 'US', name: 'United States' },
        { code: 'UY', name: 'Uruguay' },
        { code: 'UZ', name: 'Uzbekistan' },
        { code: 'VU', name: 'Vanuatu' },
        { code: 'VA', name: 'Vatican City' },
        { code: 'VE', name: 'Venezuela' },
        { code: 'VN', name: 'Vietnam' },
        { code: 'YE', name: 'Yemen' },
        { code: 'ZM', name: 'Zambia' },
        { code: 'ZW', name: 'Zimbabwe' }
      ];
    }
  }
};
</script>

<style scoped>
.searchable-dropdown {
  display: flex;
  flex-direction: column;
}

.searchable-dropdown label {
  margin-bottom: var(--space-xs);
  font-weight: 500;
  font-size: var(--text-base);
}

.debug-info {
  margin-top: var(--space-sm);
  padding: var(--space-sm);
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  font-size: var(--text-sm);
}
</style>
