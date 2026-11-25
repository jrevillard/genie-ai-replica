// lib/okf/okf_citation_open.dart — the ONE citation-open action.
//
// okf_citation.dart's header promises "ONE definition is consumed by BOTH
// chat surfaces so they cannot drift" — the /simplify review found the
// predicates honoring that promise and the NAVIGATION violating it: the
// browse push and the unavailable notice were hand-copied in both surfaces
// and had already drifted (themed vs default SnackBar chrome, and DIFFERENT
// RUNG ORDER — an OKF row that cannot be browsed but carries a url
// launched externally from the chatbot and got the honest notice from the
// sidebar).
//
// The unified rule is the sidebar's: an OKF row NEVER silently degrades to
// an external launch. Each surface keeps only its genuinely different
// external-URL rung behind the `false` return (the chatbot parses
// scheme+host properly; the sidebar still guards legacy `<HOST>`
// placeholders).
//
// The opener also RESOLVES the repository LIVE: chatqna's citation rows can
// carry a `concept_id` but NO `repo_id` (the backend did not resolve the
// repository), and such a row used to dead-end on the unavailable notice.
// okf-server answers `GET /api/okf/concepts/resolve-repo?concept_id=<id>`
// with the caller-visible serving repository, so the row opens again.
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../services/i18n_service.dart';
import '../utils/theme_manager.dart';
import 'concept_browser_repository.dart';
import 'concept_browser_screen.dart';
import 'okf_citation.dart';

/// Opens a citation row's OKF action: a browsable concept pushes the
/// concept browser at the row's own repository; an OKF row that cannot be
/// browsed answers the honest unavailable notice (themed — the DS token
/// form both surfaces now share). Returns true when the row was HANDLED —
/// the caller skips its own external-URL rung. Non-OKF rows return false
/// untouched.
///
/// A row that names a concept but carries NO repository identity is
/// resolved LIVE through okf-server before the browser opens; a resolution
/// that fails (the concept is unknown, the server refuses, the network is
/// down) keeps today's behaviour — the unavailable notice.
///
/// [repository] is the okf-server seam. When null it is read from the
/// enclosing ProviderScope, so a caller without a [ref] still resolves.
Future<bool> openOkfCitation(
  BuildContext context,
  Map doc, {
  required String logTag,
  ConceptBrowserRepository? repository,
}) async {
  if (!isOkfConceptSource(doc)) return false;
  final conceptId = citationConceptId(doc);
  var repoId = citationRepoId(doc);
  if (repoId == null && conceptId != null) {
    final resolved = await _resolveRepo(context, conceptId, repository);
    if (resolved == null) {
      debugPrint('$logTag unresolved ${citationLogTag(doc)}');
    }
    repoId = resolved;
  }
  // The live resolution crossed an async gap: a surface that was torn down
  // meanwhile gets no notice and no navigation — the row stays handled (an
  // OKF row never degrades to an external launch).
  if (!context.mounted) return true;
  if (repoId == null || conceptId == null) {
    debugPrint('$logTag unavailable ${citationLogTag(doc)}');
    _showUnavailable(context);
    return true;
  }
  final browseRepoId = repoId;
  final browseConceptId = conceptId;
  debugPrint('$logTag browse repo=$browseRepoId concept=$browseConceptId');
  Navigator.of(context).push(
    MaterialPageRoute<void>(
      builder: (_) => ConceptBrowserScreen(
        repoId: browseRepoId,
        initialConceptId: browseConceptId,
      ),
    ),
  );
  return true;
}

/// The repository that serves a concept whose citation row lost its
/// repository identity. Null when the resolution fails for any reason —
/// the caller then answers the honest notice, never a dead link.
Future<String?> _resolveRepo(
  BuildContext context,
  String conceptId,
  ConceptBrowserRepository? repository,
) async {
  final repo = repository ?? _repositoryFromScope(context);
  if (repo == null) return null;
  try {
    return await repo.resolveRepo(conceptId);
  } catch (e) {
    debugPrint('okf.citation resolve_failed concept=$conceptId error=$e');
    return null;
  }
}

/// The repository seam from the enclosing ProviderScope — the opener is a
/// plain function, so the container is the only way to reach the provider.
ConceptBrowserRepository? _repositoryFromScope(BuildContext context) {
  try {
    return ProviderScope.containerOf(
      context,
    ).read(conceptBrowserRepositoryProvider);
  } catch (e) {
    debugPrint('okf.citation resolve_unavailable error=$e');
    return null;
  }
}

/// The honest unavailable notice — the themed SnackBar both surfaces share.
void _showUnavailable(BuildContext context) {
  final tokens = ThemeManager().tokens;
  ScaffoldMessenger.of(context).showSnackBar(
    SnackBar(
      backgroundColor: tokens.surface,
      content: Text(
        tr('chatbot.sourceUnavailable'),
        style: TextStyle(color: tokens.fg),
      ),
    ),
  );
}
