import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:printing/printing.dart';
import '../providers/chat_messages_provider.dart';
import '../../data/datasources/chat_pdf_service.dart';
import '../../../../core/theme/app_theme.dart';

// ─── Topic accent colour ───────────────────────────────────────────────────────

extension _TopicColor on ChatTopic {
  Color get accentColor {
    switch (this) {
      case ChatTopic.general:      return const Color(0xFF6B7280);
      case ChatTopic.medical:      return const Color(0xFFDC2626);
      case ChatTopic.nutrition:    return const Color(0xFF16A34A);
      case ChatTopic.exercise:     return const Color(0xFF2563EB);
      case ChatTopic.medications:  return const Color(0xFF7C3AED);
      case ChatTopic.mentalHealth: return const Color(0xFFD97706);
      case ChatTopic.sleep:        return const Color(0xFF0891B2);
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// HISTORY SHEET
// ═══════════════════════════════════════════════════════════════════════════════

class ChatHistorySheet extends ConsumerStatefulWidget {
  const ChatHistorySheet({super.key});

  @override
  ConsumerState<ChatHistorySheet> createState() => _ChatHistorySheetState();
}

class _ChatHistorySheetState extends ConsumerState<ChatHistorySheet> {
  final _searchController = TextEditingController();
  String  _query          = '';
  String? _downloadingId;

  Future<void> _downloadSession(ChatSession session) async {
    if (_downloadingId != null) return;
    setState(() => _downloadingId = session.id);
    try {
      final bytes = await ChatPdfService.generate(session);
      if (!mounted) return;
      await Printing.sharePdf(
        bytes:    bytes,
        filename: 'amina-chat-${session.id}.pdf',
      );
    } finally {
      if (mounted) setState(() => _downloadingId = null);
    }
  }

  @override
  void dispose() {
    _searchController.dispose();
    super.dispose();
  }

  static String _formatDate(DateTime date) {
    final now   = DateTime.now();
    final today = DateTime(now.year, now.month, now.day);
    final d     = DateTime(date.year, date.month, date.day);
    final diff  = today.difference(d).inDays;

    if (diff == 0) return 'Today';
    if (diff == 1) return 'Yesterday';
    if (diff < 7)  return '$diff days ago';

    const months = [
      'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
      'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
    ];
    return '${months[date.month - 1]} ${date.day}';
  }

  @override
  Widget build(BuildContext context) {
    final state    = ref.watch(chatSessionsProvider);

    // Filter + sort by date descending
    var sessions = state.sessions.toList()
      ..sort((a, b) => b.date.compareTo(a.date));
    if (_query.isNotEmpty) {
      final q = _query.toLowerCase();
      sessions = sessions
          .where((s) => s.title.toLowerCase().contains(q))
          .toList();
    }

    final cs    = Theme.of(context).colorScheme;
    final amina = Theme.of(context).extension<AminaColors>()!;

    return DraggableScrollableSheet(
      initialChildSize: 0.78,
      minChildSize:     0.45,
      maxChildSize:     0.94,
      expand:           false,
      builder: (_, scrollController) => Container(
        decoration: BoxDecoration(
          color:        amina.scaffoldBg,
          borderRadius: const BorderRadius.vertical(top: Radius.circular(28)),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            // ── Drag handle ──────────────────────────────────────────────
            Center(
              child: Container(
                margin:     const EdgeInsets.only(top: 12, bottom: 4),
                width:      36,
                height:     4,
                decoration: BoxDecoration(
                  color:        amina.cardBorder,
                  borderRadius: BorderRadius.circular(2),
                ),
              ),
            ),

            // ── Header ───────────────────────────────────────────────────
            Padding(
              padding: const EdgeInsets.fromLTRB(20, 12, 16, 0),
              child: Row(
                children: [
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          'Conversation History',
                          style: TextStyle(
                            fontSize:      19,
                            fontWeight:    FontWeight.w800,
                            color:         cs.onSurface,
                            letterSpacing: -0.4,
                          ),
                        ),
                        const SizedBox(height: 2),
                        Text(
                          '${state.sessions.length} conversation${state.sessions.length == 1 ? '' : 's'}',
                          style: TextStyle(
                            fontSize: 13,
                            color:    cs.onSurfaceVariant,
                          ),
                        ),
                      ],
                    ),
                  ),
                  GestureDetector(
                    onTap: () {
                      ref.read(chatSessionsProvider.notifier).newSession();
                      Navigator.of(context).pop();
                    },
                    child: Container(
                      padding: const EdgeInsets.symmetric(
                          horizontal: 14, vertical: 9),
                      decoration: BoxDecoration(
                        color:        cs.primary,
                        borderRadius: BorderRadius.circular(20),
                        boxShadow: [
                          BoxShadow(
                            color:      cs.primary.withValues(alpha: 0.28),
                            blurRadius: 8,
                            offset:     const Offset(0, 3),
                          ),
                        ],
                      ),
                      child: const Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Icon(Icons.add_rounded,
                              color: Colors.white, size: 16),
                          SizedBox(width: 5),
                          Text(
                            'New Chat',
                            style: TextStyle(
                              color:      Colors.white,
                              fontSize:   13,
                              fontWeight: FontWeight.w600,
                            ),
                          ),
                        ],
                      ),
                    ),
                  ),
                ],
              ),
            ),

            // ── Search bar ───────────────────────────────────────────────
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 12, 16, 4),
              child: Container(
                decoration: BoxDecoration(
                  color:        cs.surface,
                  borderRadius: BorderRadius.circular(14),
                  border:       Border.all(color: amina.cardBorder),
                ),
                child: TextField(
                  controller: _searchController,
                  onChanged:  (v) => setState(() => _query = v),
                  style: TextStyle(fontSize: 15, color: cs.onSurface),
                  decoration: InputDecoration(
                    hintText:  'Search conversations…',
                    hintStyle: TextStyle(
                        color: cs.onSurfaceVariant, fontSize: 15),
                    prefixIcon: Icon(
                        Icons.search_rounded,
                        color: cs.onSurfaceVariant,
                        size:  20),
                    suffixIcon: _query.isNotEmpty
                        ? IconButton(
                            icon: Icon(Icons.close_rounded,
                                size: 18, color: cs.onSurfaceVariant),
                            onPressed: () => setState(() {
                              _query = '';
                              _searchController.clear();
                            }),
                          )
                        : null,
                    border:         InputBorder.none,
                    contentPadding:
                        const EdgeInsets.symmetric(vertical: 14),
                  ),
                ),
              ),
            ),

            // ── Session list (chronological) ─────────────────────────────
            Expanded(
              child: sessions.isEmpty
                  ? _EmptyState(hasQuery: _query.isNotEmpty)
                  : ListView.builder(
                      controller:  scrollController,
                      padding:
                          const EdgeInsets.fromLTRB(16, 8, 16, 40),
                      itemCount:   sessions.length,
                      itemBuilder: (_, i) {
                        final session = sessions[i];
                        return _SessionHistoryTile(
                          session:      session,
                          isActive:     session.id == state.activeId,
                          dateStr:      _formatDate(session.date),
                          isDownloading: _downloadingId == session.id,
                          onTap: () {
                            ref
                                .read(chatSessionsProvider.notifier)
                                .loadSession(session.id);
                            Navigator.of(context).pop();
                          },
                          onDelete: () => ref
                              .read(chatSessionsProvider.notifier)
                              .deleteSession(session.id),
                          onDownload: () => _downloadSession(session),
                        );
                      },
                    ),
            ),
          ],
        ),
      ),
    );
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// SESSION TILE
// ═══════════════════════════════════════════════════════════════════════════════

