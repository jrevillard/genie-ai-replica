import 'package:flutter/material.dart';
import 'package:genie_ai_mobile/components/shared/language_selector.dart';
import 'package:genie_ai_mobile/components/settings/settings_component.dart'; // REQUIRED IMPORT

class NavBarComponent extends StatelessWidget {
  final Map<String, dynamic> user;
  final VoidCallback onLogout;

  const NavBarComponent({
    super.key,
    required this.user,
    required this.onLogout,
  });

  @override
  Widget build(BuildContext context) {
    // Standardizing role check from nested user objects
    final dynamic roleValue = user['role'] ?? (user['user'] != null ? user['user']['role'] : '');
    final bool isAdmin = roleValue.toString().toLowerCase() == 'admin';

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
      // Open SideBar (Drawer)
      leading: IconButton(
        icon: const Icon(Icons.menu, color: Colors.white),
        onPressed: () => Scaffold.of(context).openDrawer(),
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
        const Padding(
          padding: EdgeInsets.only(right: 8),
          child: Row(
            children: [
              CircleAvatar(radius: 4, backgroundColor: Colors.orange),
              SizedBox(width: 4),
              Text("Issues", style: TextStyle(color: Colors.white70, fontSize: 10)),
            ],
          ),
        ),
        
        // Language Selector
        const LanguageSelector(),

        // Analytics: Disabled if not Admin
        IconButton(
          icon: const Icon(Icons.analytics_outlined),
          color: isAdmin ? Colors.white : Colors.white24,
          tooltip: isAdmin ? "Analytics" : "Access Restricted",
          onPressed: isAdmin ? () => Navigator.pushNamed(context, '/analytics') : null,
        ),

        // Admin: Disabled if not Admin
        IconButton(
          icon: const Icon(Icons.admin_panel_settings_outlined),
          color: isAdmin ? Colors.white : Colors.white24,
          tooltip: isAdmin ? "Administration" : "Access Restricted",
          onPressed: isAdmin ? () => Navigator.pushNamed(context, '/admin') : null,
        ),

        // Settings Button - FIXED: Calling SettingsComponent instead of placeholder
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
                // Pass the current user object so Settings can fetch the profile
                child: SettingsComponent(user: user), 
              ),
            );
          },
        ),

        // Profile Button
        IconButton(
          icon: const Icon(Icons.person_outline, color: Colors.white),
          tooltip: "Profile",
          onPressed: () => Navigator.pushNamed(context, '/profile'),
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