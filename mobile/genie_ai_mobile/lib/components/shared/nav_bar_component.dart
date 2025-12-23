import 'package:flutter/material.dart';

class NavBarComponent extends StatelessWidget {
  final Map<String, dynamic> user;
  final VoidCallback onLogout;
  const NavBarComponent({super.key, required this.user, required this.onLogout});

  @override
  Widget build(BuildContext context) {
    // Admin check from user object
    bool isAdmin = (user['role'] ?? user['user']?['role']) == 'admin';

    return AppBar(
      backgroundColor: const Color(0xFF4E97D1),
      title: const Text("GENIE.AI", style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold)),
      iconTheme: const IconThemeData(color: Colors.white),
      actions: [
        const Padding(
          padding: EdgeInsets.symmetric(horizontal: 8.0),
          child: CircleAvatar(radius: 5, backgroundColor: Colors.orange), // "Some Issues" status
        ),
        if (isAdmin) IconButton(icon: const Icon(Icons.admin_panel_settings), onPressed: () {}),
        IconButton(icon: const Icon(Icons.logout), onPressed: onLogout),
      ],
    );
  }
}