// UserProfileComponent.vue with centralized translation function and updated theme variables

<template>
  <div class="user-profile-page">
    <div class="profile-content">
      <h2>{{ translate('title') }}</h2>

      <!-- Loading Indicator -->
      <DsSpinner v-if="isLoading" overlay>
        <p>{{ translate('loadingProfile', 'Loading user profile...') }}</p>
      </DsSpinner>

      <!-- Error Message -->
      <DsStateDisplay v-else-if="errorMessage" type="error" :message="errorMessage">
        <template #action>
          <DsButton variant="secondary" @click="retryLoading">
            {{ translate('retryLoading', 'Retry') }}
          </DsButton>
        </template>
      </DsStateDisplay>

      <!-- Main content - shown when not loading and no errors -->
      <div v-else class="profile-main">
        <p class="privacy-info">
          {{ translate('privacyInfo') }}
          <a href="#" class="privacy-link">{{ translate('privacyPolicyLink') }}</a>
        </p>

        <!-- Tabs -->
        <DsTabs v-model="activeTab" :tabs="profileTabs">
          <!-- Tab content -->
          <!-- Personal Identification Data -->
          <div v-if="activeTab === 0">
            <!-- Profile Icon Section -->
            <div class="profile-icon-section">
              <label>{{ translate('profileIcon') }}</label>
              <div class="profile-icon-container">
                <div class="current-icon" @click="openIconSelector">
                  <img
                    v-if="formData.personalIdentification.profileIcon"
                    :src="formData.personalIdentification.profileIcon"
                    alt="Profile icon"
                  />
                  <div v-else class="icon-placeholder">
                    {{ getInitials(formData.personalIdentification.fullName) }}
                  </div>
                  <div class="icon-overlay">
                    <span>{{ translate('change') }}</span>
                  </div>
                </div>
              </div>

              <!-- Icon Selection Modal -->
              <div v-if="showIconSelector" class="icon-selector-overlay" @click="closeIconSelector">
                <div class="icon-selector-modal" @click.stop>
                  <h4>{{ translate('chooseProfileIcon') }}</h4>

                  <div class="icon-tabs">
                    <DsButton
                      variant="ghost"
                      :small="true"
                      :class="{ active: iconTab === 'preset' }"
                      @click="iconTab = 'preset'"
                    >
                      {{ translate('presetIcons') }}
                    </DsButton>
                    <DsButton
                      variant="ghost"
                      :small="true"
                      :class="{ active: iconTab === 'upload' }"
                      @click="iconTab = 'upload'"
                    >
                      {{ translate('upload') }}
                    </DsButton>
                    <DsButton
                      variant="ghost"
                      :small="true"
                      :class="{ active: iconTab === 'initials' }"
                      @click="iconTab = 'initials'"
                    >
                      {{ translate('initials') }}
                    </DsButton>
                  </div>

                  <div class="icon-content">
                    <!-- Preset Icons -->
                    <div v-if="iconTab === 'preset'" class="preset-icons">
                      <div
                        v-for="(icon, index) in presetIcons"
                        :key="index"
                        class="preset-icon"
                        :class="{
                          selected: formData.personalIdentification.profileIcon === icon
                        }"
                        @click="selectPresetIcon(icon)"
                      >
                        <img :src="icon" alt="Preset icon" />
                      </div>
                    </div>

                    <!-- Upload Option -->
                    <div v-if="iconTab === 'upload'" class="upload-icon">
                      <div class="upload-zone" @click="triggerFileUpload">
                        <span v-if="!uploadedImage">{{ translate('clickToUpload') }}</span>
                        <img v-else :src="uploadedImage" alt="Uploaded icon" />
                      </div>
                      <input
                        ref="fileInput"
                        type="file"
                        style="display: none"
                        accept="image/*"
                        @change="handleFileUpload"
                      />
                      <DsButton v-if="uploadedImage" variant="primary" class="btn-confirm" @click="confirmUpload">
                        {{ translate('useThisImage') }}
                      </DsButton>
                    </div>

                    <!-- Initials Option -->
                    <div v-if="iconTab === 'initials'" class="initials-selector">
                      <div class="initials-preview">
                        <div class="initials-icon" :style="{ backgroundColor: initialsColor }">
                          {{ getInitials(formData.personalIdentification.fullName) }}
                        </div>
                      </div>
                      <div class="color-selector">
                        <div
                          v-for="(color, index) in colorOptions"
                          :key="index"
                          class="color-option"
                          :style="{ backgroundColor: color }"
                          :class="{ selected: initialsColor === color }"
                          @click="initialsColor = color"
                        ></div>
                      </div>
                      <DsButton variant="primary" class="btn-confirm" @click="useInitials">
                        {{ translate('useInitials') }}
                      </DsButton>
                    </div>
                  </div>

                  <div class="icon-selector-footer">
                    <DsButton variant="secondary" class="btn-cancel" @click="closeIconSelector">
                      {{ translate('actions.cancel') }}
                    </DsButton>
                  </div>
                </div>
              </div>
            </div>
            <DsFormGroup>
              <label>{{ translate('fields.fullName') }}</label>
              <DsInput
                v-model="formData.personalIdentification.fullName"
                type="text"
                :placeholder="translate('placeholders.fullName')"
              />
            </DsFormGroup>
            <DsFormGroup>
              <label>{{ translate('fields.dob') }}</label>
              <DsInput v-model="formData.personalIdentification.dob" type="date" />
            </DsFormGroup>
            <DsFormGroup>
              <label>{{ translate('fields.gender') }}</label>
              <DsSelect v-model="formData.personalIdentification.gender" :placeholder="translate('select')">
                <option value="male">{{ translate('gender.male') }}</option>
                <option value="female">{{ translate('gender.female') }}</option>
                <option value="other">{{ translate('gender.other') }}</option>
                <option value="prefer-not-to-say">
                  {{ translate('gender.preferNot') }}
                </option>
              </DsSelect>
            </DsFormGroup>
            <DsFormGroup>
              <label>{{ translate('fields.nationality') }}</label>
              <searchable-country-dropdown
                ref="nationalityDropdown"
                v-model="formData.personalIdentification.nationality"
                :label="''"
                :placeholder="translate('placeholders.selectCountry')"
                :search-placeholder="translate('placeholders.searchCountries')"
                :no-results-text="translate('noMatchingCountries')"
                @update:name="updateNationalityName"
                @change="onNationalityChange"
              />
            </DsFormGroup>
          </div>

          <!-- Civil Registration & Documentation -->
          <div v-else-if="activeTab === 1">
            <DsFormGroup>
              <label>{{ translate('fields.birthCert') }}</label>
              <DsInput v-model="formData.civilRegistration.birthCert" type="text" />
            </DsFormGroup>
            <DsFormGroup>
              <label>{{ translate('fields.citizenship') }}</label>
              <DsInput v-model="formData.civilRegistration.citizenship" type="text" />
            </DsFormGroup>
            <DsFormGroup>
              <label>{{ translate('fields.immigration') }}</label>
              <DsInput v-model="formData.civilRegistration.immigration" type="text" />
            </DsFormGroup>
          </div>

          <!-- Address & Residency Information -->
          <div v-else-if="activeTab === 2">
            <DsFormGroup>
              <label>{{ translate('fields.currentAddress') }}</label>
              <DsInput v-model="formData.addressResidency.currentAddress" type="textarea" />
            </DsFormGroup>
            <DsFormGroup>
              <label>{{ translate('fields.postalCode') }}</label>
              <DsInput v-model="formData.addressResidency.postalCode" type="text" />
            </DsFormGroup>
            <DsFormGroup>
              <label>{{ translate('fields.country') }}</label>
              <searchable-country-dropdown
                ref="countryDropdown"
                v-model="formData.addressResidency.country"
                :label="''"
                :placeholder="translate('placeholders.selectCountry')"
                :search-placeholder="translate('placeholders.searchCountries')"
                :no-results-text="translate('noMatchingCountries')"
                @update:name="updateCountryName"
                @change="onCountryChange"
              />
            </DsFormGroup>
            <DsFormGroup>
              <label>{{ translate('fields.residencyStatus') }}</label>
              <DsSelect v-model="formData.addressResidency.residencyStatus">
                <option value="citizen">
                  {{ translate('residencyStatuses.citizen') }}
                </option>
                <option value="permanent-resident">
                  {{ translate('residencyStatuses.permanentResident') }}
                </option>
                <option value="temporary-resident">
                  {{ translate('residencyStatuses.temporaryResident') }}
                </option>
                <option value="other">
                  {{ translate('residencyStatuses.other') }}
                </option>
              </DsSelect>
            </DsFormGroup>
          </div>

          <!-- Identity & Travel Documents -->
          <div v-else-if="activeTab === 3">
            <DsFormGroup>
              <label>{{ translate('fields.idCard') }}</label>
              <DsInput v-model="formData.identityDocuments.idCard" type="text" />
            </DsFormGroup>
            <DsFormGroup>
              <label>{{ translate('fields.passport') }}</label>
              <DsInput v-model="formData.identityDocuments.passport" type="text" />
            </DsFormGroup>
            <DsFormGroup>
              <label>{{ translate('fields.driversLicense') }}</label>
              <DsInput v-model="formData.identityDocuments.driversLicense" type="text" />
            </DsFormGroup>
          </div>

          <!-- Health & Medical Records -->
          <div v-else-if="activeTab === 4">
            <DsFormGroup>
              <label>{{ translate('fields.bloodType') }}</label>
              <DsSelect v-model="formData.healthInfo.bloodType">
                <option value="a-positive">A+</option>
                <option value="a-negative">A-</option>
                <option value="b-positive">B+</option>
                <option value="b-negative">B-</option>
                <option value="ab-positive">AB+</option>
                <option value="ab-negative">AB-</option>
                <option value="o-positive">O+</option>
                <option value="o-negative">O-</option>
              </DsSelect>
            </DsFormGroup>
            <DsFormGroup>
              <label>{{ translate('fields.organDonor') }}</label>
              <DsSelect v-model="formData.healthInfo.organDonor">
                <option value="yes">{{ translate('yesNo.yes') }}</option>
                <option value="no">{{ translate('yesNo.no') }}</option>
              </DsSelect>
            </DsFormGroup>
          </div>

          <!-- Employment & Economic Data -->
          <div v-else-if="activeTab === 5">
            <DsFormGroup>
              <label>{{ translate('fields.eHistory') }}</label>
              <DsInput v-model="formData.employmentInfo.employmentHistory" type="text" />
            </DsFormGroup>
            <DsFormGroup>
              <label>{{ translate('fields.currentEmployer') }}</label>
              <DsInput v-model="formData.employmentInfo.currentEmployer" type="text" />
            </DsFormGroup>
            <DsFormGroup>
              <label>{{ translate('fields.tin') }}</label>
              <DsInput v-model="formData.employmentInfo.taxId" type="text" />
            </DsFormGroup>
          </div>

          <!-- Education & Academic Records -->
          <div v-else-if="activeTab === 6">
            <DsFormGroup>
              <label>{{ translate('fields.education') }}</label>
              <DsCombobox
                v-model="formData.educationRecords.education"
                :options="educationOptions"
                :placeholder="translate('placeholders.selectDiscipline')"
                :search-placeholder="translate('placeholders.searchDisciplines')"
                :no-results-text="translate('noMatchingDisciplines')"
              />
            </DsFormGroup>
            <DsFormGroup>
              <label>{{ translate('fields.degrees') }}</label>
              <DsCombobox
                v-model="formData.educationRecords.degrees"
                :options="degreeOptions"
                :placeholder="translate('placeholders.selectDegree')"
                :search-placeholder="translate('placeholders.searchDegrees')"
                :no-results-text="translate('noMatchingDegrees')"
              />
            </DsFormGroup>
            <DsFormGroup>
              <label>{{ translate('fields.certifications') }}</label>
              <DsInput v-model="formData.educationRecords.certifications" type="text" />
            </DsFormGroup>
            <DsFormGroup>
              <label>{{ translate('fields.academicRecords') }}</label>
              <DsInput v-model="formData.educationRecords.academicRecords" type="textarea" />
            </DsFormGroup>
          </div>

          <!-- Financial & Tax Data -->
          <div v-else-if="activeTab === 7">
            <DsFormGroup>
              <label>{{ translate('fields.incomeTax') }}</label>
              <DsInput v-model="formData.financialInfo.incomeTax" type="text" />
            </DsFormGroup>
            <DsFormGroup>
              <label>{{ translate('fields.bankAccounts') }}</label>
              <DsInput v-model="formData.financialInfo.bankAccounts" type="text" />
            </DsFormGroup>
          </div>
        </DsTabs>

        <!-- Action buttons -->
        <div class="actions">
          <DsButton variant="secondary" :disabled="isSubmitting" @click="$router.back()">
            {{ translate('actions.cancel') }}
          </DsButton>
          <DsButton variant="primary" class="save-btn" :disabled="isSubmitting" @click="saveProfile">
            {{ isSubmitting ? translate('actions.saving') : translate('actions.save') }}
          </DsButton>
        </div>
      </div>
      <confirm-dialog
        :visible="showConfirmDialog"
        :title="translate('confirmSaveTitle')"
        :message="translate('confirmSave')"
        :confirm-text="translate('actions.save')"
        :cancel-text="translate('actions.cancel')"
        @confirm="confirmSave"
        @cancel="cancelSave"
      />
    </div>
  </div>
