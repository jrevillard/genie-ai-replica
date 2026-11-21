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
import 'package:flutter/material.dart';

import '../services/i18n_service.dart';
import '../utils/theme_manager.dart';
import 'concept_browser_screen.dart';
import 'okf_citation.dart';

/// Opens a citation row's OKF action: a browsable concept pushes the
/// concept browser at the row's own repository; an OKF row that cannot be
/// browsed answers the honest unavailable notice (themed — the DS token
/// form both surfaces now share). Returns true when the row was HANDLED —
/// the caller skips its own external-URL rung. Non-OKF rows return false
/// untouched.
bool openOkfCitation(BuildContext context, Map doc, {required String logTag}) {
  if (!isOkfConceptSource(doc)) return false;
  if (!canBrowseSource(doc)) {
    debugPrint('$logTag unavailable ${citationLogTag(doc)}');
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
    return true;
  }
  final repoId = citationRepoId(doc)!;
  final conceptId = citationConceptId(doc);
  debugPrint('$logTag browse repo=$repoId concept=$conceptId');
  Navigator.of(context).push(
    MaterialPageRoute<void>(
      builder: (_) =>
          ConceptBrowserScreen(repoId: repoId, initialConceptId: conceptId),
    ),
  );
  return true;
}
