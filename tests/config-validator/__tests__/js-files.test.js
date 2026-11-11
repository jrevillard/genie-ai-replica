const { stripJsComments } = require('../validators/js-files');

/**
 * Unit spec for the comment stripper the e2e gates read with.
 *
 * The gates watch CODE: a comment that names the contract must not fail
 * the gate that watches it. The stripper is a heuristic, not a parser —
 * but the shapes it must get right are pinned here, because each one is
 * a way the scanner can end up in the wrong state and let prose through
 * as code.
 */
describe('the stripper removes prose and keeps code', () => {
  test('a line comment is stripped', () => {
    const out = stripJsComments('const a = 1;\n// the edge was https://localhost/\nconst b = 2;\n');
    expect(out).not.toContain('the edge was');
    expect(out).toContain('const a = 1;');
  });

  test('a block comment is stripped', () => {
    const out = stripJsComments('const a = 1;\n/* the edge was https://localhost/ */\nconst b = 2;\n');
    expect(out).not.toContain('the edge was');
  });

  test('a comment inside a string is not a comment', () => {
    const out = stripJsComments("const url = 'https://localhost/';\n// the edge\n");
    expect(out).toContain("'https://localhost/'");
    expect(out).not.toContain('the edge');
  });

  test('a regex literal after a keyword is a regex — and the comment after it is stripped', () => {
    // `return /…/` opens a regex, not a division. Reading it as a
    // division flips the scanner into string state, and the rest of the
    // file — comments included — survives the strip.
    const out = stripJsComments("function f() { return /';/; }\n// the edge was https://localhost/\n");
    expect(out).not.toContain('the edge was');
  });

  test('a division after a member name is a division', () => {
    // `obj.return / 2` is a division: the keyword test must not fire on
    // a member name, or the scanner swallows the rest of the file.
    const out = stripJsComments('function f() { obj.return / 2; }\n// the edge was https://localhost/\n');
    expect(out).not.toContain('the edge was');
  });

  test('a nested template inside a template expression is code, not prose', () => {
    // `\`${a(`\${B}/c`)}\`` — the inner backtick closes the OUTER
    // template for a scanner that does not know about the expression.
    // The scanner then reads the rest of the file in the wrong state,
    // and the comments survive the strip as code.
    const out = stripJsComments('const u = `${a(`${B}/c`)}`;\n// the edge was https://localhost/\n');
    expect(out).not.toContain('the edge was');
  });

  test('a slash inside a regex character class does not end the literal', () => {
    // The class holds a slash ([A-Za-z0-9_./-]): a literal that ends there
    // would leave the scanner in the wrong state, and the comment below
    // would survive as CODE — so this input is the one that separates
    // the stripper that tracks the class from the one that does not.
    const out = stripJsComments('const re = /[A-Za-z0-9_./-]+/;\n// the edge was https://localhost/\n');
    expect(out).not.toContain('the edge was');
    // The code before the comment is untouched — a stripper that merely
    // dropped the comment would pass the line above.
    expect(out).toContain('const re = /[A-Za-z0-9_./-]+/;');
  });

  test('a division after a plain expression is a division', () => {
    const out = stripJsComments('function f() { a / b; }\n// the edge was https://localhost/\n');
    expect(out).not.toContain('the edge was');
  });
});
