import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter/foundation.dart' show kIsWeb;
import 'package:flutter/services.dart';
import 'package:flutter_markdown/flutter_markdown.dart';
import 'package:url_launcher/url_launcher.dart';
import 'package:genie_ai_mobile/services/api_service.dart';
import 'package:genie_ai_mobile/utils/theme_manager.dart';

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
      await openWebFile(
        context: context,
        fileId: fileId,
        accessToken: token,
        docMetadata: doc,
      );
    } else {
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

  Widget _buildRightSidebarContent(BuildContext context, ThemeData theme) {
    final colors = ThemeManager().getColors();
    final bool isDark = ThemeManager().isDarkMode;

    return Material(
      color: colors['background'], // Dynamic Background matching Sidebar
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // HEADER - Styled exactly like the Left Sidebar Tabs
          // Height set to 72.0 to match standard Tab(icon+text) height
          Container(
            height: 72.0,
            padding: const EdgeInsets.symmetric(horizontal: 16),
            alignment: Alignment.centerLeft, // Vertically center the content
            decoration: BoxDecoration(
              color: colors['surface'],
              border: Border(
                bottom: BorderSide(
                  color: colors['border'],
                  width: 1,
                ),
              ),
            ),
            child: Row(
              children: [
                Icon(Icons.description_outlined,
                    color: theme.primaryColor, size: 20),
                const SizedBox(width: 8),
                Text(
                  "Related Documents",
                  style: TextStyle(
                    fontSize: 13,
                    fontWeight: FontWeight.bold,
                    color: theme.primaryColor, // Matching Tab Label Color
                  ),
                ),
              ],
            ),
          ),

          // CONTENT - Related Documents List
          Expanded(
            flex: 3,
            child: widget.relatedDocuments.isEmpty
                ? Center(
                    child: Text(
                      "No related documents found",
                      style: TextStyle(
                        color: colors['text'].withOpacity(0.6),
                        fontSize: 13,
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

                      return Container(
                        margin: const EdgeInsets.symmetric(vertical: 6),
                        decoration: BoxDecoration(
                          color: theme.cardColor,
                          borderRadius: BorderRadius.circular(10),
                          border: isDark
                              ? Border.all(color: colors['border'])
                              : null,
                          boxShadow: isDark
                              ? []
                              : [
                                  BoxShadow(
                                    color: Colors.black.withOpacity(0.05),
                                    blurRadius: 4,
                                    offset: const Offset(0, 2),
                                  ),
                                ],
                        ),
                        child: ExpansionTile(
                          shape: const Border(), // Remove default borders
                          leading: Icon(_documentIconClass(doc),
                              color: theme.primaryColor, size: 24),
                          title: Text(
                            doc['title'] ??
                                doc['document_name'] ??
                                doc['documentName'] ??
                                'Untitled Document',
                            style: TextStyle(
                              fontSize: 13,
                              fontWeight: FontWeight.bold,
                              color: colors['text'],
                            ),
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                          ),
                          subtitle: Text(
                            "Confidence: ${_formatScore(doc['score'] ?? doc['confidence'])}",
                            style: TextStyle(
                              fontSize: 11,
                              color: colors['text'].withOpacity(0.6),
                            ),
                          ),
                          children: [
                            Padding(
                              padding:
                                  const EdgeInsets.all(16).copyWith(top: 0),
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  _buildDetailRow(
                                      "File Name",
                                      doc['fileName'] ?? 'N/A',
                                      theme,
                                      colors['text']),
                                  _buildDetailRow("Labels", _formatLabels(doc),
                                      theme, colors['text']),
                                  const SizedBox(height: 12),
                                  Align(
                                    alignment: Alignment.centerRight,
                                    child: SizedBox(
                                      height: 32,
                                      child: ElevatedButton.icon(
                                        icon: const Icon(Icons.open_in_new,
                                            size: 14),
                                        label: const Text("Open",
                                            style: TextStyle(fontSize: 12)),
                                        onPressed: () => _openDocument(doc),
                                        style: ElevatedButton.styleFrom(
                                          backgroundColor: theme.primaryColor
                                              .withOpacity(0.1),
                                          foregroundColor: theme.primaryColor,
                                          elevation: 0,
                                          padding: const EdgeInsets.symmetric(
                                              horizontal: 12),
                                        ),
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
          Divider(height: 1, color: colors['border']),

          // FAQ Header
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
            color: colors['surface'],
            width: double.infinity,
            child: Row(
              children: [
                Icon(Icons.help_outline, size: 18, color: colors['text']),
                const SizedBox(width: 8),
                Text(
                  "Frequently Asked Questions",
                  style: TextStyle(
                    fontSize: 13,
                    fontWeight: FontWeight.w600,
                    color: colors['text'],
                  ),
                ),
              ],
            ),
          ),

          // FAQ Content
          Expanded(
            flex: 2,
            child: SingleChildScrollView(
              padding: const EdgeInsets.all(16),
              child: MarkdownBody(
                data: _faqContent,
                styleSheet: MarkdownStyleSheet.fromTheme(theme).copyWith(
                  p: theme.textTheme.bodyMedium?.copyWith(
                      color: colors['text'], fontSize: 13, height: 1.5),
                  h1: theme.textTheme.titleLarge
                      ?.copyWith(color: colors['text']),
                  h2: theme.textTheme.titleMedium
                      ?.copyWith(color: colors['text']),
                  h3: theme.textTheme.titleSmall
                      ?.copyWith(color: colors['text']),
                  listBullet: theme.textTheme.bodyMedium
                      ?.copyWith(color: colors['text']),
                ),
                selectable: true,
              ),
            ),
          ),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final bool isWideScreen = MediaQuery.of(context).size.width > 1200;

    // 1. Persistent Panel on Wide Screens
    if (isWideScreen) {
      return SizedBox(
        width: 360,
        child: _buildRightSidebarContent(context, theme),
      );
    }

    // 2. Mobile Drawer
    // Identical structure to SidebarComponent to ensure perfect alignment
    return Drawer(
      elevation: 0,
      backgroundColor: Colors.transparent, // Important: no background on drawer
      child: SafeArea(
        top: false, // We manually handle top (AppBar height)
        bottom: true, // Respect bottom safe area (home indicator)
        child: Column(
          children: [
            // Empty space equal to AppBar height (60) so content starts below navbar
            SizedBox(
              height: kToolbarHeight + MediaQuery.of(context).padding.top,
            ),
            // The actual sidebar content
            Expanded(
              child: _buildRightSidebarContent(context, theme),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildDetailRow(
      String label, String value, ThemeData theme, Color textColor) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 4),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
            width: 80,
            child: Text(
              "$label:",
              style: TextStyle(
                fontSize: 11,
                fontWeight: FontWeight.w600,
                color: textColor.withOpacity(0.7),
              ),
            ),
          ),
          Expanded(
            child: Text(
              value,
              style: TextStyle(
                fontSize: 11,
                color: textColor,
              ),
              textAlign: TextAlign.left,
            ),
          ),
        ],
      ),
    );
  }
}
