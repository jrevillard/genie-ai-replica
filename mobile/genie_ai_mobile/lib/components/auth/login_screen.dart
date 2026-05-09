import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:genie_ai_mobile/services/user_service.dart';
import 'package:genie_ai_mobile/components/shared/language_selector.dart';
import 'package:genie_ai_mobile/utils/theme_manager.dart';
import 'package:genie_ai_mobile/services/i18n_service.dart';
import 'package:genie_ai_mobile/services/genie_ai_config.dart';
import 'package:flutter_svg/flutter_svg.dart';

class LoginScreen extends StatefulWidget {
  final Function(Map<String, dynamic>) onLoginSuccess;
  const LoginScreen({super.key, required this.onLoginSuccess});

  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> {
  final _usernameController = TextEditingController();
  final _passwordController = TextEditingController();
  bool _rememberMe = false;
  bool _isLoading = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    _loadSavedCredentials();
  }

  Future<void> _loadSavedCredentials() async {
    final prefs = await SharedPreferences.getInstance();
    final String? savedLoginName = prefs.getString('savedLoginName');
    final String? savedPassword = prefs.getString('savedPassword');

    if (savedLoginName != null && savedPassword != null) {
      debugPrint('[DEBUG] Retrieved credentials from storage: $savedLoginName');
      setState(() {
        _usernameController.text = savedLoginName;
        _passwordController.text = savedPassword;
        _rememberMe = true;
      });
    } else {
      debugPrint('[DEBUG] No credentials found in storage');
    }
  }

  @override
  void dispose() {
    _usernameController.dispose();
    _passwordController.dispose();
    super.dispose();
  }

  Future<void> _handleRememberMe(String loginName, String password) async {
    final prefs = await SharedPreferences.getInstance();
    if (_rememberMe) {
      debugPrint('[DEBUG] Storing credentials for: $loginName');
      await prefs.setString('savedLoginName', loginName);
      await prefs.setString('savedPassword', password);
    } else {
      debugPrint('[DEBUG] Clearing credentials from storage');
      await prefs.remove('savedLoginName');
      await prefs.remove('savedPassword');
    }
  }

  Future<void> _handleLogin() async {
    if (_usernameController.text.isEmpty || _passwordController.text.isEmpty)
      return;

    setState(() {
      _isLoading = true;
      _error = null;
    });

    try {
      final user = await UserService()
          .login(_usernameController.text, _passwordController.text);

      await _handleRememberMe(
          _usernameController.text, _passwordController.text);

      widget.onLoginSuccess(user);

      // Pop all routes and return to home after successful login
      if (mounted) {
        Navigator.of(context).popUntil((route) => route.isFirst);
      }
    } catch (e) {
      setState(() => _error = tr('login.loginError'));
    } finally {
      setState(() => _isLoading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final colors = ThemeManager().getColors();
    final isDark = ThemeManager().isDarkMode;

    // [MODIFIED] Wrapped Scaffold in FutureBuilder to load Config
    return FutureBuilder(
        future: GenieAiConfig.load(),
        builder: (context, snapshot) {
          // Show loading spinner while config is being read
          if (!GenieAiConfig.isLoaded &&
              snapshot.connectionState != ConnectionState.done) {
            return Scaffold(
                backgroundColor: colors['background'],
                body: const Center(child: CircularProgressIndicator()));
          }

          return Scaffold(
            backgroundColor: colors['background'],
            body: Center(
              child: SingleChildScrollView(
                padding: const EdgeInsets.all(16.0),
                child: Container(
                  constraints: const BoxConstraints(maxWidth: 400),
                  padding: const EdgeInsets.all(24.0),
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
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      _buildHeader(colors, isDark),
                      if (_error != null) _buildError(),
                      _buildField(_usernameController, tr('login.username'),
                          Icons.person, colors, isDark),
                      const SizedBox(height: 10),
                      _buildField(_passwordController, tr('login.password'),
                          Icons.lock, colors, isDark,
                          obscure: true),
                      _buildRememberForgot(colors, isDark),
                      _buildLoginButton(colors),
                      _buildRegisterLink(colors, isDark),
                      _buildDivider(isDark),
                      _buildSocialButtons(colors, isDark),
                      const SizedBox(height: 24),
                      LanguageSelector(textColor: colors['text']),
                    ],
                  ),
                ),
              ),
            ),
          );
        });
  }

  Widget _buildHeader(Map<String, dynamic> colors, bool isDark) {
    return Column(children: [
      // [MODIFIED] Replaced hardcoded Icon with Dynamic Image from Config
      SizedBox(
        height: 80,
        child: GenieAiConfig.iconPath.toLowerCase().endsWith('.svg')
            ? SvgPicture.asset(
                GenieAiConfig.iconPath,
                height: 80, // Adjust size as needed
                fit: BoxFit.contain,
              )
            : Image.asset(
                GenieAiConfig.iconPath,
                height: 80,
                fit: BoxFit.contain,
                errorBuilder: (context, error, stackTrace) {
                  return const Icon(Icons.error, size: 40);
                },
              ),
      ),
      const SizedBox(height: 20),
      // [MODIFIED] Replaced tr('login.appTitle') with GenieAiConfig.title
      Text(GenieAiConfig.title,
          style: TextStyle(
              fontSize: 28,
              fontWeight: FontWeight.bold,
              color: colors['text'])),
      const SizedBox(height: 20),
    ]);
  }

