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
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../../core/theme/app_theme.dart';
import '../../../auth/presentation/providers/auth_provider.dart';

class ProfileDetailsScreen extends ConsumerStatefulWidget {
  const ProfileDetailsScreen({super.key});

  @override
  ConsumerState<ProfileDetailsScreen> createState() =>
      _ProfileDetailsScreenState();
}

class _ProfileDetailsScreenState
    extends ConsumerState<ProfileDetailsScreen> {
  late final TextEditingController _nameCtrl;
  late final TextEditingController _emailCtrl;
  late final TextEditingController _ageCtrl;
  late final TextEditingController _regionCtrl;
  late final TextEditingController _phoneCtrl;

  String?     _gender;
  Set<String> _conditions = {};

  static const _genders = [
    'Male', 'Female', 'Non-binary', 'Prefer not to say',
  ];

  static const _allConditions = [
    'Type 1 Diabetes',
    'Type 2 Diabetes',
    'Hypertension',
    'Heart Disease',
    'Asthma',
    'Chronic Kidney Disease',
    'COPD',
    'Depression / Anxiety',
    'Arthritis',
    'Obesity',
  ];

  @override
  void initState() {
    super.initState();
    final user  = ref.read(authProvider).user;
    _nameCtrl   = TextEditingController(text: user?.name   ?? '');
    _emailCtrl  = TextEditingController(text: user?.email  ?? '');
    _ageCtrl    = TextEditingController(text: user?.age?.toString() ?? '');
    _regionCtrl = TextEditingController(text: user?.region ?? '');
    _phoneCtrl  = TextEditingController();
    _gender     = user?.gender;
    _conditions = Set.from(user?.conditions ?? []);
  }

  @override
  void dispose() {
    _nameCtrl.dispose();
    _emailCtrl.dispose();
    _ageCtrl.dispose();
    _regionCtrl.dispose();
    _phoneCtrl.dispose();
    super.dispose();
  }

  String get _initials {
    final parts = _nameCtrl.text.trim().split(' ')
        .where((w) => w.isNotEmpty)
        .toList();
    if (parts.isEmpty) return '?';
    if (parts.length == 1) return parts[0][0].toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
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
          'Profile Details',
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

          // ── Avatar ──────────────────────────────────────────────────────
          Center(
            child: Stack(
              children: [
                Container(
                  width:  88,
                  height: 88,
                  decoration: BoxDecoration(
                    gradient: const LinearGradient(
                      colors: [Color(0xFF3D9970), Color(0xFF1E6B4A)],
                      begin:  Alignment.topLeft,
                      end:    Alignment.bottomRight,
                    ),
                    shape: BoxShape.circle,
                    boxShadow: [
                      BoxShadow(
                        color:      const Color(0xFF3D9970).withValues(alpha: 0.35),
                        blurRadius: 20,
                        offset:     const Offset(0, 6),
                      ),
                    ],
                  ),
                  child: Center(
                    child: Text(
                      _initials,
                      style: const TextStyle(
                        color:      Colors.white,
                        fontSize:   30,
                        fontWeight: FontWeight.w800,
                      ),
                    ),
                  ),
                ),
                Positioned(
                  bottom: 0,
                  right:  0,
                  child: Container(
                    width:  28,
                    height: 28,
                    decoration: BoxDecoration(
                      color:  cs.primary,
                      shape:  BoxShape.circle,
                      border: Border.all(color: cs.surface, width: 2.5),
                    ),
                    child: const Icon(Icons.camera_alt_rounded,
                        color: Colors.white, size: 14),
                  ),
                ),
              ],
            ),
          ),


          const SizedBox(height: 28),

          // ── Personal info ────────────────────────────────────────────────
          _SectionHeader('Personal Information', cs),
          const SizedBox(height: 12),
          _SettingsCard(
            cs:    cs,
            amina: amina,
            children: [
              _EditField(
                label:    'Full Name',
                ctrl:     _nameCtrl,
                icon:     Icons.person_outline_rounded,
                cs:       cs,
                amina:    amina,
                readOnly: true,
              ),
              _Div(cs: cs, amina: amina),
              _EditField(
                label:        'Email Address',
                ctrl:         _emailCtrl,
                icon:         Icons.mail_outline_rounded,
                cs:           cs,
                amina:        amina,
                keyboardType: TextInputType.emailAddress,
                readOnly:     true,
                trailing: Container(
                  padding: const EdgeInsets.symmetric(
                      horizontal: 8, vertical: 3),
                  decoration: BoxDecoration(
                    color:        cs.primaryContainer,
                    borderRadius: BorderRadius.circular(12),
                  ),
                  child: Text(
                    'Verified',
                    style: TextStyle(
                      fontSize:   10,
                      fontWeight: FontWeight.w700,
                      color:      cs.primary,
                    ),
                  ),
                ),
              ),
              _Div(cs: cs, amina: amina),
              _EditField(
                label:        'Phone Number',
                ctrl:         _phoneCtrl,
                icon:         Icons.phone_outlined,
                cs:           cs,
                amina:        amina,
                keyboardType: TextInputType.phone,
                hint:         'Not set',
                readOnly:     true,
              ),
              _Div(cs: cs, amina: amina),
              _EditField(
                label:    'Age',
                ctrl:     _ageCtrl,
                icon:     Icons.cake_outlined,
                cs:       cs,
                amina:    amina,
                readOnly: true,
              ),
              _Div(cs: cs, amina: amina),
              _EditField(
                label:    'Region / City',
                ctrl:     _regionCtrl,
                icon:     Icons.location_on_outlined,
                cs:       cs,
                amina:    amina,
                readOnly: true,
              ),
            ],
          ),

          const SizedBox(height: 24),

          // ── Gender ───────────────────────────────────────────────────────
          _SectionHeader('Gender', cs),
          const SizedBox(height: 12),
          _SettingsCard(
            cs:    cs,
            amina: amina,
            children: [
              Padding(
                padding: const EdgeInsets.all(16),
                child: Wrap(
                  spacing:    10,
                  runSpacing: 10,
                  children: _genders.map((g) {
                    final on = _gender == g;
                    return AnimatedContainer(
                        duration: const Duration(milliseconds: 180),
                        padding: const EdgeInsets.symmetric(
                            horizontal: 16, vertical: 9),
                        decoration: BoxDecoration(
                          color: on
                              ? cs.primary.withValues(alpha: 0.10)
                              : amina.inputFill,
                          borderRadius: BorderRadius.circular(20),
                          border: Border.all(
                            color: on
                                ? cs.primary.withValues(alpha: 0.50)
                                : amina.cardBorder,
                            width: on ? 1.8 : 1.2,
                          ),
                        ),
                        child: Text(
                          g,
                          style: TextStyle(
                            fontSize:   14,
                            fontWeight: on
                                ? FontWeight.w700
                                : FontWeight.w500,
                            color: on ? cs.primary : cs.onSurface,
                          ),
                        ),
                      );
                  }).toList(),
                ),
              ),
            ],
          ),

          const SizedBox(height: 24),

          // ── Health conditions ────────────────────────────────────────────
          _SectionHeader('Health Conditions', cs),
          const SizedBox(height: 4),
          Text(
            'Select all that apply — Amina uses this to personalise your care.',
            style: TextStyle(
              fontSize: 12.5,
              color:    cs.onSurfaceVariant,
              height:   1.4,
            ),
          ),
          const SizedBox(height: 12),
          _SettingsCard(
            cs:    cs,
            amina: amina,
            children: [
              Padding(
                padding: const EdgeInsets.all(16),
                child: Wrap(
                  spacing:    10,
                  runSpacing: 10,
                  children: _allConditions.map((c) {
                    final on = _conditions.contains(c);
                    return AnimatedContainer(
                        duration: const Duration(milliseconds: 180),
                        padding: const EdgeInsets.symmetric(
                            horizontal: 14, vertical: 8),
                        decoration: BoxDecoration(
                          color: on
                              ? cs.primary.withValues(alpha: 0.10)
                              : amina.inputFill,
                          borderRadius: BorderRadius.circular(20),
                          border: Border.all(
                            color: on
                                ? cs.primary.withValues(alpha: 0.50)
                                : amina.cardBorder,
                            width: on ? 1.8 : 1.2,
                          ),
                        ),
                        child: Row(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            if (on) ...[
                              Icon(Icons.check_rounded,
                                  color: cs.primary, size: 13),
                              const SizedBox(width: 5),
                            ],
                            Text(
                              c,
                              style: TextStyle(
                                fontSize:   13,
                                fontWeight: on
                                    ? FontWeight.w700
                                    : FontWeight.w500,
                                color: on ? cs.primary : cs.onSurface,
                              ),
                            ),
                          ],
                        ),
                      );
                  }).toList(),
                ),
              ),
            ],
          ),

          const SizedBox(height: 48),
        ],
      ),
    );
  }
}

