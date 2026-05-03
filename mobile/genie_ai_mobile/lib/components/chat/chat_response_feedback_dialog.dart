import 'package:flutter/material.dart';
import 'package:flutter_svg/flutter_svg.dart';
import 'package:genie_ai_mobile/utils/theme_manager.dart';

class ChatResponseFeedbackDialog extends StatefulWidget {
  final Map<String, dynamic> message;
  final Function(String, [String]) translate;
  final Function(Map<String, dynamic>) onSubmit;

  const ChatResponseFeedbackDialog({
    super.key,
    required this.message,
    required this.translate,
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
      'skinTone': _skinToneColor.value.toRadixString(16),
      'text': _feedbackText,
      'messageId': cleanId, // Sending clean ID (e.g. "274711...")
    });

    Navigator.of(context).pop();
  }

  @override
  Widget build(BuildContext context) {
    // ... (Rest of your UI code remains exactly the same)
    final colors = ThemeManager().getColors();
    final bool isDark = ThemeManager().isDarkMode;

    return Dialog(
      backgroundColor: colors['surface'],
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
      insetPadding: const EdgeInsets.all(16),
      child: SafeArea(
        child: Container(
          width: 700, // Max width from CSS
          padding: const EdgeInsets.all(24),
          child: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                // Header
                Text(
                  widget.translate("responseRating.title", "Rate Response"),
                  style: TextStyle(
                    fontSize: 20,
                    fontWeight: FontWeight.bold,
                    color: colors['text'],
                  ),
                ),
                const SizedBox(height: 8),
                Text(
                  widget.translate(
                    "responseRating.note",
                    "Your feedback helps improve our responses.",
                  ),
                  textAlign: TextAlign.center,
                  style: TextStyle(
                    fontSize: 13,
                    color: colors['text'].withOpacity(0.7),
                  ),
                ),
                const SizedBox(height: 24),

                // Layout
                LayoutBuilder(
                  builder: (context, constraints) {
                    return Column(
                      children: [
                        // --- MESSAGE PREVIEW ---
                        Container(
                          width: double.infinity,
                          margin: const EdgeInsets.only(bottom: 20),
                          padding: const EdgeInsets.all(12),
                          decoration: BoxDecoration(
                            color: isDark
                                ? Colors.white.withOpacity(0.05)
                                : Colors.grey[100],
                            borderRadius: BorderRadius.circular(12),
                            border: Border(
                              left: BorderSide(
                                color: colors['border'],
                                width: 3,
                              ),
                            ),
                          ),
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                widget.translate(
                                  "responseRating.chatbotResponse",
                                  "Chatbot Response",
                                ),
                                style: TextStyle(
                                  fontWeight: FontWeight.bold,
                                  fontSize: 12,
                                  color: colors['text'],
                                ),
                              ),
                              const SizedBox(height: 6),
                              Text(
                                widget.message['content'] ?? '',
                                maxLines: 3,
                                overflow: TextOverflow.ellipsis,
                                style: TextStyle(
                                  fontSize: 13,
                                  color: colors['text'].withOpacity(0.8),
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
                                label: widget.translate(
                                  "feedback.positive",
                                  "Helpful",
                                ),
                                isActive: _thumbFeedback == 'up',
                                colors: colors,
                                isDark: isDark,
                              ),
                            ),
                            const SizedBox(width: 10),
                            Expanded(
                              child: _buildThumbButton(
                                type: 'down',
                                label: widget.translate(
                                  "feedback.negative",
                                  "Not Helpful",
                                ),
                                isActive: _thumbFeedback == 'down',
                                colors: colors,
                                isDark: isDark,
                              ),
                            ),
                          ],
                        ),
                        const SizedBox(height: 16),
                        _buildSkinToneSelector(colors),
                        const SizedBox(height: 24),

                        // --- RATING 1-5 ---
                        Align(
                          alignment: Alignment.centerLeft,
                          child: Text(
                            widget.translate(
                              "feedback.promptText",
                              "How would you rate this?",
                            ),
                            style: TextStyle(
                              fontWeight: FontWeight.w500,
                              color: colors['text'].withOpacity(0.7),
                            ),
                          ),
                        ),
                        const SizedBox(height: 10),
                        _buildRatingSelector(colors, isDark),
                        const SizedBox(height: 20),

                        // --- TEXT INPUT ---
                        TextField(
                          onChanged: (v) => _feedbackText = v,
                          maxLines: 3,
                          style: TextStyle(color: colors['text'], fontSize: 14),
                          decoration: InputDecoration(
                            hintText: widget.translate(
                              "responseRating.additionalComments",
                              "Additional comments...",
                            ),
                            hintStyle: TextStyle(
                              color: colors['text'].withOpacity(0.5),
                            ),
                            filled: true,
                            fillColor: isDark
                                ? Colors.white.withOpacity(0.05)
                                : Colors.white,
                            border: OutlineInputBorder(
                              borderRadius: BorderRadius.circular(12),
                              borderSide: BorderSide(color: colors['border']),
                            ),
                            enabledBorder: OutlineInputBorder(
                              borderRadius: BorderRadius.circular(12),
                              borderSide: BorderSide(color: colors['border']),
                            ),
                          ),
                        ),
                      ],
                    );
                  },
                ),

                const SizedBox(height: 24),

                // Actions
                Row(
                  mainAxisAlignment: MainAxisAlignment.end,
                  children: [
                    TextButton(
                      onPressed: () => Navigator.of(context).pop(),
                      child: Text(
                        widget.translate("responseRating.cancel", "Cancel"),
                        style: TextStyle(color: colors['text']),
                      ),
                    ),
                    const SizedBox(width: 8),
                    ElevatedButton(
                      style: ElevatedButton.styleFrom(
                        backgroundColor: colors['primary'],
                        shape: RoundedRectangleBorder(
                          borderRadius: BorderRadius.circular(10),
                        ),
                        padding: const EdgeInsets.symmetric(
                          horizontal: 24,
                          vertical: 12,
                        ),
                      ),
                      onPressed:
                          (_selectedRating != null || _thumbFeedback != null)
                          ? _submit
                          : null,
                      child: Text(
                        widget.translate("responseRating.submit", "Submit"),
                        style: const TextStyle(
                          color: Colors.white,
                          fontWeight: FontWeight.bold,
                        ),
                      ),
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
    required Map<String, dynamic> colors,
    required bool isDark,
  }) {
    final String fillColor =
        '#${_skinToneColor.value.toRadixString(16).substring(2)}';
    final Color bgColor = isActive
        ? colors['primary'].withOpacity(0.1)
        : (isDark ? Colors.white.withOpacity(0.05) : const Color(0xFFF5F9FF));
    final Color borderColor = isActive ? colors['primary'] : colors['border'];

    return GestureDetector(
      onTap: () => _selectThumbFeedback(type),
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 200),
        padding: const EdgeInsets.symmetric(vertical: 12),
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
                    ? colors['primary']
                    : (isDark ? Colors.grey[400]! : Colors.grey[700]!),
                BlendMode.srcIn,
              ),
            ),
            const SizedBox(height: 6),
            Text(
              label,
              style: TextStyle(
                fontSize: 13,
                fontWeight: FontWeight.w600,
                color: isActive
                    ? colors['primary']
                    : colors['text'].withOpacity(0.7),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildSkinToneSelector(Map<String, dynamic> colors) {
    return Row(
      mainAxisAlignment: MainAxisAlignment.center,
      children: _skinTones.map((color) {
        final bool isSelected = _skinToneColor == color;
        return GestureDetector(
          onTap: () => setState(() => _skinToneColor = color),
          child: Container(
            margin: const EdgeInsets.symmetric(horizontal: 4),
            width: 24,
            height: 24,
            decoration: BoxDecoration(
              color: color,
              shape: BoxShape.circle,
              border: Border.all(
                color: isSelected ? colors['primary'] : Colors.grey[300]!,
                width: isSelected ? 2 : 1,
              ),
              boxShadow: isSelected
                  ? [
                      BoxShadow(
                        color: colors['primary'].withOpacity(0.3),
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

  Widget _buildRatingSelector(Map<String, dynamic> colors, bool isDark) {
    return Row(
      mainAxisAlignment: MainAxisAlignment.spaceBetween,
      children: List.generate(5, (index) {
        final int rating = index + 1;
        final bool isSelected = _selectedRating == rating;

        return Expanded(
          child: GestureDetector(
            onTap: () => setState(() => _selectedRating = rating),
            child: Container(
              margin: const EdgeInsets.symmetric(horizontal: 4),
              padding: const EdgeInsets.symmetric(vertical: 8),
              decoration: BoxDecoration(
                color: isSelected
                    ? colors['primary'].withOpacity(0.1)
                    : (isDark ? Colors.white.withOpacity(0.05) : Colors.white),
                borderRadius: BorderRadius.circular(12),
                border: Border.all(
                  color: isSelected ? colors['primary'] : colors['border'],
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
                          ? colors['primary']
                          : (isDark
                                ? Colors.white.withOpacity(0.1)
                                : Colors.grey[200]),
                    ),
                    child: Text(
                      "$rating",
                      style: TextStyle(
                        fontWeight: FontWeight.bold,
                        color: isSelected
                            ? Colors.white
                            : colors['text'].withOpacity(0.7),
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
