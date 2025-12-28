import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter/foundation.dart' show kIsWeb;
import 'package:flutter/services.dart';
import 'package:flutter_markdown/flutter_markdown.dart';
import 'package:url_launcher/url_launcher.dart';
import 'package:genie_ai_mobile/services/api_service.dart';

// --- CONDITIONAL IMPORT ---
import 'stub_file_utils.dart' if (dart.library.html) 'web_file_utils.dart';

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
    if (score is num) return '${(score * 100).toStringAsFixed(1)}%';
    return score.toString();
  }

  Future<void> _openDocument(Map<String, dynamic> doc) async {
    final String? fileId =
        doc['id'] ?? doc['_id'] ?? doc['fileId'] ?? doc['document_id'];
    if (fileId == null) {
      ScaffoldMessenger.of(context)
          .showSnackBar(const SnackBar(content: Text("Document ID not found")));
      return;
    }

    final String? token = widget.accessToken ?? _api.accessToken;
    if (token == null || token.isEmpty) {
      ScaffoldMessenger.of(context)
          .showSnackBar(const SnackBar(content: Text("Not authenticated")));
      return;
    }

    if (kIsWeb) {
      // Calls the function from web_file_utils.dart (via conditional import)
      // On mobile, this code path is dead, but the compiler sees 'stub_file_utils.dart'
      await openWebFile(
        context: context,
        fileId: fileId,
        accessToken: token,
        docMetadata: doc,
      );
    } else {
      // --- MOBILE FALLBACK ---
      final String viewUrl = '${_api.baseUrl}/files/$fileId/view';
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
                const Icon(Icons.description, color: Colors.white),
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
