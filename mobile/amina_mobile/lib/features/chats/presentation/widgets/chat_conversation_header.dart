import 'dart:ui';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../providers/chat_messages_provider.dart';
import 'chat_history_sheet.dart';

// ─── Design tokens ─────────────────────────────────────────────────────────────

const _kSage       = Color(0xFF3D9970);
const _kSageDark   = Color(0xFF2D7A58);
const _kSageLight  = Color(0xFFEDF7F3);
const _kInkPrimary = Color(0xFF111827);
const _kInkMuted   = Color(0xFF6B7280);
const _kBorder     = Color(0xFFE5E7EB);

// ═══════════════════════════════════════════════════════════════════════════════
// ChatConversationHeader
//
// A glassmorphism AppBar built exclusively for chat_conversation.dart.
//
// Slots:
//   Left   → frosted-glass back button  (48 × 48 touch target)
//   Center → 🤖 avatar + title + subtitle
//   Right  → sage-gradient history pill + live session-count badge
//
// Set `extendBodyBehindAppBar: true` on the host Scaffold so the blur has
// real content (chat messages) to sample from.
// ═══════════════════════════════════════════════════════════════════════════════

class ChatConversationHeader extends ConsumerWidget
    implements PreferredSizeWidget {
  /// Displayed as the AppBar title. Falls back to 'Chat with Amina'.
  final String title;

  /// Called when the user taps the download button.
  /// Pass `null` to hide the button (e.g. while the chat is empty or loading).
  final VoidCallback? onDownload;

  const ChatConversationHeader({
    super.key,
    this.title = 'Chat with Amina',
    this.onDownload,
  });

  // ── preferredSize ────────────────────────────────────────────────────────────
  // 70 px toolbar  +  0.8 px bottom divider.
  // The Scaffold adds status-bar height on top automatically.
  @override
  Size get preferredSize => const Size.fromHeight(70.8);

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final sessions     = ref.watch(chatSessionsProvider);
    final sessionCount = sessions.sessions.length;

    return AppBar(
      // Transparent so our custom flexibleSpace shows through.
      backgroundColor:        Colors.transparent,
      elevation:              0,
      scrolledUnderElevation: 0,
      surfaceTintColor:       Colors.transparent,
      toolbarHeight:          70,
      automaticallyImplyLeading: false,

      // ── Glassmorphism background ─────────────────────────────────────────
      flexibleSpace: _GlassBackground(),

      // ── Back button ──────────────────────────────────────────────────────
      leading: _BackButton(onTap: () => Navigator.pop(context)),

      // No extra spacing between leading and title.
      titleSpacing: 0,

      // ── Center: avatar + title + subtitle ───────────────────────────────
      title: _TitleSection(title: title),
      centerTitle: true,

      // ── Download + History ───────────────────────────────────────────────
      actions: [
        if (onDownload != null)
          _DownloadButton(onTap: onDownload!),
        Padding(
          padding: const EdgeInsets.only(right: 12),
          child: _HistoryButton(
            sessionCount: sessionCount,
            onTap:        () => _openHistory(context),
          ),
        ),
      ],

      // ── Bottom hairline divider ──────────────────────────────────────────
      bottom: PreferredSize(
        preferredSize: const Size.fromHeight(0.8),
        child: Container(
          height: 0.8,
          color:  _kBorder.withValues(alpha: 0.60),
        ),
      ),
    );
  }

  void _openHistory(BuildContext context) {
    showModalBottomSheet<void>(
      context:            context,
      isScrollControlled: true,
      backgroundColor:    Colors.transparent,
      builder:            (_) => const ChatHistorySheet(),
    );
  }
}

// ─── Glassmorphism background ─────────────────────────────────────────────────
//
// BackdropFilter samples the chat messages scrolling behind the AppBar
// (requires extendBodyBehindAppBar: true on the host Scaffold).
// A two-stop gradient adds the sage tint at the bottom without being heavy.

class _GlassBackground extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    return ClipRect(
      child: BackdropFilter(
        filter: ImageFilter.blur(sigmaX: 22, sigmaY: 22),
        child: Container(
          decoration: BoxDecoration(
            gradient: LinearGradient(
              colors: [
                Colors.white.withValues(alpha: 0.88),
                _kSageLight.withValues(alpha: 0.78),
              ],
              begin: Alignment.topCenter,
              end:   Alignment.bottomCenter,
            ),
          ),
        ),
      ),
    );
  }
}

// ─── Back button ──────────────────────────────────────────────────────────────
//
// 48 × 48 touch target → 40 × 40 frosted-glass container with radius 14.
// High-contrast dark icon against the light header for elderly legibility.

class _BackButton extends StatelessWidget {
  final VoidCallback onTap;
  const _BackButton({required this.onTap});

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width:  48,
      height: 48,
      child: Center(
        child: GestureDetector(
          onTap:     onTap,
          behavior:  HitTestBehavior.opaque,
          child: Container(
            width:  40,
            height: 40,
            decoration: BoxDecoration(
              color:        Colors.white.withValues(alpha: 0.80),
              borderRadius: BorderRadius.circular(14),
              border:       Border.all(
                color: _kBorder.withValues(alpha: 0.90),
              ),
              boxShadow: [
                BoxShadow(
                  color:      Colors.black.withValues(alpha: 0.06),
                  blurRadius: 10,
                  offset:     const Offset(0, 3),
                ),
              ],
            ),
            child: const Icon(
              Icons.arrow_back_ios_new_rounded,
              color: _kInkPrimary,
              size:  18,
            ),
          ),
        ),
      ),
    );
  }
}

