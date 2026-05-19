import { describe, it, expect } from "vitest";
import { normalizePhoneNumber, toWhatsAppFormat } from "../../src/utils/phone.js";

describe("normalizePhoneNumber", () => {
  it("adds + prefix if missing", () => {
    expect(normalizePhoneNumber("2201234567")).toBe("+2201234567");
  });

  it("keeps + prefix if present", () => {
    expect(normalizePhoneNumber("+2201234567")).toBe("+2201234567");
  });

  it("strips spaces and dashes", () => {
    expect(normalizePhoneNumber("+220 123-4567")).toBe("+2201234567");
  });

  it("strips parentheses", () => {
    expect(normalizePhoneNumber("(220)1234567")).toBe("+2201234567");
  });

  it("trims whitespace", () => {
    expect(normalizePhoneNumber("  +2201234567  ")).toBe("+2201234567");
  });
});

describe("toWhatsAppFormat", () => {
  it("strips the + prefix", () => {
    expect(toWhatsAppFormat("+2201234567")).toBe("2201234567");
  });

  it("handles numbers without + prefix", () => {
    expect(toWhatsAppFormat("2201234567")).toBe("2201234567");
  });
});
