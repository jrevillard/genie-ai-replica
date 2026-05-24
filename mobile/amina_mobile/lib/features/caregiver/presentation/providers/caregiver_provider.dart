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
import '../../data/repositories/bantaba_repository_impl.dart';
import '../../data/repositories/caregiver_list_repository_impl.dart';
import '../../data/repositories/caregiver_directory_repository_impl.dart';
import '../../domain/entities/assigned_caregiver.dart';
import '../../domain/entities/bantaba_circle.dart';
import '../../domain/entities/caregiver_directory_entry.dart';
import '../../domain/repositories/bantaba_repository.dart';
import '../../domain/repositories/caregiver_directory_repository.dart';

// ─── Connection mode ──────────────────────────────────────────────────────────

enum CaregiverMode { family, professional }

final caregiverModeProvider =
    StateProvider<CaregiverMode>((ref) => CaregiverMode.family);

// ═══════════════════════════════════════════════════════════════════════════════
// FAMILY SIDE
// ═══════════════════════════════════════════════════════════════════════════════

class ConnectedMember {
  final String id;
  final String name;
  final String relationship;
  final String avatar;
  final String lastSeen;
  final bool   isOnline;

  const ConnectedMember({
    required this.id,
    required this.name,
    required this.relationship,
    required this.avatar,
    required this.lastSeen,
    required this.isOnline,
  });
}

enum ConnectStatus { idle, loading, success, error }

class FamilyState {
  final String                myCode;
  final List<String>          enteredDigits; // 6 entries, '' = unfilled
  final List<ConnectedMember> members;
  final ConnectStatus         status;
  final String?               errorMsg;

  const FamilyState({
    required this.myCode,
    required this.enteredDigits,
    required this.members,
    this.status   = ConnectStatus.idle,
    this.errorMsg,
  });

  bool   get isComplete => enteredDigits.every((d) => d.isNotEmpty);
  String get joinedCode => enteredDigits.join();

  FamilyState copyWith({
    List<String>?          enteredDigits,
    List<ConnectedMember>? members,
    ConnectStatus?         status,
    String?                errorMsg,
    bool                   clearError = false,
  }) =>
      FamilyState(
        myCode:        myCode,
        enteredDigits: enteredDigits ?? this.enteredDigits,
        members:       members       ?? this.members,
        status:        status        ?? this.status,
        errorMsg:      clearError ? null : (errorMsg ?? this.errorMsg),
      );
}

class FamilyNotifier extends StateNotifier<FamilyState> {
  FamilyNotifier()
      : super(FamilyState(
          myCode:        _makeCode(),
          enteredDigits: List.filled(6, ''),
          members:       _kMockMembers,
        ));

  static String _makeCode() {
    final n = DateTime.now().millisecondsSinceEpoch % 900000 + 100000;
    return n.toString();
  }

  void setDigit(int i, String d) {
    final digits = [...state.enteredDigits];
    digits[i] = d.isEmpty ? '' : d[d.length - 1];
    state = state.copyWith(
      enteredDigits: digits,
      status:        ConnectStatus.idle,
      clearError:    true,
    );
  }

  void setAllDigits(String code) {
    final clean  = code.replaceAll(RegExp(r'[^0-9]'), '');
    final capped = clean.length > 6 ? clean.substring(0, 6) : clean;
    final digits = List.generate(6, (i) => i < capped.length ? capped[i] : '');
    state = state.copyWith(
      enteredDigits: digits,
      status:        ConnectStatus.idle,
      clearError:    true,
    );
  }

  void clearEntry() => state = state.copyWith(
        enteredDigits: List.filled(6, ''),
        status:        ConnectStatus.idle,
        clearError:    true,
      );

