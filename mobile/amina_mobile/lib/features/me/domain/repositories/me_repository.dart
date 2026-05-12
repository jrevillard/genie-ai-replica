import '../entities/app_settings.dart';
import '../entities/avatar.dart';
import '../entities/hospital_stock.dart';
import '../entities/notification_settings.dart';
import '../entities/user_game_stats.dart';

abstract class MeRepository {
  Future<UserGameStats>              getUserGameStats();
  Future<Map<String, HospitalStock>> getStockData();

  Future<AppSettingsState>          getAppSettings();
  Future<void>                      saveAppSettings(AppSettingsState settings);

  Future<NotificationSettingsState> getNotificationSettings();
  Future<void>                      saveNotificationSettings(NotificationSettingsState settings);

  Future<AvatarState> getAvatarState();
  Future<void>        saveAvatarState(AvatarState avatar);
}
