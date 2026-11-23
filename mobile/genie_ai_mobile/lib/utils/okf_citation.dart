/// OKF-concept citation identity — the mobile twin of the web's
/// `utils/okfCitation.js` and the `translateSources` branch of
/// `store/modules/conversation.js`.
///
/// An OKF concept is NOT a repository document: the concept's markdown never
/// becomes a doc-repo `files` doc (content-only chunking), so every
/// `/api/files/<concept_id>/view` URL 404s BY CONSTRUCTION. The citation
/// therefore carries its own stable identity (`source`, `concept_id`,
/// `repo_id`) and resolves through okf-server's concept route instead.
library;

/// The marker chatqna puts on an OKF-sourced citation.
const String kOkfConceptSource = 'okf-concept';

/// The identity a concept citation opens with.
class OkfConceptRef {
  /// The repository that serves the concept. Empty when the citation lost
  /// its repo identity (a pre-CAP-1 saved row) — the caller then resolves it
  /// live through okf-server.
  final String repoId;

  /// The concept id (the citation's stable slug).
  final String conceptId;

  const OkfConceptRef({required this.repoId, required this.conceptId});

  bool get hasRepoId => repoId.isNotEmpty;
}

/// Whether a citation row is an OKF concept rather than a repository document.
///
/// Two shapes are accepted, because two callers hold two shapes: the RAW
/// streamed/persisted citation (snake_case, as chatqna sends it) and a
/// TRANSLATED source row (camelCase). A caller must not have to know which
/// one it is holding.
bool isOkfConceptCitation(Map<String, dynamic> doc) {
  if (doc['source'] == kOkfConceptSource) return true;
  return _firstNonEmpty(doc, const ['concept_id', 'conceptId']) != null;
}

/// The concept a citation row points at, or null when the row names none.
///
/// The concept id falls back to the citation's document id: chatqna mints the
/// document id FROM the concept id, so a row that carries the marker but no
/// explicit `concept_id` still names its concept.
OkfConceptRef? okfConceptRef(Map<String, dynamic> doc) {
  final conceptId =
      _firstNonEmpty(doc, const ['concept_id', 'conceptId']) ??
      _firstNonEmpty(doc, const ['document_id', 'documentId', 'id', '_id']);
  if (conceptId == null) return null;
  final repoId = _firstNonEmpty(doc, const ['repo_id', 'repoId']) ?? '';
  return OkfConceptRef(repoId: repoId, conceptId: conceptId);
}

String? _firstNonEmpty(Map<String, dynamic> doc, List<String> keys) {
  for (final key in keys) {
    final value = doc[key];
    if (value == null) continue;
    final text = value.toString().trim();
    if (text.isNotEmpty) return text;
  }
  return null;
}
