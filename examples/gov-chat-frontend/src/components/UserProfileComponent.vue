<template>
  <div 
    class="user-profile-modal" 
    :style="dialogThemeStyles"
    :data-themed="isThemeReady"
    ref="modalContainer"
  >
    <div class="overlay" @click="cancel"></div>
    <div class="modal-content">
      <h2 :data-themed="isThemeReady">{{ $t('userProfile.title') }}</h2>
      <p class="privacy-info" :data-themed="isThemeReady">
        {{ $t('userProfile.privacyInfo') }}
        <a href="#" class="privacy-link">{{ $t('userProfile.privacyPolicyLink') }}</a>
      </p>

      <!-- Tabs -->
      <div class="tabs">
        <button
          v-for="(tab, index) in tabs"
          :key="index"
          :class="{ active: activeTab === index }"
          @click="activeTab = index"
        >
          {{ $t(`userProfile.tabs.tab${index+1}`) }}
        </button>
      </div>

      <!-- Tab content -->
      <div class="tab-content">
        <!-- Personal Identification Data -->
        <div v-if="activeTab === 0">
          <div class="field-group">
            <label>{{ $t('userProfile.fields.fullName') }}</label>
            <input v-model="formData.personalIdentification.fullName" type="text" 
                   :placeholder="$t('userProfile.placeholders.fullName')" />
          </div>
          <div class="field-group">
            <label>{{ $t('userProfile.fields.dob') }}</label>
            <input v-model="formData.personalIdentification.dob" type="date" />
          </div>
          <div class="field-group">
            <label>{{ $t('userProfile.fields.gender') }}</label>
            <select v-model="formData.personalIdentification.gender">
              <option value="">{{ $t('userProfile.select') }}</option>
              <option value="male">{{ $t('userProfile.gender.male') }}</option>
              <option value="female">{{ $t('userProfile.gender.female') }}</option>
              <option value="other">{{ $t('userProfile.gender.other') }}</option>
              <option value="prefer-not-to-say">{{ $t('userProfile.gender.preferNot') }}</option>
            </select>
          </div>
          <div class="field-group">
            <label>{{ $t('userProfile.fields.nationality') }}</label>
            <input v-model="formData.personalIdentification.nationality" type="text" 
                   :placeholder="$t('userProfile.placeholders.nationality')" />
          </div>
        </div>

        <!-- Civil Registration & Documentation -->
        <div v-else-if="activeTab === 1">
          <div class="field-group">
            <label>{{ $t('userProfile.fields.birthCert') }}</label>
            <input v-model="formData.civilRegistration.birthCert" type="text" />
          </div>
          <div class="field-group">
            <label>{{ $t('userProfile.fields.citizenship') }}</label>
            <input v-model="formData.civilRegistration.citizenship" type="text" />
          </div>
          <div class="field-group">
            <label>{{ $t('userProfile.fields.immigration') }}</label>
            <input v-model="formData.civilRegistration.immigration" type="text" />
          </div>
        </div>

        <!-- Address & Residency Information -->
        <div v-else-if="activeTab === 2">
          <div class="field-group">
            <label>{{ $t('userProfile.fields.currentAddress') }}</label>
            <textarea v-model="formData.addressResidency.currentAddress"></textarea>
          </div>
          <div class="field-group">
            <label>{{ $t('userProfile.fields.postalCode') }}</label>
            <input v-model="formData.addressResidency.postalCode" type="text" />
          </div>
          <div class="field-group">
            <label>{{ $t('userProfile.fields.country') }}</label>
            <input v-model="formData.addressResidency.country" type="text" />
          </div>
          <div class="field-group">
            <label>{{ $t('userProfile.fields.residencyStatus') }}</label>
            <select v-model="formData.addressResidency.residencyStatus">
              <option value="citizen">{{ $t('userProfile.residencyStatuses.citizen') }}</option>
              <option value="permanent-resident">{{ $t('userProfile.residencyStatuses.permanentResident') }}</option>
              <option value="temporary-resident">{{ $t('userProfile.residencyStatuses.temporaryResident') }}</option>
              <option value="other">{{ $t('userProfile.residencyStatuses.other') }}</option>
            </select>
          </div>
        </div>

        <!-- Identity & Travel Documents -->
        <div v-else-if="activeTab === 3">
          <div class="field-group">
            <label>{{ $t('userProfile.fields.idCard') }}</label>
            <input v-model="formData.identityDocuments.idCard" type="text" />
          </div>
          <div class="field-group">
            <label>{{ $t('userProfile.fields.passport') }}</label>
            <input v-model="formData.identityDocuments.passport" type="text" />
          </div>
          <div class="field-group">
            <label>{{ $t('userProfile.fields.driversLicense') }}</label>
            <input v-model="formData.identityDocuments.driversLicense" type="text" />
          </div>
        </div>

        <!-- Health & Medical Records -->
        <div v-else-if="activeTab === 4">
          <div class="field-group">
            <label>{{ $t('userProfile.fields.bloodType') }}</label>
            <select v-model="formData.healthInfo.bloodType">
              <option value="a-positive">A+</option>
              <option value="a-negative">A-</option>
              <option value="b-positive">B+</option>
              <option value="b-negative">B-</option>
              <option value="ab-positive">AB+</option>
              <option value="ab-negative">AB-</option>
              <option value="o-positive">O+</option>
              <option value="o-negative">O-</option>
            </select>
          </div>
          <div class="field-group">
            <label>{{ $t('userProfile.fields.organDonor') }}</label>
            <select v-model="formData.healthInfo.organDonor">
              <option value="yes">{{ $t('userProfile.yesNo.yes') }}</option>
              <option value="no">{{ $t('userProfile.yesNo.no') }}</option>
            </select>
          </div>
        </div>

        <!-- Employment & Economic Data -->
        <div v-else-if="activeTab === 5">
          <div class="field-group">
            <label>{{ $t('userProfile.fields.eHistory') }}</label>
            <input v-model="formData.employmentInfo.employmentHistory" type="text" />
          </div>
          <div class="field-group">
            <label>{{ $t('userProfile.fields.currentEmployer') }}</label>
            <input v-model="formData.employmentInfo.currentEmployer" type="text" />
          </div>
          <div class="field-group">
            <label>{{ $t('userProfile.fields.tin') }}</label>
            <input v-model="formData.employmentInfo.taxId" type="text" />
          </div>
        </div>

        <!-- Financial & Tax Data -->
        <div v-else-if="activeTab === 6">
          <div class="field-group">
            <label>{{ $t('userProfile.fields.incomeTax') }}</label>
            <input v-model="formData.financialInfo.incomeTax" type="text" />
          </div>
          <div class="field-group">
            <label>{{ $t('userProfile.fields.bankAccounts') }}</label>
            <input v-model="formData.financialInfo.bankAccounts" type="text" />
          </div>
        </div>
      </div>

      <!-- Action buttons -->
      <div class="actions">
        <button class="cancel-btn" @click="cancel">
          {{ $t('userProfile.actions.cancel') }}
        </button>
        <button class="save-btn" @click="saveProfile">
          {{ $t('userProfile.actions.save') }}
        </button>
      </div>
    </div>
  </div>
