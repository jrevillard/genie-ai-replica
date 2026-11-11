'use strict';

// AddFromLinkDialog's suite: the dialog teleports to body (multi-root:
// backdrop + container), so it carries the Living-Intelligence gate on its
// own roots — outside .admin-page's ancestor reach. This suite pins the
// gate (Phase V4): a silent class drop would flatten the dialog back to
// undecorated chrome with every other test green. The dialog's behaviour
// itself is exercised through the admin surfaces' flows; this suite exists
// for the layer contract.

import { mount } from '@vue/test-utils';
import AddFromLinkDialog from '../../components/AddFromLinkDialog.vue';

describe('AddFromLinkDialog — the Phase V layer contract', () => {
  it('mounts open and carries the gate on both teleported roots', () => {
    const wrapper = mount(AddFromLinkDialog, {
      props: {
        visible: true
      },
      global: {
        stubs: {
          teleport: true,
          DsButton: { template: '<button><slot /></button>' },
          DsInput: { template: '<input />' },
          DsSelect: { template: '<select />' },
          DsSpinner: { template: '<div />' }
        },
        mocks: {
          $t: (key) => key
        }
      }
    });

    expect(wrapper.find('.dialog-container').classes()).toContain('genie-living-intelligence');
    expect(wrapper.find('.dialog-backdrop').classes()).toContain('genie-living-intelligence');
  });
});
