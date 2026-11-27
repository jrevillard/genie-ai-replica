// lib/okf/okf_citation.dart — the mobile mirror of the web's citation
// contract (components/gov-chat-frontend/src/utils/okfCitation.js).
//
// chatqna emits an OKF-sourced citation with a `source: 'okf-concept'`
// marker, the concept slug as its `document_id`, a human `document_name`
// and the `concept_id` — an OKF concept is not a doc-repository file, so
// the marker is the ONLY thing separating "look me up in doc-repo" from
// "I AM a concept".
//
// The mobile chat parses the RAW streamed rows (snake_case) while parts of
// the app work with mapped rows (camelCase) — the predicates below accept
// BOTH shapes so a caller never has to know which one it is holding.
// ONE definition is consumed by BOTH chat surfaces (the answer sources bar
// and the right sidebar) so they cannot drift (web review-r0 rule).

/// The marker chatqna puts on an OKF-sourced citation.
const String okfConceptSource = 'okf-concept';

/// The marker the agent service's projection puts on a web-sourced citation
/// (capabilities/citations.py — the BFF forwards it verbatim; the url is the
/// identity: document_id IS the url).
const String webSource = 'web';

String? _pick(Map doc, List<String> keys) {
  for (final key in keys) {
    final value = doc[key];
    if (value != null && value.toString().isNotEmpty) {
      return value.toString();
    }
  }
  return null;
}

/// Whether a citation is an OKF concept rather than a repository document.
///
/// Accepts the RAW streamed shape (snake_case) and the mapped shape
/// (camelCase). Null/empty rows are not OKF sources.
bool isOkfConceptSource(Map? doc) {
  if (doc == null || doc.isEmpty) return false;
  if (doc['source'] == okfConceptSource) return true;
  // ONLY the explicit concept fields qualify — document_id/id are present
  // on plain document rows too (the web predicate does the same).
  return _pick(doc, const ['concept_id', 'conceptId']) != null;
}

/// Whether a citation is a WEB result (a web_search tool hit the BFF
/// projects with the url as its identity).
bool isWebSource(Map doc) => doc['source'] == webSource;

/// Whether a citation row carries the BROWSE identity — a WORKING
/// okf-concept row WITH repo identity. A row that names a concept but lost
/// its repository (a pre-CAP-1 row) carries no identity HERE: the shared
/// opener resolves its repository live (okf_citation_open.dart), and a
/// legacy document is never browsable.
bool canBrowseSource(Map? doc) {
  if (doc == null || doc.isEmpty) return false;
  if (!isOkfConceptSource(doc)) return false;
  return citationRepoId(doc) != null && citationConceptId(doc) != null;
}

/// The repository id of a citation row, in either shape.
String? citationRepoId(Map doc) => _pick(doc, const ['repo_id', 'repoId']);

/// The concept id of a citation row: concept_id, then conceptId, then the
/// mapped `id`, then the raw `document_id` (the concept slug).
String? citationConceptId(Map doc) =>
    _pick(doc, const ['concept_id', 'conceptId', 'id', 'document_id']);

/// The display title of a citation row: document_name, then document_id,
/// then the mapped `title`.
String? sourceTitle(Map doc) =>
    _pick(doc, const ['document_name', 'document_id', 'title']);

/// The badge of a citation row: {label, tone}.
///
/// An OKF concept has no file extension and no size — the extension
/// fallback would render the first characters of its name ("HADI" for
/// "hadith nawawi 36"). The badge names the FAMILY instead (web parity:
/// OKF/accent). A web citation names its own medium (web parity: WEB/info).
/// Documents badge by their extension, upper-cased; an extensionless
/// document gets a generic FILE badge.
({String label, String tone}) sourceBadge(Map doc) {
  if (isOkfConceptSource(doc)) {
    return (label: 'OKF', tone: 'accent');
  }
  if (isWebSource(doc)) {
    return (label: 'WEB', tone: 'info');
  }
  final name = sourceTitle(doc) ?? '';
  final dot = name.lastIndexOf('.');
  if (dot == -1 || dot == name.length - 1) {
    return (label: 'FILE', tone: 'neutral');
  }
  final ext = name.substring(dot + 1).toUpperCase();
  return (label: ext.length <= 5 ? ext : 'FILE', tone: 'neutral');
}

/// The log tag for citation-driven navigation events.
String citationLogTag(Map doc) =>
    'okf.citation okf=${isOkfConceptSource(doc)} browsable=${canBrowseSource(doc)} '
    'repo=${citationRepoId(doc)} concept=${citationConceptId(doc)}';
