import 'dart:ui';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:printing/printing.dart';
import '../providers/chat_messages_provider.dart';
import '../../data/datasources/chat_pdf_service.dart';
import '../widgets/chat_bubble.dart';
import '../widgets/chat_conversation_header.dart';
import '../widgets/message_input.dart';
import '../widgets/typing_indicator.dart';

// ─── Design tokens ─────────────────────────────────────────────────────────────

const _kCanvas    = Color(0xFFF5F9FC);
const _kSage      = Color(0xFF3D9970);
const _kSageLight = Color(0xFFEDF7F3);

// ═══════════════════════════════════════════════════════════════════════════════
// SCREEN
// ═══════════════════════════════════════════════════════════════════════════════

class ChatConversation extends ConsumerStatefulWidget {
  /// Optional: pre-fills and auto-sends a message on open.
  /// Used by AnimatedMicrophone to pass speech-to-text results.
  final String? initialMessage;

  /// Kept for API compatibility with callers that still pass a title.
  /// The AppBar title is now driven by the active session in the provider.
  final String title;

  const ChatConversation({
    super.key,
    this.title = 'Amina Care AI',
    this.initialMessage,
  });

  @override
  ConsumerState<ChatConversation> createState() =>
      _ChatConversationState();
}

class _ChatConversationState extends ConsumerState<ChatConversation> {
  final ScrollController _scrollController = ScrollController();
  bool _isGeneratingPdf = false;

  @override
  void initState() {
    super.initState();
    // Auto-send the STT result once the screen has rendered.
    if (widget.initialMessage?.isNotEmpty == true) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        ref
            .read(chatSessionsProvider.notifier)
            .sendMessage(widget.initialMessage!);
      });
    }
  }

  @override
  void dispose() {
    _scrollController.dispose();
    super.dispose();
  }

  void _scrollToBottom() {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!_scrollController.hasClients) return;
      _scrollController.animateTo(
        _scrollController.position.maxScrollExtent,
        duration: const Duration(milliseconds: 300),
        curve:    Curves.easeOut,
      );
    });
  }

  // ── PDF download ─────────────────────────────────────────────────────────────

  Future<void> _downloadPdf() async {
    final session = ref.read(chatSessionsProvider).activeSession;
    if (session == null || session.messages.isEmpty) return;

    setState(() => _isGeneratingPdf = true);

    try {
      final bytes = await ChatPdfService.generate(session);
      if (!mounted) return;

      // Native share/save sheet — handles both Android and iOS.
      await Printing.sharePdf(
        bytes:    bytes,
        filename: 'amina-chat-${session.id}.pdf',
      );
    } finally {
      if (mounted) setState(() => _isGeneratingPdf = false);
    }
  }

  // ── Build ─────────────────────────────────────────────────────────────────────

  @override
  Widget build(BuildContext context) {
    final sessionsState = ref.watch(chatSessionsProvider);
    final messages      = sessionsState.activeMessages;
    final isTyping      = ref.watch(chatIsTypingProvider);
    final activeSession = sessionsState.activeSession;

    // Scroll to bottom whenever a new message arrives.
    ref.listen(chatMessagesProvider, (_, __) => _scrollToBottom());

    // The header uses BackdropFilter (glassmorphism) so the body must
    // extend behind it. The message list compensates with top padding.
    final headerHeight = const ChatConversationHeader().preferredSize.height;
    final topPadding   = MediaQuery.of(context).padding.top + headerHeight;

    // Download button is only active when there are messages and not typing.
    final canDownload = messages.isNotEmpty && !isTyping && !_isGeneratingPdf;

    return Scaffold(
      backgroundColor:        _kCanvas,
      extendBodyBehindAppBar: true,
      appBar: ChatConversationHeader(
        title:      activeSession?.title ?? widget.title,
        onDownload: canDownload ? _downloadPdf : null,
      ),

      body: Stack(
        children: [
          // ── Main chat column ────────────────────────────────────────────
          Column(
            children: [
              // Message list
              Expanded(
                child: ListView.builder(
                  controller:  _scrollController,
                  padding: EdgeInsets.fromLTRB(16, topPadding + 8, 16, 20),
                  itemCount:   messages.length + (isTyping ? 1 : 0),
                  itemBuilder: (ctx, i) {
                    if (i == messages.length) return const TypingIndicator();
                    final m = messages[i];
                    final isPlaying =
                        sessionsState.playingMessageId == m.id;
                    final isTtsLoading = sessionsState.isTtsLoading &&
                        sessionsState.playingMessageId == m.id;
                    return ChatBubble(
                      message: {
                        'text':   m.text,
                        'sender': m.isUser ? 'user' : 'ai',
                        'time':   m.time,
                      },
                      onPlayTts: m.isUser
                          ? null
                          : () => ref
                              .read(chatSessionsProvider.notifier)
                              .playTts(m.id, m.text),
                      isPlaying:    isPlaying,
                      isTtsLoading: isTtsLoading,
                    );
                  },
                ),
              ),

              // Message input
              MessageInput(
                onSend: (text) =>
                    ref.read(chatSessionsProvider.notifier).sendMessage(text),
                onAudioRecorded: (path) =>
                    ref.read(chatSessionsProvider.notifier).sendAudio(path),
              ),
            ],
          ),

          // ── PDF generation overlay ──────────────────────────────────────
          if (_isGeneratingPdf) const _PdfGeneratingOverlay(),
        ],
      ),
    );
  }
}

