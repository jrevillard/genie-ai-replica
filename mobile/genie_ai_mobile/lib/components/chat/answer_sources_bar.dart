import 'package:flutter/material.dart';

import '../../okf/okf_citation.dart';
import '../../design_system/tokens/spacing.dart';
import '../../design_system/tokens/radii.dart';
import '../../design_system/tokens/app_tokens.dart';
import '../../utils/theme_manager.dart';

/// The per-answer related-sources bar (#1937 — the mobile mirror of the web
/// chat's collapsible `answer-sources` block).
///
/// Collapsed by default: one toggle line naming the count. Expanded: one row
/// per citation — badge + title — handing the RAW row to [onOpen]. The
/// widget stays navigation-agnostic: the caller decides what a tap means
/// (browsable OKF row -> concept browser, external URL -> launcher,
/// otherwise an honest unavailable notice). Rows are driven by the shared
/// citation predicates so this bar and the right sidebar cannot drift.
class AnswerSourcesBar extends StatefulWidget {
  const AnswerSourcesBar({
    super.key,
    required this.sources,
    required this.labelBuilder,
    required this.onOpen,
  });

  /// The RAW citation rows of one assistant answer (msg['sources']).
  final List<dynamic> sources;

  /// Builds the toggle label for a count, e.g. "Related sources (2)" —
  /// injected so the caller supplies the localized wording.
  final String Function(int count) labelBuilder;

  /// Called with the RAW row when the user taps a source row.
  final void Function(Map<String, dynamic> doc) onOpen;

  @override
  State<AnswerSourcesBar> createState() => _AnswerSourcesBarState();
}

class _AnswerSourcesBarState extends State<AnswerSourcesBar> {
  bool _open = false;

  List<Map<String, dynamic>> get _rows =>
      widget.sources.whereType<Map<String, dynamic>>().toList();

  @override
  Widget build(BuildContext context) {
    final rows = _rows;
    if (rows.isEmpty) {
      return const SizedBox.shrink();
    }
    final AppTokens tokens = ThemeManager().tokens;
    return Container(
      key: const ValueKey('answer-sources-bar'),
      margin: const EdgeInsets.only(top: DsSpacing.xs),
      padding: const EdgeInsets.symmetric(
        horizontal: DsSpacing.sm,
        vertical: DsSpacing.xs,
      ),
      decoration: BoxDecoration(
        border: Border.all(color: tokens.borderLight),
        borderRadius: BorderRadius.circular(DsRadii.md),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: [
          GestureDetector(
            key: const ValueKey('answer-sources-toggle'),
            onTap: () {
              debugPrint(
                'chat.sources_bar toggle open=${!_open} count=${rows.length}',
              );
              setState(() => _open = !_open);
            },
            child: Padding(
              padding: const EdgeInsets.symmetric(vertical: DsSpacing.xs),
              child: Row(
                children: [
                  Icon(
                    _open ? Icons.expand_less : Icons.expand_more,
                    size: 18,
                    color: tokens.muted,
                  ),
                  const SizedBox(width: DsSpacing.xs),
                  Text(
                    widget.labelBuilder(rows.length),
                    style: TextStyle(
                      fontSize: tokens.textSm,
                      color: tokens.muted,
                    ),
                  ),
                ],
              ),
            ),
          ),
          if (_open)
            ...rows.asMap().entries.map((entry) {
              final index = entry.key;
              final doc = entry.value;
              final badge = sourceBadge(doc);
              return GestureDetector(
                key: ValueKey(
                  // The id when the row carries one; rows without ANY id
                  // fall back to their POSITION — two anonymous rows must
                  // never share a ValueKey (duplicate keys among siblings
                  // break multi-child reconciliation).
                  'answer-source-row-${doc['document_id'] ?? doc['id'] ?? index}',
                ),
                onTap: () {
                  debugPrint('chat.sources_bar open ${citationLogTag(doc)}');
                  widget.onOpen(doc);
                },
                child: Padding(
                  padding: const EdgeInsets.symmetric(vertical: DsSpacing.xs),
                  child: Row(
                    children: [
                      Container(
                        padding: const EdgeInsets.symmetric(
                          horizontal: DsSpacing.xs,
                          vertical: 2,
                        ),
                        decoration: BoxDecoration(
                          color: badge.tone == 'accent'
                              ? tokens.accentMuted
                              : tokens.mutedSoft,
                          borderRadius: BorderRadius.circular(DsRadii.sm),
                        ),
                        child: Text(
                          badge.label,
                          style: TextStyle(
                            fontSize: tokens.textXs,
                            color: badge.tone == 'accent'
                                ? tokens.accent
                                : tokens.muted,
                          ),
                        ),
                      ),
                      const SizedBox(width: DsSpacing.sm),
                      Expanded(
                        child: Text(
                          sourceTitle(doc) ?? '',
                          style: TextStyle(
                            fontSize: tokens.textSm,
                            color: tokens.fg,
                          ),
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                        ),
                      ),
                      Icon(Icons.chevron_right, size: 16, color: tokens.muted),
                    ],
                  ),
                ),
              );
            }),
        ],
      ),
    );
  }
}
