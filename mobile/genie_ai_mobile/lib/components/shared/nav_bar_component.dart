import 'package:flutter/material.dart';
import 'package:flutter_svg/flutter_svg.dart';
import 'package:genie_ai_mobile/components/settings/settings_component.dart';
import 'package:genie_ai_mobile/components/user/user_profile_component.dart';
import 'package:genie_ai_mobile/design_system/tokens/spacing.dart';
import 'package:genie_ai_mobile/design_system/components/ds_button.dart';
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

  // FIX: Made async because toggleUserOfflineMode returns Future<bool>
  Future<void> _handleConnectivityToggle(
    BuildContext context,
    bool isOnline,
  ) async {
    final bool newState = await ConnectivityService().toggleUserOfflineMode();
    final message = newState
        ? "Switched to Offline Mode"
        : "Switched to Online Mode";
    final tokens = ThemeManager().tokens;

    if (context.mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(message),
          duration: const Duration(seconds: 2),
          backgroundColor: newState ? tokens.muted : tokens.success,
        ),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    final tokens = ThemeManager().tokens;
    final Color contentColor = tokens.navbarFg;

    return Material(
      elevation: 4,
      child: Container(
        height: 60,
        decoration: BoxDecoration(color: tokens.navbarBg),
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: DsSpacing.md),
          child: Row(
            children: [
              // 1. LOGO
              SizedBox(
                width: 32,
                height: 32,
                child: GenieAiConfig.iconPath.toLowerCase().endsWith('.svg')
                    ? SvgPicture.asset(
                        GenieAiConfig.iconPath,
                        fit: BoxFit.contain,
                      )
                    : Image.asset(GenieAiConfig.iconPath, fit: BoxFit.contain),
              ),
              const SizedBox(width: DsSpacing.md),

              // 2. TITLE
              Text(
                GenieAiConfig.title,
                style: TextStyle(
                  color: contentColor,
                  fontWeight: FontWeight.w900, // Extra Bold
                  fontSize: ThemeManager().tokens.textLg,
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
                  return Tooltip(
                    message: isOnline ? "Online" : "Offline",
                    child: DsButton(
                      iconOnly: true,
                      icon: isOnline ? Icons.wifi : Icons.cloud_off,
                      variant: DsButtonVariant.ghost,
                      overrideFg: isOnline ? contentColor : tokens.fg30,
                      onPressed: () =>
                          _handleConnectivityToggle(context, isOnline),
                    ),
                  );
                },
              ),

              // 4. LOGOUT
              Tooltip(
                message: tr('nav.logout'),
                child: DsButton(
                  key: const Key('navbar_logout_button'),
                  iconOnly: true,
                  icon: Icons.logout,
                  variant: DsButtonVariant.ghost,
                  overrideFg: contentColor,
                  onPressed: onLogout,
                ),
              ),

              // 5. MORE MENU (Replaces separate Settings/Profile buttons)
              // Wrapped in StreamBuilder to reactively disable Profile when Offline
              StreamBuilder<bool>(
                stream: ConnectivityService().isOnlineStream,
                initialData: ConnectivityService().isOnline,
                builder: (context, snapshot) {
                  final bool isOnline = snapshot.data ?? false;

                  return PopupMenuButton<String>(
                    key: const Key('navbar_more_button'),
                    icon: Icon(Icons.more_vert, color: contentColor),
                    tooltip: "More",
                    onSelected: (value) {
                      switch (value) {
                        case 'profile':
                          Navigator.push(
                            context,
                            MaterialPageRoute(
                              builder: (_) => UserProfileScreen(user: user),
                            ),
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
                    itemBuilder: (BuildContext context) =>
                        <PopupMenuEntry<String>>[
                          PopupMenuItem<String>(
                            value: 'profile',
                            enabled: isOnline, // DISABLE PROFILE IF OFFLINE
                            child: ListTile(
                              leading: Icon(
                                Icons.person_outline,
                                color: isOnline ? tokens.fg : tokens.muted,
                              ),
                              title: Text(
                                'Profile',
                                style: TextStyle(
                                  color: isOnline ? tokens.fg : tokens.muted,
                                ),
                              ),
                              contentPadding: EdgeInsets.zero,
                              dense: true,
                            ),
                          ),
                          PopupMenuItem<String>(
                            value: 'settings',
                            child: ListTile(
                              leading: Icon(
                                Icons.settings_outlined,
                                color: tokens.fg,
                              ),
                              title: Text(
                                'Settings',
                                style: TextStyle(color: tokens.fg),
                              ),
                              contentPadding: EdgeInsets.zero,
                              dense: true,
                            ),
                          ),
                        ],
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
