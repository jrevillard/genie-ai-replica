import 'package:flutter/material.dart';
import 'package:genie_ai_mobile/services/password_proxy.dart';
import 'package:genie_ai_mobile/services/user_service.dart';
import 'package:genie_ai_mobile/components/shared/language_selector.dart';
import 'package:genie_ai_mobile/utils/theme_manager.dart';

class PasswordResetInitiateScreen extends StatefulWidget {
  final bool isEmbedded; // Props from Vue
  final String prefilledEmail;
  final String theme;

  const PasswordResetInitiateScreen({
    super.key,
    this.isEmbedded = false,
    this.prefilledEmail = '',
    this.theme = 'light',
  });

  @override
  State<PasswordResetInitiateScreen> createState() => _PasswordResetInitiateScreenState();
}

class _PasswordResetInitiateScreenState extends State<PasswordResetInitiateScreen> {
  late TextEditingController _emailController;
  String _emailError = "";
  bool _isSubmitting = false;
  bool _resetRequested = false; // Mirrors Vue 'resetRequested'

  @override
  void initState() {
    super.initState();
    _emailController = TextEditingController(text: widget.prefilledEmail);
    _setCurrentUserEmail(); // Replicates setCurrentUserEmail()
  }

  /// Replicates isValidEmail computed property
  bool get _isValidEmail {
    final emailRegex = RegExp(r'^[^\s@]+@[^\s@]+\.[^\s@]+$');
    return emailRegex.hasMatch(_emailController.text);
  }

  /// Replicates setCurrentUserEmail method
  void _setCurrentUserEmail() {
    if (_emailController.text.isEmpty && widget.isEmbedded) {
      // Logic for fetching logged-in user email if resetting from inside the app
      // Assuming UserService().getCurrentUserInfo() exists as per JS code
    }
  }

