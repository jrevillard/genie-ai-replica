import 'package:flutter/material.dart';
import 'package:flutter_svg/flutter_svg.dart';
import 'package:genie_ai_mobile/services/i18n_service.dart';
import 'package:genie_ai_mobile/utils/theme_manager.dart';
import 'package:genie_ai_mobile/design_system/tokens/app_tokens.dart';
import 'package:genie_ai_mobile/design_system/tokens/spacing.dart';
import 'package:genie_ai_mobile/design_system/tokens/radii.dart';
import 'package:genie_ai_mobile/design_system/components/ds_button.dart';

class ChatResponseFeedbackDialog extends StatefulWidget {
  final Map<String, dynamic> message;
  final Function(Map<String, dynamic>) onSubmit;

  const ChatResponseFeedbackDialog({
    super.key,
    required this.message,
    required this.onSubmit,
  });

  @override
  State<ChatResponseFeedbackDialog> createState() =>
      _ChatResponseFeedbackDialogState();
}

class _ChatResponseFeedbackDialogState
    extends State<ChatResponseFeedbackDialog> {
  int? _selectedRating;
  String? _thumbFeedback;
  String _feedbackText = "";
  Color _skinToneColor = const Color(0xFFFFCBA4);

  // Skin tones from Vue component
  final List<Color> _skinTones = const [
    Color(0xFFFFDBAC),
    Color(0xFFF1C27D),
    Color(0xFFE0AC69),
    Color(0xFFC68642),
    Color(0xFF8D5524),
  ];

  void _selectThumbFeedback(String type) {
    setState(() {
      _thumbFeedback = type;
      // Auto-set rating logic from Vue
      if (type == 'up') {
        _selectedRating = 4;
      } else if (type == 'down') {
        _selectedRating = 2;
      }
    });
  }

  void _submit() {
    if (_selectedRating == null && _thumbFeedback == null) return;

    // FIX: Get ID and strip 'messages/' prefix to prevent 404s in URL construction
    String rawId = widget.message['id'] ?? widget.message['timestamp'];
    String cleanId = rawId.toString().replaceFirst('messages/', '');

    widget.onSubmit({
      'rating': _selectedRating,
      'thumbFeedback': _thumbFeedback,
      'skinTone': _skinToneColor.toARGB32().toRadixString(16),
      'text': _feedbackText,
      'messageId': cleanId, // Sending clean ID (e.g. "274711...")
    });

    Navigator.of(context).pop();
  }

  @override
  Widget build(BuildContext context) {
    // ... (Rest of your UI code remains exactly the same)
    final tokens = ThemeManager().tokens;
    final bool isDark = ThemeManager().isDarkMode;

    return Dialog(
      backgroundColor: tokens.surface,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(DsRadii.xl)),
      insetPadding: const EdgeInsets.all(DsSpacing.md),
      child: SafeArea(
        child: Container(
          width: 700, // Max width from CSS
          padding: const EdgeInsets.all(DsSpacing.xl),
          child: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                // Header
                Text(
                  tr("responseRating.title"),
                  style: TextStyle(
                    fontSize: tokens.textLg,
                    fontWeight: FontWeight.bold,
                    color: tokens.fg,
                  ),
                ),
                const SizedBox(height: DsSpacing.sm),
                Text(
                  tr("responseRating.note"),
                  textAlign: TextAlign.center,
                  style: TextStyle(
                    fontSize: tokens.textSm,
                    color: tokens.fg70,
                  ),
                ),
                const SizedBox(height: DsSpacing.xl),

                // Layout
                LayoutBuilder(
                  builder: (context, constraints) {
                    return Column(
                      children: [
                        // --- MESSAGE PREVIEW ---
                        Container(
                          width: double.infinity,
                          margin: const EdgeInsets.only(bottom: DsSpacing.lg),
                          padding: const EdgeInsets.all(DsSpacing.sm),
                          decoration: BoxDecoration(
                            color: isDark
                                ? tokens.muted20
                                : tokens.mutedSoft,
                            borderRadius: BorderRadius.circular(DsRadii.lg),
                            border: Border(
                              left: BorderSide(
                                color: tokens.border,
                                width: 3,
                              ),
                            ),
                          ),
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                tr("responseRating.chatbotResponse"),
                                style: TextStyle(
                                  fontWeight: FontWeight.bold,
                                  fontSize: tokens.textSm,
                                  color: tokens.fg,
                                ),
                              ),
                              const SizedBox(height: 6),
                              Text(
                                widget.message['content'] ?? '',
                                maxLines: 3,
                                overflow: TextOverflow.ellipsis,
                                style: TextStyle(
                                  fontSize: tokens.textSm,
                                  color: tokens.fg70,
                                ),
                              ),
                            ],
                          ),
                        ),

                        // --- THUMBS & SKIN TONE ---
                        Row(
                          children: [
                            Expanded(
                              child: _buildThumbButton(
                                type: 'up',
                                label: tr("feedback.positive"),
                                isActive: _thumbFeedback == 'up',
                                tokens: tokens,
                                isDark: isDark,
                              ),
                            ),
                            const SizedBox(width: 10),
                            Expanded(
                              child: _buildThumbButton(
                                type: 'down',
                                label: tr("feedback.negative"),
                                isActive: _thumbFeedback == 'down',
                                tokens: tokens,
                                isDark: isDark,
                              ),
                            ),
                          ],
                        ),
                        const SizedBox(height: DsSpacing.sm),
                        _buildSkinToneSelector(tokens),
                        const SizedBox(height: DsSpacing.xl),

                        // --- RATING 1-5 ---
                        Align(
                          alignment: Alignment.centerLeft,
                          child: Text(
                            tr("feedback.promptText"),
                            style: TextStyle(
                              fontWeight: FontWeight.w500,
                              color: tokens.fg70,
                            ),
                          ),
                        ),
                        const SizedBox(height: 10),
                        _buildRatingSelector(tokens, isDark),
                        const SizedBox(height: 20),

                        // --- TEXT INPUT ---
                        TextField(
                          onChanged: (v) => _feedbackText = v,
                          maxLines: 3,
                          style: TextStyle(color: tokens.fg, fontSize: tokens.textBase),
                          decoration: InputDecoration(
                            hintText: tr("responseRating.additionalComments"),
                            hintStyle: TextStyle(
                              color: tokens.fg30,
                            ),
                            filled: true,
                            fillColor: isDark
                                ? tokens.muted20
                                : tokens.surface,
                            border: OutlineInputBorder(
                              borderRadius: BorderRadius.circular(DsRadii.lg),
                              borderSide: BorderSide(color: tokens.border),
                            ),
                            enabledBorder: OutlineInputBorder(
                              borderRadius: BorderRadius.circular(DsRadii.lg),
                              borderSide: BorderSide(color: tokens.border),
                            ),
                          ),
                        ),
                      ],
                    );
                  },
                ),

                const SizedBox(height: DsSpacing.xl),

                // Actions
                Row(
                  mainAxisAlignment: MainAxisAlignment.end,
                  children: [
                    DsButton(
                      label: tr("responseRating.cancel"),
                      variant: DsButtonVariant.ghost,
                      onPressed: () => Navigator.of(context).pop(),
                    ),
                    const SizedBox(width: DsSpacing.sm),
                    DsButton(
                      label: tr("responseRating.submit"),
                      variant: DsButtonVariant.primary,
                      onPressed:
                          (_selectedRating != null || _thumbFeedback != null)
                          ? _submit
                          : null,
                    ),
                  ],
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  // ... (Helper widgets _buildThumbButton, _buildSkinToneSelector, etc. remain the same)
  Widget _buildThumbButton({
    required String type,
    required String label,
    required bool isActive,
    required AppTokens tokens,
    required bool isDark,
  }) {
    final String fillColor =
        '#${_skinToneColor.toARGB32().toRadixString(16).substring(2)}';
    final Color bgColor = isActive
        ? tokens.accent10
        : (isDark ? tokens.muted20 : tokens.bg);
    final Color borderColor = isActive ? tokens.accent : tokens.border;

    return GestureDetector(
      onTap: () => _selectThumbFeedback(type),
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 200),
        padding: const EdgeInsets.symmetric(vertical: DsSpacing.sm),
        decoration: BoxDecoration(
          color: bgColor,
          borderRadius: BorderRadius.circular(14),
          border: Border.all(color: borderColor, width: 2),
        ),
        child: Column(
          children: [
            SvgPicture.string(
              _generateThumbSvg(type, isActive ? fillColor : 'none'),
              width: 28,
              height: 28,
              colorFilter: ColorFilter.mode(
                isActive
                    ? tokens.accent
                    : tokens.muted,
                BlendMode.srcIn,
              ),
            ),
            const SizedBox(height: 6),
            Text(
              label,
              style: TextStyle(
                fontSize: tokens.textSm,
                fontWeight: FontWeight.w600,
                color: isActive
                    ? tokens.accent
                    : tokens.fg70,
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildSkinToneSelector(AppTokens tokens) {
    return Row(
      mainAxisAlignment: MainAxisAlignment.center,
      children: _skinTones.map((color) {
        final bool isSelected = _skinToneColor == color;
        return GestureDetector(
          onTap: () => setState(() => _skinToneColor = color),
          child: Container(
            margin: const EdgeInsets.symmetric(horizontal: DsSpacing.xs),
            width: 24,
            height: 24,
            decoration: BoxDecoration(
              color: color,
              shape: BoxShape.circle,
              border: Border.all(
                color: isSelected ? tokens.accent : tokens.border,
                width: isSelected ? 2 : 1,
              ),
              boxShadow: isSelected
                  ? [
                      BoxShadow(
                        color: tokens.accent30,
                        spreadRadius: 2,
                      ),
                    ]
                  : null,
            ),
          ),
        );
      }).toList(),
    );
  }

  Widget _buildRatingSelector(AppTokens tokens, bool isDark) {
    return Row(
      mainAxisAlignment: MainAxisAlignment.spaceBetween,
      children: List.generate(5, (index) {
        final int rating = index + 1;
        final bool isSelected = _selectedRating == rating;

        return Expanded(
          child: GestureDetector(
            onTap: () => setState(() => _selectedRating = rating),
            child: Container(
              margin: const EdgeInsets.symmetric(horizontal: DsSpacing.xs),
              padding: const EdgeInsets.symmetric(vertical: DsSpacing.sm),
              decoration: BoxDecoration(
                color: isSelected
                    ? tokens.accent10
                    : (isDark ? tokens.muted20 : tokens.surface),
                borderRadius: BorderRadius.circular(DsRadii.lg),
                border: Border.all(
                  color: isSelected ? tokens.accent : tokens.border,
                ),
              ),
              child: Column(
                children: [
                  Container(
                    width: 28,
                    height: 28,
                    alignment: Alignment.center,
                    decoration: BoxDecoration(
                      shape: BoxShape.circle,
                      color: isSelected
                          ? tokens.accent
                          : (isDark
                                ? tokens.fg30
                                : tokens.mutedSoft),
                    ),
                    child: Text(
                      "$rating",
                      style: TextStyle(
                        fontWeight: FontWeight.bold,
                        color: isSelected
                            ? tokens.accentFg
                            : tokens.fg70,
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ),
        );
      }),
    );
  }

  String _generateThumbSvg(String type, String fill) {
    if (type == 'up') {
      return '''
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
  <path d="M7 10v12" stroke-width="2" fill="none" stroke="currentColor"/>
  <path d="M15 5.88 14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.76a2 2 0 0 0 1.79-1.11L12 2h0a3.13 3.13 0 0 1 3 3.88Z" 
        fill="$fill" stroke-width="2" stroke="currentColor"/>
</svg>
''';
    } else {
      return '''
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
  <path d="M17 14V2" stroke-width="2" fill="none" stroke="currentColor"/>
  <path d="M9 18.12 10 14H4.17a2 2 0 0 1-1.92-2.56l2.33-8A2 2 0 0 1 6.5 2H20a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-2.76a2 2 0 0 0-1.79 1.11L12 22h0a3.13 3.13 0 0 1-3-3.88Z" 
        fill="$fill" stroke-width="2" stroke="currentColor"/>
</svg>
''';
    }
  }
}
