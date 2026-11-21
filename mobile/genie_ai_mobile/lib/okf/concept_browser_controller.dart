import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:openapi/api.dart';

import 'concept_browser_repository.dart';
import 'okf_browser_log.dart';

/// The concept browser's state (#1939 — the mobile mirror of the web's W9
/// browser semantics): stale-guarded progressive pages, the honest arms
/// mapping, and a visit history whose new visits truncate the forward
/// tail.
class ConceptBrowserState {
  const ConceptBrowserState({
    this.repoId,
    this.rows = const [],
    this.total = 0,
    this.loading = false,
    this.extending = false,
    this.treeComplete = false,
    this.unavailable = false,
    this.error,
    this.selected,
    this.selectedLoading = false,
    this.selectedUnavailable = false,
    this.history = const [],
    this.historyIndex = -1,
  });

  final String? repoId;
  final List<ConceptTreeRow> rows;
  final int total;

  /// First page in flight.
  final bool loading;

  /// Show-more page in flight.
  final bool extending;

  /// Nothing more to fetch (under one page, or loaded >= total, or the
  /// last page came back short).
  final bool treeComplete;

  /// The REPO arm: 403/404/501 — "cannot be browsed right now", never an
  /// error toast (anti-enumeration: foreign and fenced indistinguishable).
  final bool unavailable;
  final String? error;

  final ConceptCard? selected;
  final bool selectedLoading;

  /// The CONCEPT arm: the same 403/404/501 mapping at card level.
  final bool selectedUnavailable;

  /// Visited cards, newest last. Cards are cached in the history, so
  /// back/forward restore without a refetch.
  final List<ConceptCard> history;

  /// Position inside [history]; -1 only before the first visit. Kept by
  /// backToList so forward can re-open from the list.
  final int historyIndex;

  static const Object _unset = Object();

  ConceptBrowserState copyWith({
    Object? repoId = _unset,
    List<ConceptTreeRow>? rows,
    int? total,
    bool? loading,
    bool? extending,
    bool? treeComplete,
    bool? unavailable,
    Object? error = _unset,
    Object? selected = _unset,
    bool? selectedLoading,
    bool? selectedUnavailable,
    List<ConceptCard>? history,
    int? historyIndex,
  }) {
    return ConceptBrowserState(
      repoId: repoId == _unset ? this.repoId : repoId as String?,
      rows: rows ?? this.rows,
      total: total ?? this.total,
      loading: loading ?? this.loading,
      extending: extending ?? this.extending,
      treeComplete: treeComplete ?? this.treeComplete,
      unavailable: unavailable ?? this.unavailable,
      error: error == _unset ? this.error : error as String?,
      selected: selected == _unset ? this.selected : selected as ConceptCard?,
      selectedLoading: selectedLoading ?? this.selectedLoading,
      selectedUnavailable: selectedUnavailable ?? this.selectedUnavailable,
      history: history ?? this.history,
      historyIndex: historyIndex ?? this.historyIndex,
    );
  }
}

class ConceptBrowserController extends Notifier<ConceptBrowserState> {
  /// The web's fetchOkfConcept mapping, mirrored (builder-check resolution,
  /// the web precedent): 403, 404 and 501 all answer the unavailable arm —
  /// a 403 is the deployment's closed scope posture, which the user cannot
  /// fix from the client, so masking it as an error would violate the
  /// honest-arms ruling exactly as hard as masking a 404. 401 is NOT an
  /// arm: the session is dead app-wide and the exception propagates to the
  /// app's re-auth flow (no local retry, no unavailable arm, no toast).
  static const Set<int> _unavailableCodes = {403, 404, 501};

  final _log = okfBrowserLog;

  /// Bumped on every repo switch and on close; an in-flight response from
  /// an older generation never commits over a newer run.
  int _generation = 0;

  /// Bumped on every SELECT; a slow earlier card fetch never commits over
  /// a newer selection (two quick tree taps race — the loser's commit must
  /// not rebuild the history from its pre-fetch snapshot).
  int _selectGeneration = 0;

  /// The loaded tree's concept ids, maintained incrementally — extend()
  /// dedupes each page against this instead of re-hashing every loaded id
  /// on every Show-more (the /simplify review's O(N²/pageSize) finding).
  /// Reset by [open].
  final Set<String> _knownIds = <String>{};

