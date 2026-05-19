import { describe, it, expect } from "vitest";
import {
  markdownToWhatsApp,
  formatCitations,
  splitMessage,
  formatBotResponse,
} from "../../src/services/formatter.service.js";

describe("markdownToWhatsApp", () => {
  it("converts markdown bold to WhatsApp bold", () => {
    expect(markdownToWhatsApp("This is **bold** text")).toBe("This is *bold* text");
  });

  it("converts markdown headers to uppercase bold", () => {
    expect(markdownToWhatsApp("## My Header")).toBe("*MY HEADER*");
  });

  it("converts markdown lists to bullet points", () => {
    expect(markdownToWhatsApp("- Item one\n- Item two")).toBe("• Item one\n• Item two");
  });

  it("converts links to text with URL", () => {
    expect(markdownToWhatsApp("[click here](https://example.com)")).toBe(
      "click here (https://example.com)",
    );
  });

  it("removes image tags", () => {
    expect(markdownToWhatsApp("text ![alt](url) more")).toBe("text  more");
  });

  it("strips HTML tags", () => {
    expect(markdownToWhatsApp("text <strong>bold</strong> more")).toBe("text bold more");
  });

  it("collapses multiple blank lines", () => {
    expect(markdownToWhatsApp("line1\n\n\n\nline2")).toBe("line1\n\nline2");
  });

  it("converts horizontal rules", () => {
    expect(markdownToWhatsApp("---")).toBe("───────");
  });
});

describe("formatCitations", () => {
  it("returns empty string for no sources", () => {
    expect(formatCitations([])).toBe("");
  });

  it("formats sources with confidence scores", () => {
    const result = formatCitations([
      { text: "WHO Guide", score: 0.92 },
      { text: "Health Tips", score: 0.85 },
    ]);
    expect(result).toContain("WHO Guide");
    expect(result).toContain("92%");
    expect(result).toContain("Health Tips");
  });

  it("limits to maxSources", () => {
    const sources = [
      { text: "Source 1", score: 0.9 },
      { text: "Source 2", score: 0.8 },
      { text: "Source 3", score: 0.7 },
      { text: "Source 4", score: 0.6 },
    ];
    const result = formatCitations(sources, 2);
    expect(result).toContain("Source 1");
    expect(result).toContain("Source 2");
    expect(result).not.toContain("Source 3");
  });
});

describe("splitMessage", () => {
  it("returns single chunk for short messages", () => {
    expect(splitMessage("Hello")).toEqual(["Hello"]);
  });

  it("splits long messages at paragraph boundaries", () => {
    const paragraph = "A".repeat(2000);
    const text = `${paragraph}\n\n${paragraph}\n\n${paragraph}`;
    const chunks = splitMessage(text);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(4096);
    }
  });

  it("handles text with no good split points", () => {
    const text = "A".repeat(5000);
    const chunks = splitMessage(text);
    expect(chunks.length).toBe(2);
  });
});

describe("formatBotResponse", () => {
  it("formats response with sources", () => {
    const parts = formatBotResponse("**Hello** world", [
      { text: "Source doc", score: 0.9 },
    ]);
    expect(parts[0]).toContain("*Hello*");
    expect(parts[0]).toContain("Source doc");
  });
});
