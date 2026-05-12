import 'package:flutter_riverpod/flutter_riverpod.dart';

/// Set to true by the Dio interceptor when the backend returns 401.
/// The app root listens to this and forces a logout + redirect to login.
final sessionExpiredProvider = StateProvider<bool>((ref) => false);
