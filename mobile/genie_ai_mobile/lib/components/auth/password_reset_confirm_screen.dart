import 'package:flutter/material.dart';
import 'package:genie_ai_mobile/services/password_proxy.dart';
import 'package:genie_ai_mobile/utils/theme_manager.dart';
import 'package:genie_ai_mobile/services/i18n_service.dart'; // IMPORTED I18N

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
    if (_password.text != _confirm.text) {
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(
          content: Text(tr('passwordResetConfirm.passwordsDoNotMatch'))));
      return;
    }
    setState(() => _isLoading = true);
    try {
      await PasswordProxy().resetPassword(widget.token, _password.text);
      setState(() => _success = true);
      Future.delayed(const Duration(seconds: 3), () {
        Navigator.pushNamedAndRemoveUntil(context, '/login', (route) => false);
      });
    } catch (e) {
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(
          content: Text("${tr('passwordResetConfirm.resetFailed')}: $e")));
    } finally {
      setState(() => _isLoading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final colors = ThemeManager().getColors();
    final isDark = ThemeManager().isDarkMode;

    if (_success) return _buildSuccessView(colors);

    return Scaffold(
      backgroundColor: colors['background'],
      appBar: AppBar(
        title: Text(tr('passwordResetConfirm.resetPassword')),
        backgroundColor: colors['background'],
        elevation: 0,
        iconTheme: IconThemeData(color: colors['text']),
        titleTextStyle: TextStyle(
            color: colors['text'], fontSize: 20, fontWeight: FontWeight.bold),
      ),
      body: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(children: [
          _buildTextField(_password,
              tr('passwordResetConfirm.newPasswordLabel'), colors, isDark),
          const SizedBox(height: 16),
          _buildTextField(
              _confirm,
              tr('passwordResetConfirm.confirmNewPasswordLabel'),
              colors,
              isDark),
          const SizedBox(height: 24),
          ElevatedButton(
            style: ElevatedButton.styleFrom(
              backgroundColor: colors['primary'],
              foregroundColor: Colors.white,
              minimumSize: const Size(double.infinity, 45),
            ),
            onPressed: _isLoading ? null : _handleReset,
            child: Text(tr('passwordResetConfirm.resetButton')),
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
          Text(tr('passwordResetConfirm.resetSuccess'),
              style: TextStyle(
                  fontSize: 24,
                  fontWeight: FontWeight.bold,
                  color: colors['text'])),
          const SizedBox(height: 8),
          Text(tr('passwordResetConfirm.redirecting'),
              style: TextStyle(color: colors['text'])),
        ]),
      ),
    );
  }
}
