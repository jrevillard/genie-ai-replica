// This file is part of Amina Care.
//
// Amina Care is free software: you can redistribute it and/or modify
// it under the terms of the GNU Lesser General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// Amina Care is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
// GNU Lesser General Public License for more details.
//
// You should have received a copy of the GNU Lesser General Public License
// along with Amina Care. If not, see <https://www.gnu.org/licenses/>.

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
