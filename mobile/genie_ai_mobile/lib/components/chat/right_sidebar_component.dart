import 'dart:async';
import 'dart:convert';
import 'dart:math';
import 'package:flutter/material.dart';
import 'package:flutter/foundation.dart' show kIsWeb;
import 'package:flutter/services.dart';
import 'package:flutter_markdown/flutter_markdown.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:url_launcher/url_launcher.dart';
import 'package:openapi/api.dart' as openapi;
import 'package:genie_ai_mobile/utils/theme_manager.dart';
import 'package:genie_ai_mobile/services/i18n_service.dart';
import 'package:genie_ai_mobile/design_system/tokens/app_tokens.dart';
import 'package:genie_ai_mobile/design_system/tokens/spacing.dart';
import 'package:genie_ai_mobile/design_system/tokens/radii.dart';
import 'package:genie_ai_mobile/design_system/components/ds_card.dart';
import 'package:genie_ai_mobile/config/keycloak_config.dart';
import 'package:genie_ai_mobile/providers/api_providers.dart';

// --- CONDITIONAL IMPORT ---
import 'package:genie_ai_mobile/components/chat/stub_file_utils.dart'
    if (dart.library.html) 'package:genie_ai_mobile/components/chat/web_file_utils.dart';

class RightSidebarComponent extends ConsumerStatefulWidget {
  final List<dynamic> relatedDocuments;
  final String? accessToken;

  const RightSidebarComponent({
    super.key,
    required this.relatedDocuments,
    this.accessToken,
  });

  @override
  ConsumerState<RightSidebarComponent> createState() =>
      _RightSidebarComponentState();
}

class _RightSidebarComponentState extends ConsumerState<RightSidebarComponent> {
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
          final translationApi = ref.read(translationApiProvider);
          final request = openapi.ApiTranslateMarkdownPostRequest(
            markdown: baseMarkdown,
            sourceLang: 'en',
            targetLang: _currentLangCode,
          );

          final response = await translationApi
              .apiTranslateMarkdownPostWithHttpInfo(request);

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
            {'question': 'Error', 'answer': tr('sidebar.weatherErrorDefault')},
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
            'answer': currentAnswer.toString().trim(),
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
        'answer': currentAnswer.toString().trim(),
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

