<template>
  <div class="user-profile-modal" :style="dialogThemeStyles" :data-themed="isThemeReady" ref="modalContainer">
    <div class="overlay" @click="cancel"></div>
    <div class="modal-content">
      <h2 :data-themed="isThemeReady">{{ $t('userProfile.title') }}</h2>

      <!-- Loading Indicator -->
      <div v-if="isLoading" class="loading-overlay">
        <div class="loading-spinner"></div>
        <p>{{ $t('userProfile.loading', 'Loading user profile...') }}</p>
      </div>

      <!-- Error Message -->
      <div v-else-if="errorMessage" class="error-container">
        <p class="error-message">{{ errorMessage }}</p>
        <button @click="retryLoading" class="retry-btn">
          {{ $t('userProfile.retry', 'Retry') }}
        </button>
      </div>

      <!-- Main content - shown when not loading and no errors -->
      <div v-else>
        <p class="privacy-info" :data-themed="isThemeReady">
          {{ $t('userProfile.privacyInfo') }}
          <a href="#" class="privacy-link">{{ $t('userProfile.privacyPolicyLink') }}</a>
        </p>

        <!-- Tabs -->
        <div class="tabs">
          <button v-for="(tab, index) in tabs" :key="index" :class="{ active: activeTab === index }"
            @click="activeTab = index">
            {{ $t(`userProfile.tabs.tab${index+1}`) }}
          </button>
        </div>

        <!-- Tab content -->
        <div class="tab-content">
          <!-- Personal Identification Data -->
          <div v-if="activeTab === 0">
            <!-- Add this at the top of the Personal Identification tab content -->
            <div class="profile-icon-section">
              <label>Profile Icon</label>
              <div class="profile-icon-container">
                <div class="current-icon" @click="openIconSelector">
                  <img v-if="formData.personalIdentification.profileIcon"
                    :src="formData.personalIdentification.profileIcon" alt="Profile icon" />
                  <div v-else class="icon-placeholder">
                    {{ getInitials(formData.personalIdentification.fullName) }}
                  </div>
                  <div class="icon-overlay">
                    <span>Change</span>
                  </div>
                </div>
              </div>

              <!-- Icon Selection Modal -->
              <div v-if="showIconSelector" class="icon-selector-overlay" @click="closeIconSelector">
                <div class="icon-selector-modal" @click.stop>
                  <h4>Choose a Profile Icon</h4>

                  <div class="icon-tabs">
                    <button :class="{ active: iconTab === 'preset' }" @click="iconTab = 'preset'">Preset Icons</button>
                    <button :class="{ active: iconTab === 'upload' }" @click="iconTab = 'upload'">Upload</button>
                    <button :class="{ active: iconTab === 'initials' }" @click="iconTab = 'initials'">Initials</button>
                  </div>

                  <div class="icon-content">
                    <!-- Preset Icons -->
                    <div v-if="iconTab === 'preset'" class="preset-icons">
                      <div v-for="(icon, index) in presetIcons" :key="index" class="preset-icon"
                        :class="{ selected: formData.personalIdentification.profileIcon === icon }"
                        @click="selectPresetIcon(icon)">
                        <img :src="icon" alt="Preset icon" />
                      </div>
                    </div>

                    <!-- Upload Option -->
                    <div v-if="iconTab === 'upload'" class="upload-icon">
                      <div class="upload-zone" @click="triggerFileUpload">
                        <span v-if="!uploadedImage">Click to upload</span>
                        <img v-else :src="uploadedImage" alt="Uploaded icon" />
                      </div>
                      <input type="file" ref="fileInput" style="display:none" accept="image/*"
                        @change="handleFileUpload" />
                      <button v-if="uploadedImage" class="btn-confirm" @click="confirmUpload">Use This Image</button>
                    </div>

                    <!-- Initials Option -->
                    <div v-if="iconTab === 'initials'" class="initials-selector">
                      <div class="initials-preview">
                        <div class="initials-icon" :style="{ backgroundColor: initialsColor }">
                          {{ getInitials(formData.personalIdentification.fullName) }}
                        </div>
                      </div>
                      <div class="color-selector">
                        <div v-for="(color, index) in colorOptions" :key="index" class="color-option"
                          :style="{ backgroundColor: color }" :class="{ selected: initialsColor === color }"
                          @click="initialsColor = color"></div>
                      </div>
                      <button class="btn-confirm" @click="useInitials">Use Initials</button>
                    </div>
                  </div>

                  <div class="icon-selector-footer">
                    <button class="btn-cancel" @click="closeIconSelector">Cancel</button>
                  </div>
                </div>
              </div>
            </div>
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

          <!-- Education & Academic Records -->
          <div v-else-if="activeTab === 6">
            <div class="field-group">
              <label>{{ $t('userProfile.fields.education', 'Education') }}</label>
              <div class="select-wrapper">
                <input v-if="showEducationSearch" type="text" v-model="educationSearchTerm" class="search-input"
                  :placeholder="$t('userProfile.placeholders.searchDisciplines', 'Search disciplines...')"
                  @input="filterEducationOptions" @blur="handleEducationBlur"
                  @keydown.enter="selectFirstEducationOption" @keydown.down="navigateEducationOptions(1)"
                  @keydown.up="navigateEducationOptions(-1)" ref="educationSearchInput" />
                <div v-else class="selected-option" @click="toggleEducationSearch">
                  {{ formData.educationRecords.education || $t('userProfile.placeholders.selectDiscipline', 'Select a discipline') }}
                </div>
                <div v-if="showEducationSearch" class="options-dropdown">
                  <div v-for="(option, index) in filteredEducationOptions" :key="index" class="option"
                    :class="{ 'active': index === selectedEducationIndex }" @click="selectEducationOption(option)"
                    @mouseenter="selectedEducationIndex = index">
                    {{ option }}
                  </div>
                  <div v-if="filteredEducationOptions.length === 0" class="no-results">
                    {{ $t('userProfile.noMatchingDisciplines', 'No matching disciplines found') }}
                  </div>
                </div>
              </div>
            </div>
            <div class="field-group">
              <label>{{ $t('userProfile.fields.degrees', 'Degrees') }}</label>
              <div class="select-wrapper">
                <input v-if="showDegreeSearch" type="text" v-model="degreeSearchTerm" class="search-input"
                  :placeholder="$t('userProfile.placeholders.searchDegrees', 'Search degrees...')"
                  @input="filterDegreeOptions" @blur="handleDegreeBlur" @keydown.enter="selectFirstDegreeOption"
                  @keydown.down="navigateDegreeOptions(1)" @keydown.up="navigateDegreeOptions(-1)"
                  ref="degreeSearchInput" />
                <div v-else class="selected-option" @click="toggleDegreeSearch">
                  {{ formData.educationRecords.degrees || $t('userProfile.placeholders.selectDegree', 'Select a degree')
                  }}
                </div>
                <div v-if="showDegreeSearch" class="options-dropdown">
                  <div v-for="(option, index) in filteredDegreeOptions" :key="index" class="option"
                    :class="{ 'active': index === selectedDegreeIndex }" @click="selectDegreeOption(option)"
                    @mouseenter="selectedDegreeIndex = index">
                    {{ option }}
                  </div>
                  <div v-if="filteredDegreeOptions.length === 0" class="no-results">
                    {{ $t('userProfile.noMatchingDegrees', 'No matching degrees found') }}
                  </div>
                </div>
              </div>
            </div>
            <div class="field-group">
              <label>{{ $t('userProfile.fields.certifications', 'Certifications') }}</label>
              <input v-model="formData.educationRecords.certifications" type="text" />
            </div>
            <div class="field-group">
              <label>{{ $t('userProfile.fields.academicRecords', 'Academic Records') }}</label>
              <textarea v-model="formData.educationRecords.academicRecords"></textarea>
            </div>
          </div>

          <!-- Financial & Tax Data -->
          <div v-else-if="activeTab === 7">
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
          <button class="cancel-btn" @click="cancel" :disabled="isSubmitting">
            {{ $t('userProfile.actions.cancel') }}
          </button>
          <button class="save-btn" @click="saveProfile" :disabled="isSubmitting">
            {{ isSubmitting ? $t('userProfile.actions.saving', 'Saving...') : $t('userProfile.actions.save') }}
          </button>
        </div>
      </div>
    </div>
    <confirm-dialog :visible="showConfirmDialog" :title="$t('userProfile.confirmSaveTitle', 'Save Profile')"
      :message="$t('userProfile.confirmSave', 'Are you sure you want to save these changes?')"
      :confirm-text="$t('userProfile.actions.save', 'Save')" :cancel-text="$t('userProfile.actions.cancel', 'Cancel')"
      :theme="isDarkMode ? 'dark' : 'light'" :parent-styles="dialogThemeStyles" @confirm="confirmSave"
      @cancel="cancelSave" />
  </div>
