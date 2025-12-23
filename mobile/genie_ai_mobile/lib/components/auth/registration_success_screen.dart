import 'package:flutter/material.dart';

class RegistrationSuccessScreen extends StatelessWidget {
  const RegistrationSuccessScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: Center(
        child: Padding(
          padding: const EdgeInsets.all(32.0),
          child: Column(mainAxisAlignment: MainAxisAlignment.center, children: [
            const Icon(Icons.celebration, size: 80, color: Color(0xFF4A7EBB)),
            const SizedBox(height: 24),
            const Text("Welcome to GENIE.AI!", style: TextStyle(fontSize: 24, fontWeight: FontWeight.bold)),
            const Text("Your account has been successfully created.", textAlign: TextAlign.center),
            const SizedBox(height: 40),
            ElevatedButton(
              onPressed: () => Navigator.pushReplacementNamed(context, '/login'),
              child: const Text("Go to Login"),
            ),
          ]),
        ),
      ),
    );
  }
}