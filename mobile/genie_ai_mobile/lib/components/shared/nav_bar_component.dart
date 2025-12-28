import 'package:flutter/material.dart';
import 'package:genie_ai_mobile/components/shared/language_selector.dart';
import 'package:genie_ai_mobile/components/settings/settings_component.dart';
import 'package:genie_ai_mobile/components/user/user_profile_component.dart';

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
    return AppBar(
      // Gradient background matching the web UI
      flexibleSpace: Container(
        decoration: const BoxDecoration(
          gradient: LinearGradient(
            colors: [Color(0xFF4E97D1), Color(0xFF2C5F8A)],
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
            icon: const Icon(Icons.menu, color: Colors.white),
            tooltip: 'Open sidebar',
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
      title: const Row(
        children: [
          Icon(Icons.auto_awesome, color: Colors.white, size: 24),
          SizedBox(width: 8),
          Text(
            "GENIE.AI",
            style: TextStyle(
              color: Colors.white,
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
              icon: const Icon(Icons.description_outlined, color: Colors.white),
              tooltip: "Related Documents",
              onPressed: () {
                Scaffold.of(context).openEndDrawer();
              },
            ),
          ),

        // Settings Button
        IconButton(
          icon: const Icon(Icons.settings_outlined, color: Colors.white),
          tooltip: "Settings",
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
      icon: const Icon(Icons.person_outline, color: Colors.white),
      tooltip: "Profile",
      onPressed: () => Navigator.push(
        context,
        MaterialPageRoute(builder: (_) => UserProfileScreen(user: user)),
      ),
    ),

        // Logout Button
        IconButton(
          icon: const Icon(Icons.logout, color: Colors.white),
          tooltip: "Logout",
          onPressed: onLogout,
        ),
        const SizedBox(width: 4),
      ],
    );
  }
}
