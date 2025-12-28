import 'package:flutter/material.dart';
import 'package:genie_ai_mobile/services/user_service.dart';
import 'package:genie_ai_mobile/services/password_proxy.dart';
import 'package:genie_ai_mobile/components/shared/language_selector.dart';
import 'package:genie_ai_mobile/utils/theme_manager.dart';

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
  bool _acceptTerms = false;
  bool _isLoading = false;
  String? _userErr, _emailErr;
  Map<String, dynamic> _strength = {'score': 0, 'isValid': false};

  Future<void> _checkAvailability(String type, String val) async {
    if (val.length < 3) return;
    final svc = UserService();
    if (type == 'username') {
      final ok = await svc.checkUsernameAvailability(val);
      setState(() => _userErr = ok ? null : "Username already exists");
    } else {
      final ok = await svc.checkEmailAvailability(val);
      setState(() => _emailErr = ok ? null : "Email already registered");
    }
  }

  Future<void> _handleRegister() async {
    if (!_formKey.currentState!.validate() || !_acceptTerms) return;
    setState(() => _isLoading = true);
    try {
      await UserService().register({
        'loginName': _username.text,
        'email': _email.text,
        'password': _password.text,
      });
      Navigator.pushReplacementNamed(context, '/registration-success',
          arguments: _email.text);
    } catch (e) {
      ScaffoldMessenger.of(context)
          .showSnackBar(SnackBar(content: Text(e.toString())));
    } finally {
      setState(() => _isLoading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final colors = ThemeManager().getColors();
    final isDark = ThemeManager().isDarkMode;

    return Scaffold(
      backgroundColor: colors['background'],
      body: Center(
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(24.0),
          child: Container(
            constraints: const BoxConstraints(maxWidth: 400),
            padding: const EdgeInsets.all(24),
            decoration: BoxDecoration(
              color: colors['surface'],
              borderRadius: BorderRadius.circular(16),
              boxShadow: [
                BoxShadow(
                    color: Colors.black.withOpacity(0.1),
                    blurRadius: 10,
                    offset: const Offset(0, 4))
              ],
            ),
            child: Form(
              key: _formKey,
              child: Column(children: [
                _buildHeader(colors),
                _buildField(_username, "Username", Icons.person, colors, isDark,
                    err: _userErr,
                    onChange: (v) => _checkAvailability('username', v)),
                _buildField(_email, "Email", Icons.email, colors, isDark,
                    err: _emailErr,
                    onChange: (v) => _checkAvailability('email', v)),
                _buildField(_password, "Password", Icons.lock, colors, isDark,
                    obscure: true,
                    onChange: (v) => setState(() => _strength =
                        PasswordProxy().validatePasswordStrength(v))),
                _buildStrengthBar(),
                _buildField(_confirm, "Confirm Password", Icons.lock_outline,
                    colors, isDark,
                    obscure: true),
                _buildTerms(colors, isDark),
                _buildRegisterButton(colors),
                _buildLoginLink(colors, isDark),
                const SizedBox(height: 20),
                LanguageSelector(textColor: colors['text']),
              ]),
            ),
          ),
        ),
      ),
    );
  }

  Widget _buildHeader(Map<String, dynamic> colors) {
    return Column(children: [
      Icon(Icons.person_add, color: colors['primary'], size: 50),
      const SizedBox(height: 10),
      Text("Create Account",
          style: TextStyle(
              fontSize: 22,
              fontWeight: FontWeight.bold,
              color: colors['text'])),
      const SizedBox(height: 20),
    ]);
  }

  Widget _buildField(TextEditingController ctrl, String label, IconData icon,
      Map<String, dynamic> colors, bool isDark,
      {bool obscure = false, String? err, Function(String)? onChange}) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: TextFormField(
        controller: ctrl,
        obscureText: obscure,
        onChanged: onChange,
        style: TextStyle(color: colors['text'], fontSize: 14),
        decoration: InputDecoration(
          labelText: label,
          labelStyle: TextStyle(
              color: isDark ? Colors.grey[400] : Colors.grey[600]),
          errorText: err,
          prefixIcon: Icon(icon, size: 20, color: isDark ? Colors.grey[500] : Colors.grey[600]),
          filled: true,
          fillColor: isDark
              ? Colors.white.withOpacity(0.05)
              : const Color(0xFFF0F2F5),
          border: OutlineInputBorder(
              borderRadius: BorderRadius.circular(8),
              borderSide: BorderSide.none),
        ),
        validator: (v) => v!.isEmpty ? "Required" : null,
      ),
    );
  }

  Widget _buildStrengthBar() {
    final score = _strength['score'] ?? 0;
    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: LinearProgressIndicator(
          value: score / 4.0,
          backgroundColor: Colors.grey[300],
          color: score < 2
              ? Colors.red
              : (score < 3 ? Colors.orange : Colors.green)),
    );
  }

  Widget _buildTerms(Map<String, dynamic> colors, bool isDark) {
    return CheckboxListTile(
      value: _acceptTerms,
      onChanged: (v) => setState(() => _acceptTerms = v!),
      title: Text("I accept the Terms of Service",
          style: TextStyle(
              fontSize: 13,
              color: isDark ? Colors.grey[400] : Colors.grey[700])),
      controlAffinity: ListTileControlAffinity.leading,
      activeColor: colors['primary'],
      contentPadding: EdgeInsets.zero,
      side: BorderSide(color: colors['text'].withOpacity(0.6)),
    );
  }

  Widget _buildRegisterButton(Map<String, dynamic> colors) {
    return ElevatedButton(
      style: ElevatedButton.styleFrom(
          backgroundColor: colors['primary'],
          minimumSize: const Size(double.infinity, 45),
          shape:
              RoundedRectangleBorder(borderRadius: BorderRadius.circular(8))),
      onPressed: _isLoading || !_acceptTerms ? null : _handleRegister,
      child: _isLoading
          ? const CircularProgressIndicator(color: Colors.white)
          : const Text("Register",
              style:
                  TextStyle(color: Colors.white, fontWeight: FontWeight.bold)),
    );
  }

  Widget _buildLoginLink(Map<String, dynamic> colors, bool isDark) {
    return Padding(
        padding: const EdgeInsets.only(top: 16),
        child: Row(mainAxisAlignment: MainAxisAlignment.center, children: [
          Text("Already have an account? ",
              style: TextStyle(
                  color: isDark ? Colors.grey[400] : Colors.grey[700])),
          GestureDetector(
              onTap: () => Navigator.pop(context),
              child: Text("Login now",
                  style: TextStyle(
                      color: colors['primary'], fontWeight: FontWeight.bold))),
        ]));
  }
}