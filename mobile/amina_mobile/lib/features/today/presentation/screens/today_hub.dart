import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../chats/presentation/providers/chat_messages_provider.dart';
import '../../../chats/presentation/widgets/chat_history_sheet.dart';
import '../../../../core/components/amina_header.dart';
import '../../../../core/theme/app_theme.dart';
import '../widgets/amina_chat_bar.dart';
import '../widgets/daily_advice_banner.dart';
import '../widgets/daily_health_carousel.dart';
import '../widgets/daily_plan_section.dart';
import '../widgets/health_insights_section.dart';
import '../widgets/meals_section.dart';

// ── TodayHub ──────────────────────────────────────────────────────────────────

class TodayHub extends ConsumerStatefulWidget {
  const TodayHub({super.key});

  @override
  ConsumerState<TodayHub> createState() => _TodayHubState();
}

class _TodayHubState extends ConsumerState<TodayHub> {
  final ScrollController _scrollController = ScrollController();

  @override
  void dispose() {
    _scrollController.dispose();
    super.dispose();
  }

  void _scrollToBottom() {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (_scrollController.hasClients) {
        _scrollController.animateTo(
          _scrollController.position.maxScrollExtent,
          duration: const Duration(milliseconds: 350),
          curve: Curves.easeOut,
        );
      }
    });
  }

  @override
  Widget build(BuildContext context) {
    final messages     = ref.watch(chatMessagesProvider);
    final isTyping     = ref.watch(chatIsTypingProvider);
    final isChatActive = ref.watch(isChatActiveProvider);
    final cs           = Theme.of(context).colorScheme;
    final amina        = Theme.of(context).extension<AminaColors>()!;

    // Back button — only shown when the chat view is active.
    final backButton = isChatActive
        ? Padding(
            padding: const EdgeInsets.all(10),
            child: GestureDetector(
              onTap: () =>
                  ref.read(chatSessionsProvider.notifier).newSession(),
              child: Container(
                decoration: BoxDecoration(
                  color:  cs.primaryContainer,
                  shape:  BoxShape.circle,
                  border: Border.all(
                    color: cs.primary.withValues(alpha: 0.30),
                  ),
                ),
                child: Icon(
                  Icons.arrow_back_ios_new_rounded,
                  color: cs.primary,
                  size:  18,
                ),
              ),
            ),
          )
        : null;

    ref.listen(chatMessagesProvider, (prev, next) => _scrollToBottom());

    return Scaffold(
      backgroundColor: amina.scaffoldBg,
      appBar: AminaHeader(
        title:     'Amina Care',
        showAlert: false,
        leading:   backButton,
        trailing: Builder(
          builder: (ctx) => Padding(
            padding: const EdgeInsets.symmetric(vertical: 9, horizontal: 12),
            child: GestureDetector(
              onTap: () => showModalBottomSheet<void>(
                context:            ctx,
                isScrollControlled: true,
                backgroundColor:    Colors.transparent,
                builder:            (_) => const ChatHistorySheet(),
              ),
              child: Container(
                padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 7),
                decoration: BoxDecoration(
                  color:        cs.primaryContainer,
                  borderRadius: BorderRadius.circular(20),
                  border: Border.all(
                    color: cs.primary.withValues(alpha: 0.35),
                  ),
                ),
                child: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Icon(Icons.history_rounded, color: cs.primary, size: 16),
                    const SizedBox(width: 5),
                    Text(
                      'History',
                      style: TextStyle(
                        color:      cs.primary,
                        fontSize:   13,
                        fontWeight: FontWeight.w600,
                        fontFamily: 'Inter',
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ),
        ),
      ),
      body: Column(
        children: [
          // Daily tip — hidden while the chat is open.
          AnimatedSwitcher(
            duration: const Duration(milliseconds: 300),
            child: isChatActive
                ? const SizedBox.shrink()
                : const Padding(
                    key: ValueKey('banner'),
                    padding: EdgeInsets.fromLTRB(20, 12, 20, 0),
                    child: DailyAdviceBanner(),
                  ),
          ),

          // Dashboard ↔ Chat with slide + fade transition.
          Expanded(
            child: AnimatedSwitcher(
              duration: const Duration(milliseconds: 380),
              switchInCurve:  Curves.easeOut,
              switchOutCurve: Curves.easeIn,
              transitionBuilder: (child, animation) => FadeTransition(
                opacity: animation,
                child: SlideTransition(
                  position: Tween<Offset>(
                    begin: const Offset(0, 0.04),
                    end: Offset.zero,
                  ).animate(CurvedAnimation(
                      parent: animation, curve: Curves.easeOut)),
                  child: child,
                ),
              ),
              child: isChatActive
                  ? _ChatView(
                      key:              const ValueKey('chat'),
                      messages:         messages,
                      isTyping:         isTyping,
                      scrollController: _scrollController,
                    )
                  : const _DashboardView(key: ValueKey('dashboard')),
            ),
          ),

          // Chat bar — pinned to the bottom.
          const AminaChatBar(),
        ],
      ),
    );
  }
}

// ── Dashboard view ────────────────────────────────────────────────────────────
// Greeting card → Health Carousel → Daily Plan → Health Insights →
// Today's Habits → Recommended Meals

class _DashboardView extends ConsumerWidget {
  const _DashboardView({super.key});

  /// Sends [message] to Amina and switches the view to chat automatically.
  /// `sendMessage` already sets isChatActiveProvider = true internally.
  void _askAmina(WidgetRef ref, String message) {
    ref.read(chatSessionsProvider.notifier).sendMessage(message);
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return SingleChildScrollView(
      padding: const EdgeInsets.only(top: 24, bottom: 48),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // ── Greeting banner ───────────────────────────────────────────
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 20),
            child: _GreetingCard(),
          ),

          const SizedBox(height: 28),

          // ── Daily command centre — live vitals, mood, symptom count ───
          const DailyHealthCarousel(),

          const SizedBox(height: 32),

          // ── My Daily Plan — Care Plan + Nutrition / Meds / Exercise ──
          DailyPlanSection(
            onAskAmina: (msg) => _askAmina(ref, msg),
          ),

          const SizedBox(height: 32),

          // ── Health Insights — Heart / Dizzy / Glucose Spikes ──────────
          HealthInsightsSection(
            onAskAmina: (msg) => _askAmina(ref, msg),
          ),

          const SizedBox(height: 32),

          // ── Recommended Today — meal image cards ─────────────────────
          const MealsSection(),

          const SizedBox(height: 12),
        ],
      ),
    );
  }
}

