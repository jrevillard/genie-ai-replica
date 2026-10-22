import { marked } from 'marked';
import DOMPurify from 'dompurify';

marked.use({
  gfm: true,
  breaks: true,
  // Disable indented-code so replies with 4-space-aligned plain text don't
  // render as code boxes; fenced ``` blocks still work.
  tokenizer: {
    code() {
      return undefined;
    },
  },
});

DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  if (node.tagName === 'A') {
    node.setAttribute('target', '_blank');
    node.setAttribute('rel', 'noopener noreferrer');
  }
});

/** Markdown → sanitized HTML. Consume via v-html only. */
export function renderMarkdown(text: string): string {
  if (!text) return '';
  const html = marked.parse(text, { async: false });
  return DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true },
    FORBID_TAGS: ['img'],
    ADD_ATTR: ['target', 'rel'],
  });
}
