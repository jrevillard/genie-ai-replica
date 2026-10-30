/// Resolve a config value that may be a locale map or plain string.
///
/// Config values for prompts and welcome messages use locale maps:
///   {"en": "Hello", "es": "Hola"}
///
/// Falls back to 'en', then the first available value.
String resolveConfigText(dynamic value, String locale) {
  if (value is Map) {
    // An EMPTY map declares no text in any language — `.values.first`
    // would throw on it instead of degrading to the empty string.
    if (value.isEmpty) {
      return '';
    }
    return value[locale]?.toString() ??
        value['en']?.toString() ??
        value.values.first?.toString() ??
        '';
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