// ── Greeting card ─────────────────────────────────────────────────────────────

class _GreetingCard extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    final cs    = Theme.of(context).colorScheme;
    final amina = Theme.of(context).extension<AminaColors>()!;
    return Container(
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(
        color:        cs.surface,
        borderRadius: BorderRadius.circular(24),
        border:       Border.all(color: amina.cardBorder),
        boxShadow: [
          BoxShadow(color: amina.sageGlow, blurRadius: 20, offset: const Offset(0, 4)),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Container(
                width:     48,
                height:    48,
                alignment: Alignment.center,
                decoration: BoxDecoration(
                  color: cs.primaryContainer,
                  shape: BoxShape.circle,
                ),
                child: const Text('🌿', style: TextStyle(fontSize: 24)),
              ),
              const SizedBox(width: 14),
              Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    "Hi, I'm Amina",
                    style: TextStyle(
                      fontSize:     20,
                      fontWeight:   FontWeight.w700,
                      color:        cs.onSurface,
                      letterSpacing: -0.4,
                    ),
                  ),
                  const SizedBox(height: 2),
                  Text(
                    'Your personal health companion',
                    style: TextStyle(fontSize: 13, color: cs.onSurfaceVariant),
                  ),
                ],
              ),
            ],
          ),
          const SizedBox(height: 16),
          Text(
            'Good morning! Log your health below, then chat '
            'with Amina for personalised guidance.',
            style: TextStyle(fontSize: 16, color: cs.onSurface, height: 1.5),
          ),
        ],
      ),
    );
  }
}

// ── Chat view ─────────────────────────────────────────────────────────────────

class _ChatView extends StatelessWidget {
  final List<ChatMessage> messages;
  final bool isTyping;
  final ScrollController scrollController;

  const _ChatView({
    super.key,
    required this.messages,
    required this.isTyping,
    required this.scrollController,
  });