class _SessionHistoryTile extends StatelessWidget {
  final ChatSession  session;
  final bool         isActive;
  final bool         isDownloading;
  final String       dateStr;
  final VoidCallback onTap;
  final VoidCallback onDelete;
  final VoidCallback onDownload;

  const _SessionHistoryTile({
    required this.session,
    required this.isActive,
    required this.isDownloading,
    required this.dateStr,
    required this.onTap,
    required this.onDelete,
    required this.onDownload,
  });

  @override
  Widget build(BuildContext context) {
    final cs        = Theme.of(context).colorScheme;
    final amina     = Theme.of(context).extension<AminaColors>()!;
    final accentColor = session.topic.accentColor;
    final userCount   = session.messages.where((m) => m.isUser).length;

    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: Material(
        color:        isActive ? cs.primaryContainer : cs.surface,
        borderRadius: BorderRadius.circular(16),
        child: InkWell(
          onTap:        onTap,
          borderRadius: BorderRadius.circular(16),
          splashColor:    cs.primary.withValues(alpha: 0.06),
          highlightColor: cs.primary.withValues(alpha: 0.03),
          child: Container(
            decoration: BoxDecoration(
              borderRadius: BorderRadius.circular(16),
              border: Border.all(
                color: isActive
                    ? cs.primary.withValues(alpha: 0.45)
                    : amina.cardBorder,
                width: isActive ? 1.5 : 1.0,
              ),
            ),
            child: Row(
              children: [
                // Topic accent strip
                Container(
                  width:  4,
                  height: 64,
                  decoration: BoxDecoration(
                    color:        accentColor.withValues(alpha: 0.7),
                    borderRadius: const BorderRadius.only(
                      topLeft:    Radius.circular(16),
                      bottomLeft: Radius.circular(16),
                    ),
                  ),
                ),

                const SizedBox(width: 14),

                // Active dot
                Container(
                  width:  8,
                  height: 8,
                  decoration: BoxDecoration(
                    color: isActive ? cs.primary : amina.cardBorder,
                    shape: BoxShape.circle,
                  ),
                ),

                const SizedBox(width: 12),

                // Content
                Expanded(
                  child: Padding(
                    padding: const EdgeInsets.symmetric(vertical: 14),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          session.title,
                          style: TextStyle(
                            fontSize:      15,
                            fontWeight:    FontWeight.w600,
                            color: isActive ? cs.primary : cs.onSurface,
                            letterSpacing: -0.2,
                          ),
                          maxLines: 2,
                          overflow: TextOverflow.ellipsis,
                        ),
                        const SizedBox(height: 5),
                        Row(
                          children: [
                            Container(
                              padding: const EdgeInsets.symmetric(
                                  horizontal: 7, vertical: 2),
                              decoration: BoxDecoration(
                                color:        amina.inputFill,
                                borderRadius: BorderRadius.circular(6),
                              ),
                              child: Text(
                                dateStr,
                                style: TextStyle(
                                  fontSize:   11,
                                  color:      cs.onSurfaceVariant,
                                  fontWeight: FontWeight.w500,
                                ),
                              ),
                            ),
                            const SizedBox(width: 6),
                            Text(
                              '$userCount message${userCount == 1 ? '' : 's'}',
                              style: TextStyle(
                                  fontSize: 12, color: cs.onSurfaceVariant),
                            ),
                          ],
                        ),
                      ],
                    ),
                  ),
                ),

                // Download button
                if (userCount > 0)
                  IconButton(
                    icon: isDownloading
                        ? SizedBox(
                            width:  16,
                            height: 16,
                            child: CircularProgressIndicator(
                              strokeWidth: 2,
                              valueColor: AlwaysStoppedAnimation<Color>(
                                  cs.primary),
                            ),
                          )
                        : Icon(Icons.download_rounded,
                            size: 18, color: cs.primary),
                    tooltip:     'Download as PDF',
                    onPressed:   isDownloading ? null : onDownload,
                    padding:     const EdgeInsets.all(8),
                    constraints: const BoxConstraints(
                        minWidth: 40, minHeight: 40),
                  ),

                // Delete button
                IconButton(
                  icon: Icon(Icons.delete_outline_rounded,
                      size: 18, color: cs.onSurfaceVariant),
                  tooltip:     'Delete conversation',
                  onPressed:   onDelete,
                  padding:     const EdgeInsets.all(8),
                  constraints: const BoxConstraints(
                      minWidth: 40, minHeight: 40),
                ),

                const SizedBox(width: 4),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// EMPTY STATE
// ═══════════════════════════════════════════════════════════════════════════════

class _EmptyState extends StatelessWidget {
  final bool hasQuery;
  const _EmptyState({required this.hasQuery});

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    return Center(
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 36, vertical: 48),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(
              hasQuery ? '🔍' : '💬',
              style: const TextStyle(fontSize: 52),
            ),
            const SizedBox(height: 18),
            Text(
              hasQuery ? 'No conversations found' : 'No history yet',
              style: TextStyle(
                fontSize:      18,
                fontWeight:    FontWeight.w700,
                color:         cs.onSurface,
                letterSpacing: -0.3,
              ),
            ),
            const SizedBox(height: 8),
            Text(
              hasQuery
                  ? 'Try a different search term.'
                  : 'Start chatting with Amina and your conversations will appear here.',
              textAlign: TextAlign.center,
              style: TextStyle(
                fontSize: 14,
                color:    cs.onSurfaceVariant,
                height:   1.55,
              ),
            ),
          ],
        ),
      ),
    );
  }
}
