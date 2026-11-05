/// The mobile's config-reading layer: the rules the web's config
/// resolver applies, mirrored so both platforms read one deployment
/// the same way.
///
/// It owns five rules:
/// - the container guard ([configMapOf]) every config descent uses;
/// - the guarded descent ([configSectionOf]) down a path of keys;
/// - the truthiness of a config flag ([configTruthy]) — the web's
///   `value || default`, whose falsy set JS and Dart share;
/// - the form of a config VALUE ([jsFormOf]) — the web's own
///   serialization, which Dart's `toString` does not reproduce for a
///   number;
/// - the text of a locale map ([resolveConfigText]) and of the chat's
///   welcome message ([resolveWelcomeMessage]).
///
/// The Quick Help CARDS are read elsewhere: `components/chat/
/// quick_help_scope.dart` owns the button rules, this layer owns the
/// config they come from.
library;

/// Resolve a config value that may be a locale map or plain string.
///
/// Config values for prompts and welcome messages use locale maps:
///   {"en": "Hello", "es": "Hola"}
///
/// The mobile's mirror of the web's `value[locale] || value['en'] ||
/// Object.values(value)[0] || ''` chain, for a LOCALE MAP: the first
/// NON-EMPTY value wins — an absent key, an empty string (an
/// untranslated placeholder) and a falsy scalar (a numeric typo) all
/// fall through to the next candidate.
///
/// A value that is not a map resolves as the scalar it is (a falsy
/// scalar to no text at all). A LIST renders as its elements joined
/// with commas on both platforms — the web's template calls the
/// array's `toString`, which joins — and the mobile joins it the same
/// way, ONE rule wherever the list nests. A NUMBER renders in the
/// web's own number form ([jsFormOf]) wherever it is rendered.
String resolveConfigText(dynamic value, String locale) {
  if (value is Map) {
    // The first NON-EMPTY text wins — the web's `||` chain: a null key
    // falls through, and so does an empty string (an untranslated
    // placeholder) or a falsy scalar (a numeric typo), which would
    // otherwise blank the card the web resolves to its English text.
    for (final candidate in [
      value[locale],
      value['en'],
      if (value.values.isNotEmpty) value.values.first,
    ]) {
      // A falsy value (0, false) is no text — the web's `||` chain
      // skips it and falls through to the next candidate.
      if (candidate is String) {
        if (candidate.isNotEmpty) return candidate;
      } else if (configTruthy(candidate)) {
        // configTruthy(null) is false, so jsFormOf cannot return null
        // here. A list renders through jsFormOf's own recursive join.
        return jsFormOf(candidate)!;
      }
    }
    return '';
  }
  // A scalar the web's `value || ''` reads as falsy (0, false) is no
  // text. A truthy number renders in the WEB's number form
  // (jsFormOf): the web's template stringifies it with String(),
  // which drops the '.0' Dart keeps ('5' there, '5.0' here) - a
  // divergence only a malformed configuration produces.
  if (value is String) return value;
  // configTruthy(null) is false, so jsFormOf cannot return null here.
  return configTruthy(value) ? jsFormOf(value)! : '';
}

/// The config value as a map — the ONE container guard every config
/// descent uses. A value that is not a map (a string, a list, null: the
/// config-typo class) degrades to the EMPTY map, never a throw; the
/// callers' key reads then resolve to null and the section defaults.
Map<String, dynamic> configMapOf(dynamic value) {
  return value is Map<String, dynamic> ? value : const {};
}

/// The config section at [path] — a guarded descent, one key at a time.
/// A non-map node anywhere on the path degrades to the EMPTY map, the
/// same rule configMapOf applies to a single lookup.
Map<String, dynamic> configSectionOf(
  Map<String, dynamic> config,
  List<String> path,
) {
  var node = config;
  for (final key in path) {
    node = configMapOf(node[key]);
  }
  return node;
}

/// Whether [value] reads as TRUE the way the web's JavaScript truthiness
/// does — the falsy set a JSON config can carry is null, false, 0 and
/// ''. Every config gate (the welcome message, the hidden button flag)
/// shares this one read, so a numeric-typed typo degrades the same way
/// on both platforms.
bool configTruthy(dynamic value) {
  if (value is double && value.isNaN) return false;
  return value != null && value != false && value != 0 && value != '';
}

/// The value in the form JAVASCRIPT writes it — the ONE serialization
/// policy a config value follows on this platform: the text a card
/// displays, the id a conversation is tagged with and the category a
/// card points at all read the SAME form, so the two platforms never
/// disagree about what a config value says. null for a null input.
///
/// Dart's double toString differs from JS's Number.toString in TWO
/// ways for the values the two platforms hold in common: an integral
/// double in the plain range (below 1e21) gets a '.0' suffix (5.0 →
/// '5.0', JS: '5'), and a negative zero prints '-0' where JS writes
/// '0' — both normalized here (the digits themselves are identical at
/// every magnitude: the int64 conversion is exact below 2^63; above it
/// the plain-digit form is written straight from the double, which is
/// what JS prints too). The exponential range (≥ 1e21) already matches
/// unstripped. The band that stays unmatched is BY DECODE, not by this
/// form: an integer LITERAL above 2^53 decodes to an imprecise double
/// on the web but to the exact int64 here — the two platforms then
/// disagree about the value itself, and a web-saved conversation
/// carries the imprecise tag and misses this platform's index. A
/// configuration with an id that large is not one the platforms can
/// agree on at all: the FORM is the same on both platforms (each
/// writes the string form at the conversation boundary, and each restore
/// reads the string form), so what stays unmatched is the VALUE the two
/// decoders produced — no boundary rule can close that band.
String? jsFormOf(dynamic raw) {
  if (raw == null) return null;
  // A truthy Map (a malformed config) renders as the web's template
  // default renders any object — '[object Object]' — where Dart's own
  // toString would write a Dart map literal.
  if (raw is Map) return '[object Object]';
  // A List renders as the web's array join: every element in the SAME
  // form, recursively, joined with ',' — ONE rule for the shape
  // wherever it nests (a bare title, a locale-map value or an element
  // inside another list). A null element renders empty, JS's own join
  // rule; Dart's own toString would write '[1, 2]'.
  if (raw is List) return raw.map((e) => jsFormOf(e) ?? '').join(',');
  if (raw is double && raw.isFinite && raw == raw.truncateToDouble()) {
    // JS String(-0) is '0' — Dart prints '-0'.
    if (raw == 0) return '0';
    final plain = raw.toString();
    // ≥ 1e21 prints exponential ('1e+21', matching JS, no suffix to
    // strip); below it an integral double ends in '.0'.
    return plain.endsWith('.0') ? plain.substring(0, plain.length - 2) : plain;
  }
  return raw.toString();
}

/// The path to the chat's own section of a runtime configuration.
const List<String> chatConfigPath = <String>['features', 'chat'];

/// The welcome message the configuration declares, or null when it
/// declares none.
///
/// The web gates the RAW value's truthiness and can render an EMPTY
/// resolution (a declared map of empty strings becomes a blank bubble);
/// the mobile treats a config that resolves to nothing as UNDECLARED -
/// the built-in greeting shows instead. A falsy scalar or an empty
/// locale falls through on both platforms alike.
String? resolveWelcomeMessage(Map<String, dynamic> config, String locale) {
  final welcome = configSectionOf(config, chatConfigPath)['welcomeMessage'];
  final resolved = resolveConfigText(welcome, locale);
  return resolved.isNotEmpty ? resolved : null;
}
