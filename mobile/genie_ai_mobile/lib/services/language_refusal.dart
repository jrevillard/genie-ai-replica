import 'dart:convert';

/// The code a refusal of the requested language carries.
const String unsupportedLanguageCode = 'UNSUPPORTED_LANGUAGE';

/// A request the backend refused, with the code it refused it with.
///
/// The backend answers a language the deployment cannot answer in with
/// `400` and a body that names the refused side:
/// `{"error": "UNSUPPORTED_LANGUAGE", "message": "..."}`. The message is the
/// backend's, in English — the client shows its own text, so it reads the
/// code and nothing else.
class LanguageRefusal implements Exception {
  const LanguageRefusal(this.code);

  /// The code the backend refused the request with.
  final String code;

  @override
  String toString() => 'LanguageRefusal($code)';
}

/// The code a refusal body carries, or null when the body carries none.
///
/// A body that is not JSON, or that carries no `error` field, is not a
/// refusal the client can explain: the caller gets the generic failure
/// message, exactly as it did before the codes were readable.
String? languageRefusalCode(String? body) {
  if (body == null || body.isEmpty) {
    return null;
  }
  try {
    final Object? decoded = jsonDecode(body);
    if (decoded is! Map) {
      return null;
    }
    final Object? error = decoded['error'];
    return error is String ? error : null;
  } on FormatException {
    return null;
  }
}
