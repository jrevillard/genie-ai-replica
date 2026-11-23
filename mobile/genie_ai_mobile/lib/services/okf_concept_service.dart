import 'dart:convert';

import 'package:http/http.dart' as http;

/// One OKF concept, as okf-server serves it under the caller's own scope.
class OkfConcept {
  /// The concept's display title: the frontmatter title, else the card
  /// title, else the humanized concept id.
  final String title;

  /// The concept's markdown body, bounded for rendering (see
  /// [OkfConceptService.previewOf]).
  final String body;

  /// Whether [body] stops short of the concept's full document.
  final bool truncated;

  const OkfConcept({
    required this.title,
    required this.body,
    required this.truncated,
  });
}

/// The okf-server concept flows the mobile needs to OPEN a citation.
///
/// An OKF concept has no document-repository file (content-only chunking):
/// its open/download flows go through okf-server under the caller's own
/// scope, never through the `/api/files` URL family.
///
/// The service never throws for a concept that cannot be SERVED (restricted
/// repo, retracted, deleted): that is an honest unavailability, returned as
/// null. A transient failure (5xx, network, expired session) throws, so the
/// caller can tell "not available" from "could not open".
class OkfConceptService {
  OkfConceptService({required http.Client client, required String backendUrl})
    : _client = client,
      _backendUrl = backendUrl;

  final http.Client _client;
  final String _backendUrl;

  /// The concept route is a READ on the caller's own scope; a request that
  /// has not answered in this long is a failure, not a slow success. The
  /// timeout keeps a hung upstream from leaving the sidebar waiting.
  static const Duration _requestTimeout = Duration(seconds: 20);

  /// The longest concept body the client keeps. A concept may carry up to
  /// the deployment's ceiling (~250 000 characters) and the renderer builds
  /// a document eagerly: the client never holds more than this.
  static const int maxPreviewChars = 20000;

  /// The statuses that mean "this concept cannot be SERVED": the scope
  /// refusal (403 — okf-server denies a scopeless caller when the
  /// deployment runs in closed scope mode), a concept that is not there
  /// (404) and a server that does not serve the route (501).
  ///
  /// The concept read and the repository resolution share the set: the
  /// scope gate stands in front of BOTH routes, so a set that listed 403
  /// on one and not the other would phrase an authorization refusal as a
  /// failure on one path and as an honest notice on the other.
  static const Set<int> unavailableStatuses = {403, 404, 501};

  /// The longest run of letters and digits a preview shows before a soft
  /// space is inserted inside it.
  ///
  /// One unbroken run (a base64 blob, a hex digest, a long identifier) is
  /// what makes the markdown inline parser backtrack quadratically: on the
  /// pinned markdown version, 20 000 characters in one run cost ~1.4 s on
  /// the UI thread, the same characters broken every 500 cost ~4 ms.
  static const int previewRunWidth = 500;

  /// Opens a concept: its title and its bounded body.
  ///
  /// [repoId] may be empty — a citation saved before the repository identity
  /// was recorded is resolved through okf-server first.
  ///
  /// Null when the concept cannot be served (403/404/501 — the
  /// anti-enumeration refusal, a gone concept, an okf-server that does not
  /// serve the route, or no visible repository holding the concept).
  Future<OkfConcept?> openConcept(String repoId, String conceptId) async {
    String repository = repoId;
    if (repository.isEmpty) {
      repository = await resolveRepoId(conceptId) ?? '';
      if (repository.isEmpty) return null;
    }
    final meta = await _getJson(
      Uri.parse(
        '$_backendUrl/api/okf/repos/${Uri.encodeComponent(repository)}'
        '/concepts/${Uri.encodeComponent(conceptId)}',
      ),
      unavailable: unavailableStatuses,
      what: 'concept',
    );
    if (meta == null) return null;
    final body = (meta['body'] ?? '').toString();
    final preview = previewOf(body);
    return OkfConcept(
      title: _title(meta, conceptId),
      body: preview.preview,
      // True EXACTLY when body characters were dropped: the breaks the
      // preview inserts count against the bound, so the flag cannot be
      // derived from the body's length alone.
      truncated: preview.truncated,
    );
  }

