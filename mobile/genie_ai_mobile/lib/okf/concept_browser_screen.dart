import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_markdown/flutter_markdown.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:path_provider/path_provider.dart';
import 'package:talker/talker.dart';
import 'package:openapi/api.dart';

import '../design_system/components/ds_button.dart';
import '../design_system/components/ds_spinner.dart';
import '../design_system/components/ds_state_display.dart';
import '../design_system/tokens/app_tokens.dart';
import '../design_system/tokens/spacing.dart';
import '../services/i18n_service.dart';
import '../utils/theme_manager.dart';
import 'concept_browser_controller.dart';

/// The mobile OKF concept-tree browser (#1939 — the W9 browser's mobile
/// mirror). Citizen-scoped reads only: the tree list, the concept pane,
/// back/forward over visited concepts, related-concept chips, download.
/// Bodies render through flutter_markdown's DEFAULTS — the no-HTML
/// extension is never enabled, so raw HTML in a concept body never
/// executes (the mobile counterpart of the web's DOMPurify pipeline).
class ConceptBrowserScreen extends ConsumerStatefulWidget {
  const ConceptBrowserScreen({
    super.key,
    required this.repoId,
    this.initialConceptId,
  });

  final String repoId;

  /// A concept to deep-open (#1938): after the tree's first page loads, the
  /// browser selects it — a citation tap lands on the cited concept without
  /// a manual tree walk. The concept fetch is by id, so it need not be on
  /// the first page.
  final String? initialConceptId;

  @override
  ConsumerState<ConceptBrowserScreen> createState() => _ConceptBrowserScreenState();
}

class _ConceptBrowserScreenState extends ConsumerState<ConceptBrowserScreen> {
  final Talker _log = Talker();
  String? _openedRepoId;
  bool _deepOpened = false;

  @override
  void initState() {
    super.initState();
    // Riverpod forbids modifying a provider inside a life-cycle; the open
    // mutates state synchronously, so it rides the first frame's tail.
    WidgetsBinding.instance.addPostFrameCallback((_) => _openIfNeeded());
  }

  @override
  void didUpdateWidget(ConceptBrowserScreen oldWidget) {
    super.didUpdateWidget(oldWidget);
    WidgetsBinding.instance.addPostFrameCallback((_) => _openIfNeeded());
  }

  void _openIfNeeded() {
    if (_openedRepoId == widget.repoId) return;
    _openedRepoId = widget.repoId;
    _deepOpened = false;
    _guarded(_openAndDeepSelect());
  }

  /// Opens the repo, then deep-selects [ConceptBrowserScreen.initialConceptId]
  /// once — the fetch is by id so the concept need not sit on page one. A
  /// failed deep-open (restricted/deleted concept) leaves the tree view; the
  /// concept-unavailable arm answers a manual retry instead.
  Future<void> _openAndDeepSelect() async {
    final controller = ref.read(conceptBrowserControllerProvider.notifier);
    await controller.open(widget.repoId);
    final initial = widget.initialConceptId;
    if (initial == null || _deepOpened) return;
    _deepOpened = true;
    await controller.select(initial);
  }

  /// The controller rethrows 401 (session dead app-wide) for the app's
  /// re-auth flow; this screen swallows exactly that — no local retry, no
  /// arm of its own, and the fire-and-forget open never becomes an
  /// unhandled zone error.
  Future<void> _guarded(Future<void> work) async {
    try {
      await work;
    } on ApiException catch (e) {
      if (e.code == 401) {
        _log.warning('okf.browser.session_expired repo_id=${widget.repoId}');
        return;
      }
      rethrow;
    }
  }

  void _select(String conceptId) {
    _guarded(ref.read(conceptBrowserControllerProvider.notifier).select(conceptId));
  }

