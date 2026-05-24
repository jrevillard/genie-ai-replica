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
