import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:genie_ai_mobile/services/i18n_service.dart';

class LanguageSelector extends StatelessWidget {
  final Color? textColor;
  final Color? dropdownColor;

  const LanguageSelector({super.key, this.textColor, this.dropdownColor});

  @override
  Widget build(BuildContext context) {
    debugPrint("[LANG SELECTOR] Build called");
    final i18n = I18nService();

    final Color displayColor = textColor ?? Colors.white;

    return ListenableBuilder(
      listenable: i18n,
      builder: (context, child) {
        debugPrint(
          "[LANG SELECTOR] Builder rebuilding. Current I18n Locale: ${i18n.currentLocale.languageCode}",
        );

        final currentLanguage =
            i18n.supportedLanguages[i18n.currentLocale.languageCode] ??
            i18n.currentLocale.languageCode.toUpperCase();

        return InkWell(
          borderRadius: BorderRadius.circular(8),
          onTap: () => _showLanguagePicker(context, i18n),
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 6),
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                Flexible(
                  child: Text(
                    currentLanguage,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(
                      color: displayColor,
                      fontSize: 13,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                ),
                const SizedBox(width: 2),
                Icon(Icons.arrow_drop_down, color: displayColor, size: 20),
              ],
            ),
          ),
        );
      },
    );
  }

  void _showLanguagePicker(BuildContext context, I18nService i18n) {
    final theme = Theme.of(context);
    final Color sheetBg = dropdownColor ?? theme.cardColor;
    final maxHeight = math.min(MediaQuery.sizeOf(context).height * 0.72, 420.0);

    showModalBottomSheet<void>(
      context: context,
      backgroundColor: sheetBg,
      useSafeArea: true,
      showDragHandle: true,
      constraints: BoxConstraints(maxHeight: maxHeight),
      builder: (sheetContext) {
        return ListView(
          shrinkWrap: true,
          padding: const EdgeInsets.only(bottom: 12),
          children: i18n.supportedLanguages.entries.map((entry) {
            final isSelected = i18n.currentLocale.languageCode == entry.key;
            final textStyle = theme.textTheme.bodyMedium?.copyWith(
              color: textColor ?? theme.colorScheme.onSurface,
              fontWeight: isSelected ? FontWeight.bold : FontWeight.normal,
            );

            return ListTile(
              dense: true,
              title: Text(entry.value, style: textStyle),
              trailing: isSelected
                  ? Icon(Icons.check, color: theme.colorScheme.primary)
                  : null,
              onTap: () {
                debugPrint("[LANG SELECTOR] User selected: ${entry.key}");
                i18n.changeLanguage(entry.key);
                Navigator.of(sheetContext).pop();
              },
            );
          }).toList(),
        );
      },
    );
  }
}
