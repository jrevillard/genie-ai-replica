import 'dart:async';
import 'dart:convert';
import 'dart:html' as html;
import 'package:flutter/material.dart';
import 'package:markdown/markdown.dart' as md;
import 'package:genie_ai_mobile/services/api_service.dart';
import 'package:genie_ai_mobile/services/i18n_service.dart'; // IMPORTED I18N

/// WEB implementation.
/// This file is ONLY imported when the app runs on the browser.
Future<void> openWebFile({
  required BuildContext context,
  required String fileId,
  required String accessToken,
  required Map<String, dynamic> docMetadata,
}) async {
  final ApiService api = ApiService();
  final String viewUrl = '${api.baseUrl}/files/$fileId/view';
  debugPrint("[WEB_UTILS] Opening web window for: $viewUrl");

  // Check Theme for Dark Mode Support in Markdown Rendering
  final bool isDark = Theme.of(context).brightness == Brightness.dark;

  // 1. Open the window IMMEDIATELY to bypass popup blockers.
  final html.WindowBase openedWindow = html.window.open('', '_blank');

  try {
    // 2. Fetch the content
    final request = html.HttpRequest();
    request.open('GET', viewUrl);
    request.setRequestHeader('Authorization', 'Bearer $accessToken');
    request.responseType = 'blob'; // restored BLOB type

    final c = Completer<void>();

    request.onLoadEnd.listen((e) async {
      try {
        if (request.status == 200 && request.response is html.Blob) {
          final rawBlob = request.response as html.Blob;

          // Determine type
          final bool isMarkdown = _isMarkdown(docMetadata);
          final String targetMimeType =
              isMarkdown ? 'text/markdown' : _getMimeType(docMetadata);

          // 3. Unwrap JSON/Base64 if necessary
          final html.Blob blob = await _unwrapBlob(rawBlob, targetMimeType);

          if (isMarkdown) {
            _handleMarkdownRender(openedWindow, blob, docMetadata, c, isDark);
          } else {
            // Standard File
            final url = html.Url.createObjectUrlFromBlob(blob);
            openedWindow.location.href = url;

            Future.delayed(const Duration(seconds: 15), () {
              html.Url.revokeObjectUrl(url);
            });
            c.complete();
          }
        } else {
          debugPrint("[WEB_UTILS] Server error: ${request.status}");
          openedWindow.close();
          c.completeError("Server returned status ${request.status}");
        }
      } catch (err) {
        debugPrint("[WEB_UTILS] Processing error: $err");
        openedWindow.close();
        c.completeError(err);
      }
    });

    request.onError.listen((e) {
      debugPrint("[WEB_UTILS] Network error");
      openedWindow.close();
      c.completeError("Network Error");
    });

    request.send();
    await c.future;
  } catch (e) {
    debugPrint("[WEB_UTILS] Error: $e");
    try {
      openedWindow.close();
    } catch (_) {}

    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text("${tr('sidebar.launchError')}: $e")),
    );
  }
}

// --- HELPER FUNCTIONS (Restored Logic) ---

void _handleMarkdownRender(html.WindowBase win, html.Blob blob,
    Map<String, dynamic> doc, Completer c, bool isDark) {
  final reader = html.FileReader();
  reader.onLoadEnd.listen((e) {
    try {
      final String text = reader.result as String;

      // Limit check (5MB) - if too large, download instead of render
      if (text.length > 5 * 1024 * 1024) {
        debugPrint(
            "[WEB_UTILS] File too large for markdown render. Downloading.");
        _downloadFallback(win, blob, doc);
        c.complete();
        return;
      }

      final String htmlContent = md.markdownToHtml(text);

      // Determine styling based on mode
      final String bgColor = isDark ? '#0d1117' : '#ffffff';
      final String textColor = isDark ? '#c9d1d9' : '#24292e';
      final String preBg = isDark ? '#161b22' : '#f6f8fa';
      final String codeBg = isDark ? 'rgba(110,118,129,0.4)' : '#f6f8fa';

      final String styledHtml = '''
<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>${doc['title'] ?? 'Document'}</title>
<style>
  body { 
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; 
    line-height: 1.6; 
    padding: 40px; 
    max-width: 900px; 
    margin: 0 auto; 
    color: $textColor; 
    background-color: $bgColor;
  }
  pre { background: $preBg; padding: 16px; border-radius: 6px; overflow-x: auto; }
  code { background: $codeBg; padding: 3px 6px; border-radius: 3px; font-family: monospace; }
  img { max-width: 100%; }
</style>
</head>
<body>
$htmlContent
</body>
</html>
''';
      final htmlBlob = html.Blob([styledHtml], 'text/html');
      final url = html.Url.createObjectUrlFromBlob(htmlBlob);

      // Navigate the window to our generated HTML blob
      win.location.href = url;

      Future.delayed(
          const Duration(seconds: 15), () => html.Url.revokeObjectUrl(url));
      c.complete();
    } catch (err) {
      _downloadFallback(win, blob, doc);
      c.completeError(err);
    }
  });
  reader.readAsText(blob);
}

void _downloadFallback(
    html.WindowBase win, html.Blob blob, Map<String, dynamic> doc) {
  final url = html.Url.createObjectUrlFromBlob(blob);
  final anchor = html.AnchorElement(href: url)
    ..download = doc['fileName'] ?? 'document.md';
  anchor.click();
  html.Url.revokeObjectUrl(url);
  win.close();
}

Future<html.Blob> _unwrapBlob(html.Blob originalBlob, String mimeType) async {
  if (originalBlob.type.contains('json')) {
    final reader = html.FileReader();
    final completer = Completer<html.Blob>();

    reader.onLoadEnd.listen((_) {
      try {
        final String jsonText = reader.result as String;
        final dynamic parsed = jsonDecode(jsonText);
        String? content;

        if (parsed is Map) {
          if (parsed.containsKey('data') && parsed['data'] is Map) {
            content = parsed['data']['base64'] ?? parsed['data']['content'];
          }
          content ??= parsed['base64'] ?? parsed['content'] ?? parsed['file'];
        }

        if (content != null) {
          try {
            final bytes = base64Decode(content);
            completer.complete(html.Blob([bytes], mimeType));
          } catch (_) {
            completer.complete(html.Blob([content], mimeType));
          }
        } else {
          completer.complete(originalBlob);
        }
      } catch (_) {
        completer.complete(originalBlob);
      }
    });
    reader.readAsText(originalBlob);
    return completer.future;
  }
  return originalBlob;
}

bool _isMarkdown(Map<String, dynamic> doc) {
  final String? type = doc['type']?.toString().toLowerCase();
  if (type == 'markdown' || type == 'md') return true;
  final String name = (doc['fileName'] ?? doc['document_name'] ?? doc['title'])
          ?.toString()
          .toLowerCase() ??
      '';
  return name.endsWith('.md') || name.endsWith('.markdown');
}

String _getMimeType(Map<String, dynamic> doc) {
  final String? type = doc['type']?.toString().toLowerCase();
  final String name = (doc['fileName'] ?? doc['document_name'] ?? doc['title'])
          ?.toString()
          .toLowerCase() ??
      '';

  if (type == 'pdf' || name.endsWith('.pdf')) return 'application/pdf';
  if (type == 'html' || name.endsWith('.html')) return 'text/html';
  if (type == 'docx' || name.endsWith('.docx')) {
    return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  }
  if (type == 'xlsx' || name.endsWith('.xlsx')) {
    return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  }
  return 'application/octet-stream';
}
