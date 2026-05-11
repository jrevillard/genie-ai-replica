// For kIsWeb
import 'package:flutter/material.dart';
import 'package:flutter_svg/flutter_svg.dart';
import 'package:genie_ai_mobile/components/settings/settings_component.dart';
import 'package:genie_ai_mobile/components/user/user_profile_component.dart';
import 'package:genie_ai_mobile/utils/theme_manager.dart';
import 'package:genie_ai_mobile/services/i18n_service.dart';
import 'package:genie_ai_mobile/services/genie_ai_config.dart';
import 'package:genie_ai_mobile/services/connectivity_service.dart';

class NavBarComponent extends StatelessWidget {
  final Map<String, dynamic> user;
  final VoidCallback onLogout;
  final VoidCallback? onHomeTap;
  final bool showRightDrawerButton;

  const NavBarComponent({
    super.key,
    required this.user,
    required this.onLogout,
    this.onHomeTap,
    this.showRightDrawerButton = false,
  });

  // FIX: Made async because toggleUserOfflineMode returns Future<bool>
  Future<void> _handleConnectivityToggle(
    BuildContext context,
    bool isOnline,
  ) async {
    final bool newState = await ConnectivityService().toggleUserOfflineMode();
    final message = newState
        ? "Switched to Offline Mode"
        : "Switched to Online Mode";

    // Check mounted mostly for safety, though Stateless usually fine for SnackBar if context valid
    if (context.mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(message),
          duration: const Duration(seconds: 2),
          backgroundColor: newState ? Colors.grey[700] : Colors.green[700],
        ),
      );
    }
  }

  void _openProfile(BuildContext context) {
    Navigator.push(
      context,
      MaterialPageRoute(builder: (_) => UserProfileScreen(user: user)),
    );
  }

  void _openSettings(BuildContext context) {
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      backgroundColor: Colors.transparent,
      builder: (ctx) => FractionallySizedBox(
        heightFactor: 0.9,
        child: SettingsComponent(user: user),
      ),
    );
  }

  void _showMoreMenu(BuildContext context, bool isOnline) {
    showModalBottomSheet<void>(
      context: context,
      useSafeArea: true,
      showDragHandle: true,
      builder: (sheetContext) {
        return SafeArea(
          child: Padding(
            padding: const EdgeInsets.only(bottom: 12),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                ListTile(
                  enabled: isOnline,
                  leading: Icon(
                    Icons.person_outline,
                    color: isOnline ? null : Colors.grey,
                  ),
                  title: Text(
                    'Profile',
                    style: TextStyle(color: isOnline ? null : Colors.grey),
                  ),
                  onTap: isOnline
                      ? () {
                          Navigator.pop(sheetContext);
                          _openProfile(context);
                        }
                      : null,
                ),
                ListTile(
                  leading: const Icon(Icons.settings_outlined),
                  title: const Text('Settings'),
                  onTap: () {
                    Navigator.pop(sheetContext);
                    _openSettings(context);
                  },
                ),
              ],
            ),
          ),
        );
      },
    );
  }

  @override
  Widget build(BuildContext context) {
    final Map<String, dynamic> themeColors = ThemeManager().getColors();
    final Map<String, dynamic> navColors = themeColors['navbar'];
    final bool isDark = ThemeManager().isDarkMode;
    final Color contentColor = navColors['text'];

    return Material(
      elevation: 4,
      child: Container(
        height: 60,
        decoration: BoxDecoration(
          gradient: LinearGradient(
            colors: [
              isDark ? const Color(0xFF212121) : navColors['gradientStart'],
              isDark ? const Color(0xFF303030) : navColors['gradientEnd'],
            ],
            begin: Alignment.topLeft,
            end: Alignment.bottomRight,
          ),
        ),
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 12.0),
          child: Row(
            children: [
              // 1. BRAND / HOME
              Expanded(
                child: InkWell(
                  borderRadius: BorderRadius.circular(8),
                  onTap: onHomeTap,
                  child: Padding(
                    padding: const EdgeInsets.symmetric(vertical: 8),
                    child: Row(
                      children: [
                        SizedBox(
                          width: 32,
                          height: 32,
                          child:
                              GenieAiConfig.iconPath.toLowerCase().endsWith(
                                '.svg',
                              )
                              ? SvgPicture.asset(
                                  GenieAiConfig.iconPath,
                                  fit: BoxFit.contain,
                                )
                              : Image.asset(
                                  GenieAiConfig.iconPath,
                                  fit: BoxFit.contain,
                                ),
                        ),
                        const SizedBox(width: 12),
                        Expanded(
                          child: FittedBox(
                            fit: BoxFit.scaleDown,
                            alignment: Alignment.centerLeft,
                            child: Text(
                              GenieAiConfig.title,
                              maxLines: 1,
                              softWrap: false,
                              style: TextStyle(
                                color: contentColor,
                                fontWeight: FontWeight.w900, // Extra Bold
                                fontSize: 20,
                                letterSpacing: 0,
                              ),
                            ),
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
              ),

              const SizedBox(width: 8),

              // 3. CONNECTIVITY (Small Dot/Icon)
              StreamBuilder<bool>(
                stream: ConnectivityService().isOnlineStream,
                initialData: ConnectivityService().isOnline,
                builder: (context, snapshot) {
                  final isOnline = snapshot.data ?? false;
                  return IconButton(
                    visualDensity: VisualDensity.compact,
                    padding: EdgeInsets.zero,
                    constraints: const BoxConstraints.tightFor(
                      width: 40,
                      height: 40,
                    ),
                    icon: Icon(
                      isOnline ? Icons.wifi : Icons.cloud_off,
                      color: isOnline ? contentColor : Colors.white38,
                      size: 20,
                    ),
                    tooltip: isOnline ? "Online" : "Offline",
                    onPressed: () =>
                        _handleConnectivityToggle(context, isOnline),
                  );
                },
              ),

              // 4. LOGOUT
              IconButton(
                visualDensity: VisualDensity.compact,
                padding: EdgeInsets.zero,
                constraints: const BoxConstraints.tightFor(
                  width: 40,
                  height: 40,
                ),
                icon: Icon(Icons.logout, color: contentColor),
                tooltip: tr('nav.logout'),
                onPressed: onLogout,
              ),

              // 5. MORE MENU (Replaces separate Settings/Profile buttons)
              // Wrapped in StreamBuilder to reactively disable Profile when Offline
              StreamBuilder<bool>(
                stream: ConnectivityService().isOnlineStream,
                initialData: ConnectivityService().isOnline,
                builder: (context, snapshot) {
                  final bool isOnline = snapshot.data ?? false;

                  return IconButton(
                    visualDensity: VisualDensity.compact,
                    padding: EdgeInsets.zero,
                    constraints: const BoxConstraints.tightFor(
                      width: 40,
                      height: 40,
                    ),
                    icon: Icon(Icons.more_vert, color: contentColor),
                    tooltip: "More",
                    onPressed: () => _showMoreMenu(context, isOnline),
                  );
                },
              ),
            ],
          ),
        ),
      ),
    );
  }
}