    if (type == 'pdf' || name.endsWith('.pdf')) {
      return Icons.picture_as_pdf;
    }
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
    if (type.contains('video')) {
      return Icons.videocam;
    }
    if (type.contains('audio')) {
      return Icons.audiotrack;
    }
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
    final val = _getDocValue(doc, [
      'size',
      'fileSize',
      'length',
      'contentLength',
      'file_size',
    ]);

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
      if (s.contains('/')) {
        return s.split('/').last.toUpperCase();
      }
      return s.toUpperCase();
    }

    final String name = (_getDocValue(doc, ['fileName', 'document_name']) ?? '')
        .toString();
    if (name.contains('.')) {
      return name.split('.').last.toUpperCase();
    }

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

    final String? fileId = _getDocValue(doc, [
      'id',
      '_id',
      'fileId',
      'document_id',
    ])?.toString();

    if (fileId == null) {
      final tokens = ThemeManager().tokens;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          backgroundColor: tokens.surface,
          content: Text(
            tr('sidebar.docIdNotFound'),
            style: TextStyle(color: tokens.fg),
          ),
        ),
      );
      return;
    }

    final String? token = widget.accessToken;
    if (token == null || token.isEmpty) {
      final tokens = ThemeManager().tokens;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          backgroundColor: tokens.surface,
          content: Text(
            tr('sidebar.authError'),
            style: TextStyle(color: tokens.fg),
          ),
        ),
      );
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
      final String viewUrl = '${getConfig().backendUrl}/api/files/$fileId/view';
      final String urlWithToken = '$viewUrl?access_token=$token';
      final Uri uri = Uri.parse(urlWithToken);
      if (await canLaunchUrl(uri)) {
        await launchUrl(uri, mode: LaunchMode.externalApplication);
      } else {
        if (!mounted) return;
        final tokens = ThemeManager().tokens;
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            backgroundColor: tokens.surface,
            content: Text(
              tr('sidebar.launchError'),
              style: TextStyle(color: tokens.fg),
            ),
          ),
        );
      }
    }
  }

  // ===========================================================================
  // CONTENT BUILDER (Abstracted to support Drawer vs Panel)
  // ===========================================================================
  Widget _buildRightSidebarContent(
    BuildContext context,
    ThemeData theme,
    AppTokens tokens,
    bool isDark,
  ) {
    return Material(
      color: tokens.bg,
      child: Container(
        decoration: BoxDecoration(
          border: Border(left: BorderSide(color: tokens.border)),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            // Header
            Container(
              padding: const EdgeInsets.all(DsSpacing.md),
              decoration: BoxDecoration(
                border: Border(bottom: BorderSide(color: tokens.border)),
              ),
              child: Text(
                tr('sidebar.title'),
                style: theme.textTheme.titleMedium?.copyWith(
                  fontWeight: FontWeight.bold,
                  color: tokens.fg,
                ),
              ),
            ),

            Expanded(
              child: SingleChildScrollView(
                padding: const EdgeInsets.all(DsSpacing.md),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    _buildSectionTitle(
                      tr('sidebar.relatedDocs'),
                      Icons.description_outlined,
                      tokens,
                    ),
                    const SizedBox(height: DsSpacing.sm),
                    if (widget.relatedDocuments.isEmpty)
                      _buildEmptyState(tr('sidebar.noDocuments'), tokens)
                    else
                      ...widget.relatedDocuments.map(
                        (doc) => _buildDocItem(doc, tokens, isDark),
                      ),
                    const SizedBox(height: DsSpacing.xl),
                    _buildSectionTitle(
                      tr('sidebar.faq'),
                      Icons.help_outline,
                      tokens,
                    ),
                    const SizedBox(height: DsSpacing.sm),
                    if (_isLoadingFaq)
                      const Center(
                        child: Padding(
                          padding: EdgeInsets.all(DsSpacing.lg),
                          child: CircularProgressIndicator(strokeWidth: 2),
                        ),
                      )
                    else if (_faqItems.isEmpty)
                      _buildEmptyState(tr('sidebar.faqError'), tokens)
                    else
                      ..._faqItems.map(
                        (item) => _buildFaqItem(item, tokens, isDark),
                      ),
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
    final tokens = ThemeManager().tokens;
    final isDark = ThemeManager().isDarkMode;

    // Check screen width to determine layout mode
    final bool isWideScreen = MediaQuery.of(context).size.width > 1200;

    // 1. Desktop/Tablet Persistent Panel
    if (isWideScreen) {
      return SizedBox(
        width: 360,
        child: _buildRightSidebarContent(context, theme, tokens, isDark),
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
                child: _buildRightSidebarContent(
                  context,
                  theme,
                  tokens,
                  isDark,
                ),
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

  Widget _buildSectionTitle(String title, IconData icon, AppTokens tokens) {
    return Row(
      children: [
        Icon(icon, size: 18, color: tokens.muted),
        const SizedBox(width: DsSpacing.sm),
        Text(
          title,
          style: TextStyle(
            fontSize: tokens.textBase,
            fontWeight: FontWeight.bold,
            color: tokens.fg70,
          ),
        ),
      ],
    );
  }

  Widget _buildEmptyState(String message, AppTokens tokens) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(DsSpacing.md),
      decoration: BoxDecoration(
        color: tokens.surface,
        borderRadius: BorderRadius.circular(DsRadii.md),
        border: Border.all(color: tokens.border),
      ),
      child: Text(
        message,
        style: TextStyle(
          color: tokens.mutedSoft,
          fontSize: tokens.textSm,
          fontStyle: FontStyle.italic,
        ),
        textAlign: TextAlign.center,
      ),
    );
  }

  Widget _buildDocItem(
    Map<String, dynamic> doc,
    AppTokens tokens,
    bool isDark,
  ) {
    final String title =
        _getDocValue(doc, [
          'title',
          'document_name',
          'documentName',
          'fileName',
          'name',
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

    return Padding(
      padding: const EdgeInsets.only(bottom: DsSpacing.md),
      child: InkWell(
        onTap: () => _openDocument(doc),
        borderRadius: BorderRadius.circular(DsRadii.md),
        child: DsCard(
          variant: DsCardVariant.outline,
          overrideBorderColor: tokens.border,
          overrideBg: tokens.surface,
          radius: DsRadii.md,
          padding: const EdgeInsets.all(DsSpacing.sm),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Icon(_getDocumentIcon(doc), size: 20, color: tokens.accent),
                  const SizedBox(width: 10),
                  Expanded(
                    child: Text(
                      title,
                      style: TextStyle(
                        fontWeight: FontWeight.w600,
                        fontSize: tokens.textSm,
                        color: tokens.fg,
                      ),
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                    ),
                  ),
                ],
              ),
              const Padding(
                padding: EdgeInsets.symmetric(vertical: DsSpacing.xs),
                child: Divider(height: 1),
              ),
              if (fileName.isNotEmpty && fileName != title)
                _buildDetailRow("File Name", fileName, tokens),
              Row(
                children: [
                  Expanded(
                    child: _buildDetailRow("Format", fileFormat, tokens),
                  ),
                  Expanded(child: _buildDetailRow("Size", fileSize, tokens)),
                ],
              ),
              if (id.isNotEmpty) _buildDetailRow(tr('sidebar.id'), id, tokens),
              _buildDetailRow(tr('sidebar.labels'), labels, tokens),
              _buildDetailRow(tr('sidebar.confidence'), confidence, tokens),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildDetailRow(String label, String value, AppTokens tokens) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 2),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            "$label: ",
            style: TextStyle(
              fontSize: tokens.textXs,
              fontWeight: FontWeight.w600,
              color: tokens.fg70,
            ),
          ),
          Expanded(
            child: Text(
              value,
              style: TextStyle(fontSize: tokens.textXs, color: tokens.fg),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildFaqItem(
    Map<String, String> item,
    AppTokens tokens,
    bool isDark,
  ) {
    return Container(
      margin: const EdgeInsets.only(bottom: DsSpacing.sm),
      decoration: BoxDecoration(
        color: tokens.surface,
        border: Border.all(color: tokens.border),
        borderRadius: BorderRadius.circular(DsRadii.md),
      ),
      child: Theme(
        data: Theme.of(context).copyWith(dividerColor: Colors.transparent),
        child: ExpansionTile(
          title: MarkdownBody(
            data: item['question'] ?? '',
            styleSheet: MarkdownStyleSheet(
              p: TextStyle(
                fontSize: tokens.textSm,
                fontWeight: FontWeight.w600,
                color: tokens.fg,
              ),
            ),
          ),
          iconColor: tokens.fg50,
          collapsedIconColor: tokens.fg50,
          backgroundColor: isDark ? tokens.fg30 : tokens.muted20,
          childrenPadding: const EdgeInsets.fromLTRB(
            DsSpacing.md,
            0,
            DsSpacing.md,
            DsSpacing.md,
          ),
          children: [
            MarkdownBody(
              data: item['answer'] ?? '',
              styleSheet: MarkdownStyleSheet(
                p: TextStyle(
                  fontSize: tokens.textSm,
                  color: tokens.fg70,
                  height: 1.4,
                ),
              ),
              onTapLink: (text, href, title) {
                if (href != null) {
                  launchUrl(
                    Uri.parse(href),
                    mode: LaunchMode.externalApplication,
                  );
                }
              },
            ),
          ],
        ),
      ),
    );
  }
}