  Future<void> connect() async {
    if (!state.isComplete) return;
    state = state.copyWith(status: ConnectStatus.loading);
    await Future<void>.delayed(const Duration(seconds: 2));
    // Demo: code '123456' always succeeds; any other code shows an error.
    if (state.joinedCode == '123456') {
      const newMember = ConnectedMember(
        id:           'new',
        name:         'New Family Member',
        relationship: 'Family',
        avatar:       '🧑',
        lastSeen:     'Just connected',
        isOnline:     true,
      );
      state = state.copyWith(
        status:  ConnectStatus.success,
        members: [...state.members, newMember],
      );
    } else {
      state = state.copyWith(
        status:   ConnectStatus.error,
        errorMsg: 'Code not found. Please check and try again.',
      );
    }
  }

  void removeMember(String id) => state = state.copyWith(
        members: state.members.where((m) => m.id != id).toList(),
      );
}

final familyProvider =
    StateNotifierProvider<FamilyNotifier, FamilyState>(
  (ref) => FamilyNotifier(),
);

// ═══════════════════════════════════════════════════════════════════════════════
// PROFESSIONAL SIDE — real API
// ═══════════════════════════════════════════════════════════════════════════════

final proSearchQueryProvider = StateProvider<String>((ref) => '');

final assignedCaregiversProvider =
    FutureProvider<List<AssignedCaregiver>>((ref) async {
  await Future<void>.delayed(Duration.zero);
  return ref.read(caregiverListRepositoryProvider).listCaregivers();
});

final caregiverDirectoryProvider =
    FutureProvider<List<CaregiverDirectoryEntry>>((ref) async {
  await Future<void>.delayed(Duration.zero);
  return ref.read(caregiverDirectoryRepositoryProvider).listDirectory();
});

