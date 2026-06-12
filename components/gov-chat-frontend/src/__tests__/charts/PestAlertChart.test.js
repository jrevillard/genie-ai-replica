/**
 * PestAlertChart — Get Assistance feature tests
 */
const mockSubmitQuery = jest.fn();
jest.mock('../../services/chatbotService.js', () => ({
  submitQuery: mockSubmitQuery
}));

const mockGetPestAlerts = jest.fn();
jest.mock('../../services/agriculturalService.js', () => ({
  getPestAlerts: mockGetPestAlerts
}));

jest.mock('../../composables/useChartTheme.js', () => ({
  useChartTheme: () => ({
    theme: { value: {} },
    isDarkMode: { value: false },
    getCssVarStrings: () => ({
      chartColors: ['#4071cb', '#333', '#fff'],
      backgroundColor: 'transparent'
    })
  })
}));

// Mock apexchart
jest.mock('vue3-apexcharts', () => ({
  name: 'apexchart',
  template: '<div class="apexchart-mock" />'
}));

// Mock DOMPurify and marked
jest.mock('dompurify', () => ({
  sanitize: jest.fn((str) => str)
}));

jest.mock('marked', () => ({
  marked: {
    parse: jest.fn((str) => `<p>${str}</p>`)
  }
}));

const { marked } = require('marked');
const DOMPurify = require('dompurify');

// Mock DS components
const mockDsComponents = {
  DsButton: { template: '<button @click="$emit(\'click\')"><slot /></button>' },
  DsCard: { template: '<div class="ds-card-mock"><slot /><slot name="header" /><slot name="footer" /></div>' },
  DsInput: {
    template: '<textarea :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" />',
    props: ['modelValue', 'type', 'rows', 'placeholder']
  },
  DsModal: {
    template: '<div v-if="visible" class="ds-modal-mock"><slot /><slot name="footer" /></div>',
    props: ['visible', 'title', 'size', 'scrollable'],
    emits: ['close']
  },
  DsPill: { template: '<span><slot /></span>' },
  DsSpinner: { template: '<div class="ds-spinner-mock" />' },
  DsStateDisplay: { template: '<div class="ds-state-mock" />', props: ['type', 'message'] },
  DsSelect: { template: '<select><slot /></select>', props: ['modelValue', 'placeholder', 'size'] }
};

const PestAlertChart = require('../../components/charts/PestAlertChart.vue').default;
const { mount } = require('@vue/test-utils');
const { createStore } = require('vuex');

function createWrapper(options = {}) {
  const store = createStore({
    state: () => ({ user: { roles: ['user'] } }),
    getters: { currentUser: (s) => s.user }
  });

  return mount(PestAlertChart, {
    global: {
      components: mockDsComponents,
      mocks: {
        $t: (key, fallback) => fallback || key,
        $store: store
      },
      stubs: {
        apexchart: true,
        transition_group: {
          template: '<div><slot /></div>'
        }
      }
    },
    props: {
      region: 'El Salvador'
    },
    ...options
  });
}

const sampleAlert = {
  id: 'test-alert-1',
  pest: 'Fall Armyworm',
  scientificName: 'Spodoptera frugiperda',
  severity: 'high',
  department: 'San Salvador',
  description: 'Test alert description',
  affectedCrops: ['Maize', 'Sorghum'],
  season: 'June-September',
  recommendations: ['Apply insecticide', 'Use pheromone traps']
};

const samplePestData = {
  region: 'El Salvador',
  alerts: [sampleAlert],
  summary: { total: 3, high: 2, moderate: 1, low: 0 },
  lastUpdated: '2026-06-12T00:00:00.000Z'
};

