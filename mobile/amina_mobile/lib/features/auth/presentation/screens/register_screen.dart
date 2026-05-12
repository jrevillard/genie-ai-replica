import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../../core/navigation_menu.dart';
import '../../../../core/theme/app_theme.dart';
import '../providers/auth_provider.dart';
import '../widgets/amina_text_field.dart';
import '../widgets/auth_header.dart';
import '../widgets/login_button.dart';

// ── Options ───────────────────────────────────────────────────────────────────

const _kGenders = ['Male', 'Female', 'Other', 'Prefer not to say'];

const _kRegions = [
  'Banjul', 'Kanifing', 'Brikama', 'Mansakonko',
  'Kerewan', 'Kuntaur', 'Janjanbureh', 'Basse',
];

const _kConditions = [
  'Diabetes',
  'Hypertension',
  'Heart disease',
  'Asthma',
  'Malaria',
  'Arthritis',
  'Other',
];

// ── Screen ────────────────────────────────────────────────────────────────────

class RegisterScreen extends ConsumerStatefulWidget {
  const RegisterScreen({super.key});

  @override
  ConsumerState<RegisterScreen> createState() => _RegisterScreenState();
}

class _RegisterScreenState extends ConsumerState<RegisterScreen> {
  final _formKey          = GlobalKey<FormState>();
  final _nameCtrl         = TextEditingController();
  final _emailCtrl        = TextEditingController();
  final _passCtrl         = TextEditingController();
  final _confirmCtrl      = TextEditingController();
  final _phoneCtrl        = TextEditingController();
  final _ageCtrl          = TextEditingController();

  String?       _gender;
  String?       _region;
  final Set<String> _conditions = {};

  @override
  void dispose() {
    _nameCtrl.dispose();
    _emailCtrl.dispose();
    _passCtrl.dispose();
    _confirmCtrl.dispose();
    _phoneCtrl.dispose();
    _ageCtrl.dispose();
    super.dispose();
  }

  // ── Submit ────────────────────────────────────────────────────────────────

