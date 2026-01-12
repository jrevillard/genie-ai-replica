import 'package:flutter/foundation.dart'; // For kIsWeb
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
  final bool showRightDrawerButton;

  const NavBarComponent({
    super.key,
    required this.user,
    required this.onLogout,
    this.showRightDrawerButton = false,
  });

  void _handleConnectivityToggle(BuildContext context, bool isOnline) {
    final newState = ConnectivityService().toggleUserOfflineMode();
    final message =
        newState ? "Switched to Offline Mode" : "Switched to Online Mode";

    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(message),
        duration: const Duration(seconds: 2),
        backgroundColor: newState ? Colors.grey[700] : Colors.green[700],
      ),
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
          padding: const EdgeInsets.symmetric(horizontal: 16.0),
          child: Row(
            children: [
              // 1. LOGO
              SizedBox(
                width: 32,
                height: 32,
                child: GenieAiConfig.iconPath.toLowerCase().endsWith('.svg')
                    ? SvgPicture.asset(GenieAiConfig.iconPath,
                        fit: BoxFit.contain)
                    : Image.asset(GenieAiConfig.iconPath, fit: BoxFit.contain),
              ),
              const SizedBox(width: 12),

              // 2. TITLE
              Text(
                GenieAiConfig.title,
                style: TextStyle(
                  color: contentColor,
                  fontWeight: FontWeight.w900, // Extra Bold
                  fontSize: 22,
                  letterSpacing: 1.5,
                ),
              ),

              const Spacer(),

              // 3. CONNECTIVITY (Small Dot/Icon)
              StreamBuilder<bool>(
                stream: ConnectivityService().isOnlineStream,
                initialData: ConnectivityService().isOnline,
                builder: (context, snapshot) {
                  final isOnline = snapshot.data ?? false;
                  return IconButton(
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
                icon: Icon(Icons.logout, color: contentColor),
                tooltip: tr('nav.logout'),
                onPressed: onLogout,
              ),

              // 5. MORE MENU (Replaces separate Settings/Profile buttons)
              PopupMenuButton<String>(
                icon: Icon(Icons.more_vert, color: contentColor),
                tooltip: "More",
                onSelected: (value) {
                  switch (value) {
                    case 'profile':
                      Navigator.push(
                        context,
                        MaterialPageRoute(
                            builder: (_) => UserProfileScreen(user: user)),
                      );
                      break;
                    case 'settings':
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
                      break;
                  }
                },
                itemBuilder: (BuildContext context) => <PopupMenuEntry<String>>[
                  const PopupMenuItem<String>(
                    value: 'profile',
                    child: ListTile(
                      leading: Icon(Icons.person_outline),
                      title: Text('Profile'),
                      contentPadding: EdgeInsets.zero,
                      dense: true,
                    ),
                  ),
                  const PopupMenuItem<String>(
                    value: 'settings',
                    child: ListTile(
                      leading: Icon(Icons.settings_outlined),
                      title: Text('Settings'),
                      contentPadding: EdgeInsets.zero,
                      dense: true,
                    ),
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }
}
