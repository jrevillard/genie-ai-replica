/**
 * Standalone smoke test for src/i18n/v2_optin.js.
 *
 * Lives here (under scripts/, NOT src/) so Vite never scans it. The
 * file imports the real module from src/, wraps it in a minimal
 * browser shim, and exercises header-injection behavior end to end.
 *
 * Run from components/frontend/:
 *   node scripts/v2_optin.smoke.mjs
 */

const store = {};

globalThis.window = {
  localStorage: {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
  },
  console: { debug: () => {} },
};
globalThis.localStorage = globalThis.window.localStorage;

const calls = [];
globalThis.window.fetch = async (resource, init) => {
  const url = typeof resource === "string" ? resource : (resource && resource.url) || "";
  let headerValue = null;
  if (init && init.headers) {
    const h = new Headers(init.headers);
    headerValue = h.get("X-Translation-Pipeline");
  } else if (resource && resource.headers) {
    const h = new Headers(resource.headers);
    headerValue = h.get("X-Translation-Pipeline");
  }
  calls.push({ url, header: headerValue });
  return { ok: true, json: async () => ({}) };
};

await import("../src/i18n/v2_optin.js");

const fetch = globalThis.window.fetch;
const { __aminaUseV2 } = globalThis.window;

let failures = 0;
function check(cond, label) {
  if (!cond) {
    console.error("FAIL:", label, "— last call:", calls.at(-1));
    failures += 1;
  } else {
    console.log("pass:", label);
  }
}

await fetch("/api/v1/agent/translate", { method: "POST" });
check(calls.at(-1).header === null, "flag OFF: no header on /translate");

__aminaUseV2(true);
await fetch("/api/v1/agent/translate", { method: "POST" });
check(calls.at(-1).header === "v2", "flag ON: header on /translate");

await fetch("/api/v1/agent/translate/batch", { method: "POST" });
check(calls.at(-1).header === "v2", "flag ON: header on /translate/batch");

await fetch("/api/v1/agent/chat", { method: "POST" });
check(calls.at(-1).header === null, "flag ON + non-translate URL: no header");

await fetch("/api/v1/agent/translate/other-thing", { method: "POST" });
check(calls.at(-1).header === null, "flag ON + /translate/other: no header");

await fetch("/api/v1/agent/translate?ts=1", { method: "POST" });
check(calls.at(-1).header === "v2", "flag ON + query string: header on /translate");

__aminaUseV2(false);
await fetch("/api/v1/agent/translate", { method: "POST" });
check(calls.at(-1).header === null, "disable: reverts to no header");

check(__aminaUseV2() === false, "query: disabled state");
__aminaUseV2(true);
check(__aminaUseV2() === true, "query: enabled state");

console.log();
if (failures > 0) {
  console.error(`${failures} assertion(s) failed`);
  process.exit(1);
} else {
  console.log("v2_optin smoke: all assertions passed");
}
