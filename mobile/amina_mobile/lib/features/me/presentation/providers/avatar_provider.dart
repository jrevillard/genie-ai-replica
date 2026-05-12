import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../domain/entities/avatar.dart';

export '../../domain/entities/avatar.dart';

// ─── Notifier ─────────────────────────────────────────────────────────────────

class AvatarNotifier extends StateNotifier<AvatarState> {
  AvatarNotifier() : super(const AvatarState());

  void selectPreset(int index) =>
      state = AvatarState(selectedIndex: index);

  void setCustomPhoto(String filePath) =>
      state = AvatarState(selectedIndex: -1, customPhotoPath: filePath);

  void clearAll() =>
      state = const AvatarState();
}

// ─── Provider ─────────────────────────────────────────────────────────────────

final avatarProvider =
    StateNotifierProvider<AvatarNotifier, AvatarState>(
  (ref) => AvatarNotifier(),
);
