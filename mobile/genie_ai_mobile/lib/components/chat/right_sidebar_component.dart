import 'dart:async';
import 'dart:convert'; // For jsonDecode and base64Decode
import 'dart:html' as html;
import 'package:flutter/material.dart';
import 'package:flutter/foundation.dart' show kIsWeb;
import 'package:flutter/services.dart';
import 'package:flutter_markdown/flutter_markdown.dart';
import 'package:markdown/markdown.dart' as md;
import 'package:url_launcher/url_launcher.dart';
import 'package:genie_ai_mobile/services/api_service.dart';

class RightSidebarComponent extends StatefulWidget {
  final List<dynamic> relatedDocuments;
  final String? accessToken;

  const RightSidebarComponent({
    super.key,
    required this.relatedDocuments,
    this.accessToken,
  });

  @override
  State<RightSidebarComponent> createState() => _RightSidebarComponentState();
}

class _RightSidebarComponentState extends State<RightSidebarComponent> {
  final ApiService _api = ApiService();

  String _faqContent = "Loading FAQ...";

  @override
  void initState() {
    super.initState();
    _loadFAQ();
  }

  Future<void> _loadFAQ() async {
    try {
      final String md = await rootBundle.loadString('assets/FAQ.md');
      setState(() => _faqContent = md);
    } catch (e) {
      setState(() => _faqContent = "FAQ not available");
      debugPrint("[RIGHT_SIDEBAR] FAQ load error: $e");
    }
  }

  IconData _documentIconClass(Map<String, dynamic> doc) {
    final String? type = doc['type']?.toLowerCase();
    switch (type) {
      case 'pdf':
        return Icons.picture_as_pdf;
      case 'word':
      case 'doc':
      case 'docx':
        return Icons.description;
      case 'excel':
      case 'xls':
      case 'xlsx':
        return Icons.table_chart;
      case 'powerpoint':
      case 'ppt':
      case 'pptx':
        return Icons.slideshow;
      case 'image':
        return Icons.image;
      case 'video':
        return Icons.videocam;
      case 'audio':
        return Icons.audiotrack;
      case 'text':
      case 'txt':
      case 'html':
      case 'markdown':
        return Icons.text_snippet;
      default:
        return Icons.insert_drive_file;
    }
  }

  String _formatLabels(Map<String, dynamic> doc) {
    final List<dynamic>? labels = doc['labels'] ??
        doc['tags'] ??
        doc['categoryLabel'] ??
        doc['serviceLabels'];
    if (labels == null || labels.isEmpty) return 'None';
    return labels.join(', ');
  }

  String _formatScore(dynamic score) {
    if (score == null) return 'N/A';
    if (score is num) {
      return '${(score * 100).toStringAsFixed(1)}%';
    }
    return score.toString();
  }

  // --- Helper Methods for File Handling ---

  bool _isMarkdown(Map<String, dynamic> doc) {
    final String? type = doc['type']?.toString().toLowerCase();
    if (type == 'markdown' || type == 'md') return true;

    final String? name = (doc['fileName'] ??
            doc['document_name'] ??
            doc['documentName'] ??
            doc['title'])
        ?.toString()
        .toLowerCase();

    if (name != null) {
      return name.endsWith('.md') || name.endsWith('.markdown');
    }
    return false;
  }

  String _getMimeType(Map<String, dynamic> doc) {
    final String? type = doc['type']?.toString().toLowerCase();
    final String name = (doc['fileName'] ??
            doc['document_name'] ??
            doc['documentName'] ??
            doc['title'] ??
            '')
        .toString()
        .toLowerCase();

    if (type == 'pdf' || name.endsWith('.pdf')) {
      return 'application/pdf';
    }
    if (type == 'html' || name.endsWith('.html') || name.endsWith('.htm')) {
      return 'text/html';
    }
    if (type == 'txt' || type == 'text' || name.endsWith('.txt')) {
      return 'text/plain';
    }
    if (type == 'docx' || name.endsWith('.docx')) {
      return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    }
    if (type == 'doc' || name.endsWith('.doc')) {
      return 'application/msword';
    }
    if (type == 'xlsx' || name.endsWith('.xlsx')) {
      return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    }
    if (type == 'xls' || name.endsWith('.xls')) {
      return 'application/vnd.ms-excel';
    }

    return 'application/octet-stream';
  }