  @override
  Widget build(BuildContext context) {
    final state = ref.watch(conceptBrowserControllerProvider);
    final tokens = ThemeManager().tokens;

    return Scaffold(
      backgroundColor: tokens.bg,
      appBar: AppBar(
        backgroundColor: tokens.navbarBg,
        foregroundColor: tokens.navbarFg,
        title: Text(tr('okfBrowser.title')),
      ),
      body: _body(state, tokens),
    );
  }

  Widget _body(ConceptBrowserState state, AppTokens tokens) {
    if (state.unavailable) {
      // The honest unavailable arm: "cannot be browsed right now" — never
      // an error toast (anti-enumeration: foreign and fenced are the same
      // 404/403 to the citizen).
      return DsStateDisplay(
        type: DsStateType.empty,
        icon: Icons.folder_off_outlined,
        message: tr('okfBrowser.unavailable'),
      );
    }
    if (state.loading && state.rows.isEmpty) {
      return const DsStateDisplay(type: DsStateType.loading);
    }
    if (state.error != null) {
      return DsStateDisplay(type: DsStateType.error, message: state.error);
    }
    if (state.selected != null || state.selectedLoading || state.selectedUnavailable) {
      return _detailPane(state, tokens);
    }
    return _treeList(state, tokens);
  }

