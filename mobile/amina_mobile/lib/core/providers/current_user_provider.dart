import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../features/auth/presentation/providers/auth_provider.dart';

final currentUserIdProvider = Provider<String>((ref) {
  return ref.watch(authProvider).user?.id ?? 'anonymous';
});
