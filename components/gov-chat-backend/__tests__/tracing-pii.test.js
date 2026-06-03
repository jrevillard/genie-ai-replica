const {
  redactValue,
  isSensitiveKey,
  redactAttributes,
  SENSITIVE_KEY_PATTERNS,
} = require("../tracing-pii");

describe("tracing-pii.js", () => {
  describe("isSensitiveKey", () => {
    it("matches password (case-insensitive)", () => {
      expect(isSensitiveKey("password")).toBe(true);
      expect(isSensitiveKey("PASSWORD")).toBe(true);
      expect(isSensitiveKey("UserPassword")).toBe(true);
    });

    it("matches token", () => {
      expect(isSensitiveKey("access_token")).toBe(true);
      expect(isSensitiveKey("refreshToken")).toBe(true);
      expect(isSensitiveKey("TOKEN")).toBe(true);
    });

    it("matches secret", () => {
      expect(isSensitiveKey("client_secret")).toBe(true);
      expect(isSensitiveKey("SecretKey")).toBe(true);
    });

    it("matches authorization", () => {
      expect(isSensitiveKey("authorization")).toBe(true);
      expect(isSensitiveKey("Authorization")).toBe(true);
    });

    it("matches credential", () => {
      expect(isSensitiveKey("credentials")).toBe(true);
      expect(isSensitiveKey("AWSCredential")).toBe(true);
    });

    it("matches api_key and apiKey", () => {
      expect(isSensitiveKey("api_key")).toBe(true);
      expect(isSensitiveKey("apiKey")).toBe(true);
      expect(isSensitiveKey("X-API-KEY")).toBe(true);
    });

    it("does not match non-sensitive keys", () => {
      expect(isSensitiveKey("http.method")).toBe(false);
      expect(isSensitiveKey("db.system")).toBe(false);
      expect(isSensitiveKey("service.name")).toBe(false);
      expect(isSensitiveKey("content-type")).toBe(false);
      expect(isSensitiveKey("url")).toBe(false);
    });
  });

  describe("redactValue", () => {
    it("redacts email addresses", () => {
      expect(redactValue("user: john@example.com")).toBe("user: [REDACTED]");
      expect(redactValue("contact admin@corp.co.uk please")).toBe(
        "contact [REDACTED] please",
      );
    });

    it("redacts Bearer tokens", () => {
      expect(redactValue("Bearer abc123def456")).toBe("[REDACTED]");
      expect(redactValue("bearer xyz789")).toBe("[REDACTED]");
    });

    it("redacts multiple emails in same string", () => {
      expect(redactValue("from:a@b.com to:c@d.com")).toBe(
        "from:[REDACTED] to:[REDACTED]",
      );
    });

    it("returns non-string values unchanged", () => {
      expect(redactValue(42)).toBe(42);
      expect(redactValue(true)).toBe(true);
      expect(redactValue(null)).toBe(null);
      expect(redactValue(undefined)).toBe(undefined);
    });

    it("leaves clean strings untouched", () => {
      expect(redactValue("GET /api/health 200")).toBe("GET /api/health 200");
    });
  });

  describe("redactAttributes", () => {
    it("returns null for null input", () => {
      expect(redactAttributes(null)).toBeNull();
    });

    it("returns undefined for undefined input", () => {
      expect(redactAttributes(undefined)).toBeUndefined();
    });

    it("returns empty object for empty input", () => {
      expect(redactAttributes({})).toEqual({});
    });

    it("redacts sensitive keys with [REDACTED]", () => {
      expect(redactAttributes({ password: "secret", token: "abc" })).toEqual({
        password: "[REDACTED]",
        token: "[REDACTED]",
      });
    });

    it("redacts emails in non-sensitive string values", () => {
      expect(redactAttributes({ user_info: "john@example.com" })).toEqual({
        user_info: "[REDACTED]",
      });
    });

    it("redacts Bearer tokens in non-sensitive string values", () => {
      expect(redactAttributes({ header: "Bearer abc123" })).toEqual({
        header: "[REDACTED]",
      });
    });

    it("preserves numeric and boolean values", () => {
      expect(redactAttributes({ status: 200, active: true, count: 0 })).toEqual(
        {
          status: 200,
          active: true,
          count: 0,
        },
      );
    });

    it("preserves safe attribute keys", () => {
      const safe = {
        "http.method": "GET",
        "http.status_code": 200,
        "db.system": "arangodb",
        "db.name": "genie_db",
        "db.operation": "FOR",
        "db.collection": "users",
        "service.name": "genie-backend",
        "service.version": "1.0.0",
      };
      expect(redactAttributes(safe)).toEqual(safe);
    });

    it("handles mixed sensitive and safe attributes", () => {
      const result = redactAttributes({
        "http.method": "POST",
        password: "hunter2",
        "db.collection": "users",
        authorization: "Bearer xyz",
        "http.status_code": 201,
      });
      expect(result).toEqual({
        "http.method": "POST",
        password: "[REDACTED]",
        "db.collection": "users",
        authorization: "[REDACTED]",
        "http.status_code": 201,
      });
    });

    it("handles string containing both email and Bearer token", () => {
      const result = redactAttributes({
        raw_header: "Authorization: Bearer tok123 for admin@example.com",
      });
      expect(result.raw_header).toBe(
        "Authorization: [REDACTED] for [REDACTED]",
      );
    });
  });

  describe("SENSITIVE_KEY_PATTERNS", () => {
    it("contains exactly 6 patterns", () => {
      expect(SENSITIVE_KEY_PATTERNS).toHaveLength(6);
    });

    it("each pattern is a RegExp", () => {
      SENSITIVE_KEY_PATTERNS.forEach((p) => {
        expect(p).toBeInstanceOf(RegExp);
      });
    });
  });
});
