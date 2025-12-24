import 'package:flutter/material.dart';

class LanguageSelector extends StatefulWidget {
  final Color? textColor; // NEW: Added to handle visibility in different screens
  const LanguageSelector({super.key, this.textColor});

  @override
  State<LanguageSelector> createState() => _LanguageSelectorState();
}

class _LanguageSelectorState extends State<LanguageSelector> {
  String _currentLocale = 'English';

  @override
  Widget build(BuildContext context) {
    // Dynamic color based on context or theme
    final Color displayColor = widget.textColor ?? Colors.white;

    return DropdownButtonHideUnderline(
      child: DropdownButton<String>(
        value: _currentLocale,
        dropdownColor: const Color(0xFF4E97D1),
        // Use the passed color for the icon and text
        icon: Icon(Icons.arrow_drop_down, color: displayColor),
        items: ['Arabic', 'German', 'English', 'Spanish', 'French', 'Swahili']
            .map((lang) => DropdownMenuItem(
                  value: lang,
                  child: Text(
                    lang, 
                    style: TextStyle(color: displayColor, fontSize: 13)
                  ),
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