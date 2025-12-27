import 'dart:async';
import 'dart:convert';
import 'dart:html' as html;
import 'package:flutter/material.dart';
import 'package:markdown/markdown.dart' as md;
import 'package:genie_ai_mobile/services/api_service.dart';

/// WEB implementation.
/// This file is ONLY imported when the app runs on the browser.
Future<void> openWebFile({
  required BuildContext context,
  required String fileId,
  required String accessToken,
  required Map<String, dynamic> docMetadata,
}) async {
  final String viewUrl = '${ApiService.baseUrl}/files/$fileId/view';
  debugPrint("[WEB_UTILS] Opening web window for: $viewUrl");

  // 1. Open the window IMMEDIATELY to bypass popup blockers.
  // We use WindowBase because '_DOMWindowCrossFrame' cannot be cast to 'Window'.
  final html.WindowBase? openedWindow = html.window.open('', '_blank');
  
  if (openedWindow == null) {
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(content: Text("Popup blocked. Please allow popups.")),
    );
    return;
  }

  // Note: We cannot write "Loading..." to openedWindow.document because 
  // WindowBase does not expose the document property safely in all contexts.
  // The user will see a blank tab while fetching.

  try {
    // 2. Fetch the content
    final request = html.HttpRequest();
    request.open('GET', viewUrl);
    request.setRequestHeader('Authorization', 'Bearer $accessToken');
    request.responseType = 'blob';

    final c = Completer<void>();

    request.onLoadEnd.listen((e) async {
      try {
        if (request.status == 200 && request.response is html.Blob) {
          final rawBlob = request.response as html.Blob;
          
          // Determine type
          final bool isMarkdown = _isMarkdown(docMetadata);
          final String targetMimeType = isMarkdown ? 'text/markdown' : _getMimeType(docMetadata);

          // 3. Unwrap JSON/Base64 if necessary
          final html.Blob blob = await _unwrapBlob(rawBlob, targetMimeType);

          if (isMarkdown) {
            _handleMarkdownRender(openedWindow, blob, docMetadata, c);
          } else {
            // Standard File
            final url = html.Url.createObjectUrlFromBlob(blob);
            openedWindow.location?.href = url;
            
            // Revoke after delay
            Future.delayed(const Duration(seconds: 15), () {
              html.Url.revokeObjectUrl(url);
            });
            c.complete();
          }
        } else {
          debugPrint("[WEB_UTILS] Server error: ${request.status}");
          // We can't write to the window, so we just close it if it failed immediately
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
    // Ensure window is closed on error so we don't leave a zombie tab
    try {
      openedWindow.close(); 
    } catch (_) {}
    
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text("Error opening document: $e")),
    );
  }
}

// --- HELPER FUNCTIONS ---

void _handleMarkdownRender(html.WindowBase win, html.Blob blob, Map<String, dynamic> doc, Completer c) {
  final reader = html.FileReader();
  reader.onLoadEnd.listen((e) {
    try {
      final String text = reader.result as String;

      // Limit check (5MB) - if too large, download instead of render
      if (text.length > 5 * 1024 * 1024) {
        debugPrint("[WEB_UTILS] File too large for markdown render. Downloading.");
        _downloadFallback(win, blob, doc);
        c.complete();
        return;
      }

      final String htmlContent = md.markdownToHtml(text);
      final String styledHtml = '''
<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>${doc['title'] ?? 'Document'}</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; line-height: 1.6; padding: 40px; max-width: 900px; margin: 0 auto; color: #24292e; }
  pre { background: #f6f8fa; padding: 16px; border-radius: 6px; overflow-x: auto; }
  code { background: #f6f8fa; padding: 3px 6px; border-radius: 3px; font-family: monospace; }
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
      win.location?.href = url;
      
      Future.delayed(const Duration(seconds: 15), () => html.Url.revokeObjectUrl(url));
      c.complete();
    } catch (err) {
      // Fallback to download on parsing error
      _downloadFallback(win, blob, doc);
      c.completeError(err);
    }
  });
  reader.readAsText(blob);
}

void _downloadFallback(html.WindowBase win, html.Blob blob, Map<String, dynamic> doc) {
  // Create anchor in the MAIN window context to trigger download
  final url = html.Url.createObjectUrlFromBlob(blob);
  final anchor = html.AnchorElement(href: url)
    ..download = doc['fileName'] ?? 'document.md';
  anchor.click();
  html.Url.revokeObjectUrl(url);
  
  // Close the blank tab we opened since we are downloading instead
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
          if (content == null) {
            content = parsed['base64'] ?? parsed['content'] ?? parsed['file'];
          }
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
  final String name = (doc['fileName'] ?? doc['document_name'] ?? doc['title'])?.toString().toLowerCase() ?? '';
  return name.endsWith('.md') || name.endsWith('.markdown');
}

String _getMimeType(Map<String, dynamic> doc) {
  final String? type = doc['type']?.toString().toLowerCase();
  final String name = (doc['fileName'] ?? doc['document_name'] ?? doc['title'])?.toString().toLowerCase() ?? '';
  
  if (type == 'pdf' || name.endsWith('.pdf')) return 'application/pdf';
  if (type == 'html' || name.endsWith('.html')) return 'text/html';
  if (type == 'docx' || name.endsWith('.docx')) return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  if (type == 'xlsx' || name.endsWith('.xlsx')) return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  return 'application/octet-stream';
}