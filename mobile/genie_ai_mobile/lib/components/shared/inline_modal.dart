import 'package:flutter/material.dart';

import 'package:genie_ai_mobile/utils/theme_manager.dart';

/// Hosts a dialog INSIDE a widget subtree (a `Stack`) instead of as a
/// navigator route.
///
/// Used for the chat's save / export prompts so the scrim covers the chat
/// area only: the nav bar above stays live, and the brand (dashboard) tap
/// can leave the conversation while a prompt is open - web parity, where the
/// modal sits inside the page and the header remains clickable. A route
/// dialog would put its barrier over the nav bar.
///
/// [dismissible] = a scrim tap calls [onDismiss] (web `close-on-click-modal`).
/// The child is centered and gets bounded height, so a `DsModal` scrolls its
/// content when the keyboard shrinks the area instead of clipping its
/// buttons.
class InlineModal extends StatelessWidget {
  final bool visible;
  final bool dismissible;
  final VoidCallback onDismiss;
  final Widget child;

  const InlineModal({
    super.key,
    required this.visible,
    required this.onDismiss,
    required this.child,
    this.dismissible = true,
  });

  @override
  Widget build(BuildContext context) {
    if (!visible) {
      return const SizedBox.shrink(key: ValueKey('inline-modal-hidden'));
    }
    return Positioned.fill(
      child: Stack(
        children: [
          ModalBarrier(
            key: const ValueKey('inline-modal-barrier'),
            color: ThemeManager().tokens.scrim,
            dismissible: dismissible,
            onDismiss: onDismiss,
          ),
          Center(child: child),
        ],
      ),
    );
  }
}
