// Copyright (C) 2026 International Telecommunication Union (ITU)
// SPDX-License-Identifier: Apache-2.0
// ADVISORY rule-based PII pre-check (ADR-okf-004 rev) — used ONLY by the
// in-editor feedback surface (FR-25/Story 4.2) for instant typing hints.
// This is NOT the authoritative gate: the Presidio sidecar (pii-client) is.
// A false negative here is cosmetic, not a compliance event.

const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const PHONE_RE = /(?:\+?\d{1,3}[\s.-]?)?(?:\(\d{2,4}\)[\s.-]?)?\d{3}[\s.-]?\d{3,4}(?:[\s.-]?\d{3,4})?/g;
const IBAN_RE = /\b[A-Z]{2}\d{2}[A-Z0-9]{11,30}\b/g;
const CC_RE = /\b(?:\d[ -]?){13,19}\b/g;

/** Luhn check — filters digit runs that are not credit cards. */
function luhnOk(digits) {
  const s = digits.replace(/[^0-9]/g, '');
  if (s.length < 13 || s.length > 19) return false;
  let sum = 0;
  let dbl = false;
  for (let i = s.length - 1; i >= 0; i--) {
    let d = s.charCodeAt(i) - 48;
    if (dbl) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    dbl = !dbl;
  }
  return sum % 10 === 0;
}

/**
 * Advisory scan — pure, instant, zero-dep.
 * @param {string} text
 * @returns {{ hits: Array<{type:string,start:number,end:number}>, counts_by_type: object }}
 */
function precheck(text) {
  const hits = [];
  const push = (type, re, extra) => {
    let m;
    re.lastIndex = 0;
    while ((m = re.exec(text)) !== null) {
      if (!extra || extra(m[0])) {
        hits.push({ type, start: m.index, end: m.index + m[0].length });
      }
    }
  };
  push('EMAIL_ADDRESS', EMAIL_RE);
  push('PHONE_NUMBER', PHONE_RE, (t) => t.replace(/\D/g, '').length >= 7);
  push('IBAN_CODE', IBAN_RE);
  push('CREDIT_CARD', CC_RE, luhnOk);
  const counts_by_type = {};
  hits.forEach((h) => {
    counts_by_type[h.type] = (counts_by_type[h.type] || 0) + 1;
  });
  return { hits, counts_by_type };
}

module.exports = { precheck };
