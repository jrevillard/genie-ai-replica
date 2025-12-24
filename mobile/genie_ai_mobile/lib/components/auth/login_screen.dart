import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:genie_ai_mobile/services/user_service.dart';
import 'package:genie_ai_mobile/components/shared/language_selector.dart';
import 'package:genie_ai_mobile/utils/theme_manager.dart';

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
    _loadSavedCredentials(); // Mirrors created() hook in LoginScreen.vue
  }

  /// Replicates the created() logic to fetch credentials from localStorage
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

  /// Replicates handleLogin logic for storing/clearing credentials
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
    if (_usernameController.text.isEmpty || _passwordController.text.isEmpty) return;
    
    setState(() { _isLoading = true; _error = null; });
    
    try {
      final user = await UserService().login(_usernameController.text, _passwordController.text);
      
      // Save or Clear credentials based on checkbox state
      // Note: Using the typed password and the loginName returned/used
      await _handleRememberMe(_usernameController.text, _passwordController.text);
      
      widget.onLoginSuccess(user);
    } catch (e) {
      setState(() => _error = "Invalid credentials or server error");
    } finally {
      setState(() => _isLoading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final isDark = ThemeManager().isDarkMode;
    const accentColor = Color(0xFF2A9D8F); // Matching Vue primary

    return Scaffold(
      backgroundColor: isDark ? const Color(0xFF1E1E1E) : const Color(0xFFF5F7FA),
      body: Center(
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(16.0),
          child: Container(
            constraints: const BoxConstraints(maxWidth: 400),
            padding: const EdgeInsets.all(24.0),
            decoration: BoxDecoration(
              color: isDark ? const Color(0xFF252525) : Colors.white,
              borderRadius: BorderRadius.circular(16),
              boxShadow: [BoxShadow(color: Colors.black.withOpacity(0.2), blurRadius: 10)],
            ),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                _buildHeader(accentColor, isDark),
                if (_error != null) _buildError(),
                _buildField(_usernameController, "Username", Icons.person, isDark),
                const SizedBox(height: 10),
                _buildField(_passwordController, "Password", Icons.lock, isDark, obscure: true),
                _buildRememberForgot(accentColor, isDark),
                _buildLoginButton(accentColor),
                _buildRegisterLink(accentColor, isDark),
                _buildDivider(isDark),
                _buildSocialButtons(accentColor, isDark),
                const SizedBox(height: 24),
                const LanguageSelector(),
              ],
            ),
          ),
        ),
      ),
    );
  }

  Widget _buildHeader(Color color, bool isDark) {
    return Column(children: [
      Container(
        padding: const EdgeInsets.all(12),
        decoration: BoxDecoration(color: color, shape: BoxShape.circle),
        child: const Icon(Icons.auto_awesome, color: Colors.white, size: 40),
      ),
      const SizedBox(height: 10),
      Text("GENIE.AI", style: TextStyle(fontSize: 28, fontWeight: FontWeight.bold, color: isDark ? Colors.white : Colors.black)),
      const SizedBox(height: 20),
    ]);
  }

  Widget _buildField(TextEditingController ctrl, String hint, IconData icon, bool isDark, {bool obscure = false}) {
    return TextField(
      controller: ctrl,
      obscureText: obscure,
      style: TextStyle(color: isDark ? Colors.white : Colors.black),
      decoration: InputDecoration(
        hintText: hint,
        hintStyle: TextStyle(color: isDark ? Colors.grey : Colors.grey[600]),
        prefixIcon: Icon(icon, color: isDark ? Colors.grey : Colors.grey[600]),
        filled: true,
        fillColor: isDark ? const Color(0xFF333333) : const Color(0xFFF0F2F5), //
        border: OutlineInputBorder(borderRadius: BorderRadius.circular(8), borderSide: BorderSide.none),
      ),
    );
  }

  Widget _buildRememberForgot(Color color, bool isDark) {
    return Row(mainAxisAlignment: MainAxisAlignment.spaceBetween, children: [
      Row(children: [
        Checkbox(
          value: _rememberMe, 
          onChanged: (v) => setState(() => _rememberMe = v!),
          activeColor: color,
        ),
        Text("Remember me", style: TextStyle(fontSize: 13, color: isDark ? Colors.grey : Colors.grey[700])),
      ]),
      TextButton(
        onPressed: () => Navigator.pushNamed(context, '/forgot-password'),
        child: Text("Forgot password?", style: TextStyle(color: color, fontSize: 13)),
      ),
    ]);
  }

  Widget _buildLoginButton(Color color) {
    return ElevatedButton(
      style: ElevatedButton.styleFrom(
        backgroundColor: color,
        minimumSize: const Size(double.infinity, 45),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
      ),
      onPressed: _isLoading ? null : _handleLogin,
      child: _isLoading 
        ? const SizedBox(height: 20, width: 20, child: CircularProgressIndicator(color: Colors.white, strokeWidth: 2)) 
        : const Text("Login", style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold)),
    );
  }

  Widget _buildRegisterLink(Color color, bool isDark) {
    return Padding(
      padding: const EdgeInsets.only(top: 12),
      child: Row(mainAxisAlignment: MainAxisAlignment.center, children: [
        Text("No account? ", style: TextStyle(fontSize: 14, color: isDark ? Colors.grey : Colors.grey[700])),
        GestureDetector(
          onTap: () => Navigator.pushNamed(context, '/register'),
          child: Text("Register now", style: TextStyle(color: color, fontWeight: FontWeight.bold, fontSize: 14)),
        ),
      ]),
    );
  }

  Widget _buildDivider(bool isDark) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 16),
      child: Row(children: [
        const Expanded(child: Divider()),
        Padding(padding: const EdgeInsets.symmetric(horizontal: 10), child: Text("OR", style: TextStyle(color: isDark ? Colors.grey : Colors.grey[600], fontSize: 12))),
        const Expanded(child: Divider()),
      ]),
    );
  }

  Widget _buildSocialButtons(Color color, bool isDark) {
    return Column(children: [
      _socBtn("Continue with Google", Icons.g_mobiledata, color),
      const SizedBox(height: 8),
      _socBtn("Continue with Facebook", Icons.facebook, color),
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
      width: double.infinity, padding: const EdgeInsets.all(10), margin: const EdgeInsets.only(bottom: 16),
      decoration: BoxDecoration(color: Colors.red.withOpacity(0.2), borderRadius: BorderRadius.circular(8)),
      child: Text(_error!, style: const TextStyle(color: Colors.red, fontSize: 13), textAlign: TextAlign.center),
    );
  }
}