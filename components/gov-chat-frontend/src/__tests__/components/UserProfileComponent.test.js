'use strict';

/**
 * UserProfileComponent tests — AC1 through AC3 + loading/error/cancel.
 *
 * Covers: profile data display, edit mode, save API call, loading state,
 * error state with retry, and cancel navigation.
 */
const { mount } = require('@vue/test-utils');

// ---------------------------------------------------------------------------
// Service mocks (closure-based refs for per-test control)
// ---------------------------------------------------------------------------

let getProfileResolve;
let getProfileReject;
const mockGetProfile = jest.fn(() => {
  return new Promise((resolve, reject) => {
    getProfileResolve = resolve;
    getProfileReject = reject;
  });
});

const mockUpdateProfile = jest.fn().mockResolvedValue({});

jest.mock('../../services/userProfileService', () => ({
  __esModule: true,
  default: {
    getProfile: mockGetProfile,
    updateProfile: mockUpdateProfile
  }
}));

const mockNotificationSuccess = jest.fn();
const mockNotificationError = jest.fn();
const mockNotificationInfo = jest.fn();

jest.mock('../../services/notificationService', () => ({
  success: mockNotificationSuccess,
  error: mockNotificationError,
  info: mockNotificationInfo
}));

// ---------------------------------------------------------------------------
// Component import (after mocks)
// ---------------------------------------------------------------------------
const UserProfileComponent = require('../../components/UserProfileComponent.vue').default;

// ---------------------------------------------------------------------------
// Mock profile data matching component's formData shape
// ---------------------------------------------------------------------------

const mockProfileData = {
  personalIdentification: {
    fullName: 'John Doe',
    dob: '1990-01-15',
    gender: 'male',
    nationality: 'US',
    profileIcon: ''
  },
  civilRegistration: {
    birthCert: 'BC-12345',
    citizenship: 'US',
    immigration: ''
  },
  addressResidency: {
    currentAddress: '123 Main St',
    postalCode: '10001',
    country: 'US',
    residencyStatus: 'citizen'
  },
  identityDocuments: {
    idCard: 'ID-001',
    passport: 'P-12345',
    driversLicense: 'DL-67890'
  },
  healthInfo: {
    bloodType: 'o-positive',
    organDonor: 'yes'
  },
  employmentInfo: {
    employmentHistory: 'Software Engineer',
    currentEmployer: 'Tech Corp',
    taxId: 'TAX-001'
  },
  educationRecords: {
    education: 'Computer Science',
    degrees: 'Bachelor of Science (BS)',
    certifications: 'AWS Certified',
    academicRecords: 'GPA 3.8'
  },
  financialInfo: {
    incomeTax: 'Filed',
    bankAccounts: 'Checking + Savings'
  }
};

// ---------------------------------------------------------------------------
// Mount helper
// ---------------------------------------------------------------------------

