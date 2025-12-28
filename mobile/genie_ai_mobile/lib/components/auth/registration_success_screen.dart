import 'package:flutter/material.dart';
import 'package:genie_ai_mobile/utils/theme_manager.dart';

class RegistrationSuccessScreen extends StatelessWidget {
  const RegistrationSuccessScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final email =
        ModalRoute.of(context)!.settings.arguments as String? ?? 'your email';

    // Dynamic Theme
    final colors = ThemeManager().getColors();

    return Scaffold(
      backgroundColor: colors['background'], // Dynamic Background
      body: Center(
        child: Padding(
          padding: const EdgeInsets.all(32.0),
          child: Column(mainAxisAlignment: MainAxisAlignment.center, children: [
            const Icon(Icons.check_circle_outline,
                color: Colors.green, size: 100),
            const SizedBox(height: 24),
            Text("Welcome to GENIE.AI!",
                style: TextStyle(
                    fontSize: 26,
                    fontWeight: FontWeight.bold,
                    color: colors['text'] // Dynamic Text
                    )),
            const SizedBox(height: 16),
            Text("A verification email has been sent to $email.",
                textAlign: TextAlign.center,
                style: TextStyle(fontSize: 16, color: colors['text'])),
            const SizedBox(height: 40),
            ElevatedButton(
              style: ElevatedButton.styleFrom(
                  backgroundColor: colors['primary'], // Dynamic Primary
                  minimumSize: const Size(200, 50)),
              onPressed: () =>
                  Navigator.pushReplacementNamed(context, '/login'),
              child: const Text("Go to Login",
                  style: TextStyle(
                      color: Colors.white, fontWeight: FontWeight.bold)),
            ),
          ]),
        ),
      ),
    );
  }
}
