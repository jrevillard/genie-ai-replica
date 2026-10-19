<!--
  ModelConfigPanel.vue — Story 8-7 (2026-10-19): named remote-model
  configurations, the Lab's fifth tab. Full lifecycle per David's spec:
  "configurations must be able to be named, renamed, copied, modified,
  activated (only one is activated), deactivated (when all are deactivated
  then the configured default model will be used) and deleted. When a
  specific URL and access token etc. are configured, then the model must be
  selectable via a dropdown list."

  The dropdown: once a SAVED config carries URL + key, the model field
  becomes a live dropdown (GET /model-configs/:key/models — the server
  performs the listing with the stored key; the key NEVER reaches the
  browser). Before first save, or when the listing fails, the field is
  free text — an honest fallback, never a dead end.

  Keys are write-only from here: the edit form shows the masked hint and
  leaves the key input empty ("unchanged" semantics server-side).
-->
<template>
  <div class="okf-models__pane">
    <div class="okf-models__head">
      <h4 class="okf-headtest__pane-title">{{ translate('okf.models.title', 'Model configurations') }}</h4>
      <DsButton v-if="!formOpen" small :disabled="busy" @click="openCreate">
        {{ translate('okf.models.add', 'New configuration') }}
      </DsButton>
    </div>
    <p class="okf-ragas__hint">
      {{
        translate(
          'okf.models.hint',
          'Named remote-model endpoints for judging and generation — any OpenAI-compatible surface (OpenAI, a LiteLLM gateway, vLLM, Gemini-compat, Ollama) or Anthropic direct. Exactly one configuration can be active; when none is, the deployment’s configured default model is used. Keys are stored server-side and never displayed.'
        )
      }}
    </p>

    <p v-if="error" class="okf-models__error">{{ error }}</p>

    <!-- editor (create / modify) -->
    <div v-if="formOpen" class="okf-models__form">
      <label class="okf-models__field">
        <span>{{ translate('okf.models.name', 'Name') }}</span>
        <input v-model="form.name" type="text" maxlength="120" :disabled="busy" />
      </label>
      <label class="okf-models__field">
        <span>{{ translate('okf.models.provider', 'Provider') }}</span>
        <select v-model="form.provider" :disabled="busy">
          <option value="openai">
            {{ translate('okf.models.providerOpenai', 'OpenAI-compatible (OpenAI, LiteLLM, vLLM…)') }}
          </option>
          <option value="anthropic">{{ translate('okf.models.providerAnthropic', 'Anthropic (native API)') }}</option>
        </select>
      </label>
      <label class="okf-models__field">
        <span>{{ translate('okf.models.baseUrl', 'Base URL') }}</span>
        <input v-model="form.base_url" type="text" placeholder="https://api.openai.com/v1" :disabled="busy" />
      </label>
      <label class="okf-models__field">
        <span>{{ translate('okf.models.apiKey', 'API key') }}</span>
        <input
          v-model="form.api_key"
          type="password"
          autocomplete="new-password"
          :placeholder="
            editing
              ? translate('okf.models.apiKeyKeep', 'unchanged') +
                (editing.api_key_hint ? ' — ' + editing.api_key_hint : '')
              : ''
          "
          :disabled="busy"
        />
      </label>
      <div class="okf-models__field">
        <span>{{ translate('okf.models.model', 'Model') }}</span>
        <div class="okf-models__model-row">
          <select v-if="modelChoices.length" v-model="form.default_model" :disabled="busy">
            <option value="">{{ translate('okf.models.modelPick', 'Select a model…') }}</option>
            <option v-for="m in modelChoices" :key="m" :value="m">{{ m }}</option>
          </select>
          <input
            v-model="form.default_model"
            type="text"
            :list="'okf-models-datalist-' + uid"
            :placeholder="translate('okf.models.modelFreeText', 'model id (free text)')"
            :disabled="busy"
          />
          <datalist :id="'okf-models-datalist-' + uid">
            <option v-for="m in modelChoices" :key="m" :value="m" />
          </datalist>
          <DsButton
            v-if="canFetchModels"
            variant="secondary"
            small
            :disabled="busy || modelsBusy"
            :title="translate('okf.models.modelFetch', 'Fetch the model list from the endpoint')"
            @click="fetchModels"
          >
            {{
              modelsBusy
                ? translate('okf.models.modelFetching', 'Fetching…')
                : translate('okf.models.modelFetch', 'Fetch models')
            }}
          </DsButton>
        </div>
        <p v-if="modelsError" class="okf-models__error">{{ modelsError }}</p>
      </div>
      <div class="okf-models__form-actions">
        <DsButton small :disabled="busy || !form.name || !form.base_url" @click="save">
          {{ editing ? translate('okf.models.save', 'Save changes') : translate('okf.models.create', 'Create') }}
        </DsButton>
        <DsButton variant="secondary" small :disabled="busy" @click="closeForm">
          {{ translate('okf.models.cancel', 'Cancel') }}
        </DsButton>
      </div>
    </div>

    <!-- the list -->
    <div v-if="!configs.length && !error" class="okf-ragas__hint">
      {{ translate('okf.models.empty', 'No model configurations yet — the deployment default (env) model is in use.') }}
    </div>
    <table v-else class="okf-headtest__scores">
      <thead>
        <tr>
          <th>{{ translate('okf.models.col.name', 'Name') }}</th>
          <th>{{ translate('okf.models.col.provider', 'Provider') }}</th>
          <th>{{ translate('okf.models.col.baseUrl', 'Endpoint') }}</th>
          <th>{{ translate('okf.models.col.key', 'Key') }}</th>
          <th>{{ translate('okf.models.col.model', 'Model') }}</th>
          <th>{{ translate('okf.models.col.state', 'State') }}</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="c in configs" :key="c._key" :class="{ 'okf-models__row--active': c.active }">
          <td>{{ c.name }}</td>
          <td>{{ c.provider }}</td>
          <td class="okf-models__cell-url" :title="c.base_url">{{ c.base_url }}</td>
          <td class="okf-models__cell-key">{{ c.has_api_key ? c.api_key_hint : '—' }}</td>
          <td>{{ c.default_model || '—' }}</td>
          <td>
            <DsPill
              :variant="c.active ? 'success' : 'neutral'"
              :label="
                c.active ? translate('okf.models.active', 'active') : translate('okf.models.inactive', 'inactive')
              "
            />
          </td>
          <td class="okf-ragas__row-actions">
            <button
              type="button"
              class="okf-headtest__row-btn"
              :disabled="busy"
              :title="translate('okf.models.edit', 'Rename / modify')"
              @click="openEdit(c)"
            >
              ✎
            </button>
            <button
              type="button"
              class="okf-headtest__row-btn"
              :disabled="busy"
              :title="translate('okf.models.copy', 'Copy')"
              @click="onCopy(c)"
            >
              ⧉
            </button>
            <button
              v-if="!c.active"
              type="button"
              class="okf-headtest__row-btn"
              :disabled="busy"
              :title="translate('okf.models.activate', 'Activate (exactly one is active)')"
              @click="onActivate(c)"
            >
              ▶
            </button>
            <button
              v-else
              type="button"
              class="okf-headtest__row-btn"
              :disabled="busy"
              :title="translate('okf.models.deactivate', 'Deactivate — the deployment default model will be used')"
              @click="onDeactivate(c)"
            >
              ⏸
            </button>
            <button
              type="button"
              class="okf-headtest__row-btn"
              :disabled="busy"
              :title="translate('okf.models.delete', 'Delete')"
              @click="onDelete(c)"
            >
              ✕
            </button>
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>