</template>

<script>
export default {
  name: 'UserProfileComponent',
  data() {
    return {
      isThemeReady: false,
      activeTab: 0,
      tabs: [
        { key: 'personalIdentification' },
        { key: 'civilRegistration' },
        { key: 'addressResidency' },
        { key: 'identityDocuments' },
        { key: 'healthInfo' },
        { key: 'employmentInfo' },
        { key: 'financialInfo' }
      ],
      formData: {
        personalIdentification: {
          fullName: '',
          dob: '',
          gender: '',
          nationality: ''
        },
        civilRegistration: {
          birthCert: '',
          citizenship: '',
          immigration: ''
        },
        addressResidency: {
          currentAddress: '',
          postalCode: '',
          country: '',
          residencyStatus: ''
        },
        identityDocuments: {
          idCard: '',
          passport: '',
          driversLicense: ''
        },
        healthInfo: {
          bloodType: '',
          organDonor: ''
        },
        employmentInfo: {
          employmentHistory: '',
          currentEmployer: '',
          taxId: ''
        },
        financialInfo: {
          incomeTax: '',
          bankAccounts: ''
        }
      }
    };
  },
  computed: {
    isDarkMode() {
      // Simplified check based directly on DOM
      return document.documentElement.getAttribute('data-theme') === 'dark' ||
             document.body.getAttribute('data-theme') === 'dark';
    },
    
    dialogThemeStyles() {
      // Create a minimal required set of styles based on current theme
      const isDark = this.isDarkMode;
      
      return {
        '--dialog-background': isDark ? '#2a2a2a' : '#ffffff',
        '--dialog-title-color': isDark ? '#ffffff' : '#333333',
        '--dialog-text-color': isDark ? 'rgba(255, 255, 255, 0.8)' : '#666666',
        '--dialog-border-color': isDark ? '#3a3a3a' : '#dcdfe4',
        '--dialog-box-shadow': isDark ? '0 4px 12px rgba(0, 0, 0, 0.4)' : '0 4px 12px rgba(0, 0, 0, 0.15)',
        '--dialog-overlay-background': isDark ? 'rgba(0, 0, 0, 0.7)' : 'rgba(0, 0, 0, 0.5)',
        '--dialog-primary-button-bg': '#4E97D1',
        '--dialog-primary-button-text': '#ffffff',
        '--dialog-primary-button-hover-bg': '#3a7da0',
        '--dialog-secondary-button-bg': isDark ? '#3a3a3a' : '#cccccc',
        '--dialog-secondary-button-text': isDark ? '#e0e0e0' : '#333333',
        '--dialog-secondary-button-hover-bg': isDark ? '#4a4a4a' : '#bbbbbb',
        '--dialog-input-background': isDark ? '#333333' : '#ffffff',
        '--dialog-input-text-color': isDark ? '#f0f0f0' : '#333333',
        '--dialog-input-border-color': isDark ? '#3a3a3a' : '#ddd',
        '--dialog-input-placeholder-color': isDark ? '#8c8c8c' : '#767676',
        '--dialog-tabs-background': isDark ? '#252525' : '#f0f2f5',
        '--dialog-tabs-active-background': isDark ? '#2a2a2a' : '#ffffff',
        '--dialog-tabs-text-color': isDark ? '#f0f0f0' : '#333333',
        '--dialog-tabs-active-text-color': isDark ? '#ffffff' : '#000000',
        '--dialog-tabs-border-color': isDark ? '#3a3a3a' : '#cccccc'
      };
    }
  },
  methods: {
    updateTheme() {
      // Force-update the theme variables
      this.isThemeReady = false;
      this.$nextTick(() => {
        this.isThemeReady = true;
      });
    },
    cancel() {
      this.$emit('cancel');
    },
    saveProfile() {
      // Emit a deep copy to avoid direct mutation
      const copy = JSON.parse(JSON.stringify(this.formData));
      this.$emit('save', copy);
    },
    onFileChange(e, section, fieldKey) {
      const file = e.target.files[0];
      if (!file) return;
      
      // Validate file type and size
      const allowedTypes = ['image/jpeg', 'image/png', 'application/pdf'];
      const maxSize = 5 * 1024 * 1024; // 5MB
      
      if (!allowedTypes.includes(file.type)) {
        this.$emit('error', this.$t('userProfile.errors.invalidFileType'));
        return;
      }
      
      if (file.size > maxSize) {
        this.$emit('error', this.$t('userProfile.errors.fileTooLarge'));
        return;
      }
      
      this.formData[section][fieldKey] = file;
    },
    validateForm() {
      // Basic form validation (simplified from original)
      const validations = {
        personalIdentification: [
          { field: 'fullName', required: true },
          { field: 'dob', required: true }
        ]
      };
      
      const errors = {};
      
      Object.keys(validations).forEach(section => {
        validations[section].forEach(validation => {
          const value = this.formData[section][validation.field];
          
          if (validation.required && !value) {
            errors[`${section}.${validation.field}`] = this.$t('userProfile.validation.nameRequired');
          }
        });
      });
      
      return {
        isValid: Object.keys(errors).length === 0,
        errors
      };
    }
  },
  mounted() {
    // Add theme change listener
    window.addEventListener('themeChange', this.updateTheme);
    
    // Set initial theme after a small delay to ensure DOM is ready
    this.$nextTick(() => {
      // Update theme variables
      this.isThemeReady = true;
    });
  },
  beforeDestroy() {
    // Remove theme change listener
    window.removeEventListener('themeChange', this.updateTheme);
  }
};
</script>

