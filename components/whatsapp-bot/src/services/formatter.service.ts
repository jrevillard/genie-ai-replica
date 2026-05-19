import { MAX_WHATSAPP_MESSAGE_LENGTH } from "../types/common.types.js";
import type { SourceDocument } from "../types/genieai.types.js";

/**
 * Convert markdown formatting to WhatsApp-compatible formatting.
 * WhatsApp supports: *bold*, _italic_, ~strikethrough~, ```monospace```
 */
export function markdownToWhatsApp(text: string): string {
  let result = text;

  // Headers: ## Header → *HEADER*
  result = result.replace(/^#{1,6}\s+(.+)$/gm, (_match, content: string) => `*${content.toUpperCase()}*`);

  // Bold: **text** → *text*
  result = result.replace(/\*\*(.+?)\*\*/g, "*$1*");

  // Italic: _text_ stays as _text_ (already WhatsApp compatible)
  // But __text__ (markdown bold alt) → *text*
  result = result.replace(/__(.+?)__/g, "*$1*");

  // Strikethrough: ~~text~~ → ~text~
  result = result.replace(/~~(.+?)~~/g, "~$1~");

  // Code blocks: ```code``` stays as is (WhatsApp supports)

  // Inline code: `code` → ```code``` (WhatsApp monospace)
  result = result.replace(/(?<!`)(`(?!`))([^`]+?)(`(?!`))/g, "```$2```");

  // Unordered lists: - item or * item → • item
  result = result.replace(/^[\s]*[-*]\s+/gm, "• ");

  // Ordered lists: 1. item → 1. item (keep as is, readable)

  // Images: ![alt](url) → remove entirely (must be before links)
  result = result.replace(/!\[[^\]]*\]\([^)]+\)/g, "");

  // Links: [text](url) → text (url)
  result = result.replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1 ($2)");

  // Horizontal rules: --- → ───────
  result = result.replace(/^-{3,}$/gm, "───────");

  // Strip HTML tags
  result = result.replace(/<[^>]+>/g, "");

  // Collapse multiple blank lines
  result = result.replace(/\n{3,}/g, "\n\n");

  return result.trim();
}

/**
 * Format source citations for WhatsApp
 */
export function formatCitations(sources: SourceDocument[], maxSources = 3): string {
  if (sources.length === 0) return "";

  const lines = sources.slice(0, maxSources).map((src) => {
    const title = src.text?.slice(0, 60) ?? src.document_id ?? "Source";
    const score = src.score != null ? ` (confidence: ${Math.round(src.score * 100)}%)` : "";
    return `📄 _${title}${score}_`;
  });

  return `\n\n───────\n${lines.join("\n")}`;
}

/**
 * Split a long message into chunks that fit WhatsApp's limit,
 * splitting at paragraph boundaries.
 */
export function splitMessage(text: string, maxLength = MAX_WHATSAPP_MESSAGE_LENGTH): string[] {
  if (text.length <= maxLength) return [text];

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > maxLength) {
    // Try to split at a paragraph boundary
    let splitAt = remaining.lastIndexOf("\n\n", maxLength);
    if (splitAt === -1 || splitAt < maxLength * 0.3) {
      // Fall back to sentence boundary
      splitAt = remaining.lastIndexOf(". ", maxLength);
    }
    if (splitAt === -1 || splitAt < maxLength * 0.3) {
      // Fall back to word boundary
      splitAt = remaining.lastIndexOf(" ", maxLength);
    }
    if (splitAt === -1) {
      // Hard cut as last resort
      splitAt = maxLength;
    }

    chunks.push(remaining.slice(0, splitAt).trim());
    remaining = remaining.slice(splitAt).trim();
  }

  if (remaining.length > 0) {
    chunks.push(remaining);
  }

  return chunks;
}

/**
 * Full pipeline: format a Genie AI response for WhatsApp delivery
 */
export function formatBotResponse(
  responseText: string,
  sources?: SourceDocument[],
): string[] {
  let formatted = markdownToWhatsApp(responseText);

  if (sources && sources.length > 0) {
    formatted += formatCitations(sources);
  }

  return splitMessage(formatted);
}
