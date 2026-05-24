// This file is part of Amina Care.
//
// Amina Care is free software: you can redistribute it and/or modify
// it under the terms of the GNU Lesser General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// Amina Care is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
// GNU Lesser General Public License for more details.
//
// You should have received a copy of the GNU Lesser General Public License
// along with Amina Care. If not, see <https://www.gnu.org/licenses/>.

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../providers/caregiver_alert_provider.dart';
import '../providers/tab_provider.dart';
import '../theme/app_theme.dart';

// ─── Brand constants (never used for UI colors — only for semantics) ──────────
//
// Rule: widgets must NOT use these directly for backgrounds/text.
// They exist only as fallback identifiers.  UI colours come from the theme.

const _kAlertGradStart = Color(0xFFB91C1C);
const _kAlertGradEnd   = Color(0xFFEF4444);
const _kSentGreen      = Color(0xFF059669);

// ═══════════════════════════════════════════════════════════════════════════════
// HOW TO THEME A WIDGET — pattern demonstrated here
//
// 1. Remove all private `const _kXxx = Color(...)` color tokens.
// 2. Read colours from the ambient theme:
//      final cs    = Theme.of(context).colorScheme;
//      final amina = Theme.of(context).extension<AminaColors>()!;
// 3. Map M3 roles to your design intent:
//      AppBar bg   → cs.surface
//      Title text  → cs.onSurface
//      Divider     → amina.divider
//      Icon bg     → cs.primaryContainer
//      Icon color  → cs.primary
//      Border      → cs.outline
// 4. Do NOT pass a BuildContext into helper methods that need theme values —
//    keep the tree reads inside Widget.build / State.build.
// ═══════════════════════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════════════════════
// UNIFIED HEADER
//
// Layout: Profile button (left) │ Screen title (center) │ Alert button (right)
//
// Excluded screens: chat_conversation.dart, me_screen.dart (own AppBar).
// ═══════════════════════════════════════════════════════════════════════════════

class AminaHeader extends ConsumerWidget implements PreferredSizeWidget {
  final String  title;
  final bool    showAlert;
  /// Replaces the default profile-icon leading when provided.
  final Widget? leading;
  /// Replaces the alert button in the actions slot when provided.
  final Widget? trailing;

  const AminaHeader({
    super.key,
    required this.title,
    this.showAlert = true,
    this.leading,
    this.trailing,
  });

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final alertStatus = ref.watch(caregiverAlertProvider);

    // ── Read from theme — no hardcoded colours below this line ──────────────
    final cs    = Theme.of(context).colorScheme;
    final amina = Theme.of(context).extension<AminaColors>()!;

