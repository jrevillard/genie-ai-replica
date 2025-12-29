import 'package:flutter/material.dart';
import 'package:genie_ai_mobile/components/shared/language_selector.dart';
import 'package:genie_ai_mobile/components/settings/settings_component.dart';
import 'package:genie_ai_mobile/components/user/user_profile_component.dart';
import 'package:genie_ai_mobile/utils/theme_manager.dart';
import 'package:genie_ai_mobile/services/i18n_service.dart'; // IMPORTED I18N

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

  @override
  Widget build(BuildContext context) {
    // Retrieve dynamic navbar configuration from ThemeManager
    final Map<String, dynamic> themeColors = ThemeManager().getColors();
    final Map<String, dynamic> navColors = themeColors['navbar'];
    final bool isDark = ThemeManager().isDarkMode;

    // Override gradient for Dark Mode to a dark gray look
    final Color gradientStart = isDark
        ? const Color(0xFF212121) // Dark Grey
        : navColors['gradientStart'];

    final Color gradientEnd = isDark
        ? const Color(0xFF303030) // Slightly lighter Dark Grey
        : navColors['gradientEnd'];

    final Color contentColor = navColors['text'];

    return AppBar(
      // Gradient background matching the web UI
      flexibleSpace: Container(
        decoration: BoxDecoration(
          gradient: LinearGradient(
            colors: [gradientStart, gradientEnd],
            begin: Alignment.topLeft,
            end: Alignment.bottomRight,
          ),
        ),
      ),
      elevation: 4,
      // Open Left SideBar (Drawer)
      leading: Builder(
        builder: (BuildContext drawerContext) {
          return IconButton(
            icon: Icon(Icons.menu, color: contentColor),
            tooltip: tr('nav.toggleSidebar'), // TRANSLATED
            onPressed: () {
              debugPrint("[NAVBAR] Hamburger button pressed!");

              final scaffold = Scaffold.of(drawerContext);
              if (scaffold.hasDrawer) {
                debugPrint("[NAVBAR] Scaffold has drawer — opening it now");
                scaffold.openDrawer();
              } else {
                debugPrint("[NAVBAR] ERROR: Scaffold does NOT have a drawer!");
                debugPrint(
                    "[NAVBAR] Current screen width: ${MediaQuery.of(drawerContext).size.width}");
                debugPrint(
                    "[NAVBAR] isWideScreen likely true — drawer disabled on large screens");
              }
            },
          );
        },
      ),
      titleSpacing: 0,
      title: Row(
        children: [
          Icon(Icons.auto_awesome, color: contentColor, size: 24),
          const SizedBox(width: 8),
          Text(
            tr('brandName'), // TRANSLATED (Genie AI...)
            style: TextStyle(
              color: contentColor,
              fontWeight: FontWeight.bold,
              fontSize: 18,
            ),
          ),
        ],
      ),
      actions: [
        // System Status Indicator
        //const Padding(
        //  padding: EdgeInsets.only(right: 8),
        //  child: Row(
        //    children: [
        //      CircleAvatar(radius: 4, backgroundColor: Colors.orange),
        //      SizedBox(width: 4),
        //      Text("Issues",
        //          style: TextStyle(color: Colors.white70, fontSize: 10)),
        //    ],
        //  ),
        //),

        // Language Selector
        // const LanguageSelector(),

        // Right drawer button (Related Documents) – only on mobile/tablet
        if (showRightDrawerButton)
          Builder(
            builder: (context) => IconButton(
              icon: Icon(Icons.description_outlined, color: contentColor),
              tooltip: tr('nav.relatedDocuments'), // TRANSLATED
              onPressed: () {
                Scaffold.of(context).openEndDrawer();
              },
            ),
          ),

        // Settings Button
        IconButton(
          icon: Icon(Icons.settings_outlined, color: contentColor),
          tooltip: tr('nav.settings'), // TRANSLATED
          onPressed: () {
            showModalBottomSheet(
              context: context,
              isScrollControlled: true,
              useSafeArea: true,
              backgroundColor: Colors.transparent,
              builder: (context) => FractionallySizedBox(
                heightFactor: 0.9,
                child: SettingsComponent(user: user),
              ),
            );
          },
        ),

        // Profile Button
        IconButton(
          icon: Icon(Icons.person_outline, color: contentColor),
          tooltip: tr('nav.userProfile'), // TRANSLATED
          onPressed: () => Navigator.push(
            context,
            MaterialPageRoute(builder: (_) => UserProfileScreen(user: user)),
          ),
        ),

        // Logout Button
        IconButton(
          icon: Icon(Icons.logout, color: contentColor),
          tooltip: tr('nav.logout'), // TRANSLATED
          onPressed: onLogout,
        ),
        const SizedBox(width: 4),
      ],
    );
  }
}