// ─── Center title section ─────────────────────────────────────────────────────
//
// Robot avatar circle + two-line title column.
// Inter font throughout; both lines meet WCAG AA contrast on the glass bg.

class _TitleSection extends StatelessWidget {
  final String title;
  const _TitleSection({required this.title});

  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        // ── 🤖 avatar ──────────────────────────────────────────────────
        Container(
          width:  36,
          height: 36,
          decoration: BoxDecoration(
            gradient: const LinearGradient(
              colors: [Color(0xFF3D9970), Color(0xFF2D7A58)],
              begin:  Alignment.topLeft,
              end:    Alignment.bottomRight,
            ),
            shape:     BoxShape.circle,
            boxShadow: [
              BoxShadow(
                color:      _kSage.withValues(alpha: 0.30),
                blurRadius: 8,
                offset:     const Offset(0, 2),
              ),
            ],
          ),
          child: const Center(
            child: Text('🤖', style: TextStyle(fontSize: 18)),
          ),
        ),

        const SizedBox(width: 10),

        // ── Title + subtitle ────────────────────────────────────────────
        Flexible(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            mainAxisSize:       MainAxisSize.min,
            children: [
              Text(
                title,
                overflow: TextOverflow.ellipsis,
                maxLines: 1,
                style: const TextStyle(
                  fontSize:      15.5,
                  fontWeight:    FontWeight.w700,
                  color:         _kInkPrimary,
                  letterSpacing: -0.3,
                  fontFamily:    'Inter',
                ),
              ),
              const Text(
                'Always here for you',
                style: TextStyle(
                  fontSize:   11.5,
                  color:      _kInkMuted,
                  fontFamily: 'Inter',
                ),
              ),
            ],
          ),
        ),
      ],
    );
  }
}

// ─── Download button ──────────────────────────────────────────────────────────
//
// 48 × 48 touch target — same frosted-glass style as _BackButton.
// High-contrast sage icon for elderly legibility.

class _DownloadButton extends StatelessWidget {
  final VoidCallback onTap;
  const _DownloadButton({required this.onTap});

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width:  48,
      height: 48,
      child: Center(
        child: Tooltip(
          message: 'Download chat as PDF',
          child: GestureDetector(
            onTap:    onTap,
            behavior: HitTestBehavior.opaque,
            child: Container(
              width:  40,
              height: 40,
              decoration: BoxDecoration(
                color:        Colors.white.withValues(alpha: 0.80),
                borderRadius: BorderRadius.circular(14),
                border:       Border.all(
                  color: _kBorder.withValues(alpha: 0.90),
                ),
                boxShadow: [
                  BoxShadow(
                    color:      Colors.black.withValues(alpha: 0.06),
                    blurRadius: 10,
                    offset:     const Offset(0, 3),
                  ),
                ],
              ),
              child: const Icon(
                Icons.download_rounded,
                color: _kSage,
                size:  20,
              ),
            ),
          ),
        ),
      ),
    );
  }
}

// ─── History button ───────────────────────────────────────────────────────────
//
// Sage-gradient pill: icon + label + optional session-count badge.
// Minimum 48 × 48 touch target; inner pill is 40 tall for visual balance.
// The badge uses a white circle with a sage count so it reads clearly
// against the gradient background.

class _HistoryButton extends StatelessWidget {
  final int          sessionCount;
  final VoidCallback onTap;

  const _HistoryButton({
    required this.sessionCount,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      height: 48,
      child: Center(
        child: GestureDetector(
          onTap:    onTap,
          behavior: HitTestBehavior.opaque,
          child: Stack(
            clipBehavior: Clip.none,
            children: [
              // ── Pill ──────────────────────────────────────────────────
              Container(
                height:  40,
                padding: const EdgeInsets.symmetric(horizontal: 14),
                decoration: BoxDecoration(
                  gradient: const LinearGradient(
                    colors: [_kSage, _kSageDark],
                    begin:  Alignment.topLeft,
                    end:    Alignment.bottomRight,
                  ),
                  borderRadius: BorderRadius.circular(20),
                  boxShadow: [
                    BoxShadow(
                      color:      _kSage.withValues(alpha: 0.38),
                      blurRadius: 14,
                      offset:     const Offset(0, 4),
                    ),
                  ],
                ),
                child: const Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Icon(
                      Icons.history_rounded,
                      color: Colors.white,
                      size:  18,
                    ),
                    SizedBox(width: 6),
                    Text(
                      'History',
                      style: TextStyle(
                        fontSize:   13,
                        fontWeight: FontWeight.w600,
                        color:      Colors.white,
                        fontFamily: 'Inter',
                      ),
                    ),
                  ],
                ),
              ),

              // ── Session-count badge ────────────────────────────────────
              // Only shown when there is at least one past session.
              if (sessionCount > 0)
                Positioned(
                  top:   -4,
                  right: -4,
                  child: Container(
                    constraints: const BoxConstraints(minWidth: 18),
                    height:      18,
                    padding:     const EdgeInsets.symmetric(horizontal: 4),
                    decoration: BoxDecoration(
                      color:        Colors.white,
                      borderRadius: BorderRadius.circular(9),
                      border:       Border.all(
                        color: _kSage,
                        width: 1.5,
                      ),
                    ),
                    child: Center(
                      child: Text(
                        '$sessionCount',
                        style: const TextStyle(
                          fontSize:   10,
                          fontWeight: FontWeight.w800,
                          color:      _kSage,
                          fontFamily: 'Inter',
                          height:     1,
                        ),
                      ),
                    ),
                  ),
                ),
            ],
          ),
        ),
      ),
    );
  }
}