</template>

<script>
import userProfileService from '@/services/userProfileService';
import userService from '@/services/userService';
import notificationService from '@/services/notificationService';
import ConfirmDialog from '@/components/ConfirmDialog.vue';

export default {
  name: 'UserProfileComponent',
  components: {
    ConfirmDialog
  },
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
        { key: 'educationRecords' },   // Education tab
        { key: 'financialInfo' }       // Financial tab
      ],
      formData: {
        personalIdentification: {
          fullName: '',
          dob: '',
          gender: '',
          nationality: '',
          profileIcon: '' // Add this line
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
        educationRecords: {       // Education Records section
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
      // API integration properties
      isLoading: false,
      errorMessage: null,
      currentUserId: '',
      isSubmitting: false,

      // Education dropdown properties
      showEducationSearch: false,
      educationSearchTerm: '',
      educationOptions: [],
      filteredEducationOptions: [],
      selectedEducationIndex: -1,

      // Education and degrees dropdown properties
      degreeOptions: [],
      showDegreeSearch: false,
      degreeSearchTerm: '',
      filteredDegreeOptions: [],
      selectedDegreeIndex: -1,
 
      // The conformation dialog
      showConfirmDialog: false,

          // Profile icon properties
      showIconSelector: false,
      iconTab: 'preset',
      presetIcons: [
        '/assets/icons/profile1.png',
        '/assets/icons/profile2.png',
        '/assets/icons/profile3.png',
        '/assets/icons/profile4.png',
        '/assets/icons/profile5.png',
        '/assets/icons/profile6.png',
        '/assets/icons/profile7.png',
        '/assets/icons/profile8.png',
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
        '#D35400'  // Burnt Orange
      ]
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
      console.log('Save profile button clicked');
      
      // Instead of browser confirm, show custom dialog
      this.showConfirmDialog = true;
    },
    
    async confirmSave() {
      this.showConfirmDialog = false;
      this.isSubmitting = true;
      console.log('Submitting form, currentUserId:', this.currentUserId);

      try {
        // Validation and save logic (your existing code)
        const validation = this.validateForm();
        console.log('Form validation result:', validation);

        if (!validation.isValid) {
          // Error handling code
          return;
        }

        // Create a deep copy to avoid mutation
        const profileData = JSON.parse(JSON.stringify(this.formData));
        console.log('Profile data to submit:', profileData);

        // Call the API to update the profile
        const result = await userProfileService.updateProfile(this.currentUserId, profileData);
        console.log('Update profile API response:', result);

        // Use notification service for success message
        notificationService.success(this.$t('userProfile.saveSuccess', 'Profile saved successfully'));

        // Emit save event
        this.$emit('save', profileData);
      } catch (error) {
        console.error('Error saving profile:', error);
        notificationService.error(this.$t('userProfile.errors.savingFailed', 'Failed to save profile'));
      } finally {
        this.isSubmitting = false;
      }
    },
    
    cancelSave() {
      this.showConfirmDialog = false;
      console.log('User cancelled save operation');
    },

    onFileChange(e, section, fieldKey) {
      const file = e.target.files[0];
      if (!file) return;

      // Validate file type and size
      const allowedTypes = ['image/jpeg', 'image/png', 'application/pdf'];
      const maxSize = 5 * 1024 * 1024; // 5MB

      if (!allowedTypes.includes(file.type)) {
        //this.$emit('error', this.$t('userProfile.errors.invalidFileType'));
        notificationService.error(this.$t('userProfile.errors.invalidFileType'));
        return;
      }

      if (file.size > maxSize) {
        //this.$emit('error', this.$t('userProfile.errors.fileTooLarge'));
        notificationService.error(this.$t('userProfile.errors.fileTooLarge'));
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

      if (this.isTabComplete(this.activeTab)) {
        notificationService.info(this.$t('userProfile.tabComplete', 'Tab completed!'), 1500);
      }

      return {
        isValid: Object.keys(errors).length === 0,
        errors
      };
    },

    // Add this method to your component
    isTabComplete(tabIndex) {
      // Check if all required fields in this tab are filled
      // Return true or false
      const tab = this.tabs[tabIndex];
      if (!tab) return false;

      const sectionKey = tab.key;
      // Basic implementation - consider all tabs complete for now
      return true;
    },

    // Get current user ID
    getCurrentUserId() {
      try {
        // First try to get from cached user data (fast)
        const userData = userService.getCurrentUser();

        if (!userData) {
          console.error('No user data available');
          return '';
        }

        // Extract the numeric ID part if it includes 'users/' prefix
        let userId = userData.id || userData.userId || userData._id || '';

        // Remove 'users/' prefix if present
        if (typeof userId === 'string' && userId.includes('/')) {
          userId = userId.split('/').pop();
        }

        return userId;
      } catch (error) {
        console.error('Error getting current user ID:', error);
        return '';
      }
    },

    // Load user profile data from the API
    async loadUserProfileData() {
      this.isLoading = true;
      this.errorMessage = null;

      try {
        // Get the current user ID
        this.currentUserId = this.getCurrentUserId();

        if (!this.currentUserId) {
          throw new Error('Unable to determine current user ID');
        }

        // Fetch user profile data from the API
        const profileData = await userProfileService.getProfile(this.currentUserId);

        // Populate the form with received data
        if (profileData) {
          // Loop through each section in our form data
          Object.keys(this.formData).forEach(section => {
            // Check if this section exists in the API response
            if (profileData[section]) {
              // Loop through each field in this section
              Object.keys(this.formData[section]).forEach(field => {
                // If this field exists in the API response, update our form
                if (profileData[section][field] !== undefined) {
                  this.formData[section][field] = profileData[section][field];
                }
              });
            }
          });
        }
      } catch (error) {
        console.error('Error loading user profile:', error);
        this.errorMessage = this.$t('userProfile.errors.loadingFailed', 'Failed to load profile data');
      } finally {
        this.isLoading = false;
      }
    },

    // Handle retry when loading fails
    retryLoading() {
      this.loadUserProfileData();
    },

    // 2. Add this method to load degree options (similar to education options):
    loadDegreeOptions() {
      // Default degree options if translations are not available
      const defaultOptions = [
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
      ];

      // Get translations or fallback to default options
      this.degreeOptions = this.$te('userProfile.degreeOptions')
        ? this.$t('userProfile.degreeOptions')
        : defaultOptions;

      // Sort options alphabetically according to current locale
      if (Array.isArray(this.degreeOptions) && this.degreeOptions.length > 0) {
        const locale = this.$i18n ? this.$i18n.locale : 'en';
        this.degreeOptions.sort((a, b) => a.localeCompare(b, locale));
      }
    },

    // 3. Add these methods to handle degree dropdown:
    toggleDegreeSearch() {
      this.showDegreeSearch = true;
      this.degreeSearchTerm = this.formData.educationRecords.degrees || '';
      this.filterDegreeOptions();
      this.$nextTick(() => {
        if (this.$refs.degreeSearchInput) {
          this.$refs.degreeSearchInput.focus();
        }
      });
    },

    filterDegreeOptions() {
      if (!this.degreeSearchTerm) {
        this.filteredDegreeOptions = [...this.degreeOptions];
      } else {
        const searchTerm = this.degreeSearchTerm.toLowerCase();
        this.filteredDegreeOptions = this.degreeOptions.filter(option =>
          option.toLowerCase().includes(searchTerm)
        );
      }
      this.selectedDegreeIndex = -1;
    },

    selectDegreeOption(option) {
      this.formData.educationRecords.degrees = option;
      this.showDegreeSearch = false;
    },

    handleDegreeBlur(event) {
      // Check if related target is inside the dropdown
      if (!event.relatedTarget ||
        (event.relatedTarget && !event.relatedTarget.closest('.options-dropdown'))) {
        setTimeout(() => {
          this.showDegreeSearch = false;
        }, 150);
      }
    },

    selectFirstDegreeOption() {
      if (this.filteredDegreeOptions.length > 0) {
        this.selectDegreeOption(this.filteredDegreeOptions[0]);
      }
    },

    navigateDegreeOptions(direction) {
      const optionsLength = this.filteredDegreeOptions.length;
      if (optionsLength > 0) {
        // Calculate new index with wrapping
        this.selectedDegreeIndex =
          (this.selectedDegreeIndex + direction + optionsLength) % optionsLength;

        // If an option is selected with keyboard, use Enter to select it
        if (this.selectedDegreeIndex >= 0 && this.selectedDegreeIndex < optionsLength) {
          // Keep focus on the input
          this.$refs.degreeSearchInput.focus();
        }
      }
    },

    // Load education options from i18n
    loadEducationOptions() {
      // Default education options if translations are not available
      const defaultOptions = [
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
      ];

      // Get translations or fallback to default options
      this.educationOptions = this.$te('userProfile.educationOptions')
        ? this.$t('userProfile.educationOptions')
        : defaultOptions;

      // Sort options alphabetically according to current locale
      if (Array.isArray(this.educationOptions) && this.educationOptions.length > 0) {
        const locale = this.$i18n ? this.$i18n.locale : 'en';
        this.educationOptions.sort((a, b) => a.localeCompare(b, locale));
      }
    },

    // Education dropdown methods
    toggleEducationSearch() {
      this.showEducationSearch = true;
      this.educationSearchTerm = this.formData.educationRecords.education || '';
      this.filterEducationOptions();
      this.$nextTick(() => {
        if (this.$refs.educationSearchInput) {
          this.$refs.educationSearchInput.focus();
        }
      });
    },

    filterEducationOptions() {
      if (!this.educationSearchTerm) {
        this.filteredEducationOptions = [...this.educationOptions];
      } else {
        const searchTerm = this.educationSearchTerm.toLowerCase();
        this.filteredEducationOptions = this.educationOptions.filter(option =>
          option.toLowerCase().includes(searchTerm)
        );
      }
      this.selectedEducationIndex = -1;
    },

    selectEducationOption(option) {
      this.formData.educationRecords.education = option;
      this.showEducationSearch = false;
    },

    handleEducationBlur(event) {
      // Check if related target is inside the dropdown
      if (!event.relatedTarget ||
        (event.relatedTarget && !event.relatedTarget.closest('.options-dropdown'))) {
        setTimeout(() => {
          this.showEducationSearch = false;
        }, 150);
      }
    },

    selectFirstEducationOption() {
      if (this.filteredEducationOptions.length > 0) {
        this.selectEducationOption(this.filteredEducationOptions[0]);
      }
    },

    navigateEducationOptions(direction) {
      const optionsLength = this.filteredEducationOptions.length;
      if (optionsLength > 0) {
        // Calculate new index with wrapping
        this.selectedEducationIndex =
          (this.selectedEducationIndex + direction + optionsLength) % optionsLength;

        // If an option is selected with keyboard, use Enter to select it
        if (this.selectedEducationIndex >= 0 && this.selectedEducationIndex < optionsLength) {
          // Keep focus on the input
          this.$refs.educationSearchInput.focus();
        }
      }
    },

      // Icon selector methods
  openIconSelector() {
    this.showIconSelector = true;
  },
  
  closeIconSelector() {
    this.showIconSelector = false;
    this.uploadedImage = null;
  },
  
  getInitials(name) {
    if (!name) return '?';
    return name.split(' ')
      .map(n => n[0])
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
    
    // File validation
    const validTypes = ['image/jpeg', 'image/png', 'image/gif'];
    if (!validTypes.includes(file.type)) {
      notificationService.error('Please upload a valid image (JPEG, PNG, GIF)');
      return;
    }
    
    if (file.size > 2 * 1024 * 1024) { // 2MB limit
      notificationService.error('Image size must be less than 2MB');
      return;
    }
      // Create preview
      const reader = new FileReader();
      reader.onload = e => {
        this.uploadedImage = e.target.result;
      };
      reader.readAsDataURL(file);
    },

    confirmUpload() {
      this.formData.personalIdentification.profileIcon = this.uploadedImage;
      this.closeIconSelector();
    },

    useInitials() {
      // Create a canvas to generate an image from initials
      const canvas = document.createElement('canvas');
      const size = 200;
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext('2d');

      // Draw background
      ctx.fillStyle = this.initialsColor;
      ctx.fillRect(0, 0, size, size);

      // Draw text
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 80px Arial';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(this.getInitials(this.formData.personalIdentification.fullName), size / 2, size / 2);

      // Convert to image
      this.formData.personalIdentification.profileIcon = canvas.toDataURL('image/png');
      this.closeIconSelector();
    }
  },
  // 4. Modify the mounted hook to load degree options
  mounted() {
    // Add theme change listener
    window.addEventListener('themeChange', this.updateTheme);

    // Set initial theme after a small delay to ensure DOM is ready
    this.$nextTick(() => {
      // Update theme variables
      this.isThemeReady = true;
    });

    // Load education and degree options
    this.loadEducationOptions();
    this.loadDegreeOptions();

    // Add watcher for locale changes to update options if i18n is available
    if (this.$i18n) {
      this.$watch('$i18n.locale', () => {
        this.loadEducationOptions();
        this.loadDegreeOptions();
      });
    }

    // Load user profile data when component mounts
    this.loadUserProfileData();
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

/* Add these styles to the existing <style> section */

/* Loading spinner */
.loading-overlay {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 2rem;
  min-height: 200px;
}

.loading-spinner {
  width: 40px;
  height: 40px;
  border: 4px solid rgba(0, 0, 0, 0.1);
  border-radius: 50%;
  border-top-color: var(--dialog-primary-button-bg, #4E97D1);
  animation: spin 1s linear infinite;
  margin-bottom: 1rem;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

/* Error container */
.error-container {
  padding: 2rem;
  text-align: center;
}

.error-message {
  color: #dc3545;
  margin-bottom: 1rem;
}

.retry-btn {
  padding: 0.5rem 1.5rem;
  background-color: var(--dialog-secondary-button-bg, #cccccc);
  color: var(--dialog-secondary-button-text, #333333);
  border: 1px solid var(--dialog-tabs-border-color, #cccccc);
  border-radius: 4px;
  cursor: pointer;
}

.retry-btn:hover {
  background-color: var(--dialog-secondary-button-hover-bg, #bbbbbb);
}

/* Disabled button styles */
.save-btn:disabled,
.cancel-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

/* Searchable dropdown styles */
.select-wrapper {
  position: relative;
  width: 100%;
}

.search-input {
  width: 100%;
  padding: 6px;
  border: 1px solid var(--dialog-input-border-color, #ddd);
  border-radius: 4px;
  background-color: var(--dialog-input-background, #ffffff);
  color: var(--dialog-input-text-color, #333333);
}

.selected-option {
  width: 100%;
  padding: 6px;
  border: 1px solid var(--dialog-input-border-color, #ddd);
  border-radius: 4px;
  background-color: var(--dialog-input-background, #ffffff);
  color: var(--dialog-input-text-color, #333333);
  cursor: pointer;
  display: flex;
  align-items: center;
  position: relative;
}

.selected-option:after {
  content: '▼';
  position: absolute;
  right: 10px;
  top: 50%;
  transform: translateY(-50%);
  font-size: 0.8em;
  color: var(--dialog-input-text-color, #888);
}

.options-dropdown {
  position: absolute;
  top: 100%;
  left: 0;
  right: 0;
  max-height: 200px;
  overflow-y: auto;
  background-color: var(--dialog-input-background, #ffffff);
  border: 1px solid var(--dialog-input-border-color, #ddd);
  border-radius: 0 0 4px 4px;
  z-index: 10;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
}

.option {
  padding: 6px 10px;
  cursor: pointer;
}

.option:hover,
.option.active {
  background-color: var(--dialog-primary-button-bg, #4E97D1);
  color: var(--dialog-primary-button-text, #ffffff);
}

.no-results {
  padding: 10px;
  text-align: center;
  color: #999;
  font-style: italic;
}

/* Dark theme adjustments */
[data-theme="dark"] .options-dropdown,
.dark-mode .options-dropdown {
  background-color: var(--dialog-input-background, #333333);
  border-color: var(--dialog-input-border-color, #3a3a3a);
}

[data-theme="dark"] .option:hover,
.dark-mode .option:hover,
[data-theme="dark"] .option.active,
.dark-mode .option.active {
  background-color: var(--dialog-primary-button-bg, #4E97D1);
}

[data-theme="dark"] .no-results,
.dark-mode .no-results {
  color: #777;
}

/* Add these to your UserProfileComponent.vue style section */
.tabs button.active {
  border-bottom: 2px solid var(--dialog-primary-button-bg, #4E97D1);
  /* Optional: add a faint background to active tab */
  background-color: rgba(78, 151, 209, 0.1);
}

/* Add a subtle border to the sections */
.tab-content {
  border-left: 3px solid var(--dialog-primary-button-bg, #4E97D1);
}

/* Add color focus to input fields on focus */
.field-group input:focus,
.field-group textarea:focus,
.field-group select:focus {
  border-color: var(--dialog-primary-button-bg, #4E97D1);
  box-shadow: 0 0 0 2px rgba(78, 151, 209, 0.2);
  outline: none;
}

/* Better spacing */
.field-group {
  margin-bottom: 18px;
  padding-bottom: 10px;
  border-bottom: 1px solid rgba(125, 125, 125, 0.1);
}

/* Improved typography */
.field-group label {
  font-weight: 500;
  margin-bottom: 6px;
  font-size: 0.95rem;
  color: var(--dialog-title-color, #333333);
}

/* Make the title more prominent */
h2 {
  font-size: 1.75rem;
  margin-bottom: 16px;
  border-bottom: 1px solid var(--dialog-border-color, #eaeaea);
  padding-bottom: 12px;
}

/* Visual feedback on tab hover */
.tabs button:hover:not(.active) {
  background-color: rgba(0, 0, 0, 0.05);
}

[data-theme="dark"] .tabs button:hover:not(.active) {
  background-color: rgba(255, 255, 255, 0.05);
}

/* Slight animation on buttons */
.cancel-btn, .save-btn {
  transition: transform 0.1s ease;
}

.cancel-btn:hover, .save-btn:hover {
  transform: translateY(-1px);
}

/* Add icon styles for fields that could benefit from them */
.field-group input[type="date"] {
  position: relative;
  padding-right: 30px; /* Space for calendar icon */
}

/* Add a slight background to the active tab's content area */
.tab-content {
  background: linear-gradient(
    to bottom,
    rgba(78, 151, 209, 0.05) 0%,
    transparent 100px
  );
  padding: 15px;
}

/* Better button styling */
.save-btn {
  padding: 10px 24px;
  font-weight: 500;
  letter-spacing: 0.3px;
}

.cancel-btn {
  background-color: transparent;
  border: 1px solid var(--dialog-secondary-button-bg, #cccccc);
}

/* Better hover effects */
.save-btn:hover {
  background-color: var(--dialog-primary-button-hover-bg, #3a7da0);
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
}

/* Profile Icon Styles */
.profile-icon-section {
  margin-bottom: 20px;
}

.profile-icon-container {
  display: flex;
  align-items: center;
  margin-top: 10px;
}

.current-icon {
  width: 80px;
  height: 80px;
  border-radius: 50%;
  overflow: hidden;
  position: relative;
  cursor: pointer;
  background-color: var(--dialog-secondary-button-bg, #cccccc);
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
  font-size: 32px;
  font-weight: bold;
  color: white;
}

.icon-overlay {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  background-color: rgba(0, 0, 0, 0.5);
  color: white;
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
  background-color: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 11000;
}

.icon-selector-modal {
  background-color: var(--dialog-background, #ffffff);
  border-radius: 8px;
  width: 90%;
  max-width: 500px;
  max-height: 90vh;
  overflow-y: auto;
  padding: 20px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
}

.icon-selector-modal h4 {
  margin-top: 0;
  margin-bottom: 15px;
  color: var(--dialog-title-color, #333333);
}

.icon-tabs {
  display: flex;
  border-bottom: 1px solid var(--dialog-border-color, #eaeaea);
  margin-bottom: 15px;
}

.icon-tabs button {
  padding: 8px 16px;
  background: none;
  border: none;
  cursor: pointer;
  font-size: 14px;
  color: var(--dialog-text-color, #333333);
}

.icon-tabs button.active {
  border-bottom: 2px solid var(--dialog-primary-button-bg, #4E97D1);
  color: var(--dialog-primary-button-bg, #4E97D1);
}

.icon-content {
  min-height: 250px;
}

/* Preset Icons */
.preset-icons {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 15px;
  margin-bottom: 15px;
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

.preset-icon.selected, .preset-icon:hover {
  border-color: var(--dialog-primary-button-bg, #4E97D1);
}

/* Upload Zone */
.upload-zone {
  border: 2px dashed var(--dialog-border-color, #ddd);
  border-radius: 8px;
  height: 150px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  margin-bottom: 15px;
  position: relative;
}

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
  gap: 15px;
}

.initials-preview {
  margin-bottom: 10px;
}

.initials-icon {
  width: 100px;
  height: 100px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 40px;
  font-weight: bold;
  color: white;
}

.color-selector {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
  justify-content: center;
  margin-bottom: 15px;
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
  border-color: #ddd;
  transform: scale(1.1);
}

.icon-selector-footer {
  display: flex;
  justify-content: flex-end;
  margin-top: 20px;
}

.btn-confirm {
  background-color: var(--dialog-primary-button-bg, #4E97D1);
  color: white;
  border: none;
  padding: 8px 16px;
  border-radius: 4px;
  cursor: pointer;
}

.btn-cancel {
  background-color: var(--dialog-secondary-button-bg, #cccccc);
  color: var(--dialog-secondary-button-text, #333333);
  border: none;
  padding: 8px 16px;
  border-radius: 4px;
  cursor: pointer;
  margin-left: 10px;
}

/* Dark Mode Adjustments */
[data-theme="dark"] .icon-selector-modal h4,
[data-theme="dark"] .icon-tabs button {
  color: var(--dialog-text-color-dark, #ffffff);
}

[data-theme="dark"] .icon-tabs button.active {
  color: var(--dialog-primary-button-bg, #4E97D1);
}

[data-theme="dark"] .upload-zone {
  border-color: var(--dialog-border-color-dark, #444);
  color: var(--dialog-text-color-dark, #ccc);
}

[data-theme="dark"] .color-option.selected {
  border-color: #555;
}
</style>