  /// The body the renderer shows: the concept's markdown, bounded, and
  /// whether the bound dropped anything.
  ///
  /// The bound has two halves, and both matter:
  ///  - the LENGTH: the renderer builds a document eagerly, and a concept may
  ///    carry up to the deployment's ceiling (~250 000 characters), which
  ///    freezes the UI thread on a phone;
  ///  - the longest unbroken run of letters and digits: the markdown inline
  ///    parser backtracks quadratically over one, and a naive cut CREATES
  ///    that shape (cutting a long line leaves a long run).
  ///
  /// The cut never leaves an ill-formed string: a surrogate is not a letter
  /// or a digit, so the run resets at one and a break can never land inside
  /// a surrogate pair; a trailing lone high surrogate is dropped.
  static ({String preview, bool truncated}) previewOf(String body) {
    if (body.length <= maxPreviewChars && !_hasLongRun(body)) {
      return (preview: body, truncated: false);
    }
    final buffer = StringBuffer();
    int run = 0;
    // The body characters the preview keeps — the breaks the preview inserts
    // count against the bound, so they cannot be the measure of what was
    // dropped.
    int kept = 0;
    for (var i = 0; i < body.length; i++) {
      if (buffer.length >= maxPreviewChars) break;
      final int unit = body.codeUnitAt(i);
      buffer.writeCharCode(unit);
      kept++;
      if (!_isAlnum(unit)) {
        run = 0;
        continue;
      }
      run++;
      if (run >= previewRunWidth && buffer.length < maxPreviewChars) {
        buffer.write(' ');
        run = 0;
      }
    }
    String preview = buffer.toString();
    if (preview.isNotEmpty) {
      final int last = preview.codeUnitAt(preview.length - 1);
      if (last >= 0xD800 && last <= 0xDBFF) {
        preview = preview.substring(0, preview.length - 1);
        kept--;
      }
    }
    return (preview: preview, truncated: kept < body.length);
  }

  /// The repository that serves a concept whose citation lost its repo
  /// identity (a pre-CAP-1 saved row).
  ///
  /// Null when no visible repository holds the concept.
  Future<String?> resolveRepoId(String conceptId) async {
    final meta = await _getJson(
      Uri.parse(
        '$_backendUrl/api/okf/concepts/resolve-repo'
        '?concept_id=${Uri.encodeComponent(conceptId)}',
      ),
      unavailable: unavailableStatuses,
      what: 'concept repo resolution',
    );
    if (meta == null) return null;
    final repoId = (meta['repo_id'] ?? '').toString().trim();
    return repoId.isEmpty ? null : repoId;
  }

  /// One JSON read: null when the answer is an honest unavailability, a
  /// thrown error when the read failed.
  Future<Map<String, dynamic>?> _getJson(
    Uri uri, {
    required Set<int> unavailable,
    required String what,
  }) async {
    final response = await _client.get(uri).timeout(_requestTimeout);
    if (unavailable.contains(response.statusCode)) return null;
    if (response.statusCode != 200) {
      throw Exception('OKF $what failed: HTTP ${response.statusCode}');
    }
    final decoded = jsonDecode(response.body);
    if (decoded is! Map) {
      throw Exception('OKF $what response is not a JSON object');
    }
    return Map<String, dynamic>.from(decoded);
  }

  /// The concept's title: the frontmatter title (the steward arm), else the
  /// card title (the citizen arm), else the humanized concept id.
  String _title(Map<String, dynamic> meta, String conceptId) {
    final frontmatter = meta['frontmatter'];
    if (frontmatter is Map) {
      final title = (frontmatter['title'] ?? '').toString().trim();
      if (title.isNotEmpty) return title;
    }
    final title = (meta['title'] ?? '').toString().trim();
    if (title.isNotEmpty) return title;
    return conceptId.replaceAll('_', ' ').trim();
  }

  static bool _isAlnum(int unit) =>
      (unit >= 0x30 && unit <= 0x39) ||
      (unit >= 0x41 && unit <= 0x5A) ||
      (unit >= 0x61 && unit <= 0x7A);

  static bool _hasLongRun(String body) {
    int run = 0;
    for (var i = 0; i < body.length; i++) {
      if (_isAlnum(body.codeUnitAt(i))) {
        run++;
        if (run >= previewRunWidth) return true;
      } else {
        run = 0;
      }
    }
    return false;
  }
}
