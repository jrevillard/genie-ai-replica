import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../domain/entities/app_settings.dart';
import '../../domain/entities/avatar.dart';
import '../../domain/entities/hospital_stock.dart';
import '../../domain/entities/notification_settings.dart';
import '../../domain/entities/user_game_stats.dart';
import '../../domain/repositories/me_repository.dart';
import '../models/gamification_model.dart';

// ─── In-memory implementation ─────────────────────────────────────────────────

class MeRepositoryImpl implements MeRepository {
  // ── Gamification ──────────────────────────────────────────────────────────

  @override
  Future<UserGameStats> getUserGameStats() async => kMockUserStats;

  // ── Stock ─────────────────────────────────────────────────────────────────

  @override
  Future<Map<String, HospitalStock>> getStockData() async =>
      _buildMockStock();

  // ── Settings ──────────────────────────────────────────────────────────────

  @override
  Future<AppSettingsState> getAppSettings() async =>
      const AppSettingsState();

  @override
  Future<void> saveAppSettings(AppSettingsState settings) async {}

  // ── Notification settings ─────────────────────────────────────────────────

  @override
  Future<NotificationSettingsState> getNotificationSettings() async =>
      NotificationSettingsState.initial();

  @override
  Future<void> saveNotificationSettings(
      NotificationSettingsState settings) async {}

  // ── Avatar ────────────────────────────────────────────────────────────────

  @override
  Future<AvatarState> getAvatarState() async => const AvatarState();

  @override
  Future<void> saveAvatarState(AvatarState avatar) async {}
}

// ─── Provider ─────────────────────────────────────────────────────────────────

final meRepositoryProvider = Provider<MeRepository>(
  (_) => MeRepositoryImpl(),
);

// ─── Mock stock data ──────────────────────────────────────────────────────────

Map<String, HospitalStock> _buildMockStock() {
  final now = DateTime.now();
  return {
    'metformin': HospitalStock(
      status:       StockStatus.inStock,
      hospitalName: 'City General Hospital',
      lastSyncedAt: now.subtract(const Duration(minutes: 42)),
    ),
    'aspirin': HospitalStock(
      status:       StockStatus.inStock,
      hospitalName: 'City General Hospital',
      lastSyncedAt: now.subtract(const Duration(minutes: 55)),
    ),
    'omeprazole': HospitalStock(
      status:       StockStatus.inStock,
      hospitalName: 'Riverside Health Clinic',
      lastSyncedAt: now.subtract(const Duration(hours: 1)),
    ),
    'losartan': HospitalStock(
      status:       StockStatus.inStock,
      hospitalName: "St. Mary's Medical Center",
      lastSyncedAt: now.subtract(const Duration(hours: 2)),
    ),
    'lisinopril': HospitalStock(
      status:         StockStatus.lowStock,
      hospitalName:   "St. Mary's Medical Center",
      unitsRemaining: 12,
      lastSyncedAt:   now.subtract(const Duration(hours: 1, minutes: 15)),
    ),
    'amlodipine': HospitalStock(
      status:         StockStatus.lowStock,
      hospitalName:   'Riverside Health Clinic',
      unitsRemaining: 5,
      lastSyncedAt:   now.subtract(const Duration(hours: 3)),
    ),
    'glibenclamide': HospitalStock(
      status:         StockStatus.lowStock,
      hospitalName:   'City General Hospital',
      unitsRemaining: 8,
      lastSyncedAt:   now.subtract(const Duration(minutes: 30)),
    ),
    'atorvastatin': HospitalStock(
      status:       StockStatus.outOfStock,
      hospitalName: 'Riverside Health Clinic',
      lastSyncedAt: now.subtract(const Duration(hours: 5)),
    ),
    'simvastatin': HospitalStock(
      status:       StockStatus.outOfStock,
      hospitalName: "St. Mary's Medical Center",
      lastSyncedAt: now.subtract(const Duration(hours: 4)),
    ),
  };
}