<style scoped>
/* Base Modal Styling */
/* Base Modal Styling */
.user-profile-modal {
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  z-index: 9999;
  /* Set default colors for light mode regardless of theme detection */
  background-color: #ffffff;
  color: #333333;
}

/* Apply theme variables only as overrides */
.user-profile-modal[data-themed="true"] {
  background-color: var(--dialog-background, #ffffff);
  color: var(--dialog-text-color, #333333);
}

/* Other existing styles remain unchanged */
.overlay {
  position: absolute;
  width: 100%;
  height: 100%;
  background-color: var(--dialog-overlay-background, rgba(0, 0, 0, 0.5));
}

.modal-content {
  position: relative;
  background-color: var(--dialog-background, #ffffff);
  width: 900px;
  max-width: 90%;
  margin: 40px auto;
  padding: 20px;
  border-radius: 8px;
  overflow-y: auto;
  max-height: 90vh;
  box-shadow: var(--dialog-box-shadow, 0 4px 12px rgba(0, 0, 0, 0.15));
  border: 1px solid var(--dialog-border-color, #dcdfe4);
}

/* Title and Info Styling - add explicit color */
h2 {
  color: #333333;
  margin-bottom: 10px;
}

h2[data-themed="true"] {
  color: var(--dialog-title-color, #333333);
}

.privacy-info {
  font-size: 0.9rem;
  margin-bottom: 16px;
  color: #666666;
}

.privacy-info[data-themed="true"] {
  color: var(--dialog-text-color, #666666);
}

/* Tabs Styling */
.tabs {
  display: flex;
  flex-wrap: wrap;
  margin-bottom: 10px;
  border-bottom: 1px solid var(--dialog-tabs-border-color, #cccccc);
  max-height: 120px;
  overflow-y: auto;
  background-color: var(--dialog-tabs-background, #ffffff);
}

.tabs button {
  margin-right: 4px;
  padding: 8px 12px;
  background-color: var(--dialog-tabs-background, #ffffff);
  color: var(--dialog-tabs-text-color, #000000);
  border: 1px solid var(--dialog-tabs-border-color, #cccccc);
  border-bottom: none;
  cursor: pointer;
  border-radius: 4px 4px 0 0;
  white-space: nowrap;
}

.tabs button:hover {
  background-color: var(--dialog-tabs-hover-background, #f0f0f0);
}

.tabs button.active {
  background-color: var(--dialog-tabs-active-background, #ffffff);
  color: var(--dialog-tabs-active-text-color, #000000);
  font-weight: bold;
  border-bottom: 2px solid var(--dialog-tabs-active-background, #ffffff);
}

/* Field Group Styling */
.tab-content {
  border: 1px solid var(--dialog-tabs-border-color, #cccccc);
  border-top: none;
  padding: 10px;
  border-radius: 0 0 4px 4px;
  background-color: var(--dialog-background, #ffffff);
  min-height: 300px;
}

.field-group {
  margin-bottom: 12px;
  display: flex;
  flex-direction: column;
}

.field-group label {
  margin-bottom: 4px;
  color: var(--dialog-text-color, #333333);
}

.field-group input,
.field-group textarea {
  padding: 6px;
  border: 1px solid var(--dialog-input-border-color, #ddd);
  border-radius: 4px;
  background-color: var(--dialog-input-background, #ffffff);
  color: var(--dialog-input-text-color, #333333);
}

.field-group input::placeholder,
.field-group textarea::placeholder {
  color: var(--dialog-input-placeholder-color, #767676);
}

/* Action Buttons Styling */
.actions {
  margin-top: 20px;
  text-align: right;
  display: flex;
  justify-content: flex-end;
  gap: 10px;
}

.cancel-btn,
.save-btn {
  padding: 8px 16px;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  transition: background-color 0.2s;
}

.cancel-btn {
  background-color: var(--dialog-secondary-button-bg, #cccccc);
  color: var(--dialog-secondary-button-text, #333333);
}

.cancel-btn:hover {
  background-color: var(--dialog-secondary-button-hover-bg, #bbbbbb);
}

.save-btn {
  background-color: var(--dialog-primary-button-bg, #4E97D1);
  color: var(--dialog-primary-button-text, #ffffff);
}

.save-btn:hover {
  background-color: var(--dialog-primary-button-hover-bg, #3a7da0);
}

/* Dark Mode Specific Overrides */
[data-theme="dark"] .user-profile-modal,
.dark-mode .user-profile-modal {
  background-color: var(--dialog-background, #2a2a2a);
  color: var(--dialog-text-color, #f0f0f0);
}

[data-theme="dark"] h2,
.dark-mode h2 {
  color: #ffffff !important;
}

[data-theme="dark"] .privacy-info,
.dark-mode .privacy-info {
  color: rgba(255, 255, 255, 0.8) !important;
}
</style>