  /// The visit history's cap. A citizen browsing a long session does not
  /// keep every visited card body alive — at a documented 250k-character
  /// worst case, an unbounded history grows to megabytes (the /simplify
  /// review's retention finding; a dispose-time close was rejected — the
  /// provider is app-lifetime and notifying it during teardown reaches the
  /// defunct element's own listener). The cap drops the OLDEST entries:
  /// every new visit truncates the forward tail, so the tail is the live
  /// end and back/forward keep working inside the window.
  static const int _historyCap = 10;

  @override
  ConceptBrowserState build() => const ConceptBrowserState();

  bool _isUnavailable(Object e) =>
      e is ApiException && _unavailableCodes.contains(e.code);

  bool _isSessionExpired(Object e) => e is ApiException && e.code == 401;

  void _logTransition(String event, Map<String, Object?> fields) {
    _log.info(
      'okf.browser.$event ${fields.entries.map((e) => '${e.key}=${e.value}').join(' ')}',
    );
  }

  /// The ONE failure ladder for open/extend/select — the /simplify review
  /// found three hand-copies that had already drifted (only `open` logged
  /// the expiry and generic arms). Maps the honest arms onto the state and
  /// clears the failed operation's in-flight flag on every arm. Returns
  /// true when the caller must RETHROW: a 401 is not a browser arm — the
  /// session is dead app-wide and the exception propagates to the app's
  /// re-auth flow.
  bool _applyFailure(
    Object e, {
    required String event,
    required String? repoId,
    String conceptId = '',
    required bool cardArm,
    required ConceptBrowserState Function() clearInFlight,
  }) {
    final code = e is ApiException ? e.code : null;
    final cleared = clearInFlight();
    if (_isUnavailable(e)) {
      if (cardArm) {
        _logTransition('concept_unavailable', {
          'concept_id': conceptId,
          'code': code,
        });
        state = cleared.copyWith(selected: null, selectedUnavailable: true);
      } else {
        _logTransition('repo_unavailable', {'repo_id': repoId, 'code': code});
        state = cleared.copyWith(unavailable: true, error: null);
      }
      return false;
    }
    if (_isSessionExpired(e)) {
      _logTransition('session_expired', {
        'repo_id': repoId,
        'concept_id': conceptId,
      });
      state = cleared;
      return true;
    }
    _logTransition('error', {'repo_id': repoId, 'error': e.toString()});
    state = cleared.copyWith(error: e.toString());
    return false;
  }

  /// Open a repository's browser: reset everything and load the first
  /// page. A superseded response (an older generation) never commits.
  Future<void> open(String repoId) async {
    final gen = ++_generation;
    final repo = ref.read(conceptBrowserRepositoryProvider);
    _logTransition('open', {'repo_id': repoId, 'generation': gen});
    _knownIds.clear();
    state = ConceptBrowserState(repoId: repoId, loading: true);
    try {
      final page = await repo.fetchTreePage(repoId, offset: 0);
      if (gen != _generation) return;
      final rows = page.concepts;
      final total = page.total;
      _knownIds.addAll(rows.map((r) => r.conceptId));
      state = state.copyWith(
        rows: rows,
        total: total,
        loading: false,
        treeComplete:
            rows.length < conceptBrowserPageSize || rows.length >= total,
      );
      _logTransition('tree_loaded', {
        'repo_id': repoId,
        'rows': rows.length,
        'total': total,
      });
    } catch (e) {
      if (gen != _generation) return;
      if (_applyFailure(
        e,
        event: 'open',
        repoId: repoId,
        cardArm: false,
        clearInFlight: () => state.copyWith(loading: false),
      )) {
        rethrow;
      }
    }
  }

