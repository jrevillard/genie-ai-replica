import 'package:flutter/material.dart';

class RegistrationSuccessScreen extends StatelessWidget {
  const RegistrationSuccessScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final email = ModalRoute.of(context)!.settings.arguments as String? ?? 'your email';
    const color = Color(0xFF2A9D8F);

    return Scaffold(
      body: Center(
        child: Padding(
          padding: const EdgeInsets.all(32.0),
          child: Column(mainAxisAlignment: MainAxisAlignment.center, children: [
            const Icon(Icons.check_circle_outline, color: Colors.green, size: 100),
            const SizedBox(height: 24),
            const Text("Welcome to GENIE.AI!", style: TextStyle(fontSize: 26, fontWeight: FontWeight.bold)),
            const SizedBox(height: 16),
            Text("A verification email has been sent to $email.", textAlign: TextAlign.center, style: const TextStyle(fontSize: 16)),
            const SizedBox(height: 40),
            ElevatedButton(
              style: ElevatedButton.styleFrom(backgroundColor: color, minimumSize: const Size(200, 50)),
              onPressed: () => Navigator.pushReplacementNamed(context, '/login'), //
              child: const Text("Go to Login", style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold)),
            ),
          ]),
        ),
      ),
    );
  }
}