enum AppLanguage { english, wolof, french }

enum AppFontSize { small, normal, large }

class AppSettingsState {
  final bool        isDarkMode;
  final AppLanguage language;
  final AppFontSize fontSize;

  const AppSettingsState({
    this.isDarkMode = false,
    this.language   = AppLanguage.english,
    this.fontSize   = AppFontSize.normal,
  });

  AppSettingsState copyWith({
    bool?        isDarkMode,
    AppLanguage? language,
    AppFontSize? fontSize,
  }) =>
      AppSettingsState(
        isDarkMode: isDarkMode ?? this.isDarkMode,
        language:   language   ?? this.language,
        fontSize:   fontSize   ?? this.fontSize,
      );

  String get languageLabel => switch (language) {
        AppLanguage.english => 'English',
        AppLanguage.wolof   => 'Wolof',
        AppLanguage.french  => 'French',
      };

  String get fontSizeLabel => switch (fontSize) {
        AppFontSize.small  => 'Small',
        AppFontSize.normal => 'Normal',
        AppFontSize.large  => 'Large',
      };
}