    return AppBar(
      // backgroundColor / elevation come from AppBarTheme in AminaTheme,
      // but we also set them here for clarity and to guarantee correctness
      // when AminaHeader is used outside the normal route stack.
      backgroundColor:        cs.surface,
      elevation:              0,
      scrolledUnderElevation: 0,
      surfaceTintColor:       Colors.transparent,
      centerTitle:            true,

      // ── Leading — custom override or default profile button ──────────────
      leading: leading ?? Padding(
        padding: const EdgeInsets.all(10),
        child: GestureDetector(
          onTap: () => ref.read(selectedTabProvider.notifier).state = 4,
          child: Container(
            decoration: BoxDecoration(
              // Reads primaryContainer: sage-light in light, dark tint in dark.
              color: cs.primaryContainer,
              shape: BoxShape.circle,
            ),
            child: Icon(
              Icons.person_outline_rounded,
              color: cs.primary,   // sage in both modes
              size:  22,
            ),
          ),
        ),
      ),

      // ── Screen title ──────────────────────────────────────────────────────
      title: Text(
        title,
        style: TextStyle(
          color:         cs.onSurface,
          fontWeight:    FontWeight.w700,
          fontSize:      17,
          letterSpacing: -0.3,
          fontFamily:    'Inter',
        ),
      ),

      // ── Right action — custom trailing, alert button, or nothing ──────────
      actions: trailing != null
          ? [trailing!]
          : showAlert
              ? [
                  Padding(
                    padding: const EdgeInsets.symmetric(
                        vertical: 9, horizontal: 12),
                    child: _AlertButton(
                      status: alertStatus,
                      onTap:  () => _handleAlert(context, ref, cs, amina),
                    ),
                  ),
                ]
              : null,

      // ── Bottom divider — themed ───────────────────────────────────────────
      bottom: PreferredSize(
        preferredSize: const Size.fromHeight(0.8),
        child: Container(height: 0.8, color: amina.divider),
      ),
    );
  }

  // ── Alert flow ─────────────────────────────────────────────────────────────

  void _handleAlert(
    BuildContext context,
    WidgetRef    ref,
    ColorScheme  cs,
    AminaColors  amina,
  ) {
    if (ref.read(caregiverAlertProvider) == AlertStatus.sending) return;

    showDialog<bool>(
      context: context,
      builder: (ctx) {
        // Re-read theme inside the dialog builder — it might have changed.
        final dialogCs = Theme.of(ctx).colorScheme;
        return AlertDialog(
          // Inherits shape/bg from DialogTheme in AminaTheme.
          titlePadding:   const EdgeInsets.fromLTRB(24, 28, 24, 10),
          contentPadding: const EdgeInsets.fromLTRB(24, 0, 24, 4),
          actionsPadding: const EdgeInsets.fromLTRB(16, 8, 16, 20),
          title: Row(
            children: [
              Icon(Icons.emergency_rounded, color: _kAlertGradEnd, size: 28),
              const SizedBox(width: 12),
              Flexible(
                child: Text(
                  'Alert Your Caregiver',
                  style: TextStyle(
                    fontSize:   19,
                    fontWeight: FontWeight.w800,
                    color:      dialogCs.onSurface, // themed
                    fontFamily: 'Inter',
                  ),
                ),
              ),
            ],
          ),
          content: Text(
            'This will immediately notify your caregiver that you need '
            'assistance. Do you want to continue?',
            style: TextStyle(
              fontSize:   16,
              height:     1.55,
              color:      dialogCs.onSurfaceVariant, // themed
              fontFamily: 'Inter',
            ),
          ),
          actions: [
            // Cancel
            SizedBox(
              height: 50,
              child: TextButton(
                onPressed: () => Navigator.of(ctx).pop(false),
                style: TextButton.styleFrom(
                  foregroundColor: dialogCs.onSurfaceVariant,
                  textStyle: const TextStyle(
                    fontSize:   16,
                    fontWeight: FontWeight.w600,
                    fontFamily: 'Inter',
                  ),
                  shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(14)),
                ),
                child: const Text('Cancel'),
              ),
            ),
            const SizedBox(width: 8),
            // Confirm
            SizedBox(
              height: 50,
              child: ElevatedButton.icon(
                onPressed: () => Navigator.of(ctx).pop(true),
                icon:  const Icon(Icons.send_rounded, size: 18),
                label: const Text('Send Alert'),
                style: ElevatedButton.styleFrom(
                  backgroundColor: _kAlertGradEnd,  // alert red stays semantic
                  foregroundColor: Colors.white,
                  elevation:       0,
                  textStyle: const TextStyle(
                    fontSize:   16,
                    fontWeight: FontWeight.w700,
                    fontFamily: 'Inter',
                  ),
                  padding: const EdgeInsets.symmetric(
                      horizontal: 22, vertical: 0),
                  shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(14)),
                ),
              ),
            ),
          ],
        );
      },
    ).then((confirmed) {
      if (confirmed != true || !context.mounted) return;

      ref.read(caregiverAlertProvider.notifier).sendAlert().then((_) {
        if (!context.mounted) return;
        ScaffoldMessenger.of(context).showSnackBar(
          // SnackBar colours come from SnackBarTheme in AminaTheme
          // (inverseSurface bg, onInverseSurface text).
          SnackBar(
            content: const Row(
              children: [
                Icon(Icons.check_circle_rounded,
                    color: Colors.white, size: 20),
                SizedBox(width: 10),
                Expanded(
                  child: Text(
                    'Alert sent — your caregiver has been notified.',
                    style: TextStyle(
                      fontWeight: FontWeight.w600,
                      fontSize:   14,
                      fontFamily: 'Inter',
                    ),
                  ),
                ),
              ],
            ),
            // Semantic green stays fixed — it's a success signal, not a brand colour.
            backgroundColor: _kSentGreen,
            duration:        const Duration(seconds: 4),
          ),
        );
      });
    });
  }

  @override
  Size get preferredSize => const Size.fromHeight(60.8);
}

// ═══════════════════════════════════════════════════════════════════════════════
// CAREGIVER ALERT BUTTON
// ═══════════════════════════════════════════════════════════════════════════════

class _AlertButton extends StatelessWidget {
  final AlertStatus  status;
  final VoidCallback onTap;

  const _AlertButton({required this.status, required this.onTap});

  @override
  Widget build(BuildContext context) {
    final isSending = status == AlertStatus.sending;
    final isSent    = status == AlertStatus.sent;

    // The alert gradient is a semantic brand decision (red = danger).
    // It doesn't adapt to theme mode — it stays red in both modes.
    return GestureDetector(
      onTap: isSending ? null : onTap,
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 280),
        curve:    Curves.easeInOut,
        padding:  const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
        decoration: BoxDecoration(
          gradient: isSending
              ? null
              : LinearGradient(
                  colors: isSent
                      ? [_kSentGreen, const Color(0xFF10B981)]
                      : [_kAlertGradStart, _kAlertGradEnd],
                  begin: Alignment.topLeft,
                  end:   Alignment.bottomRight,
                ),
          color:        isSending
              ? Theme.of(context).colorScheme.outline
              : null,
          borderRadius: BorderRadius.circular(22),
          boxShadow: isSending
              ? null
              : [
                  BoxShadow(
                    color: (isSent ? _kSentGreen : _kAlertGradEnd)
                        .withValues(alpha: 0.38),
                    blurRadius: 10,
                    offset:     const Offset(0, 3),
                  ),
                ],
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            if (isSending)
              SizedBox(
                width:  15,
                height: 15,
                child: CircularProgressIndicator(
                  strokeWidth: 2,
                  color:       Theme.of(context).colorScheme.onSurfaceVariant,
                ),
              )
            else
              Icon(
                isSent
                    ? Icons.check_circle_rounded
                    : Icons.emergency_rounded,
                color: Colors.white,
                size:  16,
              ),

            const SizedBox(width: 6),

            Text(
              isSending ? 'Sending…' : (isSent ? 'Sent!' : 'Alert'),
              style: TextStyle(
                color: isSending
                    ? Theme.of(context).colorScheme.onSurfaceVariant
                    : Colors.white,
                fontSize:      13,
                fontWeight:    FontWeight.w700,
                letterSpacing: 0.3,
                fontFamily:    'Inter',
              ),
            ),
          ],
        ),
      ),
    );
  }
}
