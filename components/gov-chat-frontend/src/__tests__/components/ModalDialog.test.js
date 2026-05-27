'use strict';

const { mount } = require('@vue/test-utils');
const ModalDialog = require('@/components/ModalDialog.vue').default;

describe('ModalDialog', () => {
  let wrapper;

  const stubs = {
    DsModal: {
      name: 'DsModal',
      template: '<div class="modal-stub"><slot name="header" /><slot /><slot name="footer" /></div>',
      props: ['visible', 'title', 'size']
    },
    DsButton: {
      template: '<button class="button-stub" @click="$emit(\'click\')"><slot /></button>',
      props: ['variant']
    }
  };

  afterEach(() => {
    if (wrapper) {
      wrapper.unmount();
    }
  });

  describe('rendering', () => {
    test('renders message text', () => {
      wrapper = mount(ModalDialog, {
        props: {
          title: 'Test Dialog',
          message: 'This is a dialog message'
        },
        global: {
          stubs,
          mocks: {
            $t: (key) => key
          }
        }
      });

      expect(wrapper.text()).toContain('This is a dialog message');
    });

    test('renders default cancel text', () => {
      wrapper = mount(ModalDialog, {
        global: {
          stubs,
          mocks: {
            $t: (key) => key
          }
        }
      });

      expect(wrapper.text()).toContain('Cancel');
    });

    test('renders default confirm text', () => {
      wrapper = mount(ModalDialog, {
        global: {
          stubs,
          mocks: {
            $t: (key) => key
          }
        }
      });

      expect(wrapper.text()).toContain('Confirm');
    });

    test('renders custom cancel text when provided', () => {
      wrapper = mount(ModalDialog, {
        props: {
          cancelText: 'Close'
        },
        global: {
          stubs,
          mocks: {
            $t: (key) => key
          }
        }
      });

      expect(wrapper.text()).toContain('Close');
    });

    test('renders custom confirm text when provided', () => {
      wrapper = mount(ModalDialog, {
        props: {
          confirmText: 'Proceed'
        },
        global: {
          stubs,
          mocks: {
            $t: (key) => key
          }
        }
      });

      expect(wrapper.text()).toContain('Proceed');
    });
  });

  describe('events', () => {
    test('emits confirm event on confirm button click', async () => {
      wrapper = mount(ModalDialog, {
        props: {
          confirmText: 'Confirm'
        },
        global: {
          stubs,
          mocks: {
            $t: (key) => key
          }
        }
      });

      const buttons = wrapper.findAll('.button-stub');
      const confirmButton = buttons[1]; // Second button is confirm

      await confirmButton.trigger('click');

      expect(wrapper.emitted('confirm')).toBeTruthy();
    });

    test('emits close event on cancel button click', async () => {
      wrapper = mount(ModalDialog, {
        props: {
          cancelText: 'Cancel'
        },
        global: {
          stubs,
          mocks: {
            $t: (key) => key
          }
        }
      });

      const buttons = wrapper.findAll('.button-stub');
      const cancelButton = buttons[0]; // First button is cancel

      await cancelButton.trigger('click');

      expect(wrapper.emitted('close')).toBeTruthy();
    });

    test('emits close event when DsModal closes', async () => {
      wrapper = mount(ModalDialog, {
        global: {
          stubs,
          mocks: {
            $t: (key) => key
          }
        }
      });

      const modal = wrapper.findComponent({ name: 'DsModal' });
      await modal.vm.$emit('close');

      expect(wrapper.emitted('close')).toBeTruthy();
      expect(wrapper.emitted('close')).toHaveLength(1);
    });
  });

  describe('methods', () => {
    describe('translateIfKey', () => {
      test('returns key when useTranslation is false', () => {
        wrapper = mount(ModalDialog, {
          props: {
            useTranslation: false
          },
          global: {
            stubs,
            mocks: {
              $t: jest.fn((key) => `Translated: ${key}`)
            }
          }
        });

        const result = wrapper.vm.translateIfKey('dialog.title');
        expect(result).toBe('dialog.title');
      });

      test('returns key when useTranslation is true but key is empty', () => {
        wrapper = mount(ModalDialog, {
          props: {
            useTranslation: true
          },
          global: {
            stubs,
            mocks: {
              $t: jest.fn((key) => `Translated: ${key}`)
            }
          }
        });

        const result = wrapper.vm.translateIfKey('');
        expect(result).toBe('');
      });

      test('calls $t when useTranslation is true and key is provided', () => {
        const mockT = jest.fn((key) => `Translated: ${key}`);

        wrapper = mount(ModalDialog, {
          props: {
            useTranslation: true
          },
          global: {
            stubs,
            mocks: {
              $t: mockT
            }
          }
        });

        const result = wrapper.vm.translateIfKey('dialog.title');

        expect(mockT).toHaveBeenCalledWith('dialog.title');
        expect(result).toBe('Translated: dialog.title');
      });

      test('returns key as-is when useTranslation is true but key is falsy', () => {
        wrapper = mount(ModalDialog, {
          props: {
            useTranslation: true
          },
          global: {
            stubs,
            mocks: {
              $t: jest.fn((key) => `Translated: ${key}`)
            }
          }
        });

        expect(wrapper.vm.translateIfKey(null)).toBeNull();
        expect(wrapper.vm.translateIfKey(undefined)).toBeUndefined();
        expect(wrapper.vm.translateIfKey('')).toBe('');
      });
    });
  });

  describe('computed', () => {
    describe('translatedTitle', () => {
      test('uses translateIfKey when useTranslation is false', () => {
        wrapper = mount(ModalDialog, {
          props: {
            title: 'Custom Title',
            useTranslation: false
          },
          global: {
            stubs,
            mocks: {
              $t: jest.fn((key) => `Translated: ${key}`)
            }
          }
        });

        expect(wrapper.vm.translatedTitle).toBe('Custom Title');
      });

      test('uses translateIfKey when useTranslation is true', () => {
        const mockT = jest.fn((key) => `Translated: ${key}`);

        wrapper = mount(ModalDialog, {
          props: {
            title: 'dialog.title',
            useTranslation: true
          },
          global: {
            stubs,
            mocks: {
              $t: mockT
            }
          }
        });

        expect(wrapper.vm.translatedTitle).toBe('Translated: dialog.title');
        expect(mockT).toHaveBeenCalledWith('dialog.title');
      });

      test('returns empty string when title is empty', () => {
        wrapper = mount(ModalDialog, {
          props: {
            title: '',
            useTranslation: true
          },
          global: {
            stubs,
            mocks: {
              $t: jest.fn((key) => `Translated: ${key}`)
            }
          }
        });

        expect(wrapper.vm.translatedTitle).toBe('');
      });

      test('returns default title when no title prop is provided', () => {
        wrapper = mount(ModalDialog, {
          global: {
            stubs,
            mocks: {
              $t: jest.fn((key) => `Translated: ${key}`)
            }
          }
        });

        expect(wrapper.vm.translatedTitle).toBe('Dialog');
      });
    });
  });

  describe('slots', () => {
    test('renders default header slot content', () => {
      wrapper = mount(ModalDialog, {
        props: {
          title: 'Custom Title'
        },
        global: {
          stubs
        }
      });

      expect(wrapper.text()).toContain('Custom Title');
    });

    test('renders default body slot content', () => {
      wrapper = mount(ModalDialog, {
        props: {
          title: 'Test',
          message: 'Body content'
        },
        global: {
          stubs,
          mocks: {
            $t: (key) => key
          }
        }
      });

      expect(wrapper.text()).toContain('Body content');
    });

    test('renders default footer slot content', () => {
      wrapper = mount(ModalDialog, {
        props: {
          cancelText: 'Cancel',
          confirmText: 'OK'
        },
        global: {
          stubs
        }
      });

      expect(wrapper.text()).toContain('Cancel');
      expect(wrapper.text()).toContain('OK');
    });

    test('can override header slot', () => {
      wrapper = mount(ModalDialog, {
        props: {
          title: 'Default Title'
        },
        slots: {
          header: '<h1>Custom Header</h1>'
        },
        global: {
          stubs
        }
      });

      expect(wrapper.html()).toContain('Custom Header');
    });

    test('can override body slot', () => {
      wrapper = mount(ModalDialog, {
        props: {
          title: 'Test'
        },
        slots: {
          body: '<p>Custom Body Content</p>'
        },
        global: {
          stubs,
          mocks: {
            $t: (key) => key
          }
        }
      });

      expect(wrapper.html()).toContain('Custom Body Content');
    });

    test('can override footer slot', () => {
      wrapper = mount(ModalDialog, {
        slots: {
          footer: '<button>Custom Footer</button>'
        },
        global: {
          stubs
        }
      });

      expect(wrapper.html()).toContain('Custom Footer');
    });
  });

  describe('props', () => {
    test('accepts title prop', () => {
      wrapper = mount(ModalDialog, {
        props: {
          title: 'My Dialog'
        },
        global: {
          stubs,
          mocks: {
            $t: (key) => key
          }
        }
      });

      expect(wrapper.vm.title).toBe('My Dialog');
    });

    test('accepts message prop', () => {
      wrapper = mount(ModalDialog, {
        props: {
          message: 'Dialog message'
        },
        global: {
          stubs,
          mocks: {
            $t: (key) => key
          }
        }
      });

      expect(wrapper.vm.message).toBe('Dialog message');
    });

    test('accepts useTranslation prop', () => {
      wrapper = mount(ModalDialog, {
        props: {
          useTranslation: true
        },
        global: {
          stubs,
          mocks: {
            $t: (key) => key
          }
        }
      });

      expect(wrapper.vm.useTranslation).toBe(true);
    });

    test('has default prop values', () => {
      wrapper = mount(ModalDialog, {
        global: {
          stubs,
          mocks: {
            $t: (key) => key
          }
        }
      });

      expect(wrapper.vm.title).toBe('Dialog');
      expect(wrapper.vm.message).toBe('');
      expect(wrapper.vm.cancelText).toBe('Cancel');
      expect(wrapper.vm.confirmText).toBe('Confirm');
      expect(wrapper.vm.useTranslation).toBe(false);
    });
  });
});