// ─── Glassmorphic loading overlay ─────────────────────────────────────────────
//
// Shown while the PDF is being built. BackdropFilter blurs the chat behind it
// so the UI feels premium rather than frozen.

class _PdfGeneratingOverlay extends StatelessWidget {
  const _PdfGeneratingOverlay();

  @override
  Widget build(BuildContext context) {
    return Positioned.fill(
      child: ClipRect(
        child: BackdropFilter(
          filter: ImageFilter.blur(sigmaX: 14, sigmaY: 14),
          child: Container(
            color: Colors.white.withValues(alpha: 0.55),
            child: Center(
              child: Container(
                padding: const EdgeInsets.symmetric(
                    horizontal: 32, vertical: 28),
                decoration: BoxDecoration(
                  color: Colors.white.withValues(alpha: 0.92),
                  borderRadius: BorderRadius.circular(24),
                  border: Border.all(
                    color: const Color(0xFF3D9970).withValues(alpha: 0.20),
                  ),
                  boxShadow: [
                    BoxShadow(
                      color:      Colors.black.withValues(alpha: 0.08),
                      blurRadius: 32,
                      offset:     const Offset(0, 8),
                    ),
                  ],
                ),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    // Sage spinner
                    const SizedBox(
                      width:  48,
                      height: 48,
                      child: CircularProgressIndicator(
                        strokeWidth: 3,
                        valueColor: AlwaysStoppedAnimation<Color>(
                            _kSage),
                      ),
                    ),

                    const SizedBox(height: 20),

                    // Label
                    const Text(
                      'Generating PDF…',
                      style: TextStyle(
                        fontSize:   16,
                        fontWeight: FontWeight.w700,
                        color:      Color(0xFF111827),
                        fontFamily: 'Inter',
                      ),
                    ),

                    const SizedBox(height: 6),

                    // Sub-label
                    Container(
                      padding: const EdgeInsets.symmetric(
                          horizontal: 12, vertical: 5),
                      decoration: BoxDecoration(
                        color:        _kSageLight,
                        borderRadius: BorderRadius.circular(20),
                      ),
                      child: const Text(
                        '🌿  Amina Care',
                        style: TextStyle(
                          fontSize:   12,
                          fontWeight: FontWeight.w600,
                          color:      _kSage,
                          fontFamily: 'Inter',
                        ),
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}
