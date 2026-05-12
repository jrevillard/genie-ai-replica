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