  @override
  Widget build(BuildContext context) {
    return ListView.builder(
      controller: scrollController,
      padding: const EdgeInsets.symmetric(vertical: 16),
      itemCount: messages.length + (isTyping ? 1 : 0),
      itemBuilder: (context, index) {
        if (index < messages.length) {
          return _ChatBubble(message: messages[index]);
        }
        return const _TypingBubble();
      },
    );
  }
}

// ── Chat bubble ───────────────────────────────────────────────────────────────

class _ChatBubble extends ConsumerWidget {
  final ChatMessage message;
  const _ChatBubble({required this.message});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final isUser        = message.isUser;
    final sessionsState = ref.watch(chatSessionsProvider);
    final isPlaying     = sessionsState.playingMessageId == message.id;
    final isTtsLoading  = sessionsState.isTtsLoading && isPlaying;
    final cs            = Theme.of(context).colorScheme;
    final amina         = Theme.of(context).extension<AminaColors>()!;

    return Align(
      alignment: isUser ? Alignment.centerRight : Alignment.centerLeft,
      child: Container(
        margin: EdgeInsets.only(
          top: 3,
          bottom: 3,
          left: isUser ? 72 : 20,
          right: isUser ? 20 : 72,
        ),
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
        decoration: BoxDecoration(
          color: isUser ? cs.primary : cs.surface,
          borderRadius: BorderRadius.only(
            topLeft:     const Radius.circular(20),
            topRight:    const Radius.circular(20),
            bottomLeft:  Radius.circular(isUser ? 20 : 4),
            bottomRight: Radius.circular(isUser ? 4 : 20),
          ),
          boxShadow: isUser
              ? null
              : [
                  BoxShadow(
                    color:      amina.sageGlow,
                    blurRadius: 10,
                    offset:     const Offset(0, 2),
                  ),
                ],
        ),
        child: Column(
          crossAxisAlignment:
              isUser ? CrossAxisAlignment.end : CrossAxisAlignment.start,
          children: [
            Text(
              message.text,
              style: TextStyle(
                color:    isUser ? Colors.white : cs.onSurface,
                fontSize: 16,
                height:   1.5,
              ),
            ),
            const SizedBox(height: 4),
            Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(
                  message.time,
                  style: TextStyle(
                    color: isUser
                        ? Colors.white.withValues(alpha: 0.6)
                        : cs.onSurfaceVariant,
                    fontSize: 11,
                  ),
                ),
                if (!isUser) ...[
                  const SizedBox(width: 8),
                  GestureDetector(
                    onTap: () => ref
                        .read(chatSessionsProvider.notifier)
                        .playTts(message.id, message.text),
                    child: isTtsLoading
                        ? SizedBox(
                            width:  14,
                            height: 14,
                            child: CircularProgressIndicator(
                              strokeWidth: 1.5,
                              color:       cs.primary,
                            ),
                          )
                        : Icon(
                            isPlaying
                                ? Icons.stop_circle_outlined
                                : Icons.volume_up_outlined,
                            size:  16,
                            color: cs.primary,
                          ),
                  ),
                ],
              ],
            ),
          ],
        ),
      ),
    );
  }
}

// ── Typing bubble ─────────────────────────────────────────────────────────────

class _TypingBubble extends StatelessWidget {
  const _TypingBubble();

  @override
  Widget build(BuildContext context) {
    final cs    = Theme.of(context).colorScheme;
    final amina = Theme.of(context).extension<AminaColors>()!;
    return Align(
      alignment: Alignment.centerLeft,
      child: Container(
        margin:  const EdgeInsets.only(left: 20, top: 3, bottom: 3),
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 13),
        decoration: BoxDecoration(
          color: cs.surface,
          borderRadius: const BorderRadius.only(
            topLeft:     Radius.circular(20),
            topRight:    Radius.circular(20),
            bottomRight: Radius.circular(20),
            bottomLeft:  Radius.circular(4),
          ),
          boxShadow: [
            BoxShadow(color: amina.sageGlow, blurRadius: 10, offset: const Offset(0, 2)),
          ],
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Container(
              width:  7,
              height: 7,
              decoration: BoxDecoration(
                color: cs.primary.withValues(alpha: 0.6),
                shape: BoxShape.circle,
              ),
            ),
            const SizedBox(width: 8),
            Text(
              'Amina is thinking…',
              style: TextStyle(
                color:     cs.onSurfaceVariant,
                fontStyle: FontStyle.italic,
                fontSize:  14,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

