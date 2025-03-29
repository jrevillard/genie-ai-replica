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
                  {{ formData.educationRecords.degrees || $t('userProfile.placeholders.selectDegree', 'Select a degree') }}
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
      <confirm-dialog
        :visible="showConfirmDialog"
        :title="$t('userProfile.confirmSaveTitle', 'Save Profile')"
        :message="$t('userProfile.confirmSave', 'Are you sure you want to save these changes?')"
        :confirm-text="$t('userProfile.actions.save', 'Save')"
        :cancel-text="$t('userProfile.actions.cancel', 'Cancel')"
        :theme="isDarkMode ? 'dark' : 'light'"
        :parent-styles="dialogThemeStyles"
        @confirm="confirmSave"
        @cancel="cancelSave"
      />
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
      showConfirmDialog: false
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
</style>