import 'package:flutter_test/flutter_test.dart';

/// Pumps a bounded number of frames instead of pumpAndSettle: the settings
/// screen's tree never settles in the test environment (the loading
/// spinner's replacement keeps a frame scheduled on every pump), so
/// pumpAndSettle never returns. A fixed frame budget still flushes modal
/// enter/leave animations and the reset's microtasks.
Future<void> pumpFrames(WidgetTester tester, {int frames = 20}) async {
  for (var i = 0; i < frames; i++) {
    await tester.pump(const Duration(milliseconds: 50));
  }
}