  Future<void> _handleRegister() async {
    FocusScope.of(context).unfocus();
    if (!(_formKey.currentState?.validate() ?? false)) return;

    final error = await ref.read(authProvider.notifier).register(
          name:       _nameCtrl.text,
          email:      _emailCtrl.text,
          password:   _passCtrl.text,
          confirm:    _confirmCtrl.text,
          phone:      _phoneCtrl.text.trim(),
          age:        int.tryParse(_ageCtrl.text.trim()) ?? 0,
          gender:     _gender ?? '',
          region:     _region ?? '',
          conditions: _conditions.toList(),
        );

    if (!mounted) return;

    if (error != null) {
      final cs = Theme.of(context).colorScheme;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Row(children: [
            Icon(Icons.error_outline,
                color: cs.onErrorContainer, size: 18),
            const SizedBox(width: 10),
            Expanded(
              child: Text(error,
                  style: TextStyle(
                      color: cs.onErrorContainer, fontFamily: 'Inter')),
            ),
          ]),
          backgroundColor: cs.errorContainer,
          behavior: SnackBarBehavior.floating,
          shape: RoundedRectangleBorder(
              borderRadius: BorderRadius.circular(12)),
          margin:   const EdgeInsets.all(16),
          duration: const Duration(seconds: 3),
        ),
      );
    } else {
      Navigator.of(context).pushAndRemoveUntil(
        MaterialPageRoute(builder: (_) => const MainNavigation()),
        (_) => false,
      );
    }
  }

  // ── Build ─────────────────────────────────────────────────────────────────

  @override
  Widget build(BuildContext context) {
    final isDark = MediaQuery.platformBrightnessOf(context) == Brightness.dark;
    return Theme(
      data: isDark ? AminaTheme.dark : AminaTheme.light,
      child: Builder(builder: _buildContent),
    );
  }

  Widget _buildContent(BuildContext context) {
    final authState = ref.watch(authProvider);
    final cs        = Theme.of(context).colorScheme;
    final amina     = Theme.of(context).extension<AminaColors>()!;

    return Scaffold(
      backgroundColor: amina.scaffoldBg,
      body: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 20),
          child: Form(
            key: _formKey,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                // ── Brand ─────────────────────────────────────────────────
                const Center(child: AuthHeader()),
                const SizedBox(height: 28),

                // ── Account info ──────────────────────────────────────────
                _SectionHeader(
                  label: 'Account information',
                  icon:  Icons.person_outline_rounded,
                  cs:    cs,
                ),
                const SizedBox(height: 14),

                AminaTextField(
                  label:      'Full Name',
                  hint:       'Jane Doe',
                  prefixIcon: Icons.badge_outlined,
                  controller: _nameCtrl,
                  validator:  (v) => (v == null || v.trim().isEmpty)
                      ? 'Full name is required.'
                      : null,
                ),
                const SizedBox(height: 14),

                AminaTextField(
                  label:        'Email',
                  hint:         'you@example.com',
                  prefixIcon:   Icons.mail_outline_rounded,
                  controller:   _emailCtrl,
                  keyboardType: TextInputType.emailAddress,
                  validator: (v) {
                    if (v == null || v.trim().isEmpty) return 'Email is required.';
                    if (!RegExp(r'^[\w.+-]+@[\w-]+\.[a-zA-Z]{2,}$')
                            .hasMatch(v.trim())) {
                      return 'Enter a valid email address.';
                    }
                    return null;
                  },
                ),
                const SizedBox(height: 14),

                AminaTextField(
                  label:      'Password',
                  hint:       '••••••••',
                  prefixIcon: Icons.lock_outline_rounded,
                  controller: _passCtrl,
                  isPassword: true,
                  validator: (v) {
                    if (v == null || v.isEmpty) return 'Password is required.';
                    if (v.length < 6) {
                      return 'Password must be at least 6 characters.';
                    }
                    return null;
                  },
                ),
                const SizedBox(height: 14),

                AminaTextField(
                  label:      'Confirm Password',
                  hint:       '••••••••',
                  prefixIcon: Icons.lock_outline_rounded,
                  controller: _confirmCtrl,
                  isPassword: true,
                  validator:  (v) => (v != _passCtrl.text)
                      ? 'Passwords do not match.'
                      : null,
                ),

                const SizedBox(height: 28),

                // ── Health profile ────────────────────────────────────────
                _SectionHeader(
                  label:    'Health profile',
                  icon:     Icons.favorite_border_rounded,
                  cs:       cs,
                  optional: true,
                ),
                const SizedBox(height: 14),

                AminaTextField(
                  label:        'Phone number',
                  hint:         'e.g. 2201234567',
                  prefixIcon:   Icons.phone_outlined,
                  controller:   _phoneCtrl,
                  keyboardType: TextInputType.phone,
                ),
                const SizedBox(height: 14),

                AminaTextField(
                  label:        'Age',
                  hint:         'e.g. 45',
                  prefixIcon:   Icons.cake_outlined,
                  controller:   _ageCtrl,
                  keyboardType: TextInputType.number,
                ),
                const SizedBox(height: 14),

                // Gender dropdown
                _DropdownField(
                  label:    'Gender',
                  icon:     Icons.wc_outlined,
                  value:    _gender,
                  options:  _kGenders,
                  hint:     'Select gender',
                  cs:       cs,
                  amina:    amina,
                  onChanged: (v) => setState(() => _gender = v),
                ),
                const SizedBox(height: 14),

                // Region dropdown
                _DropdownField(
                  label:    'Region',
                  icon:     Icons.location_on_outlined,
                  value:    _region,
                  options:  _kRegions,
                  hint:     'Select your region',
                  cs:       cs,
                  amina:    amina,
                  onChanged: (v) => setState(() => _region = v),
                ),
                const SizedBox(height: 14),

                // Conditions multi-select
                Text(
                  'Health conditions',
                  style: TextStyle(
                    fontSize:   13,
                    fontWeight: FontWeight.w600,
                    color:      cs.onSurfaceVariant,
                    fontFamily: 'Inter',
                  ),
                ),
                const SizedBox(height: 8),
                Wrap(
                  spacing:    8,
                  runSpacing: 8,
                  children: _kConditions.map((c) {
                    final selected = _conditions.contains(c);
                    return GestureDetector(
                      onTap: () => setState(() {
                        selected
                            ? _conditions.remove(c)
                            : _conditions.add(c);
                      }),
                      child: AnimatedContainer(
                        duration: const Duration(milliseconds: 160),
                        padding: const EdgeInsets.symmetric(
                            horizontal: 14, vertical: 8),
                        decoration: BoxDecoration(
                          color: selected
                              ? cs.primary
                              : amina.inputFill,
                          borderRadius: BorderRadius.circular(20),
                          border: Border.all(
                            color: selected
                                ? cs.primary
                                : amina.cardBorder,
                          ),
                        ),
                        child: Text(
                          c,
                          style: TextStyle(
                            fontSize:   13,
                            fontWeight: selected
                                ? FontWeight.w600
                                : FontWeight.normal,
                            color: selected
                                ? cs.onPrimary
                                : cs.onSurfaceVariant,
                            fontFamily: 'Inter',
                          ),
                        ),
                      ),
                    );
                  }).toList(),
                ),

                const SizedBox(height: 32),

                // ── Submit ────────────────────────────────────────────────
                LoginButton(
                  isLoading: authState.isLoading,
                  onPressed: _handleRegister,
                  label:     'Create Account',
                ),

                const SizedBox(height: 24),

                // ── Footer ────────────────────────────────────────────────
                Center(
                  child: Row(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      Text(
                        'Already have an account? ',
                        style: TextStyle(
                            color: cs.onSurfaceVariant, fontSize: 14,
                            fontFamily: 'Inter'),
                      ),
                      GestureDetector(
                        onTap: () => Navigator.of(context).pop(),
                        child: Text(
                          'Sign in',
                          style: TextStyle(
                            color:      cs.primary,
                            fontSize:   14,
                            fontWeight: FontWeight.bold,
                            fontFamily: 'Inter',
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
                const SizedBox(height: 12),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

// ── Section header ────────────────────────────────────────────────────────────

class _SectionHeader extends StatelessWidget {
  final String      label;
  final IconData    icon;
  final ColorScheme cs;
  final bool        optional;

  const _SectionHeader({
    required this.label,
    required this.icon,
    required this.cs,
    this.optional = false,
  });

  @override
  Widget build(BuildContext context) {
    return Row(children: [
      Icon(icon, color: cs.primary, size: 18),
      const SizedBox(width: 8),
      Text(
        label,
        style: TextStyle(
          fontSize:   15,
          fontWeight: FontWeight.w700,
          color:      cs.onSurface,
          fontFamily: 'Inter',
        ),
      ),
      if (optional) ...[
        const SizedBox(width: 8),
        Text(
          '(optional)',
          style: TextStyle(
            fontSize:   12,
            color:      cs.onSurfaceVariant,
            fontFamily: 'Inter',
          ),
        ),
      ],
    ]);
  }
}

// ── Dropdown field ────────────────────────────────────────────────────────────

class _DropdownField extends StatelessWidget {
  final String         label;
  final IconData       icon;
  final String?        value;
  final List<String>   options;
  final String         hint;
  final ColorScheme    cs;
  final AminaColors    amina;
  final ValueChanged<String?> onChanged;

  const _DropdownField({
    required this.label,
    required this.icon,
    required this.value,
    required this.options,
    required this.hint,
    required this.cs,
    required this.amina,
    required this.onChanged,
  });

  @override
  Widget build(BuildContext context) {
    return DropdownButtonFormField<String>(
      value:       value,
      hint:        Text(hint,
          style: TextStyle(
              color: cs.onSurfaceVariant.withValues(alpha: 0.55),
              fontSize: 14, fontFamily: 'Inter')),
      onChanged:   onChanged,
      style:       TextStyle(
          fontSize: 16, color: cs.onSurface, fontFamily: 'Inter'),
      dropdownColor: amina.inputFill,
      decoration: InputDecoration(
        labelText:  label,
        labelStyle: TextStyle(
            color: cs.onSurfaceVariant, fontFamily: 'Inter'),
        prefixIcon: Icon(icon, color: cs.primary, size: 20),
        filled:     true,
        fillColor:  amina.inputFill,
        contentPadding: const EdgeInsets.symmetric(
            horizontal: 20, vertical: 18),
        border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(16),
          borderSide:   BorderSide(color: amina.cardBorder),
        ),
        enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(16),
          borderSide:   BorderSide(color: amina.cardBorder),
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(16),
          borderSide:   BorderSide(color: cs.primary, width: 1.5),
        ),
      ),
      items: options
          .map((o) => DropdownMenuItem(
                value: o,
                child: Text(o,
                    style: TextStyle(
                        fontFamily: 'Inter', color: cs.onSurface)),
              ))
          .toList(),
    );
  }
}
