/// The mobile's config-reading layer: the rules the web's config
/// resolver applies, mirrored so both platforms read one deployment
/// the same way.
///
/// It owns four rules:
/// - the container guard ([configMapOf]) every config descent uses;
/// - the guarded descent ([configSectionOf]) down a path of keys;
/// - the truthiness of a config flag ([configTruthy]) — the web's
///   `value || default`, whose falsy set JS and Dart share;
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
/// scalar to no text at all). A LIST is not a text value and the two
/// platforms render it differently (the web dumps it as JSON) — see the
/// branch below.
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
        return candidate.toString();
      }
    }
    return '';
  }
  // A scalar the web's `value || ''` reads as falsy (0, false) is no
  // text; a truthy number keeps its string form, as the web renders it.
  if (value is String) return value;
  // A list is not a text value. The web dumps it as JSON and the mobile
  // renders it as one comma-joined line - neither is the other
  // platform's rendering, and both only happen for a malformed
  // configuration; a card label stays a single line here.
  if (value is List) {
    return value.map((element) => element.toString()).join(',');
  }
  return configTruthy(value) ? value.toString() : '';
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