  /// Helper: Unwraps the Blob if it is hidden inside a JSON response.
  Future<html.Blob> _unwrapBlob(html.Blob originalBlob, String mimeType) async {
    // If the server explicitly says it's JSON, we likely need to parse it.
    if (originalBlob.type.contains('json')) {
      debugPrint(
          "[RIGHT_SIDEBAR] Blob is JSON. Attempting to unwrap content...");
      final reader = html.FileReader();
      final completer = Completer<html.Blob>();

      reader.onLoadEnd.listen((_) {
        try {
          final String jsonText = reader.result as String;
          final dynamic parsed = jsonDecode(jsonText);

          // Locate the content based on user's structure:
          // {"success":true,"message":"...","data":{"base64":"..."}}
          String? content;

          if (parsed is Map) {
            // Check nested 'data' object first
            if (parsed.containsKey('data') && parsed['data'] is Map) {
              content = parsed['data']['base64'] ?? parsed['data']['content'];
            }
            // Fallback to top-level
            if (content == null) {
              content = parsed['base64'] ?? parsed['content'] ?? parsed['file'];
            }
          }

          if (content != null) {
            try {
              // Decode Base64 to binary
              final bytes = base64Decode(content);
              debugPrint(
                  "[RIGHT_SIDEBAR] Successfully decoded Base64 content.");
              completer.complete(html.Blob([bytes], mimeType));
            } catch (e) {
              // Fallback: it was just a string
              debugPrint(
                  "[RIGHT_SIDEBAR] Content was not valid Base64, treating as plain text.");
              completer.complete(html.Blob([content], mimeType));
            }
          } else {
            // Could not find content field, return original
            debugPrint(
                "[RIGHT_SIDEBAR] JSON parsed but no 'base64' or 'content' field found.");
            completer.complete(originalBlob);
          }
        } catch (e) {
          debugPrint("[RIGHT_SIDEBAR] Error parsing JSON blob: $e");
          completer.complete(originalBlob);
        }
      });

      reader.onError.listen((e) => completer.completeError(e));
      reader.readAsText(originalBlob);

      return completer.future;
    }

    // Not JSON, return as is
    return originalBlob;
  }