<script>
import translateMixin from '../../../mixins/translateMixin';
import DsButton from '../../ds/Button.vue';
import DsPill from '../../ds/Pill.vue';

let uidCounter = 0;

const EMPTY_FORM = () => ({ name: '', provider: 'openai', base_url: '', api_key: '', default_model: '' });

export default {
  name: 'OkfModelConfigPanel',
  components: { DsButton, DsPill },
  mixins: [translateMixin],
  data() {
    return {
      configs: [],
      error: '',
      busy: false,
      formOpen: false,
      editing: null,
      form: EMPTY_FORM(),
      modelChoices: [],
      modelsBusy: false,
      modelsError: '',
      uid: `m${(uidCounter += 1)}`
    };
  },
  computed: {
    /** Model fetch needs a SAVED config (the server holds the key) with both
     * endpoint fields — or a created-but-unsaved form can't list yet. */
    canFetchModels() {
      return !!this.editing;
    }
  },
  mounted() {
    this.load();
  },
  methods: {
    async load() {
      this.error = '';
      const res = await this.$store.dispatch('okf/modelConfigList').catch(() => null);
      if (res && res.ok) this.configs = res.configs;
      else if (res && /403|forbidden|scope/i.test(res.message || '')) {
        this.error = this.translate('okf.models.adminOnly', 'Model configurations require the platform admin role.');
      } else if (res) this.error = res.message;
    },
    openCreate() {
      this.editing = null;
      this.form = EMPTY_FORM();
      this.modelChoices = [];
      this.modelsError = '';
      this.formOpen = true;
    },
    openEdit(c) {
      this.editing = c;
      this.form = {
        name: c.name,
        provider: c.provider,
        base_url: c.base_url,
        api_key: '',
        default_model: c.default_model || ''
      };
      this.modelsError = '';
      this.modelChoices = [];
      this.formOpen = true;
      // auto-populate the dropdown for a key-bearing saved config
      if (c.has_api_key && c.default_model) this.modelChoices = [c.default_model];
      if (c.has_api_key) this.fetchModels();
    },
    closeForm() {
      this.formOpen = false;
      this.editing = null;
    },
    async fetchModels() {
      if (!this.editing) return;
      this.modelsBusy = true;
      this.modelsError = '';
      const res = await this.$store.dispatch('okf/modelConfigModels', { key: this.editing._key }).catch(() => null);
      this.modelsBusy = false;
      if (res && res.ok) {
        this.modelChoices = res.models;
        if (!res.models.length) {
          this.modelsError = this.translate(
            'okf.models.modelsEmpty',
            'The endpoint returned no models — type the model id.'
          );
        }
      } else {
        this.modelsError =
          (res && res.message) ||
          this.translate('okf.models.modelsFailed', 'Model listing failed — type the model id.');
      }
    },
    async save() {
      this.busy = true;
      this.error = '';
      try {
        const payload = {
          name: this.form.name,
          provider: this.form.provider,
          base_url: this.form.base_url,
          default_model: this.form.default_model
        };
        if (this.form.api_key) payload.api_key = this.form.api_key;
        const res = this.editing
          ? await this.$store.dispatch('okf/modelConfigUpdate', { key: this.editing._key, payload })
          : await this.$store.dispatch('okf/modelConfigCreate', payload);
        if (!res.ok) {
          this.error = res.message;
          return;
        }
        this.closeForm();
        await this.load();
      } finally {
        this.busy = false;
      }
    },
    async onCopy(c) {
      this.busy = true;
      const res = await this.$store.dispatch('okf/modelConfigCopy', { key: c._key }).catch(() => null);
      this.busy = false;
      if (res && !res.ok) this.error = res.message;
      await this.load();
    },
    async onActivate(c) {
      this.busy = true;
      const res = await this.$store.dispatch('okf/modelConfigActivate', { key: c._key }).catch(() => null);
      this.busy = false;
      if (res && !res.ok) this.error = res.message;
      await this.load();
    },
    async onDeactivate(c) {
      this.busy = true;
      const res = await this.$store.dispatch('okf/modelConfigDeactivate', { key: c._key }).catch(() => null);
      this.busy = false;
      if (res && !res.ok) this.error = res.message;
      await this.load();
    },
    async onDelete(c) {
      const sure = window.confirm(
        this.translate('okf.models.deleteConfirm', 'Delete model configuration "{name}"?').replace('{name}', c.name)
      );
      if (!sure) return;
      this.busy = true;
      const res = await this.$store.dispatch('okf/modelConfigDelete', { key: c._key }).catch(() => null);
      this.busy = false;
      if (res && !res.ok) this.error = res.message;
      await this.load();
    }
  }
};
</script>

<style scoped>
.okf-models__pane {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.okf-models__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.okf-models__error {
  color: var(--danger);
  font-size: 12px;
  margin: 0;
}
.okf-models__form {
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 12px;
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 10px;
}
.okf-models__field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 12px;
}
.okf-models__field > span {
  color: var(--muted);
  font-weight: 600;
}
.okf-models__field input,
.okf-models__field select {
  font: inherit;
  padding: 6px 8px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--surface);
  color: var(--fg);
}
.okf-models__model-row {
  display: flex;
  gap: 6px;
  align-items: center;
}
.okf-models__form-actions {
  grid-column: 1 / -1;
  display: flex;
  gap: 8px;
}
.okf-models__cell-key {
  font-family: var(--font-mono, monospace);
  font-size: 11px;
  color: var(--muted);
}
.okf-models__cell-url {
  max-width: 260px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
}
.okf-models__row--active {
  background: color-mix(in srgb, var(--success) 8%, transparent);
}
</style>
