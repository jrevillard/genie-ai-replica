<template>
  <!--
    ChatComposer — the shared composer used on the welcome screen and in
    the chat view. Product feature (send, focus, submit), not a DS
    primitive, so it lives beside ChatBotComponent.vue.

    One composer instance is mounted at a time. ChatBotComponent renders
    it once, inside the welcome panel, and again at the chat input slot,
    using v-if / v-else: when the welcome panel is up the input slot is
    not in the DOM, and vice-versa. Both share the same `newMessage`
    v-model — there is never a second live textarea to split the focus
    ring or duplicate an id.

    Layout:
      [ leading slot ] [ DsInput field ] [ attach ] [ mic ] [ save? ] [ export? ] [ send ]

    Attach and mic are always present, always disabled, with tooltips
    that say they are not available yet — the chat has no file or voice
    pathway today and a button that swallows the click would be a lie.

    Save and export are the chat-view's existing affordances; the parent
    passes `show-save` / `show-export` true once there is something to
    save or export.

    Enter sends. Shift+Enter does not — the wrapper's @keydown filters
    shift out before delegating to onSend, which itself guards on
    non-empty content. DsInput's own @enter would fire either way, so
    the composer does not bind it; the wrapper owns the keydown path.
  -->
  <div
    class="chat-composer"
    :style="tintStyle"
    :aria-label="accessibleName || undefined"
    data-testid="chat-composer"
    @keydown="onKeydown"
  >
    <div v-if="$slots.leading" class="chat-composer__leading">
      <slot name="leading" />
    </div>
    <DsInput
      v-model="model"
      type="textarea"
      :rows="1"
      :placeholder="placeholder"
      class="chat-composer__field"
      :input-id="inputId"
      @focus="$emit('focus', $event)"
    />
    <div class="chat-composer__actions">
      <button
        type="button"
        class="chat-composer__icon-btn chat-composer__icon-btn--disabled"
        :title="attachTitle"
        :aria-label="attachTitle"
        :disabled="true"
        tabindex="-1"
        data-testid="composer-attach-btn"
      >
        <Paperclip :size="18" aria-hidden="true" />
      </button>
      <button
        type="button"
        class="chat-composer__icon-btn chat-composer__icon-btn--disabled"
        :title="micTitle"
        :aria-label="micTitle"
        :disabled="true"
        tabindex="-1"
        data-testid="composer-mic-btn"
      >
        <Mic :size="18" aria-hidden="true" />
      </button>
      <button
        v-if="showSave"
        type="button"
        class="chat-composer__icon-btn"
        :title="saveTitle"
        :aria-label="saveTitle"
        :disabled="isSaving"
        data-testid="composer-save-btn"
        @click="$emit('save')"
      >
        <Loader2 v-if="isSaving" :size="18" class="animate-spin" aria-hidden="true" />
        <Save v-else :size="18" aria-hidden="true" />
      </button>
      <button
        v-if="showExport"
        type="button"
        class="chat-composer__icon-btn"
        :title="exportTitle"
        :aria-label="exportTitle"
        data-testid="composer-export-btn"
        @click="$emit('export')"
      >
        <FileText :size="18" aria-hidden="true" />
      </button>
      <button
        type="button"
        class="chat-composer__send"
        :title="sendTitle"
        :aria-label="sendTitle"
        :disabled="!hasContent"
        data-testid="composer-send-btn"
        @click="onSend"
      >
        <Send :size="18" aria-hidden="true" />
      </button>
    </div>
  </div>
</template>

<script>
import { Paperclip, Mic, Send, Save, FileText, Loader2 } from '@lucide/vue';
import DsInput from './ds/Input.vue';