  Future<void> _openDocument(Map<String, dynamic> doc) async {
    final String? fileId =
        doc['id'] ?? doc['_id'] ?? doc['fileId'] ?? doc['document_id'];
    if (fileId == null) {
      debugPrint("[RIGHT_SIDEBAR] Error: Document ID is null");
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text("Document ID not found")),
      );
      return;
    }

    final String? token = widget.accessToken ?? _api.accessToken;
    if (token == null || token.isEmpty) {
      debugPrint("[RIGHT_SIDEBAR] Error: No access token");
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
            content: Text("Not authenticated – cannot open document")),
      );
      return;
    }

    final String viewUrl = '${ApiService.baseUrl}/files/$fileId/view';
    final bool isMarkdownDoc = _isMarkdown(doc);

    if (kIsWeb) {
      debugPrint("[RIGHT_SIDEBAR] Web mode: Opening new window...");
      final html.WindowBase? openedWindow = html.window.open('', '_blank');

      if (openedWindow == null) {
        debugPrint("[RIGHT_SIDEBAR] Error: Popup blocked");
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text("Popup blocked. Please allow popups.")),
        );
        return;
      }

      debugPrint("[RIGHT_SIDEBAR] Fetching content from: $viewUrl");

      try {
        final request = html.HttpRequest();
        request.open('GET', viewUrl);
        request.setRequestHeader('Authorization', 'Bearer $token');
        request.responseType = 'blob';

        final c = Completer<void>();

        request.onLoadEnd.listen((e) async {
          debugPrint("[RIGHT_SIDEBAR] Fetch status: ${request.status}");
          try {
            if (request.status == 200 && request.response is html.Blob) {
              final rawBlob = request.response as html.Blob;
              debugPrint(
                  "[RIGHT_SIDEBAR] Raw blob type: ${rawBlob.type}, size: ${rawBlob.size}");

              // Determine target MIME type
              final String targetMimeType =
                  isMarkdownDoc ? 'text/markdown' : _getMimeType(doc);

              // UNWRAP STEP: Extract clean binary from JSON/Base64 wrapper
              final html.Blob blob = await _unwrapBlob(rawBlob, targetMimeType);

              if (isMarkdownDoc) {
                debugPrint("[RIGHT_SIDEBAR] Processing Markdown...");
                final reader = html.FileReader();

                reader.onLoadEnd.listen((e) {
                  try {
                    final String text = reader.result as String;

                    // 1. Check File Size (Limit: 5MB)
                    if (text.length > 5 * 1024 * 1024) {
                      debugPrint(
                          "[RIGHT_SIDEBAR] File too large (${text.length} bytes). Downloading instead.");

                      // Trigger Download
                      final url = html.Url.createObjectUrlFromBlob(blob);
                      final anchor = html.AnchorElement(href: url)
                        ..target = 'blank'
                        ..download = doc['fileName'] ??
                            doc['document_name'] ??
                            'document.md';
                      anchor.click();
                      html.Url.revokeObjectUrl(url);

                      openedWindow.close();
                      c.complete();
                      return;
                    }

                    // 2. Render if size is OK
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
                    debugPrint(
                        "[RIGHT_SIDEBAR] Markdown rendered. Creating Object URL.");
                    final htmlBlob = html.Blob([styledHtml], 'text/html');
                    final url = html.Url.createObjectUrlFromBlob(htmlBlob);

                    openedWindow.location?.href = url;

                    Future.delayed(const Duration(seconds: 15), () {
                      html.Url.revokeObjectUrl(url);
                    });
                    c.complete();
                  } catch (err) {
                    debugPrint("[RIGHT_SIDEBAR] Markdown Error: $err");
                    // On error, fallback to download the CLEAN blob
                    try {
                      final url = html.Url.createObjectUrlFromBlob(blob);
                      final anchor = html.AnchorElement(href: url)
                        ..download = 'document.md';
                      anchor.click();
                      openedWindow.close();
                    } catch (_) {}
                    c.completeError(err);
                  }
                });

                reader.onError.listen((err) => c.completeError(err));
                reader.readAsText(blob);
              } else {
                debugPrint("[RIGHT_SIDEBAR] Processing Standard File...");
                debugPrint("[RIGHT_SIDEBAR] Final MIME: $targetMimeType");

                final url = html.Url.createObjectUrlFromBlob(blob);
                openedWindow.location?.href = url;

                Future.delayed(const Duration(seconds: 15), () {
                  html.Url.revokeObjectUrl(url);
                });
                c.complete();
              }
            } else {
              debugPrint(
                  "[RIGHT_SIDEBAR] Fetch failed with status ${request.status}");
              c.completeError("Server returned status ${request.status}");
            }
          } catch (e) {
            debugPrint("[RIGHT_SIDEBAR] Processing Error: $e");
            c.completeError(e);
          }
        });

        request.onError.listen((e) {
          debugPrint("[RIGHT_SIDEBAR] Network Error");
          c.completeError("Network Error");
        });

        request.send();
        await c.future;
      } catch (e) {
        debugPrint("[RIGHT_SIDEBAR] Web open error: $e");
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text("Error opening document: $e")),
        );
      }
    } else {
      // --- MOBILE FALLBACK ---
      final String urlWithToken = '$viewUrl?access_token=$token';
      final Uri uri = Uri.parse(urlWithToken);
      if (await canLaunchUrl(uri)) {
        await launchUrl(uri, mode: LaunchMode.externalApplication);
      } else {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
              content: Text("Cannot open document on this platform")),
        );
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final ThemeData theme = Theme.of(context);

    return Container(
      width: 360,
      decoration: BoxDecoration(
        color: theme.scaffoldBackgroundColor,
        border: Border(left: BorderSide(color: theme.dividerColor)),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withOpacity(0.05),
            blurRadius: 8,
            offset: const Offset(-4, 0),
          ),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Header
          Container(
            padding: const EdgeInsets.all(16),
            decoration: BoxDecoration(
              color: theme.appBarTheme.backgroundColor,
              border: Border(bottom: BorderSide(color: theme.dividerColor)),
            ),
            child: Row(
              children: [
                Icon(Icons.description, color: Colors.white),
                const SizedBox(width: 8),
                Text(
                  "Related Documents",
                  style: theme.textTheme.titleMedium
                      ?.copyWith(color: Colors.white),
                ),
              ],
            ),
          ),

          // Related Documents List
          Expanded(
            flex: 3,
            child: widget.relatedDocuments.isEmpty
                ? Center(
                    child: Text(
                      "No related documents found",
                      style: TextStyle(
                        color:
                            theme.textTheme.bodySmall?.color?.withOpacity(0.6),
                        fontStyle: FontStyle.italic,
                      ),
                    ),
                  )
                : ListView.builder(
                    padding: const EdgeInsets.all(12),
                    itemCount: widget.relatedDocuments.length,
                    itemBuilder: (context, index) {
                      final doc = widget.relatedDocuments[index]
                          as Map<String, dynamic>;

                      return Card(
                        margin: const EdgeInsets.symmetric(vertical: 8),
                        elevation: 2,
                        shape: RoundedRectangleBorder(
                            borderRadius: BorderRadius.circular(8)),
                        child: ExpansionTile(
                          leading: Icon(_documentIconClass(doc),
                              color: theme.primaryColor),
                          title: Text(
                            doc['title'] ??
                                doc['document_name'] ??
                                doc['documentName'] ??
                                'Untitled Document',
                            style: theme.textTheme.titleSmall,
                            maxLines: 2,
                            overflow: TextOverflow.ellipsis,
                          ),
                          subtitle: Text(
                            doc['id'] ??
                                doc['_id'] ??
                                doc['document_id'] ??
                                'ID not available',
                            style: theme.textTheme.bodySmall
                                ?.copyWith(color: theme.hintColor),
                          ),
                          children: [
                            Padding(
                              padding:
                                  const EdgeInsets.all(16).copyWith(top: 0),
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  if (doc['document_name'] != null ||
                                      doc['documentName'] != null)
                                    _buildDetailRow(
                                        "Document Name",
                                        doc['document_name'] ??
                                            doc['documentName'],
                                        theme),
                                  if (doc['fileName'] != null)
                                    _buildDetailRow(
                                        "File Name", doc['fileName'], theme),
                                  _buildDetailRow(
                                      "ID",
                                      doc['id'] ??
                                          doc['_id'] ??
                                          doc['document_id'] ??
                                          'N/A',
                                      theme),
                                  _buildDetailRow(
                                      "Labels", _formatLabels(doc), theme),
                                  _buildDetailRow(
                                      "Confidence",
                                      _formatScore(
                                          doc['score'] ?? doc['confidence']),
                                      theme),
                                  const SizedBox(height: 12),
                                  Align(
                                    alignment: Alignment.centerRight,
                                    child: ElevatedButton.icon(
                                      icon: const Icon(Icons.open_in_new,
                                          size: 16),
                                      label: const Text("Open"),
                                      onPressed: () => _openDocument(doc),
                                      style: ElevatedButton.styleFrom(
                                        padding: const EdgeInsets.symmetric(
                                            horizontal: 12, vertical: 8),
                                      ),
                                    ),
                                  ),
                                ],
                              ),
                            ),
                          ],
                        ),
                      );
                    },
                  ),
          ),

          // Divider
          Divider(height: 1, color: theme.dividerColor),

          // FAQ Section
          Container(
            padding: const EdgeInsets.all(16),
            child: Text(
              "Frequently Asked Questions",
              style: theme.textTheme.titleMedium?.copyWith(
                fontWeight: FontWeight.w600,
              ),
            ),
          ),

          Expanded(
            flex: 2,
            child: SingleChildScrollView(
              padding: const EdgeInsets.symmetric(horizontal: 16),
              child: MarkdownBody(
                data: _faqContent,
                styleSheet: MarkdownStyleSheet.fromTheme(theme).copyWith(
                  p: theme.textTheme.bodyMedium,
                  h1: theme.textTheme.titleLarge,
                  h2: theme.textTheme.titleMedium,
                  h3: theme.textTheme.titleSmall,
                  listBullet: theme.textTheme.bodyMedium,
                ),
                selectable: true,
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildDetailRow(String label, String value, ThemeData theme) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 4),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
            width: 100,
            child: Text(
              "$label:",
              style: theme.textTheme.bodySmall
                  ?.copyWith(fontWeight: FontWeight.w500),
            ),
          ),
          Expanded(
            child: Text(
              value,
              style: theme.textTheme.bodySmall,
              textAlign: TextAlign.right,
            ),
          ),
        ],
      ),
    );
  }
}
