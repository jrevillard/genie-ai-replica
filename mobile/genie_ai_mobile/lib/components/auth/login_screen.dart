import 'package:flutter/material.dart';
import 'package:genie_ai_mobile/services/user_service.dart';
import 'package:genie_ai_mobile/components/shared/language_selector.dart';

class LoginScreen extends StatefulWidget {
  final Function(Map<String, dynamic>) onLoginSuccess;
  const LoginScreen({super.key, required this.onLoginSuccess});

  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> {
  final _userController = TextEditingController();
  final _passController = TextEditingController();
  String? _error;
  bool _loading = false;

  Future<void> _handleLogin() async {
    setState(() { _loading = true; _error = null; });
    try {
      final user = await UserService().login(_userController.text, _passController.text);
      widget.onLoginSuccess(user); //
    } catch (e) {
      setState(() => _error = "Invalid credentials");
    } finally {
      setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: Padding(
        padding: const EdgeInsets.all(32.0),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            const Icon(Icons.auto_awesome, size: 80, color: Color(0xFF4E97D1)),
            const Text("GENIE.AI", style: TextStyle(fontSize: 32, fontWeight: FontWeight.bold)),
            if (_error != null) Text(_error!, style: const TextStyle(color: Colors.red)),
            TextField(controller: _userController, decoration: const InputDecoration(hintText: "Username")),
            TextField(controller: _passController, obscureText: true, decoration: const InputDecoration(hintText: "Password")),
            const SizedBox(height: 24),
            ElevatedButton(
              onPressed: _loading ? null : _handleLogin,
              child: _loading ? const CircularProgressIndicator() : const Text("Login"),
            ),
            const LanguageSelector(), //
          ],
        ),
      ),
    );
  }
}