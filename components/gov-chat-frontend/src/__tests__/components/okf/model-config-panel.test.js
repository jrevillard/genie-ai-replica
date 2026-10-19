// Copyright (C) 2026 International Telecommunication Union (ITU)
// SPDX-License-Identifier: Apache-2.0
// Story 8-7 — ModelConfigPanel behavior: the lifecycle David specified
// (create/copy/activate-exactly-one/deactivate/delete/rename), key masking
// in the UI (the masked hint renders, the key never does), and the live
// model dropdown falling back to free text when the listing fails.

import { mount } from '@vue/test-utils';
import ModelConfigPanel from '@/components/okf/editor/ModelConfigPanel.vue';

jest.mock('@/services/modelConfigService', () => ({
  __esModule: true,
  default: {
    list: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    copy: jest.fn(),
    activate: jest.fn(),
    deactivate: jest.fn(),
    remove: jest.fn(),
    models: jest.fn()
  }
}));

const dispatch = jest.fn();

function configs() {
  return [
    {
      _key: 'mc1',
      name: 'LiteLLM gateway',
      provider: 'openai',
      base_url: 'http://gw:4000/v1',
      default_model: 'gpt-4o',
      active: true,
      has_api_key: true,
      api_key_hint: '••••1234',
      created_at: '2026-10-19T07:00:00Z',
      updated_at: '2026-10-19T07:00:00Z'
    },
    {
      _key: 'mc2',
      name: 'Anthropic direct',
      provider: 'anthropic',
      base_url: 'https://api.anthropic.com',
      default_model: null,
      active: false,
      has_api_key: true,
      api_key_hint: '••••abcd',
      created_at: '2026-10-19T07:10:00Z',
      updated_at: '2026-10-19T07:10:00Z'
    }
  ];
}

function mountPanel() {
  return mount(ModelConfigPanel, {
    global: {
      mocks: {
        $store: { dispatch: (a, p) => dispatch(a, p), state: { okf: {} } }
      },
      stubs: {
        DsButton: { template: '<button @click="$emit(\'click\')"><slot /></button>' },
        DsPill: { props: ['label', 'variant'], template: '<span class="pill">{{ label }}</span>' }
      }
    }
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  dispatch.mockReset();
  dispatch.mockImplementation(async (action) => {
    if (action === 'okf/modelConfigList') return { ok: true, configs: configs() };
    if (action === 'okf/modelConfigModels') return { ok: true, models: ['claude-opus', 'claude-sonnet'] };
    return { ok: true, result: {} };
  });
});

describe('ModelConfigPanel', () => {
  test('renders the list with masked keys — the api_key hint shows, no key material', async () => {
    const w = mountPanel();
    await new Promise((r) => setTimeout(r, 0));
    expect(w.text()).toContain('LiteLLM gateway');
    expect(w.text()).toContain('Anthropic direct');
    expect(w.text()).toContain('••••1234'); // the EDIT form shows the hint
    expect(w.text()).not.toContain('sk-');
  });

  test('activate / deactivate / copy / delete dispatch through the store', async () => {
    const w = mountPanel();
    await new Promise((r) => setTimeout(r, 0));
    await w.vm.onActivate(configs()[1]);
    expect(dispatch).toHaveBeenCalledWith('okf/modelConfigActivate', { key: 'mc2' });
    await w.vm.onDeactivate(configs()[0]);
    expect(dispatch).toHaveBeenCalledWith('okf/modelConfigDeactivate', { key: 'mc1' });
    await w.vm.onCopy(configs()[0]);
    expect(dispatch).toHaveBeenCalledWith('okf/modelConfigCopy', { key: 'mc1' });
    window.confirm = () => true;
    await w.vm.onDelete(configs()[1]);
    expect(dispatch).toHaveBeenCalledWith('okf/modelConfigDelete', { key: 'mc2' });
  });

  test('create posts the form; edit keeps an absent key (payload carries no api_key)', async () => {
    const w = mountPanel();
    await new Promise((r) => setTimeout(r, 0));
    w.vm.openCreate();
    w.vm.form = { name: 'New gw', provider: 'openai', base_url: 'https://x/v1', api_key: 'k1', default_model: 'm' };
    await w.vm.save();
    expect(dispatch).toHaveBeenCalledWith(
      'okf/modelConfigCreate',
      expect.objectContaining({ name: 'New gw', api_key: 'k1', default_model: 'm' })
    );
    // edit without typing a key → payload omits api_key entirely (keep-old)
    w.vm.openEdit(configs()[0]);
    w.vm.form = { name: 'Renamed', provider: 'openai', base_url: 'http://gw:4000/v1', api_key: '', default_model: 'gpt-4o' };
    await w.vm.save();
    expect(dispatch).toHaveBeenCalledWith(
      'okf/modelConfigUpdate',
      expect.objectContaining({ key: 'mc1', payload: expect.not.objectContaining({ api_key: expect.anything() }) })
    );
  });

  test('the model dropdown populates from the live listing on edit', async () => {
    const w = mountPanel();
    await new Promise((r) => setTimeout(r, 0));
    await w.vm.openEdit(configs()[1]);
    await new Promise((r) => setTimeout(r, 0));
    expect(dispatch).toHaveBeenCalledWith('okf/modelConfigModels', { key: 'mc2' });
    expect(w.vm.modelChoices).toEqual(['claude-opus', 'claude-sonnet']);
  });

  test('a listing failure falls back honestly to free text with the error shown', async () => {
    dispatch.mockImplementation(async (action) => {
      if (action === 'okf/modelConfigList') return { ok: true, configs: configs() };
      if (action === 'okf/modelConfigModels') return { ok: false, message: '401 unauthorized' };
      return { ok: true, result: {} };
    });
    const w = mountPanel();
    await new Promise((r) => setTimeout(r, 0));
    await w.vm.openEdit(configs()[1]);
    await new Promise((r) => setTimeout(r, 0));
    expect(w.vm.modelChoices).toEqual([]);
    expect(w.vm.modelsError).toContain('401');
  });
});