// ─── Shared helpers ───────────────────────────────────────────────────────────

class _SectionHeader extends StatelessWidget {
  final String      text;
  final ColorScheme cs;
  const _SectionHeader(this.text, this.cs);

  @override
  Widget build(BuildContext context) => Text(
        text,
        style: TextStyle(
          fontSize:      13,
          fontWeight:    FontWeight.w700,
          color:         cs.onSurfaceVariant,
          letterSpacing: 0.8,
        ),
      );
}

class _SettingsCard extends StatelessWidget {
  final List<Widget> children;
  final ColorScheme  cs;
  final AminaColors  amina;
  const _SettingsCard({
    required this.children,
    required this.cs,
    required this.amina,
  });

  @override
  Widget build(BuildContext context) => Container(
        decoration: BoxDecoration(
          color:        cs.surface,
          borderRadius: BorderRadius.circular(22),
          border:       Border.all(color: amina.cardBorder),
          boxShadow: const [
            BoxShadow(
              color:      Color(0x06000000),
              blurRadius: 16,
              offset:     Offset(0, 4),
            ),
          ],
        ),
        child: Column(children: children),
      );
}

class _Div extends StatelessWidget {
  final ColorScheme cs;
  final AminaColors amina;
  const _Div({required this.cs, required this.amina});

