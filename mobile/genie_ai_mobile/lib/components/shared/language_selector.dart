import 'package:flutter/material.dart';

class LanguageSelector extends StatefulWidget {
  final Color? textColor;
  final Color?
      dropdownColor; // NEW: Allows customization of the menu background

  const LanguageSelector({
    super.key,
    this.textColor,
    this.dropdownColor,
  });

  @override
  State<LanguageSelector> createState() => _LanguageSelectorState();
}

class _LanguageSelectorState extends State<LanguageSelector> {
  String _currentLocale = 'English';

  @override
  Widget build(BuildContext context) {
    // Dynamic text color based on context or theme
    final Color displayColor = widget.textColor ?? Colors.white;
    // Dynamic background color (defaults to standard card/menu color if not provided)
    final Color menuBg = widget.dropdownColor ?? Theme.of(context).cardColor;

    return DropdownButtonHideUnderline(
      child: DropdownButton<String>(
        value: _currentLocale,
        dropdownColor: menuBg, // UPDATED: Uses dynamic color
        // Use the passed color for the icon and text
        icon: Icon(Icons.arrow_drop_down, color: displayColor),
        items: ['Arabic', 'German', 'English', 'Spanish', 'French', 'Swahili']
            .map((lang) => DropdownMenuItem(
                  value: lang,
                  child: Text(lang,
                      style: TextStyle(color: displayColor, fontSize: 13)),
                ))
            .toList(),
        onChanged: (val) {
          setState(() => _currentLocale = val!);
          // Logic for persistence from LanguageSelector.vue
        },
      ),
    );
  }
}
