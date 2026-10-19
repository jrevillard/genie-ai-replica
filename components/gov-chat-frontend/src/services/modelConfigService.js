/**
 * modelConfigService — Story 8-7 (2026-10-19): named remote-model
 * configurations (LiteLLM gateway or direct provider APIs). Thin wrapper
 * over the okf-server endpoints; API keys NEVER travel this direction —
 * the server masks them (api_key_hint) and performs the model listing
 * itself so the stored key never reaches the browser.
 *
 *   GET    /okf/model-configs                  — list (masked)
 *   POST   /okf/model-configs                  — create
 *   PATCH  /okf/model-configs/:key             — rename / modify
 *   POST   /okf/model-configs/:key/copy        — duplicate
 *   POST   /okf/model-configs/:key/activate    — exactly-one-active
 *   POST   /okf/model-configs/:key/deactivate  — to-env-default
 *   DELETE /okf/model-configs/:key             — delete
 *   GET    /okf/model-configs/:key/models      — LIVE model dropdown
 */
import httpService from './httpService';

export default {
  async list() {
    const res = await httpService.get('/okf/model-configs');
    const body = res && res.data;
    return body && Array.isArray(body.configs) ? body.configs : [];
  },
  async create(payload) {
    const res = await httpService.post('/okf/model-configs', payload);
    return res && res.data ? res.data : null;
  },
  async update(key, payload) {
    const res = await httpService.patch(`/okf/model-configs/${encodeURIComponent(key)}`, payload);
    return res && res.data ? res.data : null;
  },
  async copy(key) {
    const res = await httpService.post(`/okf/model-configs/${encodeURIComponent(key)}/copy`);
    return res && res.data ? res.data : null;
  },
  async activate(key) {
    const res = await httpService.post(`/okf/model-configs/${encodeURIComponent(key)}/activate`);
    return res && res.data ? res.data : null;
  },
  async deactivate(key) {
    const res = await httpService.post(`/okf/model-configs/${encodeURIComponent(key)}/deactivate`);
    return res && res.data ? res.data : null;
  },
  async remove(key) {
    const res = await httpService.delete(`/okf/model-configs/${encodeURIComponent(key)}`);
    return res && res.data ? res.data : null;
  },
  /** The config-form dropdown's live model list (server-side, key-safe). */
  async models(key) {
    const res = await httpService.get(`/okf/model-configs/${encodeURIComponent(key)}/models`, {}, { silent: true });
    const body = res && res.data;
    return body && Array.isArray(body.models) ? body.models : [];
  },
  /**
   * Dropdown listing for credentials NOT saved yet (the create form): the
   * typed key makes one server-side round trip — never stored, never echoed.
   */
  async modelsPreview(payload) {
    const res = await httpService.post('/okf/model-configs/models-preview', payload, { silent: true });
    const body = res && res.data;
    return body && Array.isArray(body.models) ? body.models : [];
  },
  /**
   * Connection test (before enabling). Probe failures come back as a 200
   * DIAGNOSTIC ({ok:false, error, layer flags}); only shape errors reject.
   */
  async test(payload) {
    const res = await httpService.post('/okf/model-configs/test', payload, { silent: true });
    return res && res.data ? res.data : null;
  }
};
