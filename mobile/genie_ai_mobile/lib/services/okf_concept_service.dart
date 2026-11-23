import 'dart:convert';

import 'package:http/http.dart' as http;

/// One OKF concept, as okf-server serves it under the caller's own scope.
class OkfConcept {
  /// The concept's display title: the frontmatter title, else the card
  /// title, else the humanized concept id.
  final String title;

  /// The concept's markdown body.
  final String body;

  const OkfConcept({required this.title, required this.body});
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

  /// The concept's markdown and title.
  ///
  /// Null when the concept cannot be served (403/404/501 — the anti-enumeration
  /// refusal, a gone concept, an okf-server that does not serve the route).
  Future<OkfConcept?> fetchConcept(String repoId, String conceptId) async {
    final uri = Uri.parse(
      '$_backendUrl/api/okf/repos/${Uri.encodeComponent(repoId)}'
      '/concepts/${Uri.encodeComponent(conceptId)}',
    );
    final response = await _client.get(uri).timeout(_requestTimeout);
    if (response.statusCode == 403 ||
        response.statusCode == 404 ||
        response.statusCode == 501) {
      return null;
    }
    if (response.statusCode != 200) {
      throw Exception('OKF concept fetch failed: HTTP ${response.statusCode}');
    }
    final decoded = jsonDecode(response.body);
    if (decoded is! Map) {
      throw Exception('OKF concept response is not a JSON object');
    }
    final meta = Map<String, dynamic>.from(decoded);
    return OkfConcept(
      title: _title(meta, conceptId),
      body: (meta['body'] ?? '').toString(),
    );
  }

  /// The repository that serves a concept whose citation lost its repo
  /// identity (a pre-CAP-1 saved row).
  ///
  /// Null when no visible repository holds the concept.
  Future<String?> resolveRepoId(String conceptId) async {
    final uri = Uri.parse(
      '$_backendUrl/api/okf/concepts/resolve-repo'
      '?concept_id=${Uri.encodeComponent(conceptId)}',
    );
    final response = await _client.get(uri).timeout(_requestTimeout);
    if (response.statusCode == 404 || response.statusCode == 501) return null;
    if (response.statusCode != 200) {
      throw Exception(
        'OKF concept repo resolution failed: HTTP ${response.statusCode}',
      );
    }
    final decoded = jsonDecode(response.body);
    if (decoded is! Map) {
      throw Exception('OKF concept repo resolution is not a JSON object');
    }
    final repoId = (decoded['repo_id'] ?? '').toString().trim();
    return repoId.isEmpty ? null : repoId;
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
}
