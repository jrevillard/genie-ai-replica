import 'package:flutter_riverpod/flutter_riverpod.dart';

/// Controls the active tab in [MainNavigation].
///
/// Write to this from any screen (e.g. TodayHub's profile icon) to switch
/// tabs without importing [MainNavigation] — avoiding circular imports.
final selectedTabProvider = StateProvider<int>((ref) => 0);
