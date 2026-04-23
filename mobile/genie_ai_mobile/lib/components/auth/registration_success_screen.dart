import 'package:flutter/material.dart';
import 'package:flutter_svg/flutter_svg.dart'; // IMPORTED SVG
import 'package:genie_ai_mobile/utils/theme_manager.dart';
import 'package:genie_ai_mobile/services/i18n_service.dart';
import 'package:genie_ai_mobile/services/genie_ai_config.dart'; // IMPORTED CONFIG

class RegistrationSuccessScreen extends StatelessWidget {
  const RegistrationSuccessScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final email =
        ModalRoute.of(context)!.settings.arguments as String? ?? 'your email';

    // Dynamic Theme
    final colors = ThemeManager().getColors();

    // WRAPPER: Ensures Config is loaded
    return FutureBuilder(
      future: GenieAiConfig.load(),
      builder: (context, snapshot) {
        if (!GenieAiConfig.isLoaded &&
            snapshot.connectionState != ConnectionState.done) {
          return Scaffold(
            backgroundColor: colors['background'],
            body: const Center(child: CircularProgressIndicator()),
          );
        }

        return Scaffold(
          backgroundColor: colors['background'], // Dynamic Background
          body: Center(
            child: Padding(
              padding: const EdgeInsets.all(32.0),
              child: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  // [MODIFIED] Replaced static check icon with Dynamic App Icon
                  SizedBox(
                    height: 100,
                    child: GenieAiConfig.iconPath.toLowerCase().endsWith('.svg')
                        ? SvgPicture.asset(
                            GenieAiConfig.iconPath,
                            fit: BoxFit.contain,
                          )
                        : Image.asset(
                            GenieAiConfig.iconPath,
                            fit: BoxFit.contain,
                            errorBuilder: (context, error, stackTrace) {
                              // Fallback if image fails
                              return const Icon(
                                Icons.check_circle_outline,
                                color: Colors.green,
                                size: 100,
                              );
                            },
                          ),
                  ),
                  const SizedBox(height: 24),
                  Text(
                    tr('register.registrationSuccess'), // Used Generic Success
                    style: TextStyle(
                      fontSize: 26,
                      fontWeight: FontWeight.bold,
                      color: colors['text'], // Dynamic Text
                    ),
                  ),
                  const SizedBox(height: 16),
                  // Parameterized string: "A verification email has been sent to {email}"
                  Text(
                    tr(
                      'register.verificationEmailSent',
                      args: {'email': email},
                    ),
                    textAlign: TextAlign.center,
                    style: TextStyle(fontSize: 16, color: colors['text']),
                  ),
                  const SizedBox(height: 40),
                  ElevatedButton(
                    style: ElevatedButton.styleFrom(
                      backgroundColor: colors['primary'], // Dynamic Primary
                      minimumSize: const Size(200, 50),
                    ),
                    onPressed: () =>
                        Navigator.pushReplacementNamed(context, '/login'),
                    child: Text(
                      tr('verification.proceedToLogin'),
                      style: const TextStyle(
                        color: Colors.white,
                        fontWeight: FontWeight.bold,
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ),
        );
      },
    );
  }
}
