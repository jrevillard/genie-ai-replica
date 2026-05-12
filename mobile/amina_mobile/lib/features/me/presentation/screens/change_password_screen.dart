import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../../core/theme/app_theme.dart';

class ChangePasswordScreen extends ConsumerStatefulWidget {
  const ChangePasswordScreen({super.key});

  @override
  ConsumerState<ChangePasswordScreen> createState() =>
      _ChangePasswordScreenState();
}

class _ChangePasswordScreenState
    extends ConsumerState<ChangePasswordScreen> {
  final _currentCtrl  = TextEditingController();
  final _newCtrl      = TextEditingController();
  final _confirmCtrl  = TextEditingController();

  bool _showCurrent = false;
  bool _showNew     = false;
  bool _showConfirm = false;
  bool _saving      = false;
  bool _saved       = false;
  String? _errorMsg;

  // ── Password requirements ──────────────────────────────────────────────────

  bool get _hasLength    => _newCtrl.text.length >= 8;
  bool get _hasUpper     => _newCtrl.text.contains(RegExp(r'[A-Z]'));
  bool get _hasLower     => _newCtrl.text.contains(RegExp(r'[a-z]'));
  bool get _hasNumber    => _newCtrl.text.contains(RegExp(r'[0-9]'));
  bool get _hasSpecial   => _newCtrl.text.contains(RegExp(r'[!@#\$%^&*(),.?":{}|<>]'));
  bool get _passwordsMatch =>
      _newCtrl.text.isNotEmpty &&
      _newCtrl.text == _confirmCtrl.text;

  int get _strength {
    int s = 0;
    if (_hasLength)  s++;
    if (_hasUpper)   s++;
    if (_hasLower)   s++;
    if (_hasNumber)  s++;
    if (_hasSpecial) s++;
    return s;
  }

  Color get _strengthColor => switch (_strength) {
        0 || 1 => const Color(0xFFDC2626),
        2      => const Color(0xFFF59E0B),
        3      => const Color(0xFFF59E0B),
        4      => const Color(0xFF059669),
        _      => const Color(0xFF059669),
      };

  String get _strengthLabel => switch (_strength) {
        0 || 1 => 'Weak',
        2 || 3 => 'Fair',
        4      => 'Strong',
        _      => 'Very Strong',
      };

  bool get _canSubmit =>
      _currentCtrl.text.isNotEmpty &&
      _hasLength &&
      _hasUpper &&
      _hasLower &&
      _hasNumber &&
      _passwordsMatch;

  // ── Submit ─────────────────────────────────────────────────────────────────

  Future<void> _submit() async {
    FocusScope.of(context).unfocus();
    setState(() { _saving = true; _errorMsg = null; _saved = false; });

    await Future<void>.delayed(const Duration(milliseconds: 1000));
    if (!mounted) return;

    // Mock: reject if current password is wrong
    if (_currentCtrl.text.length < 6) {
      setState(() {
        _saving   = false;
        _errorMsg = 'Current password is incorrect.';
      });
      return;
    }

    setState(() { _saving = false; _saved = true; });
    _currentCtrl.clear();
    _newCtrl.clear();
    _confirmCtrl.clear();

    await Future<void>.delayed(const Duration(seconds: 2));
    if (mounted) setState(() => _saved = false);
  }

  @override
  void dispose() {
    _currentCtrl.dispose();
    _newCtrl.dispose();
    _confirmCtrl.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final cs    = Theme.of(context).colorScheme;
    final amina = Theme.of(context).extension<AminaColors>()!;

    return Scaffold(
      backgroundColor: amina.scaffoldBg,
      appBar: AppBar(
        backgroundColor:        cs.surface,
        elevation:              0,
        scrolledUnderElevation: 0,
        leading: IconButton(
          icon: Icon(Icons.arrow_back_ios_new_rounded,
              color: cs.onSurface, size: 20),
          onPressed: () => Navigator.of(context).pop(),
        ),
        title: Text(
          'Change Password',
          style: TextStyle(
            color:      cs.onSurface,
            fontWeight: FontWeight.bold,
            fontSize:   18,
          ),
        ),
        centerTitle: true,
        bottom: PreferredSize(
          preferredSize: const Size.fromHeight(0.8),
          child: Container(height: 0.8, color: amina.cardBorder),
        ),
      ),
      body: ListView(
        padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 28),
        children: [

          // ── Lock icon header ─────────────────────────────────────────────
          Center(
            child: Container(
              width:  70,
              height: 70,
              decoration: BoxDecoration(
                color:  const Color(0xFFEEF2FF),
                shape:  BoxShape.circle,
                border: Border.all(
                    color: const Color(0xFF6366F1).withValues(alpha: 0.25)),
                boxShadow: [
                  BoxShadow(
                    color:      const Color(0xFF6366F1).withValues(alpha: 0.18),
                    blurRadius: 22,
                    offset:     const Offset(0, 6),
                  ),
                ],
              ),
              child: const Icon(Icons.lock_outline_rounded,
                  color: Color(0xFF6366F1), size: 32),
            ),
          ),

          const SizedBox(height: 16),

          Center(
            child: Text(
              'Keep your account secure',
              style: TextStyle(
                fontSize:   15,
                color:      cs.onSurfaceVariant,
                fontWeight: FontWeight.w500,
              ),
            ),
          ),

          // ── Success / error banners ──────────────────────────────────────
          AnimatedSize(
            duration: const Duration(milliseconds: 300),
            child: _saved
                ? Padding(
                    padding: const EdgeInsets.only(top: 20),
                    child: _Banner(
                      color:   const Color(0xFF059669),
                      bgColor: const Color(0xFFECFDF5),
                      icon:    Icons.check_circle_rounded,
                      text:    'Password updated successfully!',
                    ),
                  )
                : _errorMsg != null
                    ? Padding(
                        padding: const EdgeInsets.only(top: 20),
                        child: _Banner(
                          color:   const Color(0xFFDC2626),
                          bgColor: const Color(0xFFFEF2F2),
                          icon:    Icons.error_outline_rounded,
                          text:    _errorMsg!,
                        ),
                      )
                    : const SizedBox.shrink(),
          ),

          const SizedBox(height: 28),

          // ── Current password ─────────────────────────────────────────────
          _Label('Current Password', cs),
          const SizedBox(height: 8),
          _PwField(
            ctrl:         _currentCtrl,
            hint:         'Enter your current password',
            show:         _showCurrent,
            cs:           cs,
            amina:        amina,
            onToggle:     () => setState(() => _showCurrent = !_showCurrent),
            onChanged:    (_) => setState(() {}),
          ),

          const SizedBox(height: 8),

          Align(
            alignment: Alignment.centerRight,
            child: TextButton(
              onPressed: () {},
              style: TextButton.styleFrom(
                padding: const EdgeInsets.symmetric(horizontal: 4),
                foregroundColor: cs.primary,
              ),
              child: const Text(
                'Forgot current password?',
                style: TextStyle(fontSize: 13),
              ),
            ),
          ),

          const SizedBox(height: 20),

          // ── New password ─────────────────────────────────────────────────
          _Label('New Password', cs),
          const SizedBox(height: 8),
          _PwField(
            ctrl:     _newCtrl,
            hint:     'Enter a new password',
            show:     _showNew,
            cs:       cs,
            amina:    amina,
            onToggle: () => setState(() => _showNew = !_showNew),
            onChanged: (_) => setState(() {}),
          ),

          // Strength indicator
          if (_newCtrl.text.isNotEmpty) ...[
            const SizedBox(height: 12),
            Row(
              children: [
                Expanded(
                  child: ClipRRect(
                    borderRadius: BorderRadius.circular(4),
                    child: LinearProgressIndicator(
                      value:           _strength / 5,
                      minHeight:       5,
                      backgroundColor: amina.cardBorder,
                      valueColor: AlwaysStoppedAnimation<Color>(
                          _strengthColor),
                    ),
                  ),
                ),
                const SizedBox(width: 12),
                Text(
                  _strengthLabel,
                  style: TextStyle(
                    fontSize:   12,
                    fontWeight: FontWeight.w700,
                    color:      _strengthColor,
                  ),
                ),
              ],
            ),
          ],

          const SizedBox(height: 16),

          // ── Requirements checklist ───────────────────────────────────────
          _RequirementsCard(
            cs:    cs,
            amina: amina,
            items: [
              _Req(met: _hasLength,  text: 'At least 8 characters'),
              _Req(met: _hasUpper,   text: 'One uppercase letter (A–Z)'),
              _Req(met: _hasLower,   text: 'One lowercase letter (a–z)'),
              _Req(met: _hasNumber,  text: 'One number (0–9)'),
              _Req(met: _hasSpecial, text: 'One special character (!@#…)'),
            ],
          ),

          const SizedBox(height: 20),

          // ── Confirm password ─────────────────────────────────────────────
          _Label('Confirm New Password', cs),
          const SizedBox(height: 8),
          _PwField(
            ctrl:     _confirmCtrl,
            hint:     'Re-enter your new password',
            show:     _showConfirm,
            cs:       cs,
            amina:    amina,
            onToggle: () => setState(() => _showConfirm = !_showConfirm),
            onChanged: (_) => setState(() {}),
            hasError: _confirmCtrl.text.isNotEmpty && !_passwordsMatch,
          ),

          if (_confirmCtrl.text.isNotEmpty && !_passwordsMatch) ...[
            const SizedBox(height: 6),
            Padding(
              padding: const EdgeInsets.only(left: 4),
              child: Text(
                'Passwords do not match.',
                style: TextStyle(
                  fontSize: 12.5,
                  color:    Theme.of(context).colorScheme.error,
                ),
              ),
            ),
          ],

          const SizedBox(height: 32),

          // ── Submit button ────────────────────────────────────────────────
          AnimatedOpacity(
            duration: const Duration(milliseconds: 200),
            opacity:  _canSubmit ? 1.0 : 0.45,
            child: SizedBox(
              width:  double.infinity,
              height: 54,
              child: ElevatedButton(
                onPressed: _canSubmit && !_saving ? _submit : null,
                style: ElevatedButton.styleFrom(
                  backgroundColor: cs.primary,
                  foregroundColor: cs.onPrimary,
                  elevation: 0,
                  shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(16)),
                ),
                child: _saving
                    ? const SizedBox(
                        width: 22, height: 22,
                        child: CircularProgressIndicator(
                            strokeWidth: 2.5, color: Colors.white),
                      )
                    : const Text(
                        'Update Password',
                        style: TextStyle(
                          fontSize:   16,
                          fontWeight: FontWeight.w700,
                        ),
                      ),
              ),
            ),
          ),

          const SizedBox(height: 48),
        ],
      ),
    );
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

class _Label extends StatelessWidget {
  final String      text;
  final ColorScheme cs;
  const _Label(this.text, this.cs);

  @override
  Widget build(BuildContext context) => Text(
        text,
        style: TextStyle(
          fontSize:   13,
          fontWeight: FontWeight.w700,
          color:      cs.onSurfaceVariant,
          letterSpacing: 0.5,
        ),
      );
}

class _PwField extends StatelessWidget {
  final TextEditingController ctrl;
  final String                hint;
  final bool                  show;
  final ColorScheme           cs;
  final AminaColors           amina;
  final VoidCallback          onToggle;
  final ValueChanged<String>  onChanged;
  final bool                  hasError;

  const _PwField({
    required this.ctrl,
    required this.hint,
    required this.show,
    required this.cs,
    required this.amina,
    required this.onToggle,
    required this.onChanged,
    this.hasError = false,
  });

  @override
  Widget build(BuildContext context) => TextField(
        controller:    ctrl,
        obscureText:   !show,
        onChanged:     onChanged,
        style: TextStyle(fontSize: 15, color: cs.onSurface),
        decoration: InputDecoration(
          hintText:  hint,
          hintStyle: TextStyle(
              color: cs.onSurfaceVariant.withValues(alpha: 0.45)),
          filled:    true,
          fillColor: hasError
              ? cs.errorContainer.withValues(alpha: 0.30)
              : amina.inputFill,
          contentPadding: const EdgeInsets.symmetric(
              horizontal: 16, vertical: 15),
          border: OutlineInputBorder(
            borderRadius: BorderRadius.circular(14),
            borderSide: BorderSide(
              color: hasError ? cs.error : amina.cardBorder,
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
          suffixIcon: IconButton(
            icon: Icon(
              show
                  ? Icons.visibility_off_outlined
                  : Icons.visibility_outlined,
              color: cs.onSurfaceVariant,
              size:  20,
            ),
            onPressed: onToggle,
          ),
        ),
      );
}

class _Req {
  final bool   met;
  final String text;
  const _Req({required this.met, required this.text});
}

class _RequirementsCard extends StatelessWidget {
  final ColorScheme cs;
  final AminaColors amina;
  final List<_Req>  items;

  const _RequirementsCard({
    required this.cs,
    required this.amina,
    required this.items,
  });

  @override
  Widget build(BuildContext context) => Container(
        padding: const EdgeInsets.all(16),
        decoration: BoxDecoration(
          color:        cs.surface,
          borderRadius: BorderRadius.circular(16),
          border:       Border.all(color: amina.cardBorder),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              'Password requirements',
              style: TextStyle(
                fontSize:   12,
                fontWeight: FontWeight.w700,
                color:      cs.onSurfaceVariant,
              ),
            ),
            const SizedBox(height: 10),
            ...items.map((r) => Padding(
                  padding: const EdgeInsets.only(bottom: 7),
                  child: Row(
                    children: [
                      AnimatedContainer(
                        duration: const Duration(milliseconds: 200),
                        width:  18,
                        height: 18,
                        decoration: BoxDecoration(
                          color: r.met
                              ? const Color(0xFF059669)
                              : Colors.transparent,
                          shape: BoxShape.circle,
                          border: Border.all(
                            color: r.met
                                ? const Color(0xFF059669)
                                : amina.cardBorder,
                            width: 1.5,
                          ),
                        ),
                        child: r.met
                            ? const Icon(Icons.check_rounded,
                                color: Colors.white, size: 11)
                            : null,
                      ),
                      const SizedBox(width: 10),
                      Text(
                        r.text,
                        style: TextStyle(
                          fontSize: 13,
                          color:    r.met
                              ? const Color(0xFF059669)
                              : cs.onSurfaceVariant,
                          fontWeight: r.met
                              ? FontWeight.w600
                              : FontWeight.w400,
                        ),
                      ),
                    ],
                  ),
                )),
          ],
        ),
      );
}

class _Banner extends StatelessWidget {
  final Color  color;
  final Color  bgColor;
  final IconData icon;
  final String text;

  const _Banner({
    required this.color,
    required this.bgColor,
    required this.icon,
    required this.text,
  });

  @override
  Widget build(BuildContext context) => Container(
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
        decoration: BoxDecoration(
          color:        bgColor,
          borderRadius: BorderRadius.circular(14),
          border: Border.all(color: color.withValues(alpha: 0.30)),
        ),
        child: Row(
          children: [
            Icon(icon, color: color, size: 18),
            const SizedBox(width: 10),
            Expanded(
              child: Text(
                text,
                style: TextStyle(
                  fontSize:   13.5,
                  color:      color,
                  fontWeight: FontWeight.w600,
                ),
              ),
            ),
          ],
        ),
      );
}
