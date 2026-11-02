import 'package:flutter/material.dart';
import 'package:genie_ai_mobile/services/i18n_service.dart';

class LanguageSelector extends StatelessWidget {
  final Color? textColor;
  final Color? dropdownColor;

  const LanguageSelector({
    super.key,
    this.textColor,
    this.dropdownColor,
  });

  @override
  Widget build(BuildContext context) {
    debugPrint("[LANG SELECTOR] Build called");
    final i18n = I18nService();

    final Color displayColor = textColor ?? Colors.white;
    final Color menuBg = dropdownColor ?? Theme.of(context).cardColor;

    return ListenableBuilder(
      listenable: i18n,
      builder: (context, child) {
        debugPrint(
            "[LANG SELECTOR] Builder rebuilding. Current I18n Locale: ${i18n.currentLocale.languageCode}");

        return DropdownButtonHideUnderline(
          child: DropdownButton<String>(
            value: i18n.currentLocale.languageCode,
            dropdownColor: menuBg,
            icon: Icon(Icons.arrow_drop_down, color: displayColor),
            isDense: true,
            alignment: AlignmentDirectional.centerEnd,
            items: i18n.supportedLanguages.entries.map((entry) {
              return DropdownMenuItem(
                value: entry.key,
                child: Text(
                  entry.value,
                  style: TextStyle(
                      color: displayColor,
                      fontSize: 13,
                      fontWeight: i18n.currentLocale.languageCode == entry.key
                          ? FontWeight.bold
                          : FontWeight.normal),
                ),
              );
            }).toList(),
            onChanged: (val) {
              debugPrint("[LANG SELECTOR] User selected: $val");
              if (val != null) {
                i18n.changeLanguage(val);
              }
            },
          ),
        );
      },
    );
  }
}