function createUserProfileWrapper(overrides = {}) {
  return mount(UserProfileComponent, {
    global: {
      mocks: {
        $t: (key) => key,
        $te: () => true,
        $i18n: { locale: 'en' },
        $router: { push: jest.fn(), back: jest.fn() },
        $route: { path: '/profile' }
      },
      stubs: {
        DsButton: {
          template: '<button :disabled="disabled" @click="$emit(\'click\')"><slot /></button>',
          props: ['disabled', 'variant', 'small']
        },
        DsTabs: {
          template: '<div><slot /></div>',
          props: ['tabs', 'modelValue']
        },
        DsInput: {
          template: '<input :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" />',
          props: ['modelValue', 'type', 'placeholder']
        },
        DsSelect: true,
        DsCombobox: true,
        DsSpinner: true,
        DsStateDisplay: {
          template: '<div><slot name="action" /><slot /></div>',
          props: ['type', 'message']
        },
        DsFormGroup: {
          template: '<div><slot /></div>'
        },
        ConfirmDialog: {
          template: '<div v-if="visible" class="confirm-dialog"></div>',
          props: ['visible', 'title', 'message', 'confirmText', 'cancelText'],
          emits: ['confirm', 'cancel']
        },
        SearchableCountryDropdown: {
          template: '<div></div>',
          methods: {
            manuallySetCountryName: jest.fn(),
            loadCountries: jest.fn()
          }
        }
      },
      ...overrides
    }
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('UserProfileComponent', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // -----------------------------------------------------------------------
  // AC1 — Profile data displays after loading
  // -----------------------------------------------------------------------
  describe('AC1 — renders profile data after loading', () => {
    it('displays full name from loaded profile data', async () => {
      const wrapper = createUserProfileWrapper();
      getProfileResolve(mockProfileData);
      await wrapper.vm.$nextTick();
      await wrapper.vm.$nextTick();

      expect(wrapper.vm.formData.personalIdentification.fullName).toBe('John Doe');
    });

    it('displays date of birth from loaded profile data', async () => {
      const wrapper = createUserProfileWrapper();
      getProfileResolve(mockProfileData);
      await wrapper.vm.$nextTick();
      await wrapper.vm.$nextTick();

      expect(wrapper.vm.formData.personalIdentification.dob).toBe('1990-01-15');
    });

    it('populates all form sections from profile data', async () => {
      const wrapper = createUserProfileWrapper();
      getProfileResolve(mockProfileData);
      await wrapper.vm.$nextTick();
      await wrapper.vm.$nextTick();

      expect(wrapper.vm.formData.addressResidency.currentAddress).toBe('123 Main St');
      expect(wrapper.vm.formData.employmentInfo.currentEmployer).toBe('Tech Corp');
      expect(wrapper.vm.formData.identityDocuments.passport).toBe('P-12345');
    });

    it('calls userProfileService.getProfile on mount', () => {
      createUserProfileWrapper();
      expect(mockGetProfile).toHaveBeenCalledTimes(1);
    });
  });

  // -----------------------------------------------------------------------
  // AC2 — Form fields are editable
  // -----------------------------------------------------------------------
  describe('AC2 — form fields are editable', () => {
    it('allows modifying fullName via formData', async () => {
      const wrapper = createUserProfileWrapper();
      getProfileResolve(mockProfileData);
      await wrapper.vm.$nextTick();
      await wrapper.vm.$nextTick();

      wrapper.vm.formData.personalIdentification.fullName = 'Jane Doe';
      await wrapper.vm.$nextTick();

      expect(wrapper.vm.formData.personalIdentification.fullName).toBe('Jane Doe');
    });

    it('allows modifying address fields', async () => {
      const wrapper = createUserProfileWrapper();
      getProfileResolve(mockProfileData);
      await wrapper.vm.$nextTick();
      await wrapper.vm.$nextTick();

      wrapper.vm.formData.addressResidency.currentAddress = '456 New St';
      wrapper.vm.formData.addressResidency.postalCode = '20002';
      await wrapper.vm.$nextTick();

      expect(wrapper.vm.formData.addressResidency.currentAddress).toBe('456 New St');
      expect(wrapper.vm.formData.addressResidency.postalCode).toBe('20002');
    });

    it('allows modifying employment data', async () => {
      const wrapper = createUserProfileWrapper();
      getProfileResolve(mockProfileData);
      await wrapper.vm.$nextTick();
      await wrapper.vm.$nextTick();

      wrapper.vm.formData.employmentInfo.currentEmployer = 'New Corp';
      await wrapper.vm.$nextTick();

      expect(wrapper.vm.formData.employmentInfo.currentEmployer).toBe('New Corp');
    });
  });

  // -----------------------------------------------------------------------
  // AC3 — Save triggers API call with form data
  // -----------------------------------------------------------------------
  describe('AC3 — save triggers API call', () => {
    it('saveProfile sets showConfirmDialog to true', async () => {
      const wrapper = createUserProfileWrapper();
      getProfileResolve(mockProfileData);
      await wrapper.vm.$nextTick();
      await wrapper.vm.$nextTick();

      wrapper.vm.saveProfile();
      await wrapper.vm.$nextTick();

      expect(wrapper.vm.showConfirmDialog).toBe(true);
    });

    it('confirmSave calls updateProfile with form data', async () => {
      const wrapper = createUserProfileWrapper();
      getProfileResolve(mockProfileData);
      await wrapper.vm.$nextTick();
      await wrapper.vm.$nextTick();

      wrapper.vm.formData.personalIdentification.fullName = 'Jane Doe';
      await wrapper.vm.$nextTick();

      await wrapper.vm.confirmSave();
      await wrapper.vm.$nextTick();

      expect(mockUpdateProfile).toHaveBeenCalledTimes(1);
      const calledData = mockUpdateProfile.mock.calls[0][0];
      expect(calledData.personalIdentification.fullName).toBe('Jane Doe');
    });

    it('confirmSave shows success notification', async () => {
      const wrapper = createUserProfileWrapper();
      getProfileResolve(mockProfileData);
      await wrapper.vm.$nextTick();
      await wrapper.vm.$nextTick();

      await wrapper.vm.confirmSave();
      await wrapper.vm.$nextTick();

      expect(mockNotificationSuccess).toHaveBeenCalled();
    });

    it('confirmSave emits save event', async () => {
      const wrapper = createUserProfileWrapper();
      getProfileResolve(mockProfileData);
      await wrapper.vm.$nextTick();
      await wrapper.vm.$nextTick();

      await wrapper.vm.confirmSave();
      await wrapper.vm.$nextTick();

      expect(wrapper.emitted('save')).toBeTruthy();
    });

    it('confirmSave navigates to dashboard on success', async () => {
      const wrapper = createUserProfileWrapper();
      getProfileResolve(mockProfileData);
      await wrapper.vm.$nextTick();
      await wrapper.vm.$nextTick();

      await wrapper.vm.confirmSave();
      await wrapper.vm.$nextTick();

      expect(wrapper.vm.$router.push).toHaveBeenCalledWith('/dashboard');
    });

    it('confirmSave shows error notification on API failure', async () => {
      mockUpdateProfile.mockRejectedValueOnce(new Error('Server error'));
      const wrapper = createUserProfileWrapper();
      getProfileResolve(mockProfileData);
      await wrapper.vm.$nextTick();
      await wrapper.vm.$nextTick();

      await wrapper.vm.confirmSave();
      await wrapper.vm.$nextTick();

      expect(mockNotificationError).toHaveBeenCalled();
    });

    it('confirmSave resets isSubmitting in finally block', async () => {
      mockUpdateProfile.mockRejectedValueOnce(new Error('fail'));
      const wrapper = createUserProfileWrapper();
      getProfileResolve(mockProfileData);
      await wrapper.vm.$nextTick();
      await wrapper.vm.$nextTick();

      await wrapper.vm.confirmSave();
      await wrapper.vm.$nextTick();

      expect(wrapper.vm.isSubmitting).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // Loading state displayed while fetching profile
  // -----------------------------------------------------------------------
  describe('loading state', () => {
    it('shows loading spinner while fetching profile', () => {
      const wrapper = createUserProfileWrapper();
      // getProfile is pending (never resolved), isLoading should be true
      expect(wrapper.vm.isLoading).toBe(true);
    });

    it('hides loading spinner after profile loads', async () => {
      const wrapper = createUserProfileWrapper();
      getProfileResolve(mockProfileData);
      await wrapper.vm.$nextTick();
      await wrapper.vm.$nextTick();

      expect(wrapper.vm.isLoading).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // Error state displayed with retry option
  // -----------------------------------------------------------------------
  describe('error state with retry', () => {
    it('sets errorMessage when getProfile fails', async () => {
      const wrapper = createUserProfileWrapper();
      getProfileReject(new Error('Network error'));
      await wrapper.vm.$nextTick();
      await wrapper.vm.$nextTick();

      expect(wrapper.vm.errorMessage).toBeTruthy();
    });

    it('retryLoading calls loadUserProfileData again', async () => {
      const wrapper = createUserProfileWrapper();
      getProfileReject(new Error('Network error'));
      await wrapper.vm.$nextTick();
      await wrapper.vm.$nextTick();

      mockGetProfile.mockClear();
      wrapper.vm.retryLoading();

      expect(mockGetProfile).toHaveBeenCalledTimes(1);
    });
  });

  // -----------------------------------------------------------------------
  // Cancel button navigates back
  // -----------------------------------------------------------------------
  describe('cancel navigation', () => {
    it('cancel method calls $router.back', () => {
      const wrapper = createUserProfileWrapper();

      wrapper.vm.cancel();

      expect(wrapper.vm.$router.back).toHaveBeenCalledTimes(1);
    });
  });

  // -----------------------------------------------------------------------
  // Cancel save dialog
  // -----------------------------------------------------------------------
  describe('cancel save dialog', () => {
    it('cancelSave hides the confirm dialog', async () => {
      const wrapper = createUserProfileWrapper();
      getProfileResolve(mockProfileData);
      await wrapper.vm.$nextTick();
      await wrapper.vm.$nextTick();

      wrapper.vm.saveProfile();
      await wrapper.vm.$nextTick();
      expect(wrapper.vm.showConfirmDialog).toBe(true);

      wrapper.vm.cancelSave();
      await wrapper.vm.$nextTick();
      expect(wrapper.vm.showConfirmDialog).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // Tab navigation
  // -----------------------------------------------------------------------
  describe('tab navigation', () => {
    it('starts on tab 0 (personalIdentification)', () => {
      const wrapper = createUserProfileWrapper();
      expect(wrapper.vm.activeTab).toBe(0);
    });

    it('profileTabs computed returns correct tab labels', () => {
      const wrapper = createUserProfileWrapper();
      const tabs = wrapper.vm.profileTabs;
      expect(tabs.length).toBe(8);
      expect(tabs[0]).toEqual({ label: expect.any(String), value: 0 });
    });
  });
});
