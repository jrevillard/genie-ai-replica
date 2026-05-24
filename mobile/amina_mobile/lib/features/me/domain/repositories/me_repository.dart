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