export default {
  name: 'ChatComposer',
  components: { Paperclip, Mic, Send, Save, FileText, Loader2, DsInput },
  props: {
    // Standard v-model — the parent owns the text state.
    modelValue: {
      type: String,
      default: ''
    },
    placeholder: {
      type: String,
      default: ''
    },
    // Optional accessible name (welcome mode uses the just-chat entry's
    // localized title; chat mode leaves it implicit via the textarea label).
    accessibleName: {
      type: String,
      default: ''
    },
    // Optional background + border tint from the just-chat entry's styles
    // block (welcome mode only). Reads --composer-bg / --composer-outline.
    tint: {
      type: Object,
      default: null
    },
    attachTitle: {
      type: String,
      required: true
    },
    micTitle: {
      type: String,
      required: true
    },
    saveTitle: {
      type: String,
      default: ''
    },
    exportTitle: {
      type: String,
      default: ''
    },
    sendTitle: {
      type: String,
      required: true
    },
    showSave: {
      type: Boolean,
      default: false
    },
    showExport: {
      type: Boolean,
      default: false
    },
    isSaving: {
      type: Boolean,
      default: false
    },
    inputId: {
      type: String,
      default: 'composer-input'
    }
  },
  emits: ['update:modelValue', 'send', 'save', 'export', 'focus'],
  computed: {
    model: {
      get() {
        return this.modelValue;
      },
      set(v) {
        this.$emit('update:modelValue', v);
      }
    },
    hasContent() {
      return (this.modelValue || '').trim().length > 0;
    },
    tintStyle() {
      // Only emit declared bindings; CSSOM-set property with empty value
      // would silently erase the theme layer's fallback. Mirror the
      // contract used by ChatBotComponent.buttonTintStyle.
      const t = this.tint;
      if (!t || typeof t !== 'object') return undefined;
      const out = {
        '--composer-bg': t.backgroundColor,
        '--composer-outline': t.outlineColor
      };
      const defined = Object.entries(out).filter(([, v]) => v);
      if (!defined.length) return undefined;
      return Object.fromEntries(defined);
    }
  },
  methods: {
    onKeydown(e) {
      // Plain Enter sends; Shift+Enter is reserved for a newline and
      // passes through. Any other key is a no-op.
      if (!e || e.key !== 'Enter') return;
      if (e.shiftKey) return;
      e.preventDefault();
      this.onSend();
    },
    onSend() {
      if (!this.hasContent) return;
      this.$emit('send');
    }
  }
};
</script>

<style scoped>
.chat-composer {
  --composer-bg: var(--surface);
  --composer-outline: var(--border);
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  padding: var(--space-xs) var(--space-sm);
  background: var(--composer-bg);
  border: 1px solid var(--composer-outline);
  border-radius: var(--radius-pill, 999px);
  min-height: 44px;
  width: 100%;
  box-sizing: border-box;
}

.chat-composer__leading {
  display: flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
  width: 32px;
  height: 32px;
}

.chat-composer__field {
  flex: 1 1 auto;
  min-width: 0;
  /* The DsInput child uses its own border + background; reset them so
     the composer's pill shape is what shows. */
}
.chat-composer__field :deep(.ds-input) {
  background: transparent;
  border: none;
  padding: 8px 4px;
  resize: none;
}

.chat-composer__actions {
  display: flex;
  align-items: center;
  gap: var(--space-xs);
  flex: 0 0 auto;
}

.chat-composer__icon-btn,
.chat-composer__send {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: 1px solid transparent;
  cursor: pointer;
  font-family: inherit;
  color: var(--fg-muted, var(--muted));
  padding: 0;
  transition:
    background 0.15s,
    color 0.15s,
    border-color 0.15s;
}

.chat-composer__icon-btn {
  width: 32px;
  height: 32px;
  border-radius: var(--radius-md);
}

.chat-composer__icon-btn:hover:not(:disabled),
.chat-composer__icon-btn:focus-visible:not(:disabled) {
  background: var(--bg-hover, var(--surface-hover, var(--surface)));
  color: var(--fg);
  outline: none;
}

.chat-composer__icon-btn--disabled,
.chat-composer__icon-btn:disabled {
  cursor: not-allowed;
  opacity: 0.55;
  pointer-events: none;
}

/* The send button is the primary affordance — round, accent-tinted,
   and disabled until the field has content. */
.chat-composer__send {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  background: var(--accent);
  color: var(--accent-fg, #fff);
}

.chat-composer__send:hover:not(:disabled),
.chat-composer__send:focus-visible:not(:disabled) {
  background: var(--accent-hover, var(--accent));
  outline: none;
}

.chat-composer__send:disabled {
  background: var(--bg, var(--surface));
  color: var(--muted);
  cursor: not-allowed;
  opacity: 0.6;
}

.animate-spin {
  animation: chat-composer-spin 1s linear infinite;
}

@keyframes chat-composer-spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
