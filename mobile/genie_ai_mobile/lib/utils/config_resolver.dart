/// Resolve a config value that may be a locale map or plain string.
///
/// Config values for prompts and welcome messages use locale maps:
///   {"en": "Hello", "es": "Hola"}
///
/// Falls back to 'en', then the first available value.
String resolveConfigText(dynamic value, String locale) {
  if (value is Map) {
    // The first NON-EMPTY text wins — the web's `||` chain: a null key
    // falls through, and so does an empty string (an untranslated
    // placeholder), which would otherwise blank the card the web
    // resolves to its English text.
    for (final candidate in [
      value[locale],
      value['en'],
      if (value.values.isNotEmpty) value.values.first,
    ]) {
      final text = candidate?.toString();
      if (text != null && text.isNotEmpty) return text;
    }
    return '';
  }
  return value?.toString() ?? '';
}

/// The config value as a map — the ONE container guard every config
/// descent uses. A value that is not a map (a string, a list, null: the
/// config-typo class) degrades to the EMPTY map, never a throw; the
/// callers' key reads then resolve to null and the section defaults.
Map<String, dynamic> configMapOf(dynamic value) {
  return value is Map<String, dynamic> ? value : const {};
}