</template>

<script>
import userProfileService from '@/services/userProfileService';
import notificationService from '@/services/notificationService';
import DsButton from './ds/Button.vue';
import DsSpinner from './ds/Spinner.vue';
import DsStateDisplay from './ds/StateDisplay.vue';
import DsTabs from './ds/Tabs.vue';
import DsFormGroup from './ds/FormGroup.vue';
import DsInput from './ds/Input.vue';
import DsSelect from './ds/Select.vue';
import DsCombobox from './ds/Combobox.vue';

import ConfirmDialog from '@/components/ConfirmDialog.vue';
import SearchableCountryDropdown from '@/components/SearchableCountryDropdown.vue';

export default {
  name: 'UserProfileComponent',
  components: {
    ConfirmDialog,
    SearchableCountryDropdown,
    DsButton,
    DsSpinner,
    DsStateDisplay,
    DsTabs,
    DsFormGroup,
    DsInput,
    DsSelect,
    DsCombobox
  },
  emits: ['save'],
  data() {
    return {
      activeTab: 0,
      tabs: [
        { key: 'personalIdentification' },
        { key: 'civilRegistration' },
        { key: 'addressResidency' },
        { key: 'identityDocuments' },
        { key: 'healthInfo' },
        { key: 'employmentInfo' },
        { key: 'educationRecords' },
        { key: 'financialInfo' }
      ],
      formData: {
        personalIdentification: {
          fullName: '',
          dob: '',
          gender: '',
          nationality: '',
          profileIcon: ''
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
        educationRecords: {
          education: '',
          degrees: '',
          certifications: '',
          academicRecords: ''
        },
        financialInfo: {
          incomeTax: '',
          bankAccounts: ''
        }
      },
      nationalityName: '',
      countryName: '',
      isLoading: false,
      errorMessage: null,

      isSubmitting: false,
      educationOptions: [],
      degreeOptions: [],
      showConfirmDialog: false,
      showIconSelector: false,
      iconTab: 'preset',
      presetIcons: [
        '/icons/profile1.png',
        '/icons/profile2.png',
        '/icons/profile3.png',
        '/icons/profile4.png',
        '/icons/profile5.png',
        '/icons/profile6.png',
        '/icons/profile7.png',
        '/icons/profile8.png'
      ],
      uploadedImage: null,
      initialsColor: '#4E97D1',
      colorOptions: [
        '#4E97D1', // Blue
        '#2ECC71', // Green
        '#E74C3C', // Red
        '#F39C12', // Orange
        '#9B59B6', // Purple
        '#1ABC9C', // Teal
        '#34495E', // Dark Blue
        '#D35400' // Burnt Orange
      ]
    };
  },
  computed: {
    profileTabs() {
      return this.tabs.map((tab, index) => ({
        label: this.translate(`tabs.tab${index + 1}`),
        value: index
      }));
    }
  },
  watch: {
    'formData.personalIdentification.nationality': {
      handler() {
        // Rely on SearchableCountryDropdown to emit the name via update:name
      },
      immediate: true
    },
    'formData.addressResidency.country': {
      handler() {
        // Rely on SearchableCountryDropdown to emit the name via update:name
      },
      immediate: true
    },
    '$i18n.locale'() {
      this.loadEducationOptions();
      this.loadDegreeOptions();
      this.refreshCountryDropdowns();
    },

    // Watch for tab changes to ensure dropdown state persists
    activeTab: {
      handler(newTabIndex) {
        // If we're switching to the Personal Identification tab (0)
        if (newTabIndex === 0 && this.formData.personalIdentification.nationality) {
          this.$nextTick(() => {
            setTimeout(() => {
              if (this.$refs.nationalityDropdown) {
                this.$refs.nationalityDropdown.manuallySetCountryName(this.formData.personalIdentification.nationality);
              }
            }, 50);
          });
        }

        // If we're switching to the Address & Residency tab (2)
        if (newTabIndex === 2 && this.formData.addressResidency.country) {
          this.$nextTick(() => {
            setTimeout(() => {
              if (this.$refs.countryDropdown) {
                this.$refs.countryDropdown.manuallySetCountryName(this.formData.addressResidency.country);
              }
            }, 50);
          });
        }
      }
    }
  },
  mounted() {
    this.loadEducationOptions();
    this.loadDegreeOptions();
    this.loadUserProfileData();
  },
  methods: {
    // Centralized translation function
    translate(key, fallback = '') {
      // Try direct path first
      const fullKey = key.startsWith('userProfile.') ? key : `userProfile.${key}`;

      // Next try with fields prefix if it's not already there
      let result;
      if (this.$te(fullKey)) {
        result = this.$t(fullKey);
      }
      // If the key doesn't contain "fields." already, try with it
      else if (!key.includes('fields.')) {
        const fieldsKey = `userProfile.fields.${key}`;
        if (this.$te(fieldsKey)) {
          result = this.$t(fieldsKey);
        }
      }

      return result || fallback || key;
    },
    onNationalityChange(code) {
      // Only update if we received a valid code
      if (code !== undefined) {
        this.formData.personalIdentification.nationality = code;
      }
    },

    onCountryChange(code) {
      // Only update if we received a valid code
      if (code !== undefined) {
        this.formData.addressResidency.country = code;
      }
    },

    updateNationalityName(name) {
      this.nationalityName = name || '';

      if (name && !this.formData.personalIdentification.nationality) {
        // Try to find the code from the name (this could be expanded if needed)
      }

      // Store this in localStorage to persist across tab changes
      if (name && this.formData.personalIdentification.nationality) {
        try {
          localStorage.setItem('user_nationality_name', name);
          localStorage.setItem('user_nationality_code', this.formData.personalIdentification.nationality);
        } catch (e) {
          console.error('Could not store nationality in localStorage', e);
        }
      }
    },

    updateCountryName(name) {
      this.countryName = name || '';

      if (name && !this.formData.addressResidency.country) {
        // Try to find the code from the name (this could be expanded if needed)
      }

      // Store this in localStorage to persist across tab changes
      if (name && this.formData.addressResidency.country) {
        try {
          localStorage.setItem('user_country_name', name);
          localStorage.setItem('user_country_code', this.formData.addressResidency.country);
        } catch (e) {
          console.error('Could not store country in localStorage', e);
        }
      }
    },

    refreshCountryDropdowns() {
      this.$nextTick(() => {
        // Refresh nationality dropdown if it exists
        if (this.$refs.nationalityDropdown) {
          this.$refs.nationalityDropdown.loadCountries();
          if (this.formData.personalIdentification.nationality) {
            setTimeout(() => {
              this.$refs.nationalityDropdown.manuallySetCountryName(this.formData.personalIdentification.nationality);
            }, 200);
          }
        }

        // Refresh country dropdown if it exists
        if (this.$refs.countryDropdown) {
          this.$refs.countryDropdown.loadCountries();
          if (this.formData.addressResidency.country) {
            setTimeout(() => {
              this.$refs.countryDropdown.manuallySetCountryName(this.formData.addressResidency.country);
            }, 200);
          }
        }
      });
    },

    // New method to restore country data after tab switching
    restoreCountryState() {
      // Try to restore from localStorage
      try {
        const nationalityCode = localStorage.getItem('user_nationality_code');
        const countryCode = localStorage.getItem('user_country_code');
        const nationalityName = localStorage.getItem('user_nationality_name');
        const countryName = localStorage.getItem('user_country_name');

        // Restore nationality if needed
        if (nationalityCode && this.activeTab === 0 && this.$refs.nationalityDropdown) {
          if (
            !this.formData.personalIdentification.nationality ||
            this.formData.personalIdentification.nationality !== nationalityCode
          ) {
            this.formData.personalIdentification.nationality = nationalityCode;
            this.nationalityName = nationalityName || '';
            this.$refs.nationalityDropdown.manuallySetCountryName(nationalityCode);
          }
        }

        // Restore country if needed
        if (countryCode && this.activeTab === 2 && this.$refs.countryDropdown) {
          if (!this.formData.addressResidency.country || this.formData.addressResidency.country !== countryCode) {
            this.formData.addressResidency.country = countryCode;
            this.countryName = countryName || '';
            this.$refs.countryDropdown.manuallySetCountryName(countryCode);
          }
        }
      } catch (e) {
        console.error('Error restoring country state from localStorage', e);
      }
    },

    updateCountryDisplay() {
      // This function ensures the country dropdowns properly display the correct values
      if (this.formData.personalIdentification.nationality) {
        // The SearchableCountryDropdown component will handle this through its value prop
      }

      if (this.formData.addressResidency.country) {
        // The SearchableCountryDropdown component will handle this through its value prop
      }
    },
    cancel() {
      this.$router.back();
    },
    saveProfile() {
      this.showConfirmDialog = true;
    },
    async confirmSave() {
      this.showConfirmDialog = false;
      this.isSubmitting = true;

      try {
        const validation = this.validateForm();

        if (!validation.isValid) {
          notificationService.error(this.translate('errors.invalidForm', 'Please fill all required fields'));
          return;
        }

        const profileData = JSON.parse(JSON.stringify(this.formData));

        if (this.formData.personalIdentification.nationality) {
          profileData.personalIdentification.nationality = this.formData.personalIdentification.nationality;
        }

        if (this.formData.addressResidency.country) {
          profileData.addressResidency.country = this.formData.addressResidency.country;
        }

        await userProfileService.updateProfile(profileData);

        notificationService.success(this.translate('saveSuccess', 'Profile saved successfully'));
        this.$emit('save', profileData);
        this.$router.push('/dashboard');
      } catch (error) {
        console.error('Error saving profile:', error);
        notificationService.error(this.translate('errors.savingFailed', 'Failed to save profile'));
      } finally {
        this.isSubmitting = false;
      }
    },
    cancelSave() {
      this.showConfirmDialog = false;
    },
    onFileChange(e, section, fieldKey) {
      const file = e.target.files[0];
      if (!file) return;

      const allowedTypes = ['image/jpeg', 'image/png', 'application/pdf'];
      const maxSize = 5 * 1024 * 1024; // 5MB

      if (!allowedTypes.includes(file.type)) {
        notificationService.error(this.translate('errors.invalidFileType', 'Invalid file type'));
        return;
      }

      if (file.size > maxSize) {
        notificationService.error(this.translate('errors.fileTooLarge', 'File is too large'));
        return;
      }

      this.formData[section][fieldKey] = file;
    },
    validateForm() {
      const validations = {
        personalIdentification: [
          { field: 'fullName', required: true },
          { field: 'dob', required: true }
        ]
      };

      const errors = {};

      Object.keys(validations).forEach((section) => {
        validations[section].forEach((validation) => {
          const value = this.formData[section][validation.field];
          if (validation.required && !value) {
            errors[`${section}.${validation.field}`] = this.translate('validation.nameRequired');
          }
        });
      });

      if (this.isTabComplete(this.activeTab)) {
        notificationService.info(this.translate('tabComplete', 'Tab completed!'), 1500);
      }

      return {
        isValid: Object.keys(errors).length === 0,
        errors
      };
    },
    isTabComplete(tabIndex) {
      const tab = this.tabs[tabIndex];
      if (!tab) return false;
      if (tab.key === 'personalIdentification') {
        return !!this.formData.personalIdentification.fullName && !!this.formData.personalIdentification.dob;
      }
      return true; // Other tabs considered complete for simplicity
    },
    async loadUserProfileData() {
      this.isLoading = true;
      this.errorMessage = null;
      try {
        const profileData = await userProfileService.getProfile();

        if (profileData) {
          // Extract the nationality and country codes before mapping other data
          const nationalityCode = profileData.personalIdentification?.nationality || '';
          const countryCode = profileData.addressResidency?.country || '';

          // Map profile data to form data
          Object.keys(this.formData).forEach((section) => {
            if (profileData[section]) {
              Object.keys(this.formData[section]).forEach((field) => {
                if (profileData[section][field] !== undefined) {
                  this.formData[section][field] = profileData[section][field];
                }
              });
            }
          });

          // Store country values to localStorage for tab-switching persistence
          try {
            if (nationalityCode) {
              localStorage.setItem('user_nationality_code', nationalityCode);
            }
            if (countryCode) {
              localStorage.setItem('user_country_code', countryCode);
            }
          } catch (e) {
            console.error('Could not store country codes in localStorage', e);
          }

          // Ensuring the country dropdowns get initialized with their values
          this.$nextTick(() => {
            // Set nationality dropdown with a delay to ensure component is mounted
            setTimeout(() => {
              if (nationalityCode && this.$refs.nationalityDropdown) {
                this.$refs.nationalityDropdown.manuallySetCountryName(nationalityCode);
              }

              if (countryCode && this.$refs.countryDropdown) {
                this.$refs.countryDropdown.manuallySetCountryName(countryCode);
              }
            }, 300); // Small delay to ensure components are ready
          });
        }
      } catch (error) {
        console.error('Error loading user profile:', error);
        this.errorMessage = this.translate('errors.loadingFailed', 'Failed to load profile data');
      } finally {
        this.isLoading = false;
      }
    },
    retryLoading() {
      this.loadUserProfileData();
    },
    loadDegreeOptions() {
      const defaultOptions = this.translate('degreeOptions', [
        'Associate Degree',
        'Bachelor of Arts (BA)',
        'Bachelor of Science (BS)',
        'Bachelor of Engineering (BEng)',
        'Bachelor of Business Administration (BBA)',
        'Bachelor of Fine Arts (BFA)',
        'Bachelor of Education (BEd)',
        'Bachelor of Medicine (MBBS)',
        'Bachelor of Laws (LLB)',
        'Master of Arts (MA)',
        'Master of Science (MS)',
        'Master of Business Administration (MBA)',
        'Master of Engineering (MEng)',
        'Master of Fine Arts (MFA)',
        'Master of Education (MEd)',
        'Master of Laws (LLM)',
        'Master of Public Health (MPH)',
        'Doctor of Philosophy (PhD)',
        'Doctor of Medicine (MD)',
        'Doctor of Education (EdD)',
        'Doctor of Business Administration (DBA)',
        'Doctor of Jurisprudence (JD)',
        'Professional Diploma',
        'Technical Diploma',
        'Vocational Certificate',
        'Graduate Certificate',
        'Post-Graduate Diploma',
        'Post-Doctoral'
      ]);

      this.degreeOptions = Array.isArray(defaultOptions) ? defaultOptions : [];
      const locale = this.$i18n ? this.$i18n.locale : 'en';
      this.degreeOptions.sort((a, b) => a.localeCompare(b, locale));
    },
    loadEducationOptions() {
      const defaultOptions = this.translate('educationOptions', [
        'Accounting',
        'Aerospace Engineering',
        'Agricultural Science',
        'Anthropology',
        'Architecture',
        'Art History',
        'Artificial Intelligence',
        'Astronomy',
        'Astrophysics',
        'Biochemistry',
        'Biomedical Engineering',
        'Biotechnology',
        'Business Administration',
        'Chemical Engineering',
        'Chemistry',
        'Civil Engineering',
        'Communications',
        'Computer Engineering',
        'Computer Science',
        'Construction Management',
        'Criminal Justice',
        'Cybersecurity',
        'Data Science',
        'Dentistry',
        'Economics',
        'Education',
        'Electrical Engineering',
        'Elementary Education',
        'English Literature',
        'Environmental Engineering',
        'Environmental Science',
        'Fashion Design',
        'Film Studies',
        'Finance',
        'Fine Arts',
        'Food Science',
        'Forensic Science',
        'Game Design',
        'Geography',
        'Geology',
        'Graphic Design',
        'Health Administration',
        'History',
        'Hospitality Management',
        'Human Resources',
        'Industrial Design',
        'Industrial Engineering',
        'Information Systems',
        'Information Technology',
        'Interior Design',
        'International Business',
        'International Relations',
        'Journalism',
        'Law',
        'Library Science',
        'Linguistics',
        'Management',
        'Marketing',
        'Materials Science',
        'Mathematics',
        'Mechanical Engineering',
        'Media Studies',
        'Medicine',
        'Meteorology',
        'Microbiology',
        'Music',
        'Nanotechnology',
        'Nursing',
        'Nutrition',
        'Occupational Therapy',
        'Oceanography',
        'Petroleum Engineering',
        'Pharmacy',
        'Philosophy',
        'Photography',
        'Physical Education',
        'Physical Therapy',
        'Physics',
        'Political Science',
        'Psychology',
        'Public Administration',
        'Public Health',
        'Public Relations',
        'Robotics',
        'Secondary Education',
        'Social Work',
        'Sociology',
        'Software Engineering',
        'Special Education',
        'Sports Management',
        'Statistics',
        'Systems Engineering',
        'Theatre Arts',
        'Tourism',
        'Urban Planning',
        'Veterinary Medicine',
        'Web Development',
        'Wildlife Biology',
        'Zoology'
      ]);

      this.educationOptions = Array.isArray(defaultOptions) ? defaultOptions : [];
      const locale = this.$i18n ? this.$i18n.locale : 'en';
      this.educationOptions.sort((a, b) => a.localeCompare(b, locale));
    },
    openIconSelector() {
      this.showIconSelector = true;
    },
    closeIconSelector() {
      this.showIconSelector = false;
      this.uploadedImage = null;
    },
    getInitials(name) {
      if (!name) return '?';
      return name
        .split(' ')
        .map((n) => n[0])
        .join('')
        .toUpperCase()
        .substring(0, 2);
    },
    selectPresetIcon(icon) {
      this.formData.personalIdentification.profileIcon = icon;
      this.closeIconSelector();
    },
    triggerFileUpload() {
      this.$refs.fileInput.click();
    },
    handleFileUpload(event) {
      const file = event.target.files[0];
      if (!file) return;

      const validTypes = ['image/jpeg', 'image/png', 'image/gif'];
      if (!validTypes.includes(file.type)) {
        notificationService.error(
          this.translate('errors.invalidFileType', 'Please upload a valid image (JPEG, PNG, GIF)')
        );
        return;
      }

      if (file.size > 2 * 1024 * 1024) {
        notificationService.error(this.translate('errors.fileTooLarge', 'Image size must be less than 2MB'));
        return;
      }

      const reader = new FileReader();
      reader.onload = (e) => {
        this.uploadedImage = e.target.result;
      };
      reader.readAsDataURL(file);
    },
    confirmUpload() {
      this.formData.personalIdentification.profileIcon = this.uploadedImage;
      this.closeIconSelector();
    },
    useInitials() {
      const canvas = document.createElement('canvas');
      const size = 200;
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext('2d');

      ctx.fillStyle = this.initialsColor;
      ctx.fillRect(0, 0, size, size);

      ctx.fillStyle = '#ffffff'; // Canvas text color (cannot use CSS vars in canvas context)
      ctx.font = 'bold 80px Arial';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(this.getInitials(this.formData.personalIdentification.fullName), size / 2, size / 2);

      this.formData.personalIdentification.profileIcon = canvas.toDataURL('image/png');
      this.closeIconSelector();
    }
  }
};
</script>

<style scoped>
/* Base Modal Styling */
.user-profile-page {
  background: var(--bg);
  color: var(--fg);
  height: calc(100vh - 60px - var(--space-sm) * 2);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.profile-content {
  padding: var(--space-lg);
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.profile-main {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

/* Title and Info Styling - add explicit color */
h2 {
  color: var(--fg);
  margin-bottom: var(--space-sm);
}

.privacy-info {
  font-size: var(--text-base);
  margin-bottom: var(--space-md);
  color: var(--muted);
}

/* Tabs Styling - overrides for DsTabs card-like style */
.user-profile-page :deep(.ds-tabs) {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
}

.user-profile-page :deep(.ds-tabs__nav) {
  display: flex;
  flex-wrap: wrap;
  border-bottom: 1px solid var(--border-light);
}

.user-profile-page :deep(.ds-tabs__btn) {
  margin-right: var(--space-xs);
  padding: var(--space-sm) var(--space-md);
  background-color: var(--surface);
  color: var(--fg);
  border: 1px solid var(--border-light);
  border-bottom: none;
  border-radius: var(--radius-sm) var(--radius-sm) 0 0;
  white-space: nowrap;
}

.user-profile-page :deep(.ds-tabs__btn:hover) {
  background-color: var(--bg);
}

.user-profile-page :deep(.ds-tabs__btn--active) {
  background-color: var(--accent-muted);
  color: var(--fg);
  border-bottom: 2px solid var(--accent);
  font-weight: bold;
}

/* Tab content area */
.user-profile-page :deep(.ds-tabs__content) {
  border: 1px solid var(--border-light);
  border-top: none;
  padding: var(--space-sm);
  border-radius: 0 0 var(--radius-sm) var(--radius-sm);
  background-color: var(--surface);
  overflow-y: auto;
}

/* Action Buttons Styling */
.actions {
  margin-top: var(--space-lg);
  text-align: right;
  display: flex;
  justify-content: flex-end;
  gap: var(--space-sm);
  flex-shrink: 0;
}

.retry-btn {
  /* Layout only - styling handled by DsButton */
}

/* Disabled button styles are handled by DsButton */

/* Add a subtle border to the sections */

/* Better spacing */
.user-profile-page :deep(.ds-form-group) {
  margin-bottom: 18px;
  padding-bottom: var(--space-sm);
  border-bottom: 1px solid var(--border-light);
}

/* Improved typography */
.user-profile-page :deep(.ds-form-group label) {
  font-weight: 500;
  margin-bottom: var(--space-sm);
  font-size: var(--text-base);
  color: var(--fg);
}

/* Make the title more prominent */
h2 {
  font-size: var(--text-xl);
  margin-bottom: var(--space-md);
  border-bottom: 1px solid var(--border-light);
  padding-bottom: var(--space-md);
}

/* Slight animation on buttons */
.cancel-btn,
.save-btn {
  transition: transform 0.1s ease;
}

.cancel-btn:hover,
.save-btn:hover {
  transform: translateY(-1px);
}

/* Add icon styles for fields that could benefit from them */
.user-profile-page :deep(.ds-input[type='date']) {
  position: relative;
  padding-right: 30px; /* Space for calendar icon */
}

/* Add a subtle border to the active tab's content area */
.user-profile-page :deep(.ds-tabs__content) {
  padding: var(--space-md);
}

/* Better button styling */
.save-btn {
  padding: var(--space-sm) var(--space-lg);
  font-weight: 500;
  letter-spacing: 0.3px;
}

.cancel-btn {
  background-color: transparent;
  border: 1px solid var(--btn-secondary-bg);
}

/* Better hover effects */
.save-btn:hover {
  background-color: var(--accent-hover);
  box-shadow: var(--shadow-sm);
}

/* Profile Icon Styles */
.profile-icon-section {
  margin-bottom: var(--space-lg);
}

.profile-icon-container {
  display: flex;
  align-items: center;
  margin-top: var(--space-sm);
}

.current-icon {
  width: 80px;
  height: 80px;
  border-radius: 50%;
  overflow: hidden;
  position: relative;
  cursor: pointer;
  background-color: var(--btn-secondary-bg);
}

.current-icon img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.icon-placeholder {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: var(--text-2xl);
  font-weight: bold;
  color: var(--accent-fg);
}

.icon-overlay {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  background-color: var(--overlay-bg);
  color: var(--accent-fg);
  display: flex;
  align-items: center;
  justify-content: center;
  opacity: 0;
  transition: opacity 0.2s;
}

.current-icon:hover .icon-overlay {
  opacity: 1;
}

/* Icon Selector Modal */
.icon-selector-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background-color: var(--overlay-bg);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 11000;
}

.icon-selector-modal {
  background-color: var(--surface);
  border-radius: var(--radius-lg);
  width: 90%;
  max-width: 500px;
  max-height: 90vh;
  overflow-y: auto;
  padding: var(--space-lg);
  box-shadow: var(--shadow-lg);
}

.icon-selector-modal h4 {
  margin-top: 0;
  margin-bottom: var(--space-md);
  color: var(--fg);
}

.icon-tabs {
  display: flex;
  border-bottom: 1px solid var(--border-light);
  margin-bottom: var(--space-md);
}

.icon-tabs button {
  padding: var(--space-sm) var(--space-md);
  background: none;
  border: none;
  cursor: pointer;
  font-size: var(--text-base);
  color: var(--fg);
}

.icon-tabs button.active {
  border-bottom: 2px solid var(--accent);
  color: var(--accent);
}

.upload-zone {
  border: 2px dashed var(--border-light);
  border-radius: var(--radius-lg);
  height: 150px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  margin-bottom: var(--space-md);
  position: relative;
  color: var(--fg);
}

.icon-content {
  min-height: 250px;
}

/* Preset Icons */
.preset-icons {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: var(--space-md);
  margin-bottom: var(--space-md);
}

.preset-icon {
  width: 70px;
  height: 70px;
  border-radius: 50%;
  overflow: hidden;
  cursor: pointer;
  border: 2px solid transparent;
  transition: border-color 0.2s;
}

.preset-icon img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.preset-icon.selected,
.preset-icon:hover {
  border-color: var(--accent);
}

/* Upload Zone */

.upload-zone img {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
}

/* Initials Selector */
.initials-selector {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-md);
}

.initials-preview {
  margin-bottom: var(--space-sm);
}

.initials-icon {
  width: 100px;
  height: 100px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: var(--text-3xl);
  font-weight: bold;
  color: var(--accent-fg);
}

.color-selector {
  display: flex;
  gap: var(--space-sm);
  flex-wrap: wrap;
  justify-content: center;
  margin-bottom: var(--space-md);
}

.color-option {
  width: 30px;
  height: 30px;
  border-radius: 50%;
  cursor: pointer;
  border: 2px solid transparent;
  transition: transform 0.2s;
}

.color-option:hover {
  transform: scale(1.1);
}

.color-option.selected {
  border-color: var(--fg);
  transform: scale(1.1);
}

.icon-selector-footer {
  display: flex;
  justify-content: flex-end;
  margin-top: var(--space-lg);
}

.btn-confirm {
  /* Layout only - styling handled by DsButton primary */
}

.btn-cancel {
  /* Layout only - styling handled by DsButton secondary */
  margin-left: var(--space-sm);
}
</style>
