'use strict';

/**
 * Write one client SSE frame. JSON.stringify escapes quotes and newlines, so
 * a value cannot terminate the `data:` frame or inject a second event; the
 * client renders message content through DOMPurify (ChatBotComponent.vue).
 * ONE encoding home for every client frame — the legacy relay, the unit
 * relay and the agentic frame writer all write through it, so a wire-format
 * change lands once.
 * @param {Object} res - The Express response.
 * @param {Object} payload - The frame object (the `type` discriminator inside).
 */
function writeSSEFrame(res, payload) {
  // nosemgrep: nodejs_scan.javascript-xss-rule-express_xss
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

module.exports = { writeSSEFrame };
