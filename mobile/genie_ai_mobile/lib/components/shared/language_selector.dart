import 'package:flutter/material.dart';

class LanguageSelector extends StatefulWidget {
  const LanguageSelector({super.key});

  @override
  State<LanguageSelector> createState() => _LanguageSelectorState();
}

class _LanguageSelectorState extends State<LanguageSelector> {
  String _currentLocale = 'English'; //

  @override
  Widget build(BuildContext context) {
    return DropdownButtonHideUnderline(
      child: DropdownButton<String>(
        value: _currentLocale,
        dropdownColor: const Color(0xFF4E97D1),
        icon: const Icon(Icons.arrow_drop_down, color: Colors.white),
        items: ['Arabic', 'German', 'English', 'Spanish', 'French', 'Swahili']
            .map((lang) => DropdownMenuItem(
                  value: lang,
                  child: Text(lang, style: const TextStyle(color: Colors.white, fontSize: 13)),
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