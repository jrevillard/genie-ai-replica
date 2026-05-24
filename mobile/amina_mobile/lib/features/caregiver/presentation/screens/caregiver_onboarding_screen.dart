// This file is part of Amina Care.
//
// Amina Care is free software: you can redistribute it and/or modify
// it under the terms of the GNU Lesser General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// Amina Care is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
// GNU Lesser General Public License for more details.
//
// You should have received a copy of the GNU Lesser General Public License
// along with Amina Care. If not, see <https://www.gnu.org/licenses/>.

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../../core/providers/app_mode_provider.dart';
import '../../../../core/theme/app_theme.dart'; // AminaColors extension
import 'caregiver_dashboard.dart';

// ═══════════════════════════════════════════════════════════════════════════════
// CaregiverOnboardingScreen
// ═══════════════════════════════════════════════════════════════════════════════

class CaregiverOnboardingScreen extends ConsumerStatefulWidget {
  const CaregiverOnboardingScreen({super.key});

  @override
  ConsumerState<CaregiverOnboardingScreen> createState() =>
      _CaregiverOnboardingScreenState();
}

class _CaregiverOnboardingScreenState
    extends ConsumerState<CaregiverOnboardingScreen>
    with SingleTickerProviderStateMixin {
  final _controllers = List.generate(6, (_) => TextEditingController());
  final _focusNodes  = List.generate(6, (_) => FocusNode());

  bool    _isLoading = false;
  String? _errorMsg;

  late final AnimationController _shakeCtrl;
  late final Animation<double>   _shakeAnim;

  @override
  void initState() {
    super.initState();
    _shakeCtrl = AnimationController(
      vsync:    this,
      duration: const Duration(milliseconds: 420),
    );
    _shakeAnim = TweenSequence<double>([
      TweenSequenceItem(tween: Tween(begin: 0,  end:  8), weight: 1),
      TweenSequenceItem(tween: Tween(begin: 8,  end: -8), weight: 2),
      TweenSequenceItem(tween: Tween(begin: -8, end:  8), weight: 2),
      TweenSequenceItem(tween: Tween(begin: 8,  end:  0), weight: 1),
    ]).animate(CurvedAnimation(parent: _shakeCtrl, curve: Curves.easeInOut));
  }

  @override
  void dispose() {
    for (final c in _controllers) c.dispose();
    for (final f in _focusNodes)  f.dispose();
    _shakeCtrl.dispose();
    super.dispose();
  }

  // ── Helpers ──────────────────────────────────────────────────────────────────

  String get _code => _controllers.map((c) => c.text.trim()).join();
  bool   get _isFilled => _code.length == 6;

  void _onDigitChanged(int index, String value) {
    if (value.length > 1) {
      final digits = value.replaceAll(RegExp(r'\D'), '');
      for (int i = 0; i < 6 && i < digits.length; i++) {
        _controllers[i].text = digits[i];
      }
      final nextFocus = (digits.length < 6) ? digits.length : 5;
      FocusScope.of(context).requestFocus(_focusNodes[nextFocus]);
    } else if (value.isNotEmpty && index < 5) {
      FocusScope.of(context).requestFocus(_focusNodes[index + 1]);
    }
    setState(() => _errorMsg = null);
  }

  void _onDigitBackspace(int index) {
    if (_controllers[index].text.isEmpty && index > 0) {
      _controllers[index - 1].clear();
      FocusScope.of(context).requestFocus(_focusNodes[index - 1]);
    }
  }

  Future<void> _submit() async {
    if (!_isFilled || _isLoading) return;
    FocusScope.of(context).unfocus();

    setState(() {
      _isLoading = true;
      _errorMsg  = null;
    });

    final error = await ref.read(appModeProvider.notifier).linkWithCode(_code);

    if (!mounted) return;
    setState(() => _isLoading = false);

    if (error != null) {
      setState(() => _errorMsg = error);
      _shakeCtrl.forward(from: 0);
      for (final c in _controllers) c.clear();
      FocusScope.of(context).requestFocus(_focusNodes[0]);
    } else {
      Navigator.of(context).pushAndRemoveUntil(
        MaterialPageRoute(builder: (_) => const CaregiverDashboard()),
        (_) => false,
      );
    }
  }

  // ── Build ─────────────────────────────────────────────────────────────────────

  @override
  Widget build(BuildContext context) => _buildContent(context);

  Widget _buildContent(BuildContext context) {
    final cs    = Theme.of(context).colorScheme;
    final amina = Theme.of(context).extension<AminaColors>()!;

    return Scaffold(
      backgroundColor: amina.scaffoldBg,
      body: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.symmetric(horizontal: 28),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const SizedBox(height: 24),

              // Back button
              IconButton(
                onPressed: () => Navigator.of(context).maybePop(),
                icon: Icon(Icons.arrow_back_ios_new_rounded,
                    color: cs.onSurface, size: 20),
                padding:     EdgeInsets.zero,
                constraints: const BoxConstraints(),
              ),

              const SizedBox(height: 36),

              // ── Icon header ──────────────────────────────────────────────────
              Container(
                width:  64,
                height: 64,
                decoration: BoxDecoration(
                  color: cs.primaryContainer,
                  shape: BoxShape.circle,
                  boxShadow: [
                    BoxShadow(
                      color:      cs.primary.withValues(alpha: 0.28),
                      blurRadius: 28,
                      offset:     const Offset(0, 8),
                    ),
                  ],
                ),
                child: const Center(
                  child: Text('🔗', style: TextStyle(fontSize: 28)),
                ),
              ),

              const SizedBox(height: 22),

              Text(
                'Enter your\nlinking code',
                style: TextStyle(
                  fontSize:      32,
                  fontWeight:    FontWeight.w800,
                  color:         cs.onSurface,
                  height:        1.2,
                  letterSpacing: -0.8,
                  fontFamily:    'Inter',
                ),
              ),

              const SizedBox(height: 10),

              Text(
                'Ask your patient for their 6-digit code.\nYou\'ll get read-only access to their health data.',
                style: TextStyle(
                  fontSize: 14.5,
                  color:    cs.onSurfaceVariant,
                  height:   1.55,
                ),
              ),

              const SizedBox(height: 44),

              // ── Code boxes ──────────────────────────────────────────────────
              AnimatedBuilder(
                animation: _shakeAnim,
                builder: (_, child) => Transform.translate(
                  offset: Offset(_shakeAnim.value, 0),
                  child:  child,
                ),
                child: Column(
                  children: [
                    Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: List.generate(6, (i) => _DigitBox(
                        controller: _controllers[i],
                        focusNode:  _focusNodes[i],
                        hasError:   _errorMsg != null,
                        onChanged:  (v) => _onDigitChanged(i, v),
                        onBackspace: () => _onDigitBackspace(i),
                      )),
                    ),

                    // Error message
                    if (_errorMsg != null) ...[
                      const SizedBox(height: 14),
                      Container(
                        width:   double.infinity,
                        padding: const EdgeInsets.symmetric(
                            horizontal: 14, vertical: 11),
                        decoration: BoxDecoration(
                          color:        cs.errorContainer,
                          borderRadius: BorderRadius.circular(12),
                          border: Border.all(
                              color: cs.error.withValues(alpha: 0.40)),
                        ),
                        child: Row(children: [
                          Icon(Icons.error_outline_rounded,
                              color: cs.error, size: 16),
                          const SizedBox(width: 8),
                          Expanded(
                            child: Text(
                              _errorMsg!,
                              style: TextStyle(fontSize: 13, color: cs.error),
                            ),
                          ),
                        ]),
                      ),
                    ],
                  ],
                ),
              ),

              const SizedBox(height: 36),

              // ── Submit button ────────────────────────────────────────────────
              SizedBox(
                width:  double.infinity,
                height: 56,
                child: AnimatedOpacity(
                  duration: const Duration(milliseconds: 200),
                  opacity:  _isFilled ? 1.0 : 0.5,
                  child: DecoratedBox(
                    decoration: BoxDecoration(
                      gradient: const LinearGradient(
                        colors: [Color(0xFF3D9970), Color(0xFF2D7354)],
                      ),
                      borderRadius: BorderRadius.circular(16),
                      boxShadow: _isFilled
                          ? [
                              BoxShadow(
                                color:      cs.primary.withValues(alpha: 0.38),
                                blurRadius: 20,
                                offset:     const Offset(0, 6),
                              ),
                            ]
                          : null,
                    ),
                    child: TextButton(
                      onPressed: _isFilled ? _submit : null,
                      style: TextButton.styleFrom(
                        foregroundColor: Colors.white,
                        shape: RoundedRectangleBorder(
                          borderRadius: BorderRadius.circular(16),
                        ),
                      ),
                      child: _isLoading
                          ? const SizedBox(
                              width:  22,
                              height: 22,
                              child: CircularProgressIndicator(
                                strokeWidth: 2.5,
                                valueColor: AlwaysStoppedAnimation<Color>(
                                    Colors.white),
                              ),
                            )
                          : const Text(
                              'Connect as Caregiver',
                              style: TextStyle(
                                fontSize:      15.5,
                                fontWeight:    FontWeight.w700,
                                letterSpacing: 0.1,
                              ),
                            ),
                    ),
                  ),
                ),
              ),

              const SizedBox(height: 28),

              // ── Hint ────────────────────────────────────────────────────────
              Center(
                child: Text(
                  '🔒  Read-only · No editing of patient data',
                  style: TextStyle(
                    fontSize: 12.5,
                    color:    cs.onSurfaceVariant.withValues(alpha: 0.65),
                  ),
                ),
              ),

              const SizedBox(height: 48),
            ],
          ),
        ),
      ),
    );
  }
}

