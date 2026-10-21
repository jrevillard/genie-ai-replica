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
      class="chat-composer__field prompt-textarea"
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
        data-testid="save-chat-btn"
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
        <ArrowRight :size="18" aria-hidden="true" />
      </button>
    </div>
  </div>
</template>

<script>
import { ArrowRight, Paperclip, Mic, Save, FileText, Loader2 } from '@lucide/vue';
import DsInput from './ds/Input.vue';

export default {
  name: 'ChatComposer',
  components: { ArrowRight, Paperclip, Mic, Save, FileText, Loader2, DsInput },
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
      //
      // The entry's colours are emitted as the *tint*, not as the final
      // background: they are light-mode values, and painting them as-is
      // puts a white bar in the dark theme, where the reference shows a
      // dark glass one. The stylesheet mixes the theme's surface with
      // them, so the bar follows the theme and keeps the entry's hue.
      const t = this.tint;
      if (!t || typeof t !== 'object') return undefined;
      const out = {
        '--composer-tint': t.backgroundColor,
        '--composer-tint-outline': t.outlineColor
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
  /* The bar's own colours are derived from the theme's surface and the
     entry's tint, never from the tint alone: the entry's colours are
     light-mode values (the reference's light bar is a pale blue), and
     used as they are they would paint a white bar over the dark theme.
     Measured against the reference: the light bar is the tint on the
     surface, the dark one is the surface with the tint's hue mixed
     back in. */
  --composer-bg: color-mix(in srgb, var(--surface) 25%, var(--composer-tint, var(--surface)));
  --composer-outline: color-mix(in srgb, var(--border) 45%, var(--composer-tint-outline, var(--border)));
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

/* In the dark theme the reference shows a dark glass bar: the surface,
  with only a hint of the entry's hue. ThemeManager writes the
  `dark-mode` class on the document element and the body, so both are
  covered here. */
.dark-mode .chat-composer {
  --composer-bg: color-mix(in srgb, var(--surface) 90%, var(--composer-tint, var(--surface)));
  --composer-outline: color-mix(in srgb, var(--border) 75%, var(--composer-tint-outline, var(--border)));
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
}
/* The DsInput carries its own border, background and radius. Inside the
   pill they would draw a box around the text, so they are reset here.
   The class lands on the primitive's root element, so the selector has
   to match that element itself — a descendant selector
   (`.chat-composer__field .ds-input`) never matches anything, and the
   reset silently does nothing while the comment above it claims it
   works. The wrapper class is part of the selector to out-specify the
   primitive's own rule, whatever order the two stylesheets land in. */
.chat-composer .chat-composer__field {
  background: transparent;
  border: none;
  border-radius: 0;
  padding: var(--space-xs) var(--space-xs);
  resize: none;
}

/* The focus ring belongs to the pill the field lives in, not to a box
   drawn inside it. */
.chat-composer:focus-within {
  border-color: var(--accent);
  box-shadow: 0 0 0 3px var(--accent-muted);
}
.chat-composer .chat-composer__field:focus,
.chat-composer .chat-composer__field:focus-visible {
  box-shadow: none;
  outline: none;
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
