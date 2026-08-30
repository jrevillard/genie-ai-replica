// test-aql-regex-hardening.js — regression tests for the escapeRegExp hardening
// of dynamic RegExp construction in aql-to-sql.js. Run: node tests/test-aql-regex-hardening.js
//
// The translator builds RegExp objects by interpolating AQL identifiers and
// function-map keys. Today those are always \w+ captures or static strings, so
// metacharacters cannot appear — these tests pin that invariant: even when
// unusual content flows through the expression paths, translation must not
// throw from the dynamic RegExp construction itself.

const { AqlToSqlTranslator } = require('../aql-to-sql.js');

const translator = new AqlToSqlTranslator(['users', 'sessions', 'analytics']);

const CASES = [
  {
    name: 'nested FOR traversal (dynamic-regex path)',
    aql: 'FOR e IN edgeCollection FILTER e.userId == @uid FOR d IN documents FILTER d._id == e._to RETURN { name: d.nameEN }'
  },
  {
    name: 'LET + RETURN LENGTH (var-name \\b regex path)',
    aql: 'LET usersList = (FOR u IN users FILTER u.active == true RETURN u) RETURN LENGTH(usersList)'
  },
  {
    name: 'REMOVE (var-prefix regex path)',
    aql: 'FOR t IN tokens FILTER t.expired == true REMOVE t IN tokens'
  },
  {
    name: 'COLLECT (group-var regex path)',
    aql: 'FOR s IN sessions COLLECT userId = s.userId WITH COUNT INTO cnt RETURN { userId, cnt }'
  },
  {
    name: 'function map with parenthesised args (key regex path)',
    aql: 'FOR u IN users FILTER LOWER(u.loginName) == @name RETURN LENGTH(u.history)'
  },
  {
    name: 'metacharacters in string literals and bound values',
    aql: 'FOR u IN users FILTER u.name == "a(b)*c[d]" OR u.note == "x+y{z}" RETURN u'
  },
  {
    name: 'metacharacters in LIKE pattern via bind var',
    aql: 'FOR u IN users FILTER u.loginName LIKE @term RETURN u'
  },
  {
    name: 'expression function nested with odd spacing',
    aql: 'RETURN DATE_DIFF(DATE_NOW() , DATE_TIMESTAMP(@t) , "days")'
  }
];

let failed = 0;
for (const c of CASES) {
  try {
    const r = translator.translateQuery(c.aql, { term: '%(x)+y$', t: '2026-01-01' });
    if (!r || typeof r.sql !== 'string' || r.sql.length === 0) {
      console.log(`FAIL ${c.name}: empty translation result`);
      failed++;
    } else {
      console.log(`ok   ${c.name}`);
    }
  } catch (e) {
    console.log(`FAIL ${c.name}: threw ${e.message}`);
    failed++;
  }
}

// Direct grammar-violating inputs must not crash with a regex error either.
for (const bad of ['', '   ', 'RETURN {,}', 'FOR IN', 'LET = ( RETURN x']) {
  try {
    translator.translateQuery(bad, {});
    console.log(`ok   degenerate input ${JSON.stringify(bad)} (no throw)`);
  } catch (e) {
    const regexRelated = e instanceof SyntaxError || /Invalid regular expression/i.test(e.message);
    if (regexRelated) {
      console.log(`FAIL degenerate input ${JSON.stringify(bad)}: ${e.message}`);
      failed++;
    } else {
      // Non-regex translation errors on malformed AQL are acceptable behavior.
      console.log(`ok   degenerate input ${JSON.stringify(bad)} (non-regex error: ${e.message.slice(0, 40)})`);
    }
  }
}

console.log(failed === 0 ? '\nALL REGEX-HARDENING TESTS PASSED' : `\n${failed} FAILURES`);
process.exit(failed === 0 ? 0 : 1);
