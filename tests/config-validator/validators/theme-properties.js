/**
 * A theme.properties file is a Java properties file.
 *
 * `java.util.Properties.load` reads it, so a `:` separator and a
 * backslash continuation are as valid as `=`, the value carries the
 * escapes Java resolves, and a malformed `\u` escape is a broken file
 * rather than a literal.
 *
 * The file is read as UTF-8. Keycloak reads it with
 * `java.util.PropertyResourceBundle`, which reads the stream as UTF-8
 * on the JDK 9 and later it requires and applies the parsing rules of
 * `java.util.Properties.load(Reader)` — the rules this module
 * implements.
 *
 * The reading lives in its own module: it is a reading of the Java
 * format, not a rule of the theme guard, and the differential harness
 * checks it against the JVM on its own.
 *
 * The hand-written cases of the suite are this reader's whole CI
 * surface by design: the four rules left unpinned (the `\t` escape, the
 * `!` comment, the CRLF line ending and the trailing backslash at EOF)
 * fail towards a false positive, never towards a silent ship.
 */
const fs = require('fs');

/**
 * The whitespace java.util.Properties skips: a space, a tab and a form
 * feed. A vertical tab and a non-breaking space are ordinary
 * characters there.
 */
const WHITESPACE = /[ \t\f]/;

/**
 * The escapes java.util.Properties resolves into a single character.
 */
const SIMPLE_ESCAPES = { t: '\t', n: '\n', r: '\r', f: '\f' };

/**
 * A theme.properties file java.util.Properties would refuse to read.
 */
class PropertiesError extends Error {
  /**
   * @param {string} file the file
   * @param {string} reason why it is invalid
   */
  constructor(file, reason) {
    super(`${file}: ${reason}`);
    this.name = 'PropertiesError';
    this.file = file;
    this.reason = reason;
  }
}

/**
 * The whitespace at the start of a line, which java.util.Properties
 * skips.
 *
 * @param {string} text the line
 * @returns {string} the line without its leading whitespace
 */
function stripLeadingWhitespace(text) {
  return text.replace(/^[ \t\f]+/, '');
}

/**
 * The escapes of a key or of a value, resolved the way
 * java.util.Properties resolves them.
 *
 * A `\u` that is not followed by four hex digits is not a literal: the
 * loader throws, so the file is broken.
 *
 * @param {string} text the raw key or value
 * @param {string} file the file it comes from
 * @returns {string} the resolved text
 */
function unescape(text, file) {
  let result = '';
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char !== '\\') {
      result += char;
      continue;
    }
    const escaped = text[index + 1];
    index += 1;
    if (escaped === undefined) {
      // The backslash escapes the newline that follows it. There is
      // none, so the backslash goes away with it.
      continue;
    }
    if (escaped === 'u') {
      const code = text.slice(index + 1, index + 5);
      if (!/^[0-9a-fA-F]{4}$/.test(code)) {
        throw new PropertiesError(file, 'Malformed \\uxxxx encoding.');
      }
      result += String.fromCharCode(parseInt(code, 16));
      index += 4;
      continue;
    }
    result += Object.hasOwn(SIMPLE_ESCAPES, escaped) ? SIMPLE_ESCAPES[escaped] : escaped;
  }
  return result;
}

/**
 * Whether a line ends with an odd number of backslashes — a backslash
 * continuation, which joins the next line to this one.
 *
 * @param {string} text the line
 * @returns {boolean} true when the line continues on the next one
 */
function endsWithContinuation(text) {
  let backslashes = 0;
  for (let index = text.length - 1; index >= 0 && text[index] === '\\'; index -= 1) {
    backslashes += 1;
  }
  return backslashes % 2 === 1;
}

/**
 * The key and the value of a logical line.
 *
 * The key ends at the first unescaped `=`, `:` or whitespace. The
 * whitespace before the separator is skipped, and so is the whitespace
 * after it; the value keeps its trailing whitespace, as Java's loader
 * keeps it.
 *
 * @param {string} line the logical line
 * @param {string} file the file it comes from
 * @returns {[string, string]} the key and the value
 */
function splitProperty(line, file) {
  let index = 0;
  let separator = null;
  while (index < line.length) {
    const char = line[index];
    if (char === '\\') {
      // An escaped character is never a separator.
      index += 2;
      continue;
    }
    if (char === '=' || char === ':') {
      separator = char;
      break;
    }
    if (WHITESPACE.test(char)) {
      separator = ' ';
      break;
    }
    index += 1;
  }

  if (separator === null) {
    return [unescape(line, file), ''];
  }

  const key = line.slice(0, index);
  index += 1;
  while (index < line.length && WHITESPACE.test(line[index])) index += 1;
  if (separator === ' ' && (line[index] === '=' || line[index] === ':')) {
    // A separator right after the whitespace separates as well.
    index += 1;
    while (index < line.length && WHITESPACE.test(line[index])) index += 1;
  }
  return [unescape(key, file), unescape(line.slice(index), file)];
}

/**
 * The `key=value` pairs of a properties file's content, read the way
 * java.util.Properties reads them.
 *
 * A comment is a `#` or a `!` at the start of a physical line: it ends
 * there, and the next physical line is a line of its own. A `#` inside
 * a value is text.
 *
 * @param {string} text the content
 * @param {string} file the file it comes from, for the error message
 * @returns {Object} the properties
 */
function parseProperties(text, file) {
  const properties = Object.create(null);
  const lines = text.split(/\r\n|\r|\n/);
  let index = 0;
  while (index < lines.length) {
    const natural = stripLeadingWhitespace(lines[index]);
    index += 1;
    if (!natural) continue;
    if (natural.startsWith('#') || natural.startsWith('!')) continue;

    // A line that ends with an odd number of backslashes continues on
    // the next one: the last backslash escapes the newline, which goes
    // away with it.
    let logical = natural;
    while (endsWithContinuation(logical) && index < lines.length) {
      logical = logical.slice(0, -1) + stripLeadingWhitespace(lines[index]);
      index += 1;
    }
    if (endsWithContinuation(logical)) {
      // The last backslash escapes a newline that is not there.
      logical = logical.slice(0, -1);
    }

    const [key, value] = splitProperty(logical, file);
    properties[key] = value;
  }
  return properties;
}

/**
 * The `key=value` pairs of a properties file, read the way
 * java.util.Properties reads them.
 *
 * @param {string} file path of the file
 * @returns {Object} the properties
 */
function readProperties(file) {
  return parseProperties(fs.readFileSync(file, 'utf8'), file);
}

module.exports = { readProperties, PropertiesError };