  Widget _treeList(ConceptBrowserState state, AppTokens tokens) {
    if (state.rows.isEmpty) {
      return DsStateDisplay(type: DsStateType.empty, message: tr('okfBrowser.selectHint'));
    }
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(DsSpacing.md, DsSpacing.sm, DsSpacing.md, 0),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                tr('okfBrowser.currentNotice'),
                style: TextStyle(color: tokens.muted, fontSize: tokens.textSm),
              ),
              const SizedBox(height: DsSpacing.xs),
              Text(
                tr('okfBrowser.selectHint'),
                style: TextStyle(color: tokens.mutedSoft, fontSize: tokens.textXs),
              ),
            ],
          ),
        ),
        Expanded(
          child: ListView.builder(
            itemCount: state.rows.length,
            itemBuilder: (context, i) {
              final row = state.rows[i];
              return ListTile(
                key: ValueKey('okf-browser-row-${row.conceptId}'),
                leading: _statusDot(row, tokens),
                title: Text(
                  row.title ?? row.conceptId,
                  style: TextStyle(
                    color: tokens.fg,
                    fontSize: tokens.textBase,
                    // Index rows are bold — the tree's root marker.
                    fontWeight: (row.isIndex ?? false) ? FontWeight.w600 : FontWeight.w400,
                  ),
                ),
                trailing: row.links.isEmpty
                    ? null
                    : Icon(Icons.link, size: 16, color: tokens.muted),
                onTap: () => _select(row.conceptId),
              );
            },
          ),
        ),
        if (!state.treeComplete)
          Padding(
            padding: const EdgeInsets.all(DsSpacing.md),
            child: state.extending
                ? const Center(child: DsSpinner(size: DsSpinnerSize.sm))
                : DsButton(
                    key: const ValueKey('okf-browser-show-more'),
                    label: tr('okfBrowser.showMore'),
                    variant: DsButtonVariant.secondary,
                    onPressed: () =>
                        ref.read(conceptBrowserControllerProvider.notifier).extend(),
                  ),
          ),
      ],
    );
  }

  /// The drain-status dot the tree rows carry (the editor's status dots,
  /// citizen-read shapes): indexed greens, failures red, anything else the
  /// pending amber.
  Widget _statusDot(ConceptTreeRow row, AppTokens tokens) {
    final status = row.indexStatus;
    final color = switch (status) {
      'indexed' || 'drained' || 'complete' => tokens.success,
      'failed' || 'error' => tokens.danger,
      _ => tokens.warning,
    };
    return Icon(Icons.circle, size: 10, color: color);
  }

  Widget _detailPane(ConceptBrowserState state, AppTokens tokens) {
    final controller = ref.read(conceptBrowserControllerProvider.notifier);
    final card = state.selected;
    final canBack = state.historyIndex > 0;
    final canForward = state.historyIndex >= 0 && state.historyIndex < state.history.length - 1;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(DsSpacing.sm, DsSpacing.sm, DsSpacing.sm, 0),
          child: Row(
            children: [
              DsButton(
                key: const ValueKey('okf-browser-back'),
                icon: Icons.arrow_back,
                iconOnly: true,
                small: true,
                disabled: !canBack,
                onPressed: canBack ? controller.goBack : null,
              ),
              DsButton(
                key: const ValueKey('okf-browser-forward'),
                icon: Icons.arrow_forward,
                iconOnly: true,
                small: true,
                disabled: !canForward,
                onPressed: canForward ? controller.goForward : null,
              ),
              const Spacer(),
              DsButton(
                key: const ValueKey('okf-browser-back-to-list'),
                label: tr('okfBrowser.backToList'),
                variant: DsButtonVariant.ghost,
                small: true,
                onPressed: controller.backToList,
              ),
            ],
          ),
        ),
        Expanded(
          child: state.selectedLoading
              ? const DsStateDisplay(type: DsStateType.loading)
              : state.selectedUnavailable || card == null
              ? DsStateDisplay(
                  type: DsStateType.empty,
                  icon: Icons.help_outline,
                  message: tr('okfBrowser.conceptUnavailable'),
                )
              : _cardView(state, card, controller, tokens),
        ),
      ],
    );
  }

  Widget _cardView(
    ConceptBrowserState state,
    ConceptCard card,
    ConceptBrowserController controller,
    AppTokens tokens,
  ) {
    // Related-concept chips: deduped — a repeated link renders once; the
    // label falls back to the id when the linked row is not in the loaded
    // tree.
    final titles = <String, String>{
      for (final row in state.rows) row.conceptId: (row.title ?? row.conceptId),
    };
    final seen = <String>{};
    final chips = <Widget>[];
    for (final link in card.links) {
      if (!seen.add(link)) continue;
      chips.add(
        ActionChip(
          key: ValueKey('okf-browser-chip-$link'),
          label: Text(titles[link] ?? link),
          onPressed: () => _select(link),
        ),
      );
    }

    return ListView(
      padding: const EdgeInsets.all(DsSpacing.md),
      children: [
        Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Expanded(
              child: Text(
                card.title,
                style: TextStyle(
                  color: tokens.fg,
                  fontSize: tokens.textLg,
                  fontWeight: FontWeight.w600,
                ),
              ),
            ),
            DsButton(
              key: const ValueKey('okf-browser-download'),
              icon: Icons.download,
              iconOnly: true,
              small: true,
              onPressed: () => _download(card),
            ),
          ],
        ),
        const SizedBox(height: DsSpacing.sm),
        // MarkdownBody DEFAULTS — no HTML extension. A concept body's raw
        // HTML renders as text; it never executes.
        MarkdownBody(data: card.body ?? ''),
        if (chips.isNotEmpty) ...[
          const SizedBox(height: DsSpacing.md),
          Wrap(spacing: DsSpacing.sm, runSpacing: DsSpacing.sm, children: chips),
        ],
      ],
    );
  }

  Future<void> _download(ConceptCard card) async {
    final body = card.body ?? '';
    if (body.isEmpty) {
      _log.info('okf.browser.download_empty concept_id=${card.conceptId}');
      _toast(tr('okfBrowser.downloadEmpty'));
      return;
    }
    try {
      final dir = await getApplicationDocumentsDirectory();
      final safeId = card.conceptId.replaceAll(RegExp(r'[^A-Za-z0-9._-]'), '_');
      final file = File('${dir.path}${Platform.pathSeparator}$safeId.md');
      await file.writeAsString(body);
      _log.info('okf.browser.download concept_id=${card.conceptId} bytes=${body.length}');
      _toast(file.uri.pathSegments.last);
    } catch (e) {
      _log.error('okf.browser.download_failed error=$e');
      _toast(tr('okfBrowser.downloadEmpty'));
    }
  }

  void _toast(String message) {
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(message)));
  }
}