  /// Replicates handleInitiateReset method
  Future<void> _handleInitiateReset() async {
    setState(() => _emailError = "");
    
    if (!_isValidEmail) {
      setState(() => _emailError = "Invalid email address"); //
      return;
    }

    setState(() => _isSubmitting = true);
    try {
      // Calls POST auth/reset-password as per passwordService.js
      await PasswordProxy().initiateReset(_emailController.text);
      setState(() => _resetRequested = true); //
      
      if (widget.isEmbedded) {
        // Replicates $emit('reset-initiated')
        Future.delayed(const Duration(seconds: 2), () {
          if (mounted) Navigator.of(context).pop(_emailController.text);
        });
      }
    } catch (error) {
      // Even on error, Vue code sets resetRequested to true to avoid email harvesting
      setState(() => _resetRequested = true);
    } finally {
      if (mounted) setState(() => _isSubmitting = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final isDark = ThemeManager().isDarkMode;
    const accentColor = Color(0xFF2A9D8F); // Matching Vue accent color

    return Scaffold(
      backgroundColor: widget.isEmbedded 
          ? Colors.transparent 
          : (isDark ? const Color(0xFF1E1E1E) : const Color(0xFFF5F7FA)), //
      body: Center(
        child: SingleChildScrollView(
          padding: EdgeInsets.all(widget.isEmbedded ? 0 : 16.0),
          child: Container(
            constraints: const BoxConstraints(maxWidth: 400),
            padding: const EdgeInsets.all(24.0),
            decoration: widget.isEmbedded ? null : BoxDecoration(
              color: isDark ? const Color(0xFF252525) : Colors.white, //
              borderRadius: BorderRadius.circular(16),
              boxShadow: [BoxShadow(color: Colors.black.withOpacity(0.3), blurRadius: 10)],
            ),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                _buildHeader(accentColor, isDark),
                const SizedBox(height: 10),
                Text(
                  "Reset Password",
                  style: TextStyle(
                    fontSize: 18, 
                    fontWeight: FontWeight.w500,
                    color: isDark ? const Color(0xFFB3B3B3) : const Color(0xFF4D4D4D)
                  ),
                ),
                const SizedBox(height: 20),

                if (_resetRequested) _buildSuccessView(accentColor)
                else _buildFormView(accentColor, isDark),

                _buildFooter(accentColor),
                if (widget.isEmbedded) _buildCancelButton(accentColor),
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
        width: 60, height: 60,
        decoration: BoxDecoration(color: color, shape: BoxShape.circle),
        child: const Icon(Icons.auto_awesome, color: Colors.white, size: 30), // App icon fallback
      ),
      const SizedBox(height: 10),
      Text(
        "GENIE.AI",
        style: TextStyle(fontSize: 28, fontWeight: FontWeight.bold, color: isDark ? Colors.white : Colors.black),
      ),
    ]);
  }

  Widget _buildFormView(Color color, bool isDark) {
    return Column(children: [
      Align(
        alignment: Alignment.centerLeft,
        child: Text(
          "Email Address",
          style: TextStyle(fontSize: 14, fontWeight: FontWeight.w500, color: isDark ? Colors.white : Colors.black),
        ),
      ),
      const SizedBox(height: 6),
      TextField(
        controller: _emailController,
        keyboardType: TextInputType.emailAddress,
        onChanged: (_) => setState(() {}),
        decoration: InputDecoration(
          hintText: "Enter your email",
          filled: true,
          fillColor: isDark ? const Color(0xFF333333) : const Color(0xFFF0F2F5), //
          border: OutlineInputBorder(borderRadius: BorderRadius.circular(8), borderSide: BorderSide.none),
          errorText: _emailError.isEmpty ? null : _emailError,
        ),
      ),
      const SizedBox(height: 16),
      ElevatedButton(
        style: ElevatedButton.styleFrom(
          backgroundColor: color,
          minimumSize: const Size(double.infinity, 48),
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
        ),
        onPressed: (_isSubmitting || !_isValidEmail) ? null : _handleInitiateReset,
        child: _isSubmitting 
          ? const SizedBox(height: 20, width: 20, child: CircularProgressIndicator(color: Colors.white, strokeWidth: 2))
          : const Text("Reset Password", style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold)),
      ),
    ]);
  }

  Widget _buildSuccessView(Color color) {
    return Container(
      padding: const EdgeInsets.all(16),
      margin: const EdgeInsets.only(bottom: 16),
      decoration: BoxDecoration(
        color: const Color(0x1A10B981), // rgba(16, 185, 129, 0.1)
        border: Border.all(color: const Color(0x4D10B981)),
        borderRadius: BorderRadius.circular(8),
      ),
      child: const Column(children: [
        Text("Reset Request Successful", style: TextStyle(color: Color(0xFF4ADE80), fontWeight: FontWeight.bold)), //
        SizedBox(height: 8),
        Text(
          "Please check your email for further instructions.",
          textAlign: TextAlign.center,
          style: TextStyle(color: Color(0xFF4ADE80), fontSize: 13),
        ),
      ]),
    );
  }

  Widget _buildFooter(Color color) {
    return Column(children: [
      const SizedBox(height: 16),
      Row(mainAxisAlignment: MainAxisAlignment.center, children: [
        const Text("Remember password? "),
        GestureDetector(
          onTap: () => Navigator.pushReplacementNamed(context, '/login'), //
          child: Text("Back to Login", style: TextStyle(color: color, fontWeight: FontWeight.bold)),
        ),
      ]),
      const SizedBox(height: 24),
      const Text("If you need assistance, please contact support.", style: TextStyle(fontSize: 11, color: Colors.grey)), //
      const SizedBox(height: 8),
      const LanguageSelector(),
    ]);
  }

  Widget _buildCancelButton(Color color) {
    return Padding(
      padding: const EdgeInsets.only(top: 16),
      child: OutlinedButton(
        style: OutlinedButton.styleFrom(
          side: BorderSide(color: color),
          minimumSize: const Size(120, 36),
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
        ),
        onPressed: () => Navigator.of(context).pop(), // replicates cancelReset()
        child: Text("Cancel", style: TextStyle(color: color)),
      ),
    );
  }
}