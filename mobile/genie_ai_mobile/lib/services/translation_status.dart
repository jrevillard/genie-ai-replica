/// Whether the answer the caller reads is an answer that was not translated.
///
/// The backend reports what happened to the language of the answer:
/// `translation_status` is "ok" when the answer was translated, "refused"
/// when the requested language was refused, and "failed" when the translation
/// broke. The last two leave the English answer in place, so the client has
/// to be able to tell an untranslated answer from a translated one — an
/// English answer shown as if it were the requested language is the failure
/// the flag exists for.
///
/// No status at all means no translation was asked for: the answer was
/// written in the language the caller reads, and there is nothing to report.
bool isTranslationFailed(Map<String, dynamic>? metadata) {
  final Object? status = metadata?['translation_status'];
  return status is String && status != 'ok';
}
