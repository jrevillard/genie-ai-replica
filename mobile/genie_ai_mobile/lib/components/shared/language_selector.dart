import 'package:flutter/material.dart';
import 'package:genie_ai_mobile/utils/theme_manager.dart';
import 'package:genie_ai_mobile/services/i18n_service.dart';

class LanguageSelector extends StatelessWidget {
  final Color? textColor;
  final Color? dropdownColor;
  final ValueChanged<String>? onChanged;

  const LanguageSelector({
    super.key,
    this.textColor,
    this.dropdownColor,
    this.onChanged,
  });

  @override
  Widget build(BuildContext context) {
    final i18n = I18nService();
    final tokens = ThemeManager().tokens;

    final Color displayColor = textColor ?? tokens.navbarFg;
    final Color menuBg = dropdownColor ?? tokens.surface;

    return ListenableBuilder(
      listenable: i18n,
      builder: (context, child) {
        return DropdownButtonHideUnderline(
          child: DropdownButton<String>(
            key: const ValueKey('language-selector'),
            value: i18n.currentLocale.languageCode,
            dropdownColor: menuBg,
            icon: Icon(
              Icons.arrow_drop_down,
              color: displayColor,
              key: const ValueKey('language-selector-icon'),
            ),
            isDense: true,
            alignment: AlignmentDirectional.centerEnd,
            items: i18n.supportedLanguages.entries.map((entry) {
              return DropdownMenuItem(
                key: ValueKey('lang-item-${entry.key}'),
                value: entry.key,
                child: Text(
                  entry.value,
                  style: TextStyle(
                    color: displayColor,
                    fontSize: ThemeManager().tokens.textSm,
                    fontWeight: i18n.currentLocale.languageCode == entry.key
                        ? FontWeight.bold
                        : FontWeight.normal,
                  ),
                ),
              );
            }).toList(),
            onChanged: (val) {
              if (val != null) {
                i18n.changeLanguage(val);
                onChanged?.call(val);
              }
            },
          ),
        );
      },
    );
  }
}
