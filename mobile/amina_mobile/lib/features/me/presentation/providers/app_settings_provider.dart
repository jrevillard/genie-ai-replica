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

import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../domain/entities/app_settings.dart';

export '../../domain/entities/app_settings.dart';

// ─── Notifier ──────────────────────────────────────────────────────────────────

class AppSettingsNotifier extends StateNotifier<AppSettingsState> {
  AppSettingsNotifier() : super(const AppSettingsState());

  void toggleDarkMode() =>
      state = state.copyWith(isDarkMode: !state.isDarkMode);

  void setLanguage(AppLanguage lang) => state = state.copyWith(language: lang);

  void setFontSize(AppFontSize size) => state = state.copyWith(fontSize: size);
}

// ─── Provider ──────────────────────────────────────────────────────────────────

final appSettingsProvider =
    StateNotifierProvider<AppSettingsNotifier, AppSettingsState>(
  (ref) => AppSettingsNotifier(),
);