describe('PestAlertChart — Get Assistance', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetPestAlerts.mockResolvedValue(samplePestData);
  });

  describe('openAssistanceDialog', () => {
    it('builds prompt from alert data and shows dialog', async () => {
      const wrapper = createWrapper();
      await wrapper.vm.$nextTick();
      // Wait for mounted loadPestAlerts
      await wrapper.vm.$nextTick();

      wrapper.vm.openAssistanceDialog(sampleAlert);

      expect(wrapper.vm.assistanceDialog.visible).toBe(true);
      expect(wrapper.vm.assistanceDialog.prompt).toContain('High');
      expect(wrapper.vm.assistanceDialog.prompt).toContain('Fall Armyworm');
      expect(wrapper.vm.assistanceDialog.prompt).toContain('San Salvador');
    });

    it('includes scientific name when available', async () => {
      const wrapper = createWrapper();
      await wrapper.vm.$nextTick();

      wrapper.vm.openAssistanceDialog(sampleAlert);

      expect(wrapper.vm.assistanceDialog.prompt).toContain('Spodoptera frugiperda');
    });

    it('falls back to my area when department missing', async () => {
      const wrapper = createWrapper();
      await wrapper.vm.$nextTick();

      const noDept = { ...sampleAlert, department: null };
      wrapper.vm.openAssistanceDialog(noDept);

      expect(wrapper.vm.assistanceDialog.prompt).toContain('my area');
    });
  });

  describe('submitAssistanceQuery', () => {
    it('calls chatbotService.submitQuery with full prompt', async () => {
      mockSubmitQuery.mockResolvedValue({ response: 'Test AI response' });
      const wrapper = createWrapper();
      await wrapper.vm.$nextTick();

      wrapper.vm.assistanceDialog.prompt = 'Test prompt';
      wrapper.vm.assistanceDialog.userInput = 'Extra context';

      await wrapper.vm.submitAssistanceQuery();

      expect(mockSubmitQuery).toHaveBeenCalledWith({ query: 'Test prompt\n\nAdditional context: Extra context' });
    });

    it('uses prompt without user input when none provided', async () => {
      mockSubmitQuery.mockResolvedValue({ response: 'Response' });
      const wrapper = createWrapper();
      await wrapper.vm.$nextTick();

      wrapper.vm.assistanceDialog.prompt = 'Just the prompt';
      wrapper.vm.assistanceDialog.userInput = '';

      await wrapper.vm.submitAssistanceQuery();

      expect(mockSubmitQuery).toHaveBeenCalledWith({ query: 'Just the prompt' });
    });

    it('closes assistance dialog and opens response dialog', async () => {
      mockSubmitQuery.mockResolvedValue({ response: 'AI says hello' });
      const wrapper = createWrapper();
      await wrapper.vm.$nextTick();

      wrapper.vm.assistanceDialog.prompt = 'Test';
      wrapper.vm.assistanceDialog.visible = true;

      await wrapper.vm.submitAssistanceQuery();

      expect(wrapper.vm.assistanceDialog.visible).toBe(false);
      expect(wrapper.vm.responseDialog.visible).toBe(true);
    });

    it('displays AI response on success', async () => {
      mockSubmitQuery.mockResolvedValue({ response: 'Spray insecticide immediately.' });
      const wrapper = createWrapper();
      await wrapper.vm.$nextTick();

      wrapper.vm.assistanceDialog.prompt = 'Help';
      await wrapper.vm.submitAssistanceQuery();

      expect(wrapper.vm.responseDialog.response).toBe('Spray insecticide immediately.');
      expect(wrapper.vm.responseDialog.loading).toBe(false);
    });

    it('displays error on failure', async () => {
      mockSubmitQuery.mockRejectedValue(new Error('Network error'));
      const wrapper = createWrapper();
      await wrapper.vm.$nextTick();

      wrapper.vm.assistanceDialog.prompt = 'Help';
      await wrapper.vm.submitAssistanceQuery();

      expect(wrapper.vm.responseDialog.error).toBe('Network error');
      expect(wrapper.vm.responseDialog.loading).toBe(false);
    });
  });

  describe('closeAssistanceDialog', () => {
    it('resets dialog state and hides dialog', async () => {
      const wrapper = createWrapper();
      await wrapper.vm.$nextTick();

      wrapper.vm.assistanceDialog.visible = true;
      wrapper.vm.assistanceDialog.prompt = 'Some prompt';
      wrapper.vm.assistanceDialog.userInput = 'Some input';

      wrapper.vm.closeAssistanceDialog();

      expect(wrapper.vm.assistanceDialog.visible).toBe(false);
      expect(wrapper.vm.assistanceDialog.prompt).toBe('');
      expect(wrapper.vm.assistanceDialog.userInput).toBe('');
      expect(wrapper.vm.assistanceDialog.alert).toBeNull();
    });
  });

  describe('closeResponseDialog', () => {
    it('resets response state and hides dialog', async () => {
      const wrapper = createWrapper();
      await wrapper.vm.$nextTick();

      wrapper.vm.responseDialog.visible = true;
      wrapper.vm.responseDialog.prompt = 'Q';
      wrapper.vm.responseDialog.response = 'A';

      wrapper.vm.closeResponseDialog();

      expect(wrapper.vm.responseDialog.visible).toBe(false);
      expect(wrapper.vm.responseDialog.prompt).toBe('');
      expect(wrapper.vm.responseDialog.response).toBe('');
      expect(wrapper.vm.responseDialog.loading).toBe(false);
      expect(wrapper.vm.responseDialog.error).toBeNull();
    });
  });

  describe('copyResponse', () => {
    it('formats question and response for clipboard', async () => {
      const mockWrite = jest.fn().mockResolvedValue(undefined);
      Object.assign(navigator, { clipboard: { writeText: mockWrite } });

      const wrapper = createWrapper();
      await wrapper.vm.$nextTick();

      wrapper.vm.responseDialog.prompt = 'How to treat armyworm?';
      wrapper.vm.responseDialog.response = 'Apply Bacillus thuringiensis.';

      wrapper.vm.copyResponse();

      const copiedText = mockWrite.mock.calls[0][0];
      expect(copiedText).toContain('Question: How to treat armyworm?');
      expect(copiedText).toContain('Response: Apply Bacillus thuringiensis.');
      expect(copiedText).toMatch(/Question:.*\n\nResponse:/s);
    });

    it('does not throw when clipboard fails', async () => {
      const mockWrite = jest.fn().mockRejectedValue(new Error('Permission denied'));
      Object.assign(navigator, { clipboard: { writeText: mockWrite } });

      const wrapper = createWrapper();
      await wrapper.vm.$nextTick();

      wrapper.vm.responseDialog.prompt = 'Q';
      wrapper.vm.responseDialog.response = 'A';

      expect(() => wrapper.vm.copyResponse()).not.toThrow();
    });
  });

  describe('renderedAIResponse', () => {
    it('returns empty string when no response', async () => {
      const wrapper = createWrapper();
      await wrapper.vm.$nextTick();

      wrapper.vm.responseDialog.response = '';
      expect(wrapper.vm.renderedAIResponse).toBe('');
    });

    it('passes markdown output through sanitizer before returning', async () => {
      // Simulate real pipeline: marked produces raw HTML, DOMPurify sanitizes it
      DOMPurify.sanitize.mockImplementation((html) => html.replace(/<script>/g, ''));

      const wrapper = createWrapper();
      await wrapper.vm.$nextTick();

      wrapper.vm.responseDialog.response = '# Heading';
      const result = wrapper.vm.renderedAIResponse;

      // Verify the pipeline: marked.parse is called with the raw response
      expect(marked.parse).toHaveBeenCalledWith('# Heading');
      // Verify DOMPurify.sanitize receives marked's output (not raw markdown)
      const markedOutput = marked.parse.mock.results[0].value;
      expect(DOMPurify.sanitize).toHaveBeenCalledWith(markedOutput);
      // Verify the final result is DOMPurify's output, not marked's raw output
      expect(result).toBe(DOMPurify.sanitize.mock.results[0].value);
    });

    it('returns sanitized output even if response contains special chars', async () => {
      DOMPurify.sanitize.mockReturnValue('safe content');

      const wrapper = createWrapper();
      await wrapper.vm.$nextTick();

      wrapper.vm.responseDialog.response = '<script>alert("xss")</script>';
      const result = wrapper.vm.renderedAIResponse;

      // The computed must always return the sanitized version, never raw input
      expect(result).toBe('safe content');
      expect(result).not.toContain('<script>');
    });
  });
});
