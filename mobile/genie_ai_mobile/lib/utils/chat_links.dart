/// Links inside assistant replies.
///
/// The services emit site-relative URLs (e.g. the drought report as
/// `/api/weather/drought-report/<file>.pdf`, see weather-mcp-service
/// `_PUBLIC_DROUGHT_REPORT_BASE`). A browser resolves those against the page
/// origin; the app has no origin, so they must be resolved against the backend
/// base URL before anything can open them. Mirrors the web, where the same
/// anchor simply works because it is relative to the site.
library;

/// Absolute URI for [href]: relative paths are resolved against [backendUrl]
/// (scheme + host [+ port]); absolute URLs are returned unchanged. Null when
/// [href] is blank or cannot be parsed.
Uri? resolveChatLink(String? href, String backendUrl) {
  final raw = href?.trim() ?? '';
  if (raw.isEmpty) return null;
  final parsed = Uri.tryParse(raw);
  if (parsed == null) return null;
  if (parsed.hasScheme) return parsed;
  final base = Uri.tryParse(backendUrl);
  if (base == null || !base.hasScheme) return null;
  // Keep only the origin: a base path such as "/api" would otherwise be
  // prepended to the already-rooted service paths.
  return base.replace(path: '/', query: null, fragment: null).resolve(raw);
}

final RegExp _droughtReport = RegExp(
  r'^/api/weather/drought-report/([^/]+\.pdf)$',
  caseSensitive: false,
);

/// File name when [uri] points at a drought report PDF (opened in-app), else
/// null.
String? droughtReportFilename(Uri uri) {
  final m = _droughtReport.firstMatch(uri.path);
  return m?.group(1);
}
