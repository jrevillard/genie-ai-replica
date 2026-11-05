/// Lets an unawaited preference write land before the storage is inspected
/// or replaced. The mock store the tests install serves every read
/// asynchronously, so a write issued fire-and-forget (changeLanguage,
/// ThemeManager.setTheme) needs one event-loop turn to land — clearing the
/// storage before that would seed the next test instead.
Future<void> settlePreferenceWrites() =>
    Future<void>.delayed(const Duration(milliseconds: 20));