// ─── Single digit input box ───────────────────────────────────────────────────

class _DigitBox extends StatelessWidget {
  final TextEditingController controller;
  final FocusNode             focusNode;
  final bool                  hasError;
  final ValueChanged<String>  onChanged;
  final VoidCallback          onBackspace;

  const _DigitBox({
    required this.controller,
    required this.focusNode,
    required this.hasError,
    required this.onChanged,
    required this.onBackspace,
  });

  @override
  Widget build(BuildContext context) {
    final cs    = Theme.of(context).colorScheme;
    final amina = Theme.of(context).extension<AminaColors>()!;

    return SizedBox(
      width:  46,
      height: 58,
      child: KeyboardListener(
        focusNode: FocusNode(),
        onKeyEvent: (event) {
          if (event is KeyDownEvent &&
              event.logicalKey == LogicalKeyboardKey.backspace &&
              controller.text.isEmpty) {
            onBackspace();
          }
        },
        child: TextField(
          controller:      controller,
          focusNode:       focusNode,
          textAlign:       TextAlign.center,
          keyboardType:    TextInputType.number,
          inputFormatters: [
            FilteringTextInputFormatter.digitsOnly,
            LengthLimitingTextInputFormatter(1),
          ],
          style: TextStyle(
            fontSize:      22,
            fontWeight:    FontWeight.w800,
            color:         hasError ? cs.error : cs.onSurface,
            letterSpacing: 0,
          ),
          decoration: InputDecoration(
            filled:    true,
            fillColor: hasError
                ? cs.errorContainer
                : focusNode.hasFocus
                    ? cs.primaryContainer
                    : amina.inputFill,
            contentPadding: EdgeInsets.zero,
            border: OutlineInputBorder(
              borderRadius: BorderRadius.circular(14),
              borderSide: BorderSide(
                color: hasError
                    ? cs.error.withValues(alpha: 0.55)
                    : amina.cardBorder,
                width: 1.5,
              ),
            ),
            enabledBorder: OutlineInputBorder(
              borderRadius: BorderRadius.circular(14),
              borderSide: BorderSide(
                color: hasError
                    ? cs.error.withValues(alpha: 0.55)
                    : amina.cardBorder,
                width: 1.5,
              ),
            ),
            focusedBorder: OutlineInputBorder(
              borderRadius: BorderRadius.circular(14),
              borderSide: BorderSide(
                color: hasError ? cs.error : cs.primary,
                width: 2.0,
              ),
            ),
          ),
          onChanged:   onChanged,
          cursorColor: cs.primary,
          cursorWidth: 1.5,
        ),
      ),
    );
  }
}
