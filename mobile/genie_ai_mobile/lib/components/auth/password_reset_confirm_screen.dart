import 'package:flutter/material.dart';
import 'package:genie_ai_mobile/services/password_proxy.dart';

class PasswordResetConfirmScreen extends StatefulWidget {
  final String token;
  const PasswordResetConfirmScreen({super.key, required this.token});

  @override
  State<PasswordResetConfirmScreen> createState() => _PasswordResetConfirmScreenState();
}

class _PasswordResetConfirmScreenState extends State<PasswordResetConfirmScreen> {
  final _password = TextEditingController();
  final _confirm = TextEditingController();
  bool _isLoading = false;
  bool _success = false;

  Future<void> _handleReset() async {
    if (_password.text != _confirm.text) return;
    setState(() => _isLoading = true);
    try {
      // Calls POST auth/reset-password/confirm
      await PasswordProxy().resetPassword(widget.token, _password.text);
      setState(() => _success = true);
      Future.delayed(const Duration(seconds: 3), () {
        Navigator.pushNamedAndRemoveUntil(context, '/login', (route) => false);
      });
    } catch (e) {
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text("Reset failed: $e")));
    } finally {
      setState(() => _isLoading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_success) return _buildSuccessView();

    return Scaffold(
      appBar: AppBar(title: Text("Set New Password")),
      body: Padding(
        padding: const EdgeInsets.all(24.0),
        child: Column(children: [
          const Text("Please enter your new password below."),
          const SizedBox(height: 24),
          TextField(controller: _password, obscureText: true, decoration: const InputDecoration(labelText: "New Password")),
          const SizedBox(height: 16),
          TextField(controller: _confirm, obscureText: true, decoration: const InputDecoration(labelText: "Confirm Password")),
          const SizedBox(height: 32),
          ElevatedButton(
            onPressed: _isLoading ? null : _handleReset,
            child: const Text("Reset Password"),
          ),
        ]),
      ),
    );
  }

  Widget _buildSuccessView() {
    return const Scaffold(
      body: Center(
        child: Column(mainAxisAlignment: MainAxisAlignment.center, children: [
          Icon(Icons.check_circle, size: 80, color: Colors.green),
          Text("Success!", style: TextStyle(fontSize: 24, fontWeight: FontWeight.bold)),
          Text("Redirecting to login..."),
        ]),
      ),
    );
  }
}