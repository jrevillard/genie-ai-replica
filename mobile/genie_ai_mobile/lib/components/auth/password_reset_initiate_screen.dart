import 'package:flutter/material.dart';
import 'package:flutter_svg/flutter_svg.dart'; // IMPORTED SVG
import 'package:genie_ai_mobile/services/password_proxy.dart';
import 'package:genie_ai_mobile/services/user_service.dart';
import 'package:genie_ai_mobile/components/shared/language_selector.dart';
import 'package:genie_ai_mobile/utils/theme_manager.dart';
import 'package:genie_ai_mobile/services/i18n_service.dart';
import 'package:genie_ai_mobile/services/genie_ai_config.dart'; // IMPORTED CONFIG

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
  State<PasswordResetInitiateScreen> createState() =>
      _PasswordResetInitiateScreenState();
}

class _PasswordResetInitiateScreenState
    extends State<PasswordResetInitiateScreen> {
  late TextEditingController _emailController;
  String _emailError = "";
  bool _isSubmitting = false;
  bool _resetRequested = false; // Mirrors Vue 'resetRequested'

  @override
  void initState() {
    super.initState();
    _emailController = TextEditingController(text: widget.prefilledEmail);
    _setCurrentUserEmail();
  }

  bool get _isValidEmail {
    final emailRegex = RegExp(r'^[^\s@]+@[^\s@]+\.[^\s@]+$');
    return emailRegex.hasMatch(_emailController.text);
  }

  // FIXED: Changed to async/await to safely handle the Future
  Future<void> _setCurrentUserEmail() async {
    if (_emailController.text.isEmpty && widget.isEmbedded) {
      // Logic for fetching logged-in user email if resetting from inside the app
      try {
        final user = await UserService().getCurrentUser();
        if (user != null && user['email'] != null && mounted) {
          setState(() {
            _emailController.text = user['email'];
          });
        }
      } catch (e) {
        debugPrint("Error fetching current user email: $e");
      }
    }
  }

  Future<void> _handleInitiateReset() async {
    setState(() => _emailError = "");

    if (!_isValidEmail) {
      setState(() => _emailError = tr('passwordReset.invalidEmail'));
      return;
    }

    setState(() => _isSubmitting = true);
    try {
      await PasswordProxy().initiateReset(_emailController.text);
      setState(() => _resetRequested = true);

      if (widget.isEmbedded) {
        Future.delayed(const Duration(seconds: 2), () {
          if (mounted) Navigator.of(context).pop(_emailController.text);
        });
      }
    } catch (error) {
      // Even on error, avoid email harvesting
      setState(() => _resetRequested = true);
    } finally {
      if (mounted) setState(() => _isSubmitting = false);
    }
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
             backgroundColor: widget.isEmbedded ? Colors.transparent : colors['background'],
             body: const Center(child: CircularProgressIndicator())
          );
        }

        return Scaffold(
          backgroundColor: widget.isEmbedded
              ? Colors.transparent
              : colors['background'], // Dynamic Background
          body: Center(
            child: SingleChildScrollView(
              padding: EdgeInsets.all(widget.isEmbedded ? 0 : 16.0),
              child: Container(
                constraints: const BoxConstraints(maxWidth: 400),
                padding: const EdgeInsets.all(24.0),
                decoration: widget.isEmbedded
                    ? null
                    : BoxDecoration(
                        color: colors['surface'], // Dynamic Surface
                        borderRadius: BorderRadius.circular(16),
                        boxShadow: [
                          BoxShadow(
                              color: Colors.black.withOpacity(0.1), blurRadius: 10)
                        ],
                      ),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    _buildHeader(colors),
                    const SizedBox(height: 10),
                    Text(
                      tr('passwordReset.resetPassword'),
                      style: TextStyle(
                          fontSize: 18,
                          fontWeight: FontWeight.w500,
                          color: colors['text'].withOpacity(0.7)),
                    ),
                    const SizedBox(height: 20),
                    if (_resetRequested)
                      _buildSuccessView()
                    else
                      _buildFormView(colors, isDark),
                    _buildFooter(colors, isDark),
                    if (widget.isEmbedded) _buildCancelButton(colors),
                  ],
                ),
              ),
            ),
          ),
        );
      }
    );
  }

  Widget _buildHeader(Map<String, dynamic> colors) {
    return Column(children: [
      // [MODIFIED] Replaced hardcoded Icon with Dynamic SVG/Image
      SizedBox(
        height: 80,
        child: GenieAiConfig.iconPath.toLowerCase().endsWith('.svg')
            ? SvgPicture.asset(
                GenieAiConfig.iconPath,
                fit: BoxFit.contain,
              )
            : Image.asset(
                GenieAiConfig.iconPath,
                fit: BoxFit.contain,
                errorBuilder: (context, error, stackTrace) {
                   return const Icon(Icons.error, size: 40);
                },
              ),
      ),
      const SizedBox(height: 10),
      // [MODIFIED] Use Dynamic Title
      Text(
        GenieAiConfig.title,
        style: TextStyle(
            fontSize: 28, fontWeight: FontWeight.bold, color: colors['text']),
      ),
    ]);
  }

  Widget _buildFormView(Map<String, dynamic> colors, bool isDark) {
    return Column(children: [
      Align(
        alignment: Alignment.centerLeft,
        child: Text(
          tr('passwordReset.emailLabel'),
          style: TextStyle(
              fontSize: 14, fontWeight: FontWeight.w500, color: colors['text']),
        ),
      ),
      const SizedBox(height: 6),
      TextField(
        controller: _emailController,
        keyboardType: TextInputType.emailAddress,
        onChanged: (_) => setState(() {}),
        style: TextStyle(color: colors['text']),
        decoration: InputDecoration(
          hintText: tr('passwordReset.emailPlaceholder'),
          hintStyle:
              TextStyle(color: isDark ? Colors.grey[500] : Colors.grey[600]),
          filled: true,
          fillColor:
              isDark ? Colors.white.withOpacity(0.05) : const Color(0xFFF0F2F5),
          border: OutlineInputBorder(
              borderRadius: BorderRadius.circular(8),
              borderSide: BorderSide.none),
          errorText: _emailError.isEmpty ? null : _emailError,
        ),
      ),
      const SizedBox(height: 16),
      ElevatedButton(
        style: ElevatedButton.styleFrom(
          backgroundColor: colors['primary'],
          minimumSize: const Size(double.infinity, 48),
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
        ),
        onPressed:
            (_isSubmitting || !_isValidEmail) ? null : _handleInitiateReset,
        child: _isSubmitting
            ? const SizedBox(
                height: 20,
                width: 20,
                child: CircularProgressIndicator(
                    color: Colors.white, strokeWidth: 2))
            : Text(tr('passwordReset.resetButton'),
                style: const TextStyle(
                    color: Colors.white, fontWeight: FontWeight.bold)),
      ),
    ]);
  }

  Widget _buildSuccessView() {
    return Container(
      padding: const EdgeInsets.all(16),
      margin: const EdgeInsets.only(bottom: 16),
      decoration: BoxDecoration(
        color: const Color(0x1A10B981), // rgba(16, 185, 129, 0.1)
        border: Border.all(color: const Color(0x4D10B981)),
        borderRadius: BorderRadius.circular(8),
      ),
      child: Column(children: [
        Text(tr('passwordReset.resetRequestSuccess'),
            textAlign: TextAlign.center,
            style: const TextStyle(
                color: Color(0xFF10B981), fontWeight: FontWeight.bold)),
        const SizedBox(height: 8),
        Text(
          tr('passwordReset.checkEmail'),
          textAlign: TextAlign.center,
          style: const TextStyle(color: Color(0xFF10B981), fontSize: 13),
        ),
      ]),
    );
  }

  Widget _buildFooter(Map<String, dynamic> colors, bool isDark) {
    return Column(children: [
      const SizedBox(height: 16),
      Row(mainAxisAlignment: MainAxisAlignment.center, children: [
        Text(tr('passwordReset.rememberPassword') + ' ',
            style:
                TextStyle(color: isDark ? Colors.grey[400] : Colors.grey[700])),
        GestureDetector(
          onTap: () => Navigator.pushReplacementNamed(context, '/login'),
          child: Text(tr('passwordReset.backToLogin'),
              style: TextStyle(
                  color: colors['primary'], fontWeight: FontWeight.bold)),
        ),
      ]),
      const SizedBox(height: 24),
      Text(tr('passwordReset.supportMessage'),
          style: TextStyle(
              fontSize: 11, color: isDark ? Colors.grey[500] : Colors.grey)),
      const SizedBox(height: 8),
      LanguageSelector(textColor: colors['text']),
    ]);
  }

  Widget _buildCancelButton(Map<String, dynamic> colors) {
    return Padding(
      padding: const EdgeInsets.only(top: 16),
      child: OutlinedButton(
        style: OutlinedButton.styleFrom(
          side: BorderSide(color: colors['primary']),
          minimumSize: const Size(120, 36),
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
        ),
        onPressed: () => Navigator.of(context).pop(),
        child: Text(tr('common.cancel'),
            style: TextStyle(color: colors['primary'])),
      ),
    );
  }
}