  /// Show more: fetch the next page at offset = loaded count. The boundary
  /// (loaded >= total) is refused before any request; an out-of-range
  /// response (the total shrank mid-session) commits as complete without
  /// duplicating rows.
  Future<void> extend() async {
    final s = state;
    if (s.repoId == null || s.loading || s.extending || s.treeComplete) return;
    final gen = _generation;
    final repo = ref.read(conceptBrowserRepositoryProvider);
    final offset = s.rows.length;
    _logTransition('extend', {'repo_id': s.repoId, 'offset': offset});
    state = s.copyWith(extending: true);
    try {
      final page = await repo.fetchTreePage(s.repoId!, offset: offset);
      if (gen != _generation) return;
      final loaded = page.concepts;
      final rows = [
        ...s.rows,
        ...loaded.where((r) => !_knownIds.contains(r.conceptId)),
      ];
      _knownIds.addAll(rows.map((r) => r.conceptId));
      final total = page.total;
      state = state.copyWith(
        rows: rows,
        total: total,
        extending: false,
        treeComplete:
            rows.length >= total || loaded.length < conceptBrowserPageSize,
      );
      _logTransition('tree_extended', {
        'repo_id': s.repoId,
        'rows': rows.length,
        'total': total,
      });
    } catch (e) {
      if (gen != _generation) return;
      if (_applyFailure(
        e,
        event: 'extend',
        repoId: s.repoId,
        cardArm: false,
        clearInFlight: () => state.copyWith(extending: false),
      )) {
        rethrow;
      }
    }
  }

  /// Visit a concept: fetch the citizen card and append it to the history,
  /// truncating the forward tail. Re-tapping the visible selection is a
  /// no-op; re-selecting the entry the history points at restores it
  /// without growing the history.
  Future<void> select(String conceptId) async {
    final s = state;
    if (s.repoId == null) return;
    if (s.selected != null && s.selected!.conceptId == conceptId) {
      _logTransition('select_repeat_noop', {'concept_id': conceptId});
      return;
    }
    final gen = ++_selectGeneration;
    final repoGen = _generation;
    final repo = ref.read(conceptBrowserRepositoryProvider);
    _logTransition('select', {'repo_id': s.repoId, 'concept_id': conceptId});
    state = s.copyWith(selectedLoading: true, selectedUnavailable: false);
    try {
      final card = await repo.fetchCard(s.repoId!, conceptId);
      if (gen != _selectGeneration || repoGen != _generation) return;
      final atCurrent =
          s.historyIndex >= 0 &&
          s.historyIndex < s.history.length &&
          s.history[s.historyIndex].conceptId == conceptId;
      var history = atCurrent
          ? s.history
          : [...s.history.take(s.historyIndex + 1), card];
      var index = atCurrent ? s.historyIndex : history.length - 1;
      if (history.length > _historyCap) {
        final drop = history.length - _historyCap;
        history = history.sublist(drop);
        index -= drop;
      }
      state = state.copyWith(
        selected: card,
        selectedLoading: false,
        selectedUnavailable: false,
        history: history,
        historyIndex: index,
        // A success clears a prior select's error — the pane shows the
        // card, never a stale failure over a working one.
        error: null,
      );
    } catch (e) {
      if (gen != _selectGeneration || repoGen != _generation) return;
      if (_applyFailure(
        e,
        event: 'select',
        repoId: s.repoId,
        conceptId: conceptId,
        cardArm: true,
        clearInFlight: () => state.copyWith(selectedLoading: false),
      )) {
        rethrow;
      }
    }
  }

  /// One step back over the visited concepts (restored from the cached
  /// history, no refetch). Boundary: no-op.
  void goBack() => _step(-1);

  /// One step forward (re-opens the entry after the current position,
  /// including from the list after backToList). Boundary: no-op.
  void goForward() => _step(1);

  /// The shared back/forward body: one boundary-and-commit for both
  /// directions (the /simplify review flagged the mirrored pair).
  void _step(int delta) {
    final s = state;
    if (s.historyIndex < 0) return;
    final i = s.historyIndex + delta;
    if (i < 0 || i >= s.history.length) return;
    state = s.copyWith(
      selected: s.history[i],
      selectedUnavailable: false,
      historyIndex: i,
    );
  }

  /// Leave the detail pane for the tree list. The selection clears; the
  /// history and the position stay, so forward re-opens from the list.
  void backToList() {
    state = state.copyWith(selected: null, selectedUnavailable: false);
  }

  /// Close the browser: reset everything; in-flight responses from this
  /// (now dead) generation never commit.
  void close() {
    _generation++;
    _logTransition('close', {});
    state = const ConceptBrowserState();
  }
}

final conceptBrowserControllerProvider =
    NotifierProvider<ConceptBrowserController, ConceptBrowserState>(
      ConceptBrowserController.new,
    );