  Widget _buildField(TextEditingController ctrl, String hint, IconData icon,
      Map<String, dynamic> colors, bool isDark,
      {bool obscure = false}) {
    return TextField(
      controller: ctrl,
      obscureText: obscure,
      style: TextStyle(color: colors['text']),
      decoration: InputDecoration(
        hintText: hint,
        hintStyle:
            TextStyle(color: isDark ? Colors.grey[500] : Colors.grey[600]),
        prefixIcon:
            Icon(icon, color: isDark ? Colors.grey[500] : Colors.grey[600]),
        filled: true,
        fillColor:
            isDark ? Colors.white.withOpacity(0.05) : const Color(0xFFF0F2F5),
        border: OutlineInputBorder(
            borderRadius: BorderRadius.circular(8),
            borderSide: BorderSide.none),
      ),
    );
  }

  Widget _buildRememberForgot(Map<String, dynamic> colors, bool isDark) {
    return Row(mainAxisAlignment: MainAxisAlignment.spaceBetween, children: [
      Row(children: [
        Checkbox(
          value: _rememberMe,
          onChanged: (v) => setState(() => _rememberMe = v!),
          activeColor: colors['primary'],
          side: BorderSide(color: colors['text'].withOpacity(0.6)),
        ),
        Text(tr('login.rememberMe'),
            style: TextStyle(
                fontSize: 13,
                color: isDark ? Colors.grey[400] : Colors.grey[700])),
      ]),
      TextButton(
        onPressed: () => Navigator.pushNamed(context, '/password-reset'),
        child: Text(tr('login.forgotPassword'),
            style: TextStyle(color: colors['primary'], fontSize: 13)),
      ),
    ]);
  }

  Widget _buildLoginButton(Map<String, dynamic> colors) {
    return ElevatedButton(
      style: ElevatedButton.styleFrom(
        backgroundColor: colors['primary'],
        minimumSize: const Size(double.infinity, 45),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
      ),
      onPressed: _isLoading ? null : _handleLogin,
      child: _isLoading
          ? const SizedBox(
              height: 20,
              width: 20,
              child: CircularProgressIndicator(
                  color: Colors.white, strokeWidth: 2))
          : Text(tr('login.loginButton'),
              style: const TextStyle(
                  color: Colors.white, fontWeight: FontWeight.bold)),
    );
  }

  Widget _buildRegisterLink(Map<String, dynamic> colors, bool isDark) {
    return Padding(
      padding: const EdgeInsets.only(top: 12),
      child: Row(mainAxisAlignment: MainAxisAlignment.center, children: [
        Text(tr('login.noAccount') + ' ',
            style: TextStyle(
                fontSize: 14,
                color: isDark ? Colors.grey[400] : Colors.grey[700])),
        GestureDetector(
          onTap: () => Navigator.pushNamed(context, '/register'),
          child: Text(tr('login.registerNow'),
              style: TextStyle(
                  color: colors['primary'],
                  fontWeight: FontWeight.bold,
                  fontSize: 14)),
        ),
      ]),
    );
  }

  Widget _buildDivider(bool isDark) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 16),
      child: Row(children: [
        const Expanded(child: Divider()),
        Padding(
            padding: const EdgeInsets.symmetric(horizontal: 10),
            child: Text(tr('login.or'),
                style: TextStyle(
                    color: isDark ? Colors.grey : Colors.grey[600],
                    fontSize: 12))),
        const Expanded(child: Divider()),
      ]),
    );
  }

  Widget _buildSocialButtons(Map<String, dynamic> colors, bool isDark) {
    return Column(children: [
      _socBtn(tr('login.googleLogin'), Icons.g_mobiledata, colors['primary']),
      const SizedBox(height: 8),
      _socBtn(tr('login.facebookLogin'), Icons.facebook,
          Color.lerp(colors['primary'], Colors.black, 0.2)!),
    ]);
  }

  Widget _socBtn(String text, IconData icon, Color color) {
    return ElevatedButton.icon(
      style: ElevatedButton.styleFrom(
        backgroundColor: color,
        minimumSize: const Size(double.infinity, 40),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
      ),
      onPressed: () {},
      icon: Icon(icon, color: Colors.white),
      label: Text(text, style: const TextStyle(color: Colors.white)),
    );
  }

  Widget _buildError() {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(10),
      margin: const EdgeInsets.only(bottom: 16),
      decoration: BoxDecoration(
          color: Colors.red.withOpacity(0.2),
          borderRadius: BorderRadius.circular(8)),
      child: Text(_error!,
          style: const TextStyle(color: Colors.red, fontSize: 13),
          textAlign: TextAlign.center),
    );
  }
}
