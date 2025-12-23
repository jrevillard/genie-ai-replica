import 'package:flutter/material.dart';
import 'package:genie_ai_mobile/services/password_proxy.dart';
import 'package:genie_ai_mobile/components/shared/language_selector.dart';

class PasswordResetInitiateScreen extends StatefulWidget {
  const PasswordResetInitiateScreen({super.key});

  @override
  State<PasswordResetInitiateScreen> createState() => _PasswordResetInitiateScreenState();
}

class _PasswordResetInitiateScreenState extends State<PasswordResetInitiateScreen> {
  final _emailController = TextEditingController();
  bool _isLoading = false;
  bool _resetRequested = false; // Mirrors 'resetRequested' in Vue
  String? _error;

  Future<void> _handleResetRequest() async {
    if (_emailController.text.isEmpty) return;

    setState(() {
      _isLoading = true;
      _error = null;
    });

    try {
      // Calls the initiateReset method in your PasswordProxy
      await PasswordProxy().initiateReset(_emailController.text);
      setState(() => _resetRequested = true);
    } catch (e) {
      setState(() => _error = "Could not initiate reset. Please check your email and try again.");
    } finally {
      setState(() => _isLoading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.white,
      body: Center(
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(32.0),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              // Logo and App Name section
              const Icon(Icons.auto_awesome, size: 64, color: Color(0xFF4E97D1)),
              const SizedBox(height: 16),
              const Text(
                "GENIE.AI",
                style: TextStyle(fontSize: 28, fontWeight: FontWeight.bold),
              ),
              const SizedBox(height: 32),
              
              const Text(
                "Reset Password",
                style: TextStyle(fontSize: 22, fontWeight: FontWeight.w600),
              ),
              const SizedBox(height: 24),

              // Success Message View
              if (_resetRequested) ...[
                const Icon(Icons.mark_email_read, size: 48, color: Colors.green),
                const SizedBox(height: 16),
                const Text(
                  "Reset Request Successful",
                  style: TextStyle(fontWeight: FontWeight.bold, color: Colors.green),
                ),
                const SizedBox(height: 8),
                const Text(
                  "Please check your email for further instructions.",
                  textAlign: TextAlign.center,
                  style: TextStyle(color: Colors.grey),
                ),
                const SizedBox(height: 32),
                TextButton(
                  onPressed: () => Navigator.pushReplacementNamed(context, '/login'),
                  child: const Text("Back to Login", style: TextStyle(color: Color(0xFF4E97D1))),
                ),
              ] 
              // Email Form View
              else ...[
                if (_error != null)
                  Padding(
                    padding: const EdgeInsets.only(bottom: 16),
                    child: Text(_error!, style: const TextStyle(color: Colors.red)),
                  ),
                
                TextField(
                  controller: _emailController,
                  keyboardType: TextInputType.emailAddress,
                  decoration: const InputDecoration(
                    labelText: "Email Address",
                    hintText: "Enter your email",
                    border: OutlineInputBorder(),
                    prefixIcon: Icon(Icons.email_outlined),
                  ),
                ),
                const SizedBox(height: 24),
                
                ElevatedButton(
                  style: ElevatedButton.styleFrom(
                    backgroundColor: const Color(0xFF4E97D1),
                    minimumSize: const Size(double.infinity, 50),
                    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
                  ),
                  onPressed: _isLoading ? null : _handleResetRequest,
                  child: _isLoading 
                    ? const CircularProgressIndicator(color: Colors.white) 
                    : const Text("Send Reset Link", style: TextStyle(color: Colors.white)),
                ),
                
                const SizedBox(height: 24),
                GestureDetector(
                  onTap: () => Navigator.pushReplacementNamed(context, '/login'),
                  child: const Text(
                    "Back to Login",
                    style: TextStyle(color: Color(0xFF4E97D1), fontWeight: FontWeight.bold),
                  ),
                ),
              ],
              
              const SizedBox(height: 40),
              const LanguageSelector(), //
            ],
          ),
        ),
      ),
    );
  }
}