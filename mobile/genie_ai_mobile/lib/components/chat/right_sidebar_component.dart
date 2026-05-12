import 'dart:async';
import 'dart:convert';
import 'dart:math';
import 'package:flutter/material.dart';
import 'package:flutter/foundation.dart' show kIsWeb;
import 'package:flutter/services.dart';
import 'package:flutter_markdown/flutter_markdown.dart';
import 'package:url_launcher/url_launcher.dart';
import 'package:genie_ai_mobile/services/api_service.dart';
import 'package:genie_ai_mobile/utils/theme_manager.dart';
import 'package:genie_ai_mobile/services/i18n_service.dart';

// --- CONDITIONAL IMPORT ---
import 'package:genie_ai_mobile/components/chat/stub_file_utils.dart'
    if (dart.library.html) 'package:genie_ai_mobile/components/chat/web_file_utils.dart';

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

  List<Map<String, String>> _faqItems = [];
  bool _isLoadingFaq = false;
  String _currentLangCode = 'en';

  @override
  void initState() {
    super.initState();
    _currentLangCode = I18nService().currentLocale.languageCode;
    _loadAndProcessFAQ();
    I18nService().addListener(_onLanguageChange);
  }

  @override
  void dispose() {
    I18nService().removeListener(_onLanguageChange);
    super.dispose();
  }

  void _onLanguageChange() {
    final newCode = I18nService().currentLocale.languageCode;
    if (newCode != _currentLangCode) {
      setState(() {
        _currentLangCode = newCode;
      });
      _loadAndProcessFAQ();
    }
  }

  Future<void> _loadAndProcessFAQ() async {
    if (!mounted) return;
    setState(() => _isLoadingFaq = true);

    String markdownContent = "";

    try {
      final String baseMarkdown = await rootBundle.loadString('assets/FAQ.md');

      if (_currentLangCode == 'en') {
        markdownContent = baseMarkdown;
      } else {
        try {
          final response = await _api.post('translate/markdown', {
            'markdown': baseMarkdown,
            'source_lang': 'en',
            'target_lang': _currentLangCode,
          });

          if (response.statusCode == 200 || response.statusCode == 201) {
            final data = jsonDecode(response.body);
            final dynamic translated = data['translated_markdown'];
            if (translated is List) {
              markdownContent = translated.join('\n');
            } else if (translated is String) {
              markdownContent = translated;
            } else {
              markdownContent = baseMarkdown;
            }
          } else {
            markdownContent = baseMarkdown;
          }
        } catch (e) {
          markdownContent = baseMarkdown;
        }
      }

      final parsedFaqs = _parseFaqMarkdown(markdownContent);

      if (mounted) {
        setState(() {
          _faqItems = parsedFaqs;
          _isLoadingFaq = false;
        });
      }
    } catch (e) {
      if (mounted) {
        setState(() {
          _faqItems = [
            {'question': 'Error', 'answer': tr('sidebar.weatherErrorDefault')}
          ];
          _isLoadingFaq = false;
        });
      }
    }
  }

  List<Map<String, String>> _parseFaqMarkdown(String markdown) {
    final List<Map<String, String>> faqs = [];
    final lines = markdown.split('\n');

    String? currentQuestion;
    StringBuffer currentAnswer = StringBuffer();

    for (var line in lines) {
      if (line.trim().startsWith('## ')) {
        if (currentQuestion != null) {
          faqs.add({
            'question': currentQuestion,
            'answer': currentAnswer.toString().trim()
          });
          currentAnswer.clear();
        }
        currentQuestion = line.substring(3).trim();
      } else {
        if (currentQuestion != null) {
          currentAnswer.writeln(line);
        }
      }
    }

    if (currentQuestion != null) {
      faqs.add({
        'question': currentQuestion,
        'answer': currentAnswer.toString().trim()
      });
    }

    return faqs;
  }

  // ===========================================================================
  // DATA HELPERS
  // ===========================================================================

  dynamic _getDocValue(Map<String, dynamic> doc, List<String> keys) {
    for (var key in keys) {
      if (doc.containsKey(key) && doc[key] != null) return doc[key];
      if (doc['metadata'] is Map && doc['metadata'][key] != null) {
        return doc['metadata'][key];
      }
    }
    return null;
  }

  IconData _getDocumentIcon(Map<String, dynamic> doc) {
    final String url = _getDocValue(doc, ['url'])?.toString() ?? "";
    final bool isExternal = url.startsWith('http') && !url.contains('<HOST>');
    if (isExternal) return Icons.public;

    final String type =
        _getDocValue(doc, ['type', 'fileType'])?.toString().toLowerCase() ?? '';
    final String name =
        (_getDocValue(doc, ['fileName', 'document_name', 'title']) ?? '')
            .toString()
            .toLowerCase();

    if (type == 'pdf' || name.endsWith('.pdf')) return Icons.picture_as_pdf;
    if (type.contains('word') || name.contains('.doc')) {
      return Icons.description;
    }
    if (type.contains('excel') || name.contains('.xls')) {
      return Icons.table_chart;
    }
    if (type.contains('powerpoint') || name.contains('.ppt')) {
      return Icons.slideshow;
    }
    if (type.contains('image') ||
        name.contains('.jpg') ||
        name.contains('.png')) {
      return Icons.image;
    }
    if (type.contains('video')) return Icons.videocam;
    if (type.contains('audio')) return Icons.audiotrack;
    if (name.endsWith('.md') || name.endsWith('.txt')) {
      return Icons.text_snippet;
    }

    return Icons.insert_drive_file;
  }

  String _formatScore(dynamic score) {
    if (score == null || score is! num) return tr('sidebar.unknown');
    return "${(score * 100).toStringAsFixed(2)}%";
  }

  String _formatFileSize(Map<String, dynamic> doc) {
    final val = _getDocValue(
        doc, ['size', 'fileSize', 'length', 'contentLength', 'file_size']);

    num bytes = 0;
    if (val is num) {
      bytes = val;
    } else if (val is String) {
      bytes = num.tryParse(val) ?? 0;
    }

    if (bytes <= 0) return tr('sidebar.unknown');

    const suffixes = ["B", "KB", "MB", "GB"];
    var i = (log(bytes) / log(1024)).floor();
    return '${(bytes / pow(1024, i)).toStringAsFixed(1)} ${suffixes[i]}';
  }

  String _getFileFormat(Map<String, dynamic> doc) {
    final type = _getDocValue(doc, ['fileType', 'mimeType', 'type', 'format']);
    if (type != null) {
      final s = type.toString();
      if (s.contains('/')) return s.split('/').last.toUpperCase();
      return s.toUpperCase();
    }

    final String name =
        (_getDocValue(doc, ['fileName', 'document_name']) ?? '').toString();
    if (name.contains('.')) return name.split('.').last.toUpperCase();

    return "FILE";
  }

  String _formatLabels(Map<String, dynamic> doc) {
    final Set<String> allLabels = {};

    final cat = _getDocValue(doc, ['categoryLabel', 'category']);
    if (cat != null) {
      if (cat is List) {
        allLabels.addAll(cat.map((e) => e.toString()));
      } else {
        allLabels.add(cat.toString());
      }
    }

    final srv = _getDocValue(doc, ['serviceLabels', 'services']);
    if (srv != null) {
      if (srv is List) {
        allLabels.addAll(srv.map((e) => e.toString()));
      } else {
        allLabels.add(srv.toString());
      }
    }

    final lbl = _getDocValue(doc, ['labels', 'tags', 'keywords']);
    if (lbl != null) {
      if (lbl is List) {
        allLabels.addAll(lbl.map((e) => e.toString()));
      } else {
        allLabels.add(lbl.toString());
      }
    }

    if (allLabels.isEmpty) return tr('sidebar.unknown');
    return allLabels.join(", ");
  }

  // RESTORED: Original File Opening Logic
  Future<void> _openDocument(Map<String, dynamic> doc) async {
    final String url = _getDocValue(doc, ['url'])?.toString() ?? "";

    if (url.startsWith('http') && !url.contains('<HOST>')) {
      launchUrl(Uri.parse(url), mode: LaunchMode.externalApplication);
      return;
    }

    final String? fileId =
        _getDocValue(doc, ['id', '_id', 'fileId', 'document_id'])?.toString();

    if (fileId == null) {
      ScaffoldMessenger.of(context)
          .showSnackBar(SnackBar(content: Text(tr('sidebar.docIdNotFound'))));
      return;
    }

    final String? token = widget.accessToken ?? _api.accessToken;
    if (token == null || token.isEmpty) {
      ScaffoldMessenger.of(context)
          .showSnackBar(SnackBar(content: Text(tr('sidebar.authError'))));
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
          SnackBar(content: Text(tr('sidebar.launchError'))),
        );
      }
    }
  }

  // ===========================================================================
  // CONTENT BUILDER (Abstracted to support Drawer vs Panel)
  // ===========================================================================
  Widget _buildRightSidebarContent(BuildContext context, ThemeData theme,
      Map<String, dynamic> colors, bool isDark) {
    return Material(
      color: colors['background'],
      child: Container(
        decoration: BoxDecoration(
          border: Border(left: BorderSide(color: colors['border'])),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            // Header
            Container(
              padding: const EdgeInsets.all(16),
              decoration: BoxDecoration(
                border: Border(bottom: BorderSide(color: colors['border'])),
              ),
              child: Text(
                tr('sidebar.title'),
                style: theme.textTheme.titleMedium?.copyWith(
                  fontWeight: FontWeight.bold,
                  color: colors['text'],
                ),
              ),
            ),

            Expanded(
              child: SingleChildScrollView(
                padding: const EdgeInsets.all(16),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    _buildSectionTitle(tr('sidebar.relatedDocs'),
                        Icons.description_outlined, colors),
                    const SizedBox(height: 12),
                    if (widget.relatedDocuments.isEmpty)
                      _buildEmptyState(tr('sidebar.noDocuments'), colors)
                    else
                      ...widget.relatedDocuments
                          .map((doc) => _buildDocItem(doc, colors, isDark)),
                    const SizedBox(height: 32),
                    _buildSectionTitle(
                        tr('sidebar.faq'), Icons.help_outline, colors),
                    const SizedBox(height: 12),
                    if (_isLoadingFaq)
                      const Center(
                          child: Padding(
                        padding: EdgeInsets.all(20.0),
                        child: CircularProgressIndicator(strokeWidth: 2),
                      ))
                    else if (_faqItems.isEmpty)
                      _buildEmptyState(tr('sidebar.faqError'), colors)
                    else
                      ..._faqItems
                          .map((item) => _buildFaqItem(item, colors, isDark)),
                  ],
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  // ===========================================================================
  // MAIN BUILD METHOD (Responsive Logic with Full Screen Drawer Fix)
  // ===========================================================================
  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final colors = ThemeManager().getColors();
    final isDark = ThemeManager().isDarkMode;

    // Check screen width to determine layout mode
    final bool isWideScreen = MediaQuery.of(context).size.width > 1200;

    // 1. Desktop/Tablet Persistent Panel
    if (isWideScreen) {
      return SizedBox(
        width: 360,
        child: _buildRightSidebarContent(context, theme, colors, isDark),
      );
    }

    // 2. Mobile Drawer
    // FIX: FULL WIDTH DRAWER FOR MOBILE
    // Use full screen width instead of a percentage or capped width
    final double drawerWidth = MediaQuery.of(context).size.width;

    return SizedBox(
      width: drawerWidth, // FORCE FULL WIDTH
      child: Drawer(
        elevation: 16,
        backgroundColor: Colors.transparent, // Avoid double backgrounds
        child: SafeArea(
          top: false,
          bottom: true,
          child: Column(
            children: [
              // Spacer for AppBar with Tap-to-Close
              // ADDED: GestureDetector to capture taps on the transparent header area
              GestureDetector(
                onTap: () {
                  Navigator.of(context).pop();
                },
                behavior: HitTestBehavior
                    .translucent, // Catches taps even on transparent areas
                child: SizedBox(
                  height: kToolbarHeight + MediaQuery.of(context).padding.top,
                  width: double.infinity,
                ),
              ),
              // Actual Content
              Expanded(
                child:
                    _buildRightSidebarContent(context, theme, colors, isDark),
              ),
            ],
          ),
        ),
      ),
    );
  }

  // ===========================================================================
  // WIDGET HELPERS
  // ===========================================================================

  Widget _buildSectionTitle(
      String title, IconData icon, Map<String, dynamic> colors) {
    return Row(
      children: [
        Icon(icon, size: 18, color: colors['text'].withOpacity(0.6)),
        const SizedBox(width: 8),
        Text(
          title,
          style: TextStyle(
            fontSize: 14,
            fontWeight: FontWeight.bold,
            color: colors['text'].withOpacity(0.8),
          ),
        ),
      ],
    );
  }

  Widget _buildEmptyState(String message, Map<String, dynamic> colors) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: colors['surface'],
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: colors['border']),
      ),
      child: Text(
        message,
        style: TextStyle(
          color: colors['text'].withOpacity(0.5),
          fontSize: 13,
          fontStyle: FontStyle.italic,
        ),
        textAlign: TextAlign.center,
      ),
    );
  }

  Widget _buildDocItem(
      Map<String, dynamic> doc, Map<String, dynamic> colors, bool isDark) {
    final String title = _getDocValue(doc, [
          'title',
          'document_name',
          'documentName',
          'fileName',
          'name'
        ])?.toString() ??
        tr('sidebar.unknown');

    final String fileName =
        _getDocValue(doc, ['fileName', 'document_name'])?.toString() ?? "";
    final String fileSize = _formatFileSize(doc);
    final String fileFormat = _getFileFormat(doc);
    final String labels = _formatLabels(doc);
    final String confidence = _formatScore(doc['score'] ?? doc['confidence']);
    final String id =
        _getDocValue(doc, ['id', '_id', 'document_id', 'fileId'])?.toString() ??
            "";

    return Card(
      elevation: 0,
      color: colors['surface'],
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(8),
        side: BorderSide(color: colors['border']),
      ),
      margin: const EdgeInsets.only(bottom: 12),
      child: InkWell(
        onTap: () => _openDocument(doc),
        borderRadius: BorderRadius.circular(8),
        child: Padding(
          padding: const EdgeInsets.all(12),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Icon(_getDocumentIcon(doc),
                      size: 20, color: colors['primary']),
                  const SizedBox(width: 10),
                  Expanded(
                    child: Text(
                      title,
                      style: TextStyle(
                        fontWeight: FontWeight.w600,
                        fontSize: 13,
                        color: colors['text'],
                      ),
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                    ),
                  ),
                ],
              ),
              const Padding(
                  padding: EdgeInsets.symmetric(vertical: 4),
                  child: Divider(height: 1)),
              if (fileName.isNotEmpty && fileName != title)
                _buildDetailRow("File Name", fileName, colors),
              Row(
                children: [
                  Expanded(
                      child: _buildDetailRow("Format", fileFormat, colors)),
                  Expanded(child: _buildDetailRow("Size", fileSize, colors)),
                ],
              ),
              if (id.isNotEmpty) _buildDetailRow(tr('sidebar.id'), id, colors),
              _buildDetailRow(tr('sidebar.labels'), labels, colors),
              _buildDetailRow(tr('sidebar.confidence'), confidence, colors),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildDetailRow(
      String label, String value, Map<String, dynamic> colors) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 2),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            "$label: ",
            style: TextStyle(
              fontSize: 11,
              fontWeight: FontWeight.w600,
              color: colors['text'].withOpacity(0.7),
            ),
          ),
          Expanded(
            child: Text(
              value,
              style: TextStyle(
                fontSize: 11,
                color: colors['text'],
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildFaqItem(
      Map<String, String> item, Map<String, dynamic> colors, bool isDark) {
    return Container(
      margin: const EdgeInsets.only(bottom: 8),
      decoration: BoxDecoration(
        color: colors['surface'],
        border: Border.all(color: colors['border']),
        borderRadius: BorderRadius.circular(8),
      ),
      child: Theme(
        data: Theme.of(context).copyWith(dividerColor: Colors.transparent),
        child: ExpansionTile(
          title: MarkdownBody(
            data: item['question'] ?? '',
            styleSheet: MarkdownStyleSheet(
              p: TextStyle(
                fontSize: 13,
                fontWeight: FontWeight.w600,
                color: colors['text'],
              ),
            ),
          ),
          iconColor: colors['text'].withOpacity(0.5),
          collapsedIconColor: colors['text'].withOpacity(0.5),
          backgroundColor: isDark
              ? Colors.white.withOpacity(0.02)
              : Colors.grey.withOpacity(0.05),
          childrenPadding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
          children: [
            MarkdownBody(
              data: item['answer'] ?? '',
              styleSheet: MarkdownStyleSheet(
                p: TextStyle(
                    fontSize: 13,
                    color: colors['text'].withOpacity(0.8),
                    height: 1.4),
              ),
              onTapLink: (text, href, title) {
                if (href != null) {
                  launchUrl(Uri.parse(href),
                      mode: LaunchMode.externalApplication);
                }
              },
            ),
          ],
        ),
      ),
    );
  }
}