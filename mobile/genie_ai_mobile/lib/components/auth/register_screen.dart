import 'package:flutter/material.dart';
import 'package:flutter_svg/flutter_svg.dart'; // IMPORTED SVG
import 'package:genie_ai_mobile/services/user_service.dart';
import 'package:genie_ai_mobile/services/password_proxy.dart';
import 'package:genie_ai_mobile/components/shared/language_selector.dart';
import 'package:genie_ai_mobile/utils/theme_manager.dart';
import 'package:genie_ai_mobile/services/i18n_service.dart';
import 'package:genie_ai_mobile/services/genie_ai_config.dart'; // IMPORTED CONFIG

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
      setState(() => _userErr = ok ? null : tr('register.usernameExists'));
    } else {
      final ok = await svc.checkEmailAvailability(val);
      setState(() => _emailErr = ok ? null : tr('register.emailExists'));
    }
  }

  void _checkPassword(String val) {
    final res = PasswordProxy().validatePasswordStrength(val);
    setState(() => _strength = res);
  }

  Future<void> _handleRegister() async {
    if (!_formKey.currentState!.validate() || !_acceptTerms) {
      if (!_acceptTerms) {
        ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(content: Text(tr('register.mustAcceptTerms'))));
      }
      return;
    }

    setState(() => _isLoading = true);
    final svc = UserService();
    final res = await svc.register({
      'loginName': _username.text,
      'email': _email.text,
      'password': _password.text,
    });

    setState(() => _isLoading = false);
    if (res['success']) {
      Navigator.pushReplacementNamed(context, '/registration-success',
          arguments: _email.text);
    } else {
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(
          content: Text(res['message'] ?? tr('register.registrationFailed'))));
    }
  }

  @override
  void dispose() {
    _username.dispose();
    _email.dispose();
    _password.dispose();
    _confirm.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final colors = ThemeManager().getColors();
    final isDark = ThemeManager().isDarkMode;

    // WRAPPER: Ensures Config is loaded
    return FutureBuilder(
      future: GenieAiConfig.load(),
      builder: (context, snapshot) {
        if (!GenieAiConfig.isLoaded && snapshot.connectionState != ConnectionState.done) {
          return Scaffold(
            backgroundColor: colors['background'],
            body: const Center(child: CircularProgressIndicator()),
          );
        }

        return Scaffold(
          backgroundColor: colors['background'],
          body: Center(
            child: SingleChildScrollView(
              padding: const EdgeInsets.all(24),
              child: Container(
                constraints: const BoxConstraints(maxWidth: 400),
                child: Form(
                  key: _formKey,
                  child: Column(
                    children: [
                      // [ADDED] Dynamic Logo Display
                      SizedBox(
                        height: 80,
                        child: GenieAiConfig.iconPath.toLowerCase().endsWith('.svg')
                            ? SvgPicture.asset(GenieAiConfig.iconPath, fit: BoxFit.contain)
                            : Image.asset(GenieAiConfig.iconPath, fit: BoxFit.contain),
                      ),
                      const SizedBox(height: 24),

                      Text(tr('register.createAccount'),
                          style: TextStyle(
                              fontSize: 28,
                              fontWeight: FontWeight.bold,
                              color: colors['text'])),
                      const SizedBox(height: 24),
                      _buildInput(
                          _username,
                          tr('register.username'),
                          Icons.person,
                          (v) => v!.length < 3
                              ? tr('register.usernameMinLength')
                              : _userErr,
                          (v) => _checkAvailability('username', v),
                          colors,
                          isDark),
                      _buildInput(
                          _email,
                          tr('register.email'),
                          Icons.email,
                          (v) => !v!.contains('@')
                              ? tr('register.invalidEmail')
                              : _emailErr,
                          (v) => _checkAvailability('email', v),
                          colors,
                          isDark),
                      _buildInput(
                          _password,
                          tr('register.password'),
                          Icons.lock,
                          (v) => !_strength['isValid']
                              ? tr('register.passwordRequirements')
                              : null,
                          _checkPassword,
                          colors,
                          isDark,
                          isPass: true),
                      // Strength Meter
                      if (_password.text.isNotEmpty)
                        Padding(
                            padding: const EdgeInsets.only(bottom: 16),
                            child: LinearProgressIndicator(
                                value: _strength['score'] / 4,
                                color: _strength['color'] ?? Colors.red)),
                      _buildInput(
                          _confirm,
                          tr('register.confirmPassword'),
                          Icons.lock_outline,
                          (v) => v != _password.text
                              ? tr('register.passwordsDoNotMatch')
                              : null,
                          null,
                          colors,
                          isDark,
                          isPass: true),
                      _buildTerms(colors),
                      const SizedBox(height: 24),
                      _buildRegisterButton(colors),
                      _buildLoginLink(colors, isDark),
                      const SizedBox(height: 24),
                      Text(tr('register.privacyNotice'),
                          textAlign: TextAlign.center,
                          style: TextStyle(fontSize: 11, color: Colors.grey)),
                      const SizedBox(height: 16),
                      LanguageSelector(textColor: colors['text']),
                    ],
                  ),
                ),
              ),
            ),
          ),
        );
      }
    );
  }

  Widget _buildInput(
      TextEditingController ctrl,
      String label,
      IconData icon,
      String? Function(String?) validator,
      Function(String)? onChanged,
      Map<String, dynamic> colors,
      bool isDark,
      {bool isPass = false}) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 16),
      child: TextFormField(
        controller: ctrl,
        obscureText: isPass,
        style: TextStyle(color: colors['text']),
        onChanged: onChanged,
        validator: validator,
        decoration: InputDecoration(
          labelText: label,
          labelStyle:
              TextStyle(color: isDark ? Colors.grey[400] : Colors.grey[600]),
          prefixIcon: Icon(icon, color: colors['primary']),
          filled: true,
          fillColor: isDark ? Colors.white.withOpacity(0.05) : Colors.grey[100],
          border: OutlineInputBorder(borderRadius: BorderRadius.circular(8)),
        ),
      ),
    );
  }

  Widget _buildTerms(Map<String, dynamic> colors) {
    return CheckboxListTile(
      value: _acceptTerms,
      onChanged: (v) => setState(() => _acceptTerms = v!),
      title: Wrap(children: [
        Text(tr('register.acceptTerms') + ' ',
            style: TextStyle(color: colors['text'], fontSize: 13)),
        Text(tr('register.termsOfService'),
            style: TextStyle(
                color: colors['primary'],
                fontWeight: FontWeight.bold,
                fontSize: 13))
      ]),
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
          : Text(tr('register.registerButton'),
              style: const TextStyle(
                  color: Colors.white, fontWeight: FontWeight.bold)),
    );
  }

  Widget _buildLoginLink(Map<String, dynamic> colors, bool isDark) {
    return Padding(
        padding: const EdgeInsets.only(top: 16),
        child: Row(mainAxisAlignment: MainAxisAlignment.center, children: [
          Text(tr('register.alreadyHaveAccount') + ' ',
              style: TextStyle(
                  color: isDark ? Colors.grey[400] : Colors.grey[700])),
          GestureDetector(
              onTap: () => Navigator.pop(context),
              child: Text(tr('register.loginNow'),
                  style: TextStyle(
                      color: colors['primary'], fontWeight: FontWeight.bold)))
        ]));
  }
}