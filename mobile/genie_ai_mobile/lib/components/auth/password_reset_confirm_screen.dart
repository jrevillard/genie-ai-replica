import 'package:flutter/material.dart';
import 'package:genie_ai_mobile/services/password_proxy.dart';
import 'package:genie_ai_mobile/utils/theme_manager.dart';

class PasswordResetConfirmScreen extends StatefulWidget {
  final String token;
  const PasswordResetConfirmScreen({super.key, required this.token});

  @override
  State<PasswordResetConfirmScreen> createState() =>
      _PasswordResetConfirmScreenState();
}

class _PasswordResetConfirmScreenState
    extends State<PasswordResetConfirmScreen> {
  final _password = TextEditingController();
  final _confirm = TextEditingController();
  bool _isLoading = false;
  bool _success = false;

  Future<void> _handleReset() async {
    if (_password.text != _confirm.text) return;
    setState(() => _isLoading = true);
    try {
      await PasswordProxy().resetPassword(widget.token, _password.text);
      setState(() => _success = true);
      Future.delayed(const Duration(seconds: 3), () {
        Navigator.pushNamedAndRemoveUntil(context, '/login', (route) => false);
      });
    } catch (e) {
      ScaffoldMessenger.of(context)
          .showSnackBar(SnackBar(content: Text("Reset failed: $e")));
    } finally {
      setState(() => _isLoading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    // Dynamic Colors from ThemeManager
    final colors = ThemeManager().getColors();
    final isDark = ThemeManager().isDarkMode;

    if (_success) return _buildSuccessView(colors);

    return Scaffold(
      backgroundColor: colors['background'],
      appBar: AppBar(
        title: const Text("Set New Password"),
        backgroundColor: colors['primary'],
        foregroundColor: Colors.white,
      ),
      body: Padding(
        padding: const EdgeInsets.all(24.0),
        child: Column(children: [
          Text("Please enter your new password below.",
              style: TextStyle(color: colors['text'])),
          const SizedBox(height: 24),
          _buildTextField(_password, "New Password", colors, isDark),
          const SizedBox(height: 16),
          _buildTextField(_confirm, "Confirm Password", colors, isDark),
          const SizedBox(height: 32),
          ElevatedButton(
            style: ElevatedButton.styleFrom(
              backgroundColor: colors['primary'],
              foregroundColor: Colors.white,
              minimumSize: const Size(double.infinity, 45),
            ),
            onPressed: _isLoading ? null : _handleReset,
            child: const Text("Reset Password"),
          ),
        ]),
      ),
    );
  }

  Widget _buildTextField(TextEditingController ctrl, String label,
      Map<String, dynamic> colors, bool isDark) {
    return TextField(
      controller: ctrl,
      obscureText: true,
      style: TextStyle(color: colors['text']),
      decoration: InputDecoration(
        labelText: label,
        labelStyle:
            TextStyle(color: isDark ? Colors.grey[400] : Colors.grey[600]),
        filled: true,
        fillColor: isDark ? Colors.white.withOpacity(0.05) : Colors.grey[100],
        border: OutlineInputBorder(borderRadius: BorderRadius.circular(8)),
      ),
    );
  }

  Widget _buildSuccessView(Map<String, dynamic> colors) {
    return Scaffold(
      backgroundColor: colors['background'],
      body: Center(
        child: Column(mainAxisAlignment: MainAxisAlignment.center, children: [
          const Icon(Icons.check_circle, size: 80, color: Colors.green),
          const SizedBox(height: 16),
          Text("Success!",
              style: TextStyle(
                  fontSize: 24,
                  fontWeight: FontWeight.bold,
                  color: colors['text'])),
          const SizedBox(height: 8),
          Text("Redirecting to login...",
              style: TextStyle(color: colors['text'])),
        ]),
      ),
    );
  }
}