final filteredDirectoryProvider =
    Provider<AsyncValue<List<CaregiverDirectoryEntry>>>((ref) {
  final query = ref.watch(proSearchQueryProvider).toLowerCase().trim();
  return ref.watch(caregiverDirectoryProvider).whenData((list) {
    if (query.isEmpty) return list;
    return list
        .where((c) =>
            c.name.toLowerCase().contains(query) ||
            c.specialization.toLowerCase().contains(query) ||
            c.specialtyTags.any((t) => t.toLowerCase().contains(query)))
        .toList();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// ADD MEMBER REQUEST
// ═══════════════════════════════════════════════════════════════════════════════

class AddMemberState {
  final String        candidateAminaId;
  final String        relation;
  final ConnectStatus status;
  final String?       errorMsg;

  const AddMemberState({
    this.candidateAminaId = '',
    this.relation         = '',
    this.status           = ConnectStatus.idle,
    this.errorMsg,
  });

  bool get isComplete =>
      candidateAminaId.trim().isNotEmpty && relation.isNotEmpty;

  AddMemberState copyWith({
    String?        candidateAminaId,
    String?        relation,
    ConnectStatus? status,
    String?        errorMsg,
    bool           clearError = false,
  }) =>
      AddMemberState(
        candidateAminaId: candidateAminaId ?? this.candidateAminaId,
        relation:         relation         ?? this.relation,
        status:           status           ?? this.status,
        errorMsg:         clearError ? null : (errorMsg ?? this.errorMsg),
      );
}

class AddMemberNotifier extends StateNotifier<AddMemberState> {
  AddMemberNotifier(this._repo) : super(const AddMemberState());

  final BantabaRepository _repo;

  void setAminaId(String v)  => state = state.copyWith(candidateAminaId: v, clearError: true);
  void setRelation(String v) => state = state.copyWith(relation: v, clearError: true);
  void reset()               => state = const AddMemberState();

  Future<void> submit() async {
    if (!state.isComplete) return;
    state = state.copyWith(status: ConnectStatus.loading);
    try {
      await _repo.requestAddMemberById(
        candidateAminaId: state.candidateAminaId.trim(),
        relation:         state.relation,
      );
      state = state.copyWith(status: ConnectStatus.success);
    } catch (e) {
      state = state.copyWith(
        status:   ConnectStatus.error,
        errorMsg: e.toString().replaceFirst('Exception: ', ''),
      );
    }
  }
}

final addMemberProvider =
    StateNotifierProvider<AddMemberNotifier, AddMemberState>(
  (ref) => AddMemberNotifier(ref.read(bantabaRepositoryProvider)),
);

// ═══════════════════════════════════════════════════════════════════════════════
// CAREGIVER APPLICATION (directory → apply)
// ═══════════════════════════════════════════════════════════════════════════════

class ApplyCgState {
  final ConnectStatus status;
  final String?       errorMsg;
  final String?       appId;

  const ApplyCgState({
    this.status   = ConnectStatus.idle,
    this.errorMsg,
    this.appId,
  });

  ApplyCgState copyWith({
    ConnectStatus? status,
    String?        errorMsg,
    String?        appId,
    bool           clearError = false,
  }) =>
      ApplyCgState(
        status:   status   ?? this.status,
        errorMsg: clearError ? null : (errorMsg ?? this.errorMsg),
        appId:    appId    ?? this.appId,
      );
}

class ApplyCgNotifier extends StateNotifier<ApplyCgState> {
  ApplyCgNotifier(this._repo) : super(const ApplyCgState());

  final CaregiverDirectoryRepository _repo;

  void reset() => state = const ApplyCgState();

  Future<void> submit({
    required String       caregiverId,
    required String       primaryConcern,
    required List<String> healthConditions,
    required List<String> currentMedications,
    required String       preferredContact,
    required String       emergencyContactName,
    required String       emergencyContactPhone,
    required String       additionalNotes,
    required String       patientFullName,
    required int          patientAge,
    required String       patientGender,
    required String       patientRegion,
  }) async {
    state = state.copyWith(status: ConnectStatus.loading, clearError: true);
    try {
      final appId = await _repo.applyToCaregiver(
        caregiverId:           caregiverId,
        primaryConcern:        primaryConcern,
        healthConditions:      healthConditions,
        currentMedications:    currentMedications,
        preferredContact:      preferredContact,
        emergencyContactName:  emergencyContactName,
        emergencyContactPhone: emergencyContactPhone,
        additionalNotes:       additionalNotes,
        patientFullName:       patientFullName,
        patientAge:            patientAge,
        patientGender:         patientGender,
        patientRegion:         patientRegion,
      );
      state = state.copyWith(status: ConnectStatus.success, appId: appId);
    } catch (e) {
      state = state.copyWith(
        status:   ConnectStatus.error,
        errorMsg: e.toString().replaceFirst('Exception: ', ''),
      );
    }
  }
}

final applyCgProvider =
    StateNotifierProvider.autoDispose<ApplyCgNotifier, ApplyCgState>(
  (ref) => ApplyCgNotifier(ref.read(caregiverDirectoryRepositoryProvider)),
);

// ═══════════════════════════════════════════════════════════════════════════════
// BANTABA CIRCLE — real API
// ═══════════════════════════════════════════════════════════════════════════════

final bantabaCircleProvider = FutureProvider<BantabaCircle>((ref) async {
  await Future<void>.delayed(Duration.zero);
  return ref.read(bantabaRepositoryProvider).getMyCircle();
});

// ─── Crash-safe init guard ────────────────────────────────────────────────────
// CaregiverScreen sits inside an IndexedStack. Yielding to the event loop
// prevents any compositing-heavy widgets from painting on frame 1 before the
// RenderObject has been laid out by the engine.

final caregiverReadyProvider = FutureProvider<bool>((ref) async {
  await Future<void>.delayed(Duration.zero);
  return true;
});

// ═══════════════════════════════════════════════════════════════════════════════
// MOCK DATA
// ═══════════════════════════════════════════════════════════════════════════════

const _kMockMembers = [
  ConnectedMember(
    id:           '1',
    name:         'Maria Sow',
    relationship: 'Daughter',
    avatar:       '👩',
    lastSeen:     'Active now',
    isOnline:     true,
  ),
  ConnectedMember(
    id:           '2',
    name:         'Carlos Sow',
    relationship: 'Son',
    avatar:       '👨',
    lastSeen:     '2 hours ago',
    isOnline:     false,
  ),
];
