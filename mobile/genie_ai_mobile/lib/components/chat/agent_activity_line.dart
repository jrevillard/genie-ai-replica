import 'package:flutter/material.dart';

import '../../design_system/components/ds_spinner.dart';
import '../../design_system/tokens/spacing.dart';
import '../../services/i18n_service.dart';
import '../../utils/theme_manager.dart' show ThemeManager;

/// The agent activity line: one transient row reporting the operation the
/// agent is currently running while it works on an answer.
///
/// The mobile rendering of the same contract the web chat carries (the
/// activity line's UX spine): the same states (`running` / `completed` /
/// `failed`), the same localized words, the same truth-table behavior. The
/// line is invisible chrome — text plus a state marker, never a control:
/// not focusable, no tap target, nothing persisted. The chat surface owns
/// the lifecycle (which turn shows it, when it collapses); this widget is
/// the row itself.
///
/// Handles mirror the web's declared ones: the container is
/// `ValueKey('agent-activity-line')`, the operation row
/// `ValueKey('agent-activity-op-<operation>')`.
class AgentActivityLine extends StatelessWidget {
  /// The operation name the server reported (the registered toolset's
  /// name — never shown raw to the user; it selects the localized
  /// template). Null renders the generic label and an `unknown` handle
  /// discriminator.
  final String? operation;

  /// The raw wire status: `started`, `completed` or `failed`. Anything
  /// else renders as running — a row must show something, and the state
  /// word comes from the label.
  final String status;

  const AgentActivityLine({super.key, required this.status, this.operation});

  @override
  Widget build(BuildContext context) {
    final tokens = ThemeManager().tokens;
    final failed = status == 'failed';
    final completed = status == 'completed';
    final reduceMotion = MediaQuery.disableAnimationsOf(context);

    final marker = ExcludeSemantics(
      child: failed
          ? Icon(Icons.warning_amber_rounded, size: 16, color: tokens.warning)
          : (completed || reduceMotion)
          ? _StaticDot(color: completed ? tokens.muted : tokens.accent)
          : const DsSpinner(size: DsSpinnerSize.sm),
    );

    return Semantics(
      // The line is the turn's polite live region: a state change
      // announces, without interrupting (the web's role="status" +
      // aria-live="polite" pair).
      liveRegion: true,
      child: Container(
        key: const ValueKey('agent-activity-line'),
        padding: const EdgeInsets.symmetric(vertical: DsSpacing.md),
        child: Row(
          key: ValueKey('agent-activity-op-${operation ?? 'unknown'}'),
          children: [
            marker,
            const SizedBox(width: DsSpacing.sm),
            Expanded(
              child: Text(
                _label(),
                style: TextStyle(
                  fontSize: tokens.textSm,
                  color: failed ? tokens.warning : tokens.muted,
                ),
                // The failed label wraps instead of truncating: the state
                // word must survive every locale's length at every font
                // scale; the other states truncate with an ellipsis.
                maxLines: failed ? null : 1,
                overflow: failed ? null : TextOverflow.ellipsis,
              ),
            ),
          ],
        ),
      ),
    );
  }

  /// The localized label for the current operation and state. A per-op
  /// catalogue entry (`chatbot.agentActivity.operations.<op>.<state>`)
  /// wins; an operation with no catalogue entry falls back to the generic
  /// state label — `tr()` returns the dotted key when nothing matches,
  /// which is how the missing entry is detected.
  String _label() {
    final (stateKey, genericKey) = switch (status) {
      'completed' => ('completed', 'chatbot.agentActivity.stepCompleted'),
      'failed' => ('failed', 'chatbot.agentActivity.stepFailed'),
      _ => ('running', 'chatbot.agentActivity.working'),
    };
    if (operation != null) {
      final key = 'chatbot.agentActivity.operations.$operation.$stateKey';
      final value = tr(key);
      if (value != key) return value;
    }
    return tr(genericKey);
  }
}

/// The completed state's static marker (the web's nav-status-pill dot): a
/// small filled circle. Also the reduced-motion stand-in for the spinner.
class _StaticDot extends StatelessWidget {
  final Color color;

  const _StaticDot({required this.color});

  @override
  Widget build(BuildContext context) {
    return Container(
      width: 10,
      height: 10,
      decoration: BoxDecoration(color: color, shape: BoxShape.circle),
    );
  }
}
