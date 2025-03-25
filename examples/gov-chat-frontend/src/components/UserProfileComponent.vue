<!-- UserProfileComponent.vue -->
<template>
  <div 
    class="user-profile-modal" 
    :style="dialogThemeStyles"
    ref="modalContainer"
  >
    <div class="overlay" @click="cancel"></div>
    <div class="modal-content">
      <h2>{{ $t('userProfile.title') }}</h2>
      <p class="privacy-info">
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
          {{ $t(`userProfile.tabs.${tab.key}`) }}
        </button>
      </div>

      <!-- Tab content -->
      <div class="tab-content">
        <!-- Profile Type or General Information Tab -->
        <div v-if="activeTab === 0">
          <div class="field-group">
            <label>{{ $t('userProfile.fields.profileType') }}</label>
            <select v-model="formData.generalInfo.profileType">
              <option value="personal">{{ $t('userProfile.profileTypes.personal') }}</option>
              <option value="business">{{ $t('userProfile.profileTypes.business') }}</option>
              <option value="organization">{{ $t('userProfile.profileTypes.organization') }}</option>
            </select>
          </div>
          <div class="field-group">
            <label>{{ $t('userProfile.fields.primaryPurpose') }}</label>
            <textarea v-model="formData.generalInfo.primaryPurpose"></textarea>
          </div>
        </div>

        <!-- Contact Information Tab -->
        <div v-else-if="activeTab === 1">
          <div class="field-group">
            <label>{{ $t('userProfile.fields.email') }}</label>
            <input v-model="formData.contactInfo.email" type="email" />
          </div>
          <div class="field-group">
            <label>{{ $t('userProfile.fields.phoneNumber') }}</label>
            <input v-model="formData.contactInfo.phoneNumber" type="tel" />
          </div>
          <div class="field-group">
            <label>{{ $t('userProfile.fields.alternateContact') }}</label>
            <input v-model="formData.contactInfo.alternateContact" type="tel" />
          </div>
        </div>

        <!-- Personal Identification Data -->
        <div v-else-if="activeTab === 2">
          <div class="field-group">
            <label>{{ $t('userProfile.fields.fullName') }}</label>
            <input v-model="formData.personalIdentification.fullName" type="text" />
          </div>
          <div class="field-group">
            <label>{{ $t('userProfile.fields.dob') }}</label>
            <input v-model="formData.personalIdentification.dob" type="date" />
          </div>
          <div class="field-group">
            <label>{{ $t('userProfile.fields.gender') }}</label>
            <select v-model="formData.personalIdentification.gender">
              <option value="">{{ $t('userProfile.fields.selectGender') }}</option>
              <option value="male">{{ $t('userProfile.genders.male') }}</option>
              <option value="female">{{ $t('userProfile.genders.female') }}</option>
              <option value="other">{{ $t('userProfile.genders.other') }}</option>
              <option value="prefer-not-to-say">{{ $t('userProfile.genders.preferNotToSay') }}</option>
            </select>
          </div>
          <div class="field-group">
            <label>{{ $t('userProfile.fields.nationality') }}</label>
            <input v-model="formData.personalIdentification.nationality" type="text" />
          </div>
        </div>

        <!-- Address & Residency Information -->
        <div v-else-if="activeTab === 3">
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

        <!-- Identity Documents -->
        <div v-else-if="activeTab === 4">
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

        <!-- Employment Information -->
        <div v-else-if="activeTab === 5">
          <div class="field-group">
            <label>{{ $t('userProfile.fields.employmentStatus') }}</label>
            <select v-model="formData.employmentInfo.employmentStatus">
              <option value="employed">{{ $t('userProfile.employmentStatuses.employed') }}</option>
              <option value="self-employed">{{ $t('userProfile.employmentStatuses.selfEmployed') }}</option>
              <option value="unemployed">{{ $t('userProfile.employmentStatuses.unemployed') }}</option>
              <option value="student">{{ $t('userProfile.employmentStatuses.student') }}</option>
              <option value="retired">{{ $t('userProfile.employmentStatuses.retired') }}</option>
            </select>
          </div>
          <div class="field-group">
            <label>{{ $t('userProfile.fields.occupation') }}</label>
            <input v-model="formData.employmentInfo.occupation" type="text" />
          </div>
          <div class="field-group">
            <label>{{ $t('userProfile.fields.employer') }}</label>
            <input v-model="formData.employmentInfo.employer" type="text" />
          </div>
        </div>

        <!-- Financial Information -->
        <div v-else-if="activeTab === 6">
          <div class="field-group">
            <label>{{ $t('userProfile.fields.incomeRange') }}</label>
            <select v-model="formData.financialInfo.incomeRange">
              <option value="0-25000">{{ $t('userProfile.incomeRanges.0-25000') }}</option>
              <option value="25001-50000">{{ $t('userProfile.incomeRanges.25001-50000') }}</option>
              <option value="50001-100000">{{ $t('userProfile.incomeRanges.50001-100000') }}</option>
              <option value="100001+">{{ $t('userProfile.incomeRanges.100001+') }}</option>
            </select>
          </div>
          <div class="field-group">
            <label>{{ $t('userProfile.fields.taxIdentification') }}</label>
            <input v-model="formData.financialInfo.taxIdentification" type="text" />
          </div>
        </div>

        <!-- Additional Identifiers -->
        <div v-else-if="activeTab === 7">
          <div class="field-group">
            <label>{{ $t('userProfile.fields.socialSecurityNumber') }}</label>
            <input v-model="formData.additionalIdentifiers.socialSecurityNumber" type="text" />
          </div>
          <div class="field-group">
            <label>{{ $t('userProfile.fields.taxId') }}</label>
            <input v-model="formData.additionalIdentifiers.taxId" type="text" />
          </div>
        </div>

        <!-- Health Information -->
        <div v-else-if="activeTab === 8">
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

        <!-- Emergency Contacts -->
        <div v-else-if="activeTab === 9">
          <div class="field-group">
            <label>{{ $t('userProfile.fields.emergencyContactName') }}</label>
            <input v-model="formData.emergencyContacts.primaryContact.name" type="text" />
          </div>
          <div class="field-group">
            <label>{{ $t('userProfile.fields.emergencyContactRelationship') }}</label>
            <input v-model="formData.emergencyContacts.primaryContact.relationship" type="text" />
          </div>
          <div class="field-group">
            <label>{{ $t('userProfile.fields.emergencyContactPhone') }}</label>
            <input v-model="formData.emergencyContacts.primaryContact.phone" type="tel" />
          </div>
        </div>

        <!-- Preferences -->
        <div v-else-if="activeTab === 10">
          <div class="field-group">
            <label>{{ $t('userProfile.fields.communicationPreference') }}</label>
            <select v-model="formData.preferences.communicationPreference">
              <option value="email">{{ $t('userProfile.communicationPreferences.email') }}</option>
              <option value="phone">{{ $t('userProfile.communicationPreferences.phone') }}</option>
              <option value="sms">{{ $t('userProfile.communicationPreferences.sms') }}</option>
              <option value="mail">{{ $t('userProfile.communicationPreferences.mail') }}</option>
            </select>
          </div>
          <div class="field-group">
            <label>{{ $t('userProfile.fields.languagePreference') }}</label>
            <select v-model="formData.preferences.languagePreference">
              <option value="en">English</option>
              <option value="es">Español</option>
              <option value="fr">Français</option>
              <option value="de">Deutsch</option>
              <!-- Add more languages as needed -->
            </select>
          </div>
        </div>

        <!-- Additional Information -->
        <div v-else-if="activeTab === 11">
          <div class="field-group">
            <label>{{ $t('userProfile.fields.additionalNotes') }}</label>
            <textarea v-model="formData.additionalInfo.notes" rows="4"></textarea>
          </div>
          <div class="field-group">
            <label>{{ $t('userProfile.fields.specialRequirements') }}</label>
            <textarea v-model="formData.additionalInfo.specialRequirements" rows="4"></textarea>
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
      activeTab: 0,
      tabs: [
        { key: 'generalInfo' },
        { key: 'contactInfo' },
        { key: 'personalIdentification' },
        { key: 'addressResidency' },
        { key: 'identityDocuments' },
        { key: 'employmentInfo' },
        { key: 'financialInfo' },
        { key: 'additionalIdentifiers' },
        { key: 'healthInfo' },
        { key: 'emergencyContacts' },
        { key: 'preferences' },
        { key: 'additionalInfo' }
      ],
      formData: {
        generalInfo: {
          profileType: '',
          primaryPurpose: ''
        },
        contactInfo: {
          email: '',
          phoneNumber: '',
          alternateContact: ''
        },
        personalIdentification: {
          fullName: '',
          dob: '',
          gender: '',
          nationality: ''
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
        employmentInfo: {
          employmentStatus: '',
          occupation: '',
          employer: ''
        },
        financialInfo: {
          incomeRange: '',
          taxIdentification: ''
        },
        additionalIdentifiers: {
          socialSecurityNumber: '',
          taxId: ''
        },
        healthInfo: {
          bloodType: '',
          organDonor: ''
        },
        emergencyContacts: {
          primaryContact: {
            name: '',
            relationship: '',
            phone: ''
          }
        },
        preferences: {
          communicationPreference: '',
          languagePreference: ''
        },
        additionalInfo: {
          notes: '',
          specialRequirements: ''
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
      // Basic form validation
      const validations = {
        generalInfo: [
          { field: 'profileType', required: true }
        ],
        contactInfo: [
          { field: 'email', required: true, type: 'email' },
          { field: 'phoneNumber', required: true }
        ],
        personalIdentification: [
          { field: 'fullName', required: true },
          { field: 'dob', required: true }
        ]
        // Add more validations as needed
      };
      
      const errors = {};
      
      Object.keys(validations).forEach(section => {
        validations[section].forEach(validation => {
          const value = this.formData[section][validation.field];
          
          if (validation.required && !value) {
            errors[`${section}.${validation.field}`] = this.$t('userProfile.validations.required');
          }
          
          if (validation.type === 'email' && value && !/\S+@\S+\.\S+/.test(value)) {
            errors[`${section}.${validation.field}`] = this.$t('userProfile.validations.invalidEmail');
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
  },
  beforeDestroy() {
    // Remove theme change listener
    window.removeEventListener('themeChange', this.updateTheme);
  }
};
</script>

<style scoped>
/* Styles remain the same as in the previous version */
.user-profile-modal {
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  z-index: 9999;
  background-color: var(--dialog-background, #ffffff);
  color: var(--dialog-text-color, #333333);
}

.overlay {
  position: absolute;
  width: 100%;
  height: 100%;
  background-color: var(--dialog-overlay-background, rgba(0, 0, 0, 0.5));
  cursor: pointer;
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

/* Tabs Styling */
.tabs {
  display: flex;
  flex-wrap: wrap;
  margin-bottom: 10px;
  border-bottom: 1px solid var(--dialog-tabs-border-color, #cccccc);
  max-height: 120px;
  overflow-y: auto;
  background-color: var(--dialog-tabs-background, #f0f2f5);
}

.tabs button {
  margin-right: 4px;
  padding: 8px 12px;
  background-color: var(--dialog-tabs-background, #f0f2f5);
  color: var(--dialog-tabs-text-color, #333333);
  border: 1px solid var(--dialog-tabs-border-color, #cccccc);
  border-bottom: none;
  cursor: pointer;
  border-radius: 4px 4px 0 0;
  white-space: nowrap;
}

.tabs button:hover {
  background-color: var(--dialog-tabs-hover-background, #e0e0e0);
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
  font-weight: 600;
}

.field-group input,
.field-group textarea,
.field-group select {
  padding: 8px;
  border: 1px solid var(--dialog-input-border-color, #ddd);
  border-radius: 4px;
  background-color: var(--dialog-input-background, #ffffff);
  color: var(--dialog-input-text-color, #333333);
  transition: border-color 0.2s ease;
}

.field-group input:focus,
.field-group textarea:focus,
.field-group select:focus {
  outline: none;
  border-color: #4E97D1;
  box-shadow: 0 0 0 2px rgba(78, 151, 209, 0.2);
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
  padding: 10px 18px;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  transition: background-color 0.2s, transform 0.1s;
  font-weight: 600;
  text-transform: uppercase;
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
  transform: translateY(-1px);
  box-shadow: 0 2px 4px rgba(0,0,0,0.1);
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