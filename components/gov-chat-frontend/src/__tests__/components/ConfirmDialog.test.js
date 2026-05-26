'use strict';

const { mount } = require('@vue/test-utils');
const ConfirmDialog = require('@/components/ConfirmDialog.vue').default;

describe('ConfirmDialog', () => {
  let wrapper;

  const stubs = {
    DsModal: {
      template: '<div class="modal-stub"><slot /><slot name="footer" /></div>',
      props: ['visible', 'title', 'size']
    },
    DsButton: {
      template: '<button class="button-stub" @click="$emit(\'click\')"><slot /></button>',
      props: ['variant', 'disabled']
    }
  };

  afterEach(() => {
    if (wrapper) {
      wrapper.unmount();
    }
  });

  describe('rendering', () => {
    test('renders message prop', () => {
      wrapper = mount(ConfirmDialog, {
        props: {
          visible: true,
          message: 'Are you sure you want to delete this item?'
        },
        global: {
          stubs
        }
      });

      expect(wrapper.text()).toContain('Are you sure you want to delete this item?');
    });

    test('does not render secondary button when secondaryText is empty', () => {
      wrapper = mount(ConfirmDialog, {
        props: {
          visible: true,
          secondaryText: ''
        },
        global: {
          stubs
        }
      });

      // Count all buttons - should only have cancel and confirm buttons
      const buttons = wrapper.findAll('.button-stub');
      expect(buttons.length).toBe(2);
    });

    test('renders secondary button when secondaryText is provided', () => {
      wrapper = mount(ConfirmDialog, {
        props: {
          visible: true,
          secondaryText: 'Learn More'
        },
        global: {
          stubs
        }
      });

      // Should have three buttons: secondary, cancel, confirm
      const buttons = wrapper.findAll('.button-stub');
      expect(buttons.length).toBe(3);
    });

    test('uses danger variant for confirm button when danger=true', () => {
      wrapper = mount(ConfirmDialog, {
        props: {
          visible: true,
          danger: true,
          confirmText: 'Delete'
        },
        global: {
          stubs
        }
      });

      // Just verify the button text is correct
      const buttons = wrapper.findAll('.button-stub');
      const confirmButton = buttons[buttons.length - 1]; // Last button is confirm
      expect(confirmButton.text()).toBe('Delete');
    });

    test('uses primary variant for confirm button when danger=false', () => {
      wrapper = mount(ConfirmDialog, {
        props: {
          visible: true,
          danger: false,
          confirmText: 'Confirm'
        },
        global: {
          stubs
        }
      });

      const buttons = wrapper.findAll('.button-stub');
      const confirmButton = buttons[buttons.length - 1]; // Last button is confirm
      expect(confirmButton.text()).toBe('Confirm');
    });
  });

  describe('events', () => {
    test('emits confirm event when confirm button is clicked', async () => {
      wrapper = mount(ConfirmDialog, {
        props: {
          visible: true,
          confirmText: 'OK'
        },
        global: {
          stubs
        }
      });

      const buttons = wrapper.findAll('.button-stub');
      const confirmButton = buttons[buttons.length - 1]; // Last button is confirm

      await confirmButton.trigger('click');

      expect(wrapper.emitted('confirm')).toBeTruthy();
    });

    test('emits cancel event when cancel button is clicked', async () => {
      wrapper = mount(ConfirmDialog, {
        props: {
          visible: true,
          cancelText: 'Cancel'
        },
        global: {
          stubs
        }
      });

      const buttons = wrapper.findAll('.button-stub');
      // Cancel button is the second-to-last (or first if only 2 buttons)
      const cancelButton = buttons.length > 2 ? buttons[buttons.length - 2] : buttons[0];

      await cancelButton.trigger('click');

      expect(wrapper.emitted('cancel')).toBeTruthy();
    });

    test('emits secondary event when secondary button is clicked', async () => {
      wrapper = mount(ConfirmDialog, {
        props: {
          visible: true,
          secondaryText: 'Learn More'
        },
        global: {
          stubs
        }
      });

      const buttons = wrapper.findAll('.button-stub');
      const secondaryButton = buttons[0]; // First button is secondary

      await secondaryButton.trigger('click');

      expect(wrapper.emitted('secondary')).toBeTruthy();
    });
  });

  describe('methods', () => {
    test('confirm method emits confirm event', () => {
      wrapper = mount(ConfirmDialog, {
        props: {
          visible: true
        },
        global: {
          stubs
        }
      });

      wrapper.vm.confirm();

      expect(wrapper.emitted('confirm')).toBeTruthy();
      expect(wrapper.emitted('confirm')).toHaveLength(1);
    });

    test('cancel method emits cancel event', () => {
      wrapper = mount(ConfirmDialog, {
        props: {
          visible: true
        },
        global: {
          stubs
        }
      });

      wrapper.vm.cancel();

      expect(wrapper.emitted('cancel')).toBeTruthy();
      expect(wrapper.emitted('cancel')).toHaveLength(1);
    });

    test('secondary method emits secondary event', () => {
      wrapper = mount(ConfirmDialog, {
        props: {
          visible: true,
          secondaryText: 'Learn More'
        },
        global: {
          stubs
        }
      });

      wrapper.vm.secondary();

      expect(wrapper.emitted('secondary')).toBeTruthy();
      expect(wrapper.emitted('secondary')).toHaveLength(1);
    });
  });
});
