import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_markdown/flutter_markdown.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:path_provider/path_provider.dart';
import 'package:talker/talker.dart';
import 'package:openapi/api.dart';

import '../design_system/components/ds_button.dart';
import '../design_system/components/ds_input.dart';
import '../design_system/components/ds_spinner.dart';
import '../design_system/components/ds_state_display.dart';
import '../design_system/tokens/app_tokens.dart';
import '../design_system/tokens/spacing.dart';
import '../services/i18n_service.dart';
import '../utils/theme_manager.dart';
import 'concept_browser_controller.dart';
import 'markdown_chunker.dart';

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
  ConsumerState<ConceptBrowserScreen> createState() =>
      _ConceptBrowserScreenState();
}

class _ConceptBrowserScreenState extends ConsumerState<ConceptBrowserScreen> {
  final Talker _log = Talker();
  String? _openedRepoId;
  bool _deepOpened = false;

  // The tree pane's view state (the editor's OkfConceptList carries the same
  // two: the root twist starts OPEN and the filter starts empty).
  bool _treeExpanded = true;
  String _filter = '';

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
    // The post-frame callback can fire after the route was popped in the
    // same frame — a ref.read on a disposed ConsumerState throws.
    if (!mounted) return;
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
    _guarded(
      ref.read(conceptBrowserControllerProvider.notifier).select(conceptId),
    );
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
        // The Vue browser is a DsDialog with an explicit CLOSE action — the
        // mobile mirror carries the same exit in its app bar (the system back
        // gesture stays too).
        actions: [
          IconButton(
            key: const ValueKey('okf-browser-close'),
            icon: const Icon(Icons.close),
            tooltip: tr('okfBrowser.close'),
            onPressed: () => Navigator.of(context).maybePop(),
          ),
        ],
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
    // The OPEN failure (the tree never loaded) owns the whole screen; a
    // SELECT failure must not — the Vue browser keeps the tree and shows
    // the error inside the content pane (the 2026-11-20 review finding:
    // one failed card fetch bricked the whole browser with no way back).
    if (state.error != null && state.rows.isEmpty) {
      return DsStateDisplay(type: DsStateType.error, message: state.error);
    }
    // The Vue browser's NARROW layout, mirrored: both panes STACKED on one
    // screen (the tree above, the reading pane below — "stacked with
    // Back-to-list on narrow viewports", D8 §2). Back-to-list clears the
    // selection so the pane below answers the select-hint arm again; the
    // history survives it (issue #1836). Each pane keeps its OWN viewport —
    // the card's lazy chunks need one to parse only the visible slice.
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Expanded(flex: 5, child: _treeList(state, tokens)),
        Container(
          height: 1,
          color: tokens.border,
          margin: const EdgeInsets.symmetric(horizontal: DsSpacing.md),
        ),
        Expanded(flex: 5, child: _detailPane(state, tokens)),
      ],
    );
  }

  /// The tree pane — the mobile mirror of the Vue browser's own tree: the
  /// editor's OkfConceptList, read-only (2026-11-20, David: "the tree view
  /// must be the index.md and the concepts of the repository being
  /// browsed"). index.md is the ROOT row (twist + index badge) and every
  /// other loaded concept renders as its child; the filter narrows the
  /// loaded rows view-locally; Show-more pages beneath.
  Widget _treeList(ConceptBrowserState state, AppTokens tokens) {
    if (state.rows.isEmpty) {
      return DsStateDisplay(
        type: DsStateType.empty,
        message: tr('okfBrowser.selectHint'),
      );
    }
    final lines = _treeLines(state.rows);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(
            DsSpacing.md,
            DsSpacing.sm,
            DsSpacing.md,
            0,
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                tr('okfBrowser.currentNotice'),
                style: TextStyle(color: tokens.muted, fontSize: tokens.textSm),
              ),
              const SizedBox(height: DsSpacing.sm),
              // The list header + filter: the editor's OkfConceptList chrome,
              // read-only (Files + count, then the filter input).
              Row(
                children: [
                  Text(
                    tr('okfBrowser.filesLabel'),
                    style: TextStyle(
                      color: tokens.fg,
                      fontSize: tokens.textSm,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                  const SizedBox(width: DsSpacing.sm),
                  Container(
                    padding: const EdgeInsets.symmetric(
                      horizontal: DsSpacing.sm,
                      vertical: 1,
                    ),
                    decoration: BoxDecoration(
                      color: tokens.accentMuted,
                      borderRadius: BorderRadius.circular(100),
                    ),
                    child: Text(
                      '${lines.length}',
                      style: TextStyle(
                        color: tokens.accent,
                        fontSize: tokens.textXs,
                      ),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: DsSpacing.sm),
              DsInput(
                key: const ValueKey('okf-browser-filter'),
                size: DsInputSize.sm,
                placeholder: tr('okfBrowser.filterHint'),
                onChanged: (value) => setState(() => _filter = value),
              ),
            ],
          ),
        ),
        Expanded(
          child: lines.isEmpty
              ? DsStateDisplay(
                  type: DsStateType.empty,
                  message: tr('okfBrowser.selectHint'),
                )
              : ListView.builder(
                  itemCount: lines.length,
                  itemBuilder: (context, i) {
                    final line = lines[i];
                    return line.isRoot
                        ? _rootRow(line.row, tokens)
                        : _childRow(line.row, tokens);
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
                    // extend() rethrows 401 (session dead app-wide); the
                    // fire-and-forget press is guarded like every other
                    // entry point, or the rejection escapes as an unhandled
                    // zone error.
                    onPressed: () => _guarded(
                      ref
                          .read(conceptBrowserControllerProvider.notifier)
                          .extend(),
                    ),
                  ),
          ),
      ],
    );
  }

  /// The flattened tree the list builds from — the Vue `tree()` computed:
  /// the first `is_index` row is the ROOT, every other row its child, the
  /// filter narrowed first (title + id, the fields the tree page serves).
  List<_TreeLine> _treeLines(List<ConceptTreeRow> rows) {
    final query = _filter.trim().toLowerCase();
    Iterable<ConceptTreeRow> visible = rows;
    if (query.isNotEmpty) {
      visible = rows.where((r) {
        final hay = '${r.title ?? ''} ${r.conceptId}'.toLowerCase();
        return hay.contains(query);
      });
    }
    final list = visible.toList();
    ConceptTreeRow? indexRow;
    for (final r in list) {
      if (r.isIndex == true) {
        indexRow = r;
        break;
      }
    }
    final rest = list.where((r) => !identical(r, indexRow)).toList();
    if (indexRow == null) {
      return [for (final r in rest) _TreeLine(r, depth: 0, isRoot: false)];
    }
    return [
      _TreeLine(indexRow, depth: 0, isRoot: true),
      if (_treeExpanded) ...[
        for (final r in rest) _TreeLine(r, depth: 1, isRoot: false),
      ],
    ];
  }

  /// The index.md ROOT row: twist (toggles the children), status dot, title,
  /// and the index badge — the editor's own root chrome, read-only.
  Widget _rootRow(ConceptTreeRow row, AppTokens tokens) {
    return InkWell(
      key: ValueKey('okf-browser-row-${row.conceptId}'),
      onTap: () => _select(row.conceptId),
      child: Padding(
        padding: const EdgeInsets.symmetric(
          horizontal: DsSpacing.md,
          vertical: DsSpacing.sm,
        ),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.center,
          children: [
            GestureDetector(
              key: const ValueKey('okf-browser-twist'),
              behavior: HitTestBehavior.opaque,
              onTap: () => setState(() => _treeExpanded = !_treeExpanded),
              child: Padding(
                padding: const EdgeInsets.only(
                  right: DsSpacing.xs,
                  top: 2,
                  bottom: 2,
                ),
                child: Icon(
                  _treeExpanded
                      ? Icons.keyboard_arrow_down
                      : Icons.keyboard_arrow_right,
                  size: 18,
                  color: tokens.muted,
                ),
              ),
            ),
            _statusDot(row, tokens),
            const SizedBox(width: DsSpacing.sm),
            Expanded(
              child: Text(
                row.title ?? row.conceptId,
                style: TextStyle(
                  color: tokens.fg,
                  fontSize: tokens.textBase,
                  fontWeight: FontWeight.w600,
                ),
              ),
            ),
            Container(
              padding: const EdgeInsets.symmetric(
                horizontal: DsSpacing.sm,
                vertical: 1,
              ),
              decoration: BoxDecoration(
                color: tokens.accentMuted,
                borderRadius: BorderRadius.circular(100),
              ),
              child: Text(
                tr('okfBrowser.indexBadge'),
                style: TextStyle(color: tokens.accent, fontSize: tokens.textXs),
              ),
            ),
          ],
        ),
      ),
    );
  }

  /// A concept CHILD row: indented under the index root, status dot + title.
  Widget _childRow(ConceptTreeRow row, AppTokens tokens) {
    return InkWell(
      key: ValueKey('okf-browser-row-${row.conceptId}'),
      onTap: () => _select(row.conceptId),
      child: Padding(
        padding: const EdgeInsets.only(
          left: DsSpacing.xl,
          right: DsSpacing.md,
          top: DsSpacing.sm,
          bottom: DsSpacing.sm,
        ),
        child: Row(
          children: [
            _statusDot(row, tokens),
            const SizedBox(width: DsSpacing.sm),
            Expanded(
              child: Text(
                row.title ?? row.conceptId,
                style: TextStyle(color: tokens.fg, fontSize: tokens.textBase),
              ),
            ),
          ],
        ),
      ),
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
    final canForward =
        state.historyIndex >= 0 &&
        state.historyIndex < state.history.length - 1;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(
            DsSpacing.sm,
            DsSpacing.sm,
            DsSpacing.sm,
            0,
          ),
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
              : state.selectedUnavailable
              ? DsStateDisplay(
                  type: DsStateType.empty,
                  icon: Icons.help_outline,
                  message: tr('okfBrowser.conceptUnavailable'),
                )
              // A failed card fetch (500/timeout): the pane carries the
              // failure — the tree above stays alive, the next row tap is
              // the retry (the Vue browser's error paragraph, mirrored).
              : state.error != null
              ? DsStateDisplay(type: DsStateType.error, message: state.error)
              : card == null
              // The Vue browser's EMPTY arm: nothing selected yet — the
              // tree above is the invitation.
              ? DsStateDisplay(
                  type: DsStateType.empty,
                  message: tr('okfBrowser.selectHint'),
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
    // Related-concept chips: deduped — a repeated link renders once. A
    // link row carries the author-link OBJECT shape ({to_concept_id,
    // label}; legacy rows a {target} .md path), read with the Vue
    // browser's contract: to_concept_id first, then target, stripping a
    // trailing .md / concepts/ prefix. The label falls back to the id
    // when the linked row is not in the loaded tree.
    final titles = <String, String>{
      for (final row in state.rows) row.conceptId: (row.title ?? row.conceptId),
    };
    String linkTarget(ConceptCardLink link) =>
        (link.toConceptId ?? link.target ?? '')
            .replaceFirst(RegExp(r'\.md$', caseSensitive: false), '')
            .replaceFirst(RegExp(r'^concepts/'), '')
            // Legacy relative targets ('./beta.md') strip the './' too —
            // './beta' is an id nothing holds and the chip would dead-end.
            .replaceFirst(RegExp(r'^\./'), '')
            .trim();
    final seen = <String>{};
    final chips = <Widget>[];
    for (final link in card.links) {
      final target = linkTarget(link);
      if (target.isEmpty || target == card.conceptId || !seen.add(target)) {
        continue;
      }
      final labelText = (link.label?.trim().isNotEmpty ?? false)
          ? link.label!.trim()
          : (titles[target] ?? target);
      chips.add(
        ActionChip(
          key: ValueKey('okf-browser-chip-$target'),
          label: Text(labelText),
          onPressed: () => _select(target),
        ),
      );
    }

    // The body renders through chunked lazy items (2026-11-20): a serving
    // repo's citizen card carried a 249,557-char body and one
    // whole-document MarkdownBody wedged the render pipeline — the card
    // pane painted nothing. The chunker cuts at paragraph boundaries and
    // the ListView builds only the visible slice: a 250k body parses
    // viewport-sized pieces, the FULL content kept. MarkdownBody DEFAULTS
    // — no HTML extension. A concept body's raw HTML renders as text; it
    // never executes.
    final chunks = chunkMarkdownBody(card.body ?? '');
    final hasChips = chips.isNotEmpty;

    Widget buildItem(BuildContext context, int index) {
      if (index == 0) {
        return Column(
          crossAxisAlignment: CrossAxisAlignment.start,
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
          ],
        );
      }
      final chunkIndex = index - 1;
      if (chunkIndex < chunks.length) {
        return Padding(
          key: ValueKey('okf-browser-md-chunk-$chunkIndex'),
          padding: const EdgeInsets.only(bottom: DsSpacing.sm),
          child: MarkdownBody(data: chunks[chunkIndex]),
        );
      }
      return Wrap(
        spacing: DsSpacing.sm,
        runSpacing: DsSpacing.sm,
        children: chips,
      );
    }

    return ListView.builder(
      key: const ValueKey('okf-browser-card-list'),
      padding: const EdgeInsets.all(DsSpacing.md),
      itemCount: 1 + chunks.length + (hasChips ? 1 : 0),
      itemBuilder: buildItem,
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
      _log.info(
        'okf.browser.download concept_id=${card.conceptId} bytes=${body.length}',
      );
      _toast(file.uri.pathSegments.last);
    } catch (e) {
      _log.error('okf.browser.download_failed error=$e');
      // A WRITE failure is not an empty concept — the message names the
      // failure (the 2026-11-20 review finding).
      _toast(tr('okfBrowser.downloadFailed'));
    }
  }

  void _toast(String message) {
    if (!mounted) return;
    ScaffoldMessenger.of(
      context,
    ).showSnackBar(SnackBar(content: Text(message)));
  }
}

/// One rendered line of the tree list: a row plus its depth (the index root
/// sits at depth 0, its children at 1 — the OkfConceptList tree is exactly
/// these two levels).
class _TreeLine {
  const _TreeLine(this.row, {required this.depth, required this.isRoot});

  final ConceptTreeRow row;
  final int depth;
  final bool isRoot;
}