  @override
  Widget build(BuildContext context) => Divider(
        height: 1,
        indent: 56,
        color:  amina.cardBorder,
      );
}

class _EditField extends StatelessWidget {
  final String                label;
  final TextEditingController ctrl;
  final IconData              icon;
  final ColorScheme           cs;
  final AminaColors           amina;
  final TextInputType         keyboardType;
  final bool                  readOnly;
  final String?               hint;
  final Widget?               trailing;

  const _EditField({
    required this.label,
    required this.ctrl,
    required this.icon,
    required this.cs,
    required this.amina,
    this.keyboardType = TextInputType.text,
    this.readOnly     = false,
    this.hint,
    this.trailing,
  });

  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
        child: Row(
          children: [
            Container(
              width:  38,
              height: 38,
              decoration: BoxDecoration(
                color:  cs.primaryContainer,
                shape:  BoxShape.circle,
              ),
              child: Icon(icon, color: cs.primary, size: 19),
            ),
            const SizedBox(width: 14),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    label,
                    style: TextStyle(
                      fontSize:   11,
                      fontWeight: FontWeight.w600,
                      color:      cs.onSurfaceVariant,
                    ),
                  ),
                  const SizedBox(height: 4),
                  TextField(
                    controller:   ctrl,
                    keyboardType: keyboardType,
                    readOnly:     readOnly,
                    style: TextStyle(
                      fontSize:   15,
                      fontWeight: FontWeight.w500,
                      color:      readOnly
                          ? cs.onSurfaceVariant
                          : cs.onSurface,
                    ),
                    decoration: InputDecoration(
                      isDense:        true,
                      contentPadding: EdgeInsets.zero,
                      border:         InputBorder.none,
                      hintText:       hint ?? 'Not set',
                      hintStyle: TextStyle(
                        color:    cs.onSurfaceVariant.withValues(alpha: 0.45),
                        fontSize: 15,
                      ),
                    ),
                  ),
                ],
              ),
            ),
            if (trailing != null) ...[
              const SizedBox(width: 8),
              trailing!,
            ] else if (!readOnly)
              Icon(Icons.edit_rounded,
                  size: 15, color: cs.onSurfaceVariant.withValues(alpha: 0.45)),
          ],
        ),
      );
}
