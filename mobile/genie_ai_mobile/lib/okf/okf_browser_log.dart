// lib/okf/okf_browser_log.dart — the concept browser's ONE Talker. The
// /simplify review found the screen and the controller each building a
// bare instance per route/app-lifetime, every one keeping an in-memory
// history nothing reads (these classes only console-log). One shared
// instance, history off.
import 'package:talker/talker.dart';

final Talker okfBrowserLog = Talker(
  settings: TalkerSettings(useHistory: false),
);
