import 'dart:async';
import 'package:flutter/material.dart';
import 'package:genie_ai_mobile/services/user_service.dart';
import 'package:genie_ai_mobile/services/password_proxy.dart';

class RegisterScreen extends StatefulWidget {
  const RegisterScreen({super.key});
  @override
  State<RegisterScreen> createState() => _RegisterScreenState();
}

class _RegisterScreenState extends State<RegisterScreen> {
  final _formKey = GlobalKey<FormState>();
  final _username = TextEditingController();
  final _email = TextEditingController();
  final _password = TextEditingController();
  final _confirm = TextEditingController();
  
  String? _usernameError;
  String? _emailError;
  bool _isLoading = false;
  Map<String, dynamic> _passwordStrength = {'isValid': false, 'score': 0};

  // Availability check logic
  Future<void> _checkAvailability(String type, String value) async {
    if (value.isEmpty) return;
    final userService = UserService();
    if (type == 'username') {
      final available = await userService.checkUsernameAvailability(value);
      setState(() => _usernameError = available ? null : "Username already taken");
    } else {
      final available = await userService.checkEmailAvailability(value);
      setState(() => _emailError = available ? null : "Email already registered");
    }
  }

  Future<void> _handleRegister() async {
    if (!_formKey.currentState!.validate() || _usernameError != null || _emailError != null) return;
    setState(() => _isLoading = true);
    try {
      await UserService().register({
        'loginName': _username.text,
        'email': _email.text,
        'password': _password.text,
      }); //
      Navigator.pushReplacementNamed(context, '/registration-success');
    } catch (e) {
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text("Error: $e")));
    } finally {
      setState(() => _isLoading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: Text("Create Account")),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(24),
        child: Form(
          key: _formKey,
          child: Column(children: [
            const Icon(Icons.person_add, size: 64, color: Color(0xFF4A7EBB)),
            const SizedBox(height: 24),
            TextFormField(
              controller: _username,
              decoration: InputDecoration(labelText: "Username", errorText: _usernameError),
              onChanged: (v) => _checkAvailability('username', v), //
            ),
            const SizedBox(height: 16),
            TextFormField(
              controller: _email,
              decoration: InputDecoration(labelText: "Email", errorText: _emailError),
              onChanged: (v) => _checkAvailability('email', v), //
            ),
            const SizedBox(height: 16),
            TextFormField(
              controller: _password,
              obscureText: true,
              decoration: const InputDecoration(labelText: "Password"),
              onChanged: (v) => setState(() => _passwordStrength = PasswordProxy().validatePasswordStrength(v)), //
            ),
            _buildStrengthBar(), // Visual 0-4 score bar
            const SizedBox(height: 16),
            TextFormField(
              controller: _confirm,
              obscureText: true,
              decoration: const InputDecoration(labelText: "Confirm Password"),
              validator: (v) => v != _password.text ? "Passwords do not match" : null, //
            ),
            const SizedBox(height: 32),
            ElevatedButton(
              onPressed: _isLoading ? null : _handleRegister,
              child: _isLoading ? const CircularProgressIndicator() : const Text("Register"),
            ),
          ]),
        ),
      ),
    );
  }

  Widget _buildStrengthBar() {
    final score = _passwordStrength['score'] ?? 0;
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 8),
      child: LinearProgressIndicator(
        value: score / 4.0,
        backgroundColor: Colors.grey[200],
        color: score < 2 ? Colors.red : (score < 3 ? Colors.orange : Colors.green),
      ),
    );
  }
}