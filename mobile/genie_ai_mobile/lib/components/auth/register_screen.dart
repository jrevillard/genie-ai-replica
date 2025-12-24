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
      setState(() => _userErr = ok ? null : "Username already exists"); //
    } else {
      final ok = await svc.checkEmailAvailability(val);
      setState(() => _emailErr = ok ? null : "Email already registered"); //
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
      }); //
      Navigator.pushReplacementNamed(context, '/registration-success', arguments: _email.text);
    } catch (e) {
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.toString())));
    } finally {
      setState(() => _isLoading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final isDark = ThemeManager().isDarkMode;
    const accent = Color(0xFF2A9D8F);

    return Scaffold(
      backgroundColor: isDark ? const Color(0xFF1E1E1E) : const Color(0xFFF5F7FA),
      body: Center(
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(24.0),
          child: Container(
            constraints: const BoxConstraints(maxWidth: 400),
            padding: const EdgeInsets.all(24),
            decoration: BoxDecoration(
              color: isDark ? const Color(0xFF252525) : Colors.white,
              borderRadius: BorderRadius.circular(16),
              boxShadow: const [BoxShadow(color: Colors.black12, blurRadius: 10)],
            ),
            child: Form(
              key: _formKey,
              child: Column(children: [
                _buildHeader(accent, isDark),
                _buildField(_username, "Username", Icons.person, isDark, err: _userErr, onChange: (v) => _checkAvailability('username', v)),
                _buildField(_email, "Email", Icons.email, isDark, err: _emailErr, onChange: (v) => _checkAvailability('email', v)),
                _buildField(_password, "Password", Icons.lock, isDark, obscure: true, onChange: (v) => setState(() => _strength = PasswordProxy().validatePasswordStrength(v))),
                _buildStrengthBar(), //
                _buildField(_confirm, "Confirm Password", Icons.lock_outline, isDark, obscure: true),
                _buildTerms(accent, isDark),
                _buildRegisterButton(accent),
                _buildLoginLink(accent, isDark),
                const SizedBox(height: 20),
                const LanguageSelector(),
              ]),
            ),
          ),
        ),
      ),
    );
  }

  Widget _buildHeader(Color color, bool isDark) {
    return Column(children: [
      Icon(Icons.person_add, color: color, size: 50),
      const SizedBox(height: 10),
      Text("Create Account", style: TextStyle(fontSize: 22, fontWeight: FontWeight.bold, color: isDark ? Colors.white : Colors.black)),
      const SizedBox(height: 20),
    ]);
  }

  Widget _buildField(TextEditingController ctrl, String label, IconData icon, bool isDark, {bool obscure = false, String? err, Function(String)? onChange}) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: TextFormField(
        controller: ctrl, obscureText: obscure, onChanged: onChange,
        style: TextStyle(color: isDark ? Colors.white : Colors.black, fontSize: 14),
        decoration: InputDecoration(
          labelText: label, errorText: err, prefixIcon: Icon(icon, size: 20),
          filled: true, fillColor: isDark ? const Color(0xFF333333) : const Color(0xFFF0F2F5),
          border: OutlineInputBorder(borderRadius: BorderRadius.circular(8), borderSide: BorderSide.none),
        ),
        validator: (v) => v!.isEmpty ? "Required" : null,
      ),
    );
  }

  Widget _buildStrengthBar() {
    final score = _strength['score'] ?? 0;
    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: LinearProgressIndicator(value: score / 4.0, backgroundColor: Colors.grey[300], color: score < 2 ? Colors.red : (score < 3 ? Colors.orange : Colors.green)),
    );
  }

  Widget _buildTerms(Color color, bool isDark) {
    return CheckboxListTile(
      value: _acceptTerms, onChanged: (v) => setState(() => _acceptTerms = v!),
      title: Text("I accept the Terms of Service", style: TextStyle(fontSize: 13, color: isDark ? Colors.grey : Colors.grey[700])),
      controlAffinity: ListTileControlAffinity.leading, activeColor: color, contentPadding: EdgeInsets.zero,
    );
  }

  Widget _buildRegisterButton(Color color) {
    return ElevatedButton(
      style: ElevatedButton.styleFrom(backgroundColor: color, minimumSize: const Size(double.infinity, 45), shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8))),
      onPressed: _isLoading || !_acceptTerms ? null : _handleRegister,
      child: _isLoading ? const CircularProgressIndicator(color: Colors.white) : const Text("Register", style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold)),
    );
  }

  Widget _buildLoginLink(Color color, bool isDark) {
    return Padding(padding: const EdgeInsets.only(top: 16), child: Row(mainAxisAlignment: MainAxisAlignment.center, children: [
      Text("Already have an account? ", style: TextStyle(color: isDark ? Colors.grey : Colors.grey[700])),
      GestureDetector(onTap: () => Navigator.pop(context), child: Text("Login now", style: TextStyle(color: color, fontWeight: FontWeight.bold))),
    ]));
  }
}