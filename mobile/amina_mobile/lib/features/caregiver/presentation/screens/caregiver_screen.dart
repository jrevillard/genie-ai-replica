import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../../core/components/amina_header.dart';
import '../../../../core/theme/app_theme.dart';
import '../../../auth/presentation/providers/auth_provider.dart';
import '../../domain/entities/bantaba_circle.dart';
import '../../domain/entities/assigned_caregiver.dart';
import '../../domain/entities/caregiver_directory_entry.dart';
import '../../data/repositories/bantaba_repository_impl.dart';
import '../providers/caregiver_provider.dart';
import 'caregiver_health_view.dart';

// Data-identity accent colours — semantic meaning, not theme-adaptive.
const _kFamilyRose = Color(0xFFE11D48);
const _kProIndigo  = Color(0xFF4F46E5);
const _kSage       = Color(0xFF3D9970);

// ═══════════════════════════════════════════════════════════════════════════════
// ROOT SCREEN
// ═══════════════════════════════════════════════════════════════════════════════

class CaregiverScreen extends ConsumerWidget {
  const CaregiverScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final amina = Theme.of(context).extension<AminaColors>()!;
    final ready = ref.watch(caregiverReadyProvider);
    return ready.when(
      loading: () => Scaffold(
        backgroundColor: amina.scaffoldBg,
        body: const SizedBox.shrink(),
      ),
      error: (_, __) => Scaffold(backgroundColor: amina.scaffoldBg),
      data:  (_) => const _CaregiverBody(),
    );
  }
}

class _CaregiverBody extends ConsumerWidget {
  const _CaregiverBody();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final amina = Theme.of(context).extension<AminaColors>()!;
    final mode  = ref.watch(caregiverModeProvider);

    return Scaffold(
      backgroundColor: amina.scaffoldBg,
      appBar: const AminaHeader(title: 'My Support Circle'),
      body: CustomScrollView(
        key: ValueKey(mode),
        slivers: [
          const SliverToBoxAdapter(child: _HeroSection()),
          SliverToBoxAdapter(child: _ModeToggle(mode: mode)),
          if (mode == CaregiverMode.family) ...[
            const SliverToBoxAdapter(child: _FamilyView()),
          ] else ...[
            const _AssignedCaregiversSection(),
            const SliverToBoxAdapter(child: _ProHeaderView()),
            const _ProSliverList(),
          ],
          const SliverToBoxAdapter(child: SizedBox(height: 110)),
        ],
      ),
    );
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// HERO SECTION
// ═══════════════════════════════════════════════════════════════════════════════

class _HeroSection extends StatelessWidget {
  const _HeroSection();

  @override
  Widget build(BuildContext context) {
    final cs    = Theme.of(context).colorScheme;
    final amina = Theme.of(context).extension<AminaColors>()!;

    return Container(
      width: double.infinity,
      padding: const EdgeInsets.fromLTRB(24, 60, 24, 32),
      decoration: BoxDecoration(
        gradient: LinearGradient(
          colors: [cs.primaryContainer, cs.tertiaryContainer],
          begin: Alignment.topLeft,
          end:   Alignment.bottomRight,
        ),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Container(
                width:  62,
                height: 62,
                decoration: BoxDecoration(
                  color:  cs.surface,
                  shape:  BoxShape.circle,
                  border: Border.all(
                    color: cs.primary.withValues(alpha: 0.30),
                    width: 1.5,
                  ),
                ),
                child: const Center(
                  child: Text('🤝', style: TextStyle(fontSize: 28)),
                ),
              ),
              const SizedBox(width: 16),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      'Your Support Circle',
                      style: TextStyle(
                        fontSize:      26,
                        fontWeight:    FontWeight.w900,
                        color:         cs.onSurface,
                        height:        1.1,
                        letterSpacing: -0.5,
                      ),
                    ),
                    const SizedBox(height: 4),
                    Text(
                      'Family love or professional care — your choice.',
                      style: TextStyle(
                        fontSize: 13.5,
                        color:    cs.onSurfaceVariant,
                        height:   1.4,
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),

          const SizedBox(height: 24),

          Row(
            children: [
              _HeroStat(label: 'Families\nConnected', value: '1,240+', cs: cs, amina: amina),
              _HeroStat(label: 'Verified\nProfessionals', value: '86', cs: cs, amina: amina),
              _HeroStat(label: 'Avg\nRating', value: '4.8 ⭐', cs: cs, amina: amina),
            ],
          ),
        ],
      ),
    );
  }
}

class _HeroStat extends StatelessWidget {
  final String      label;
  final String      value;
  final ColorScheme cs;
  final AminaColors amina;
  const _HeroStat({
    required this.label,
    required this.value,
    required this.cs,
    required this.amina,
  });

  @override
  Widget build(BuildContext context) => Expanded(
        child: Container(
          margin: const EdgeInsets.only(right: 10),
          padding: const EdgeInsets.symmetric(vertical: 10, horizontal: 12),
          decoration: BoxDecoration(
            color:        amina.inputFill,
            borderRadius: BorderRadius.circular(14),
            border:       Border.all(color: amina.cardBorder),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                value,
                style: TextStyle(
                  fontSize:   17,
                  fontWeight: FontWeight.w800,
                  color:      cs.onSurface,
                ),
              ),
              const SizedBox(height: 2),
              Text(
                label,
                style: TextStyle(
                  fontSize:   10,
                  color:      cs.onSurfaceVariant,
                  height:     1.3,
                  fontWeight: FontWeight.w500,
                ),
              ),
            ],
          ),
        ),
      );
}

// ═══════════════════════════════════════════════════════════════════════════════
// MODE TOGGLE
// ═══════════════════════════════════════════════════════════════════════════════

class _ModeToggle extends ConsumerWidget {
  final CaregiverMode mode;
  const _ModeToggle({required this.mode});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final amina = Theme.of(context).extension<AminaColors>()!;

    return Container(
      margin:  const EdgeInsets.fromLTRB(16, 16, 16, 0),
      padding: const EdgeInsets.all(4),
      decoration: BoxDecoration(
        color:        amina.inputFill,
        borderRadius: BorderRadius.circular(20),
        border:       Border.all(color: amina.cardBorder),
      ),
      child: Row(
        children: [
          _TogglePill(
            icon:   Icons.people_rounded,
            label:  'Family',
            active: mode == CaregiverMode.family,
            accent: _kFamilyRose,
            onTap:  () => ref.read(caregiverModeProvider.notifier).state =
                CaregiverMode.family,
          ),
          _TogglePill(
            icon:   Icons.medical_services_rounded,
            label:  'Professional',
            active: mode == CaregiverMode.professional,
            accent: _kProIndigo,
            onTap:  () => ref.read(caregiverModeProvider.notifier).state =
                CaregiverMode.professional,
          ),
        ],
      ),
    );
  }
}

class _TogglePill extends StatelessWidget {
  final IconData     icon;
  final String       label;
  final bool         active;
  final Color        accent;
  final VoidCallback onTap;

  const _TogglePill({
    required this.icon,
    required this.label,
    required this.active,
    required this.accent,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;

    return Expanded(
      child: GestureDetector(
        onTap: onTap,
        child: AnimatedContainer(
          duration: const Duration(milliseconds: 220),
          curve:    Curves.easeInOut,
          padding:  const EdgeInsets.symmetric(vertical: 14),
          decoration: BoxDecoration(
            color:        active ? cs.surface : Colors.transparent,
            borderRadius: BorderRadius.circular(16),
            boxShadow: active
                ? [
                    BoxShadow(
                      color:      cs.shadow.withValues(alpha: 0.08),
                      blurRadius: 10,
                      offset:     const Offset(0, 3),
                    ),
                  ]
                : null,
          ),
          child: Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Icon(
                icon,
                size:  18,
                color: active ? accent : cs.onSurfaceVariant,
              ),
              const SizedBox(width: 6),
              Text(
                label,
                style: TextStyle(
                  fontSize:   15,
                  fontWeight: active ? FontWeight.w700 : FontWeight.w500,
                  color:      active ? cs.onSurface : cs.onSurfaceVariant,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// FAMILY VIEW
// ═══════════════════════════════════════════════════════════════════════════════

class _FamilyView extends ConsumerWidget {
  const _FamilyView();

  static const _avatars = ['👩', '👨', '👵', '👴', '🧑', '👦', '👧'];

  static ConnectedMember _toMember(BantabaMember m, int index) {
    return ConnectedMember(
      id:           m.id,
      name:         m.name,
      relationship: m.conditions.isNotEmpty
          ? m.conditions.first
          : 'Family member',
      avatar:       _avatars[index % _avatars.length],
      lastSeen:     m.addedAt.isNotEmpty ? 'Joined ${_shortDate(m.addedAt)}' : 'Connected',
      isOnline:     false,
    );
  }

  static String _shortDate(String iso) {
    try {
      final dt = DateTime.parse(iso);
      return '${dt.day}/${dt.month}/${dt.year}';
    } catch (_) {
      return '';
    }
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final async = ref.watch(bantabaCircleProvider);

    return async.when(
      loading: () => const Padding(
        padding: EdgeInsets.symmetric(vertical: 48),
        child:   Center(child: CircularProgressIndicator()),
      ),
      error: (_, __) => const Padding(
        padding: EdgeInsets.fromLTRB(16, 20, 16, 0),
        child:   _CodeEntryCard(),
      ),
      data: (circle) {
        final familyMembers = circle.members
            .asMap()
            .entries
            .map((e) => _toMember(e.value, e.key))
            .toList();

        return Padding(
          padding: const EdgeInsets.fromLTRB(16, 20, 16, 0),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              if (familyMembers.isNotEmpty) ...[
                _ConnectedMembersCard(members: familyMembers),
                const SizedBox(height: 20),
              ],
              const _CodeEntryCard(),
              const SizedBox(height: 20),
              _MyCodeCard(aminaId: circle.ownerId),
            ],
          ),
        );
      },
    );
  }
}

// ─── My shareable code card ───────────────────────────────────────────────────

class _MyCodeCard extends StatelessWidget {
  final String aminaId;
  const _MyCodeCard({required this.aminaId});

  @override
  Widget build(BuildContext context) {
    final code   = aminaId;
    final digits = code.split('');
    final cs    = Theme.of(context).colorScheme;
    final amina = Theme.of(context).extension<AminaColors>()!;

    return Container(
      width:   double.infinity,
      padding: const EdgeInsets.fromLTRB(22, 24, 22, 24),
      decoration: BoxDecoration(
        gradient: LinearGradient(
          colors: [cs.primaryContainer, cs.tertiaryContainer],
          begin:  Alignment.topLeft,
          end:    Alignment.bottomRight,
        ),
        borderRadius: BorderRadius.circular(24),
        border: Border.all(color: amina.cardBorder),
        boxShadow: [
          BoxShadow(
            color:      amina.sageGlow,
            blurRadius: 20,
            offset:     const Offset(0, 8),
          ),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                decoration: BoxDecoration(
                  color:        cs.primary.withValues(alpha: 0.20),
                  borderRadius: BorderRadius.circular(20),
                  border:       Border.all(color: cs.primary.withValues(alpha: 0.40)),
                ),
                child: Text(
                  'YOUR FAMILY CODE',
                  style: TextStyle(
                    fontSize:      10,
                    fontWeight:    FontWeight.w800,
                    color:         cs.primary,
                    letterSpacing: 1.0,
                  ),
                ),
              ),
              const Spacer(),
              Container(
                width:  8, height: 8,
                decoration: BoxDecoration(
                  color: cs.primary, shape: BoxShape.circle,
                ),
              ),
              const SizedBox(width: 6),
              Text(
                'Active',
                style: TextStyle(
                  fontSize:   11,
                  fontWeight: FontWeight.w600,
                  color:      cs.onSurfaceVariant,
                ),
              ),
            ],
          ),

          const SizedBox(height: 20),

          FittedBox(
            fit: BoxFit.scaleDown,
            child: Row(
              mainAxisSize:      MainAxisSize.min,
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                for (int i = 0; i < digits.length; i++) ...[
                  _CodeDisplayBox(digit: digits[i]),
                  if (i < digits.length - 1) const SizedBox(width: 6),
                ],
              ],
            ),
          ),

          const SizedBox(height: 18),

          Text(
            'Share this code with a family member so\nthey can connect with you on Amina.',
            style: TextStyle(
              fontSize: 13,
              color:    cs.onSurfaceVariant,
              height:   1.45,
            ),
          ),

          const SizedBox(height: 18),

          Row(
            children: [
              Expanded(
                child: _HeroButton(
                  icon:  Icons.copy_rounded,
                  label: 'Copy Code',
                  onTap: () {
                    Clipboard.setData(ClipboardData(text: code));
                    ScaffoldMessenger.of(context).showSnackBar(
                      SnackBar(
                        content: const Text('Code copied to clipboard'),
                        backgroundColor: _kSage,
                        behavior: SnackBarBehavior.floating,
                        shape: RoundedRectangleBorder(
                          borderRadius: BorderRadius.circular(12)),
                      ),
                    );
                  },
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: _HeroButton(
                  icon:  Icons.share_rounded,
                  label: 'Share',
                  onTap: () {},
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

class _CodeDisplayBox extends StatelessWidget {
  final String digit;
  const _CodeDisplayBox({required this.digit});

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    return Container(
      width:  46,
      height: 58,
      decoration: BoxDecoration(
        color:        cs.surface,
        borderRadius: BorderRadius.circular(12),
        border:       Border.all(
          color: cs.primary.withValues(alpha: 0.45),
          width: 1.5,
        ),
      ),
      child: Center(
        child: Text(
          digit,
          style: TextStyle(
            fontSize:      26,
            fontWeight:    FontWeight.w900,
            color:         cs.onSurface,
            letterSpacing: -0.5,
          ),
        ),
      ),
    );
  }
}

class _HeroButton extends StatelessWidget {
  final IconData     icon;
  final String       label;
  final VoidCallback onTap;
  const _HeroButton({
    required this.icon,
    required this.label,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    return Material(
      color:        cs.surface.withValues(alpha: 0.60),
      borderRadius: BorderRadius.circular(14),
      child: InkWell(
        onTap:        onTap,
        borderRadius: BorderRadius.circular(14),
        splashColor:  cs.primary.withValues(alpha: 0.08),
        child: Padding(
          padding: const EdgeInsets.symmetric(vertical: 13),
          child: Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Icon(icon, color: cs.primary, size: 17),
              const SizedBox(width: 7),
              Text(
                label,
                style: TextStyle(
                  color:      cs.onSurface,
                  fontSize:   14,
                  fontWeight: FontWeight.w600,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

// ─── Add member request card ──────────────────────────────────────────────────

class _CodeEntryCard extends ConsumerStatefulWidget {
  const _CodeEntryCard();

  @override
  ConsumerState<_CodeEntryCard> createState() => _CodeEntryCardState();
}

class _CodeEntryCardState extends ConsumerState<_CodeEntryCard> {
  final _idCtrl = TextEditingController();

  static const _relations = [
    'Son', 'Daughter', 'Spouse', 'Parent', 'Sibling', 'Other',
  ];

  @override
  void dispose() {
    _idCtrl.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final cs    = Theme.of(context).colorScheme;
    final amina = Theme.of(context).extension<AminaColors>()!;

    final state     = ref.watch(addMemberProvider);
    final notifier  = ref.read(addMemberProvider.notifier);
    final isLoading = state.status == ConnectStatus.loading;
    final isSuccess = state.status == ConnectStatus.success;

    ref.listen<AddMemberState>(addMemberProvider, (_, next) {
      if (next.status == ConnectStatus.idle && next.candidateAminaId.isEmpty) {
        _idCtrl.clear();
      }
    });

    return Container(
      width:   double.infinity,
      padding: const EdgeInsets.fromLTRB(22, 24, 22, 24),
      decoration: BoxDecoration(
        color:        cs.surface,
        borderRadius: BorderRadius.circular(24),
        border:       Border.all(color: amina.cardBorder),
        boxShadow: [
          BoxShadow(
            color:      amina.sageGlow,
            blurRadius: 16,
            offset:     const Offset(0, 4),
          ),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Header
          Row(
            children: [
              Container(
                width:  40,
                height: 40,
                decoration: BoxDecoration(
                  color: cs.primaryContainer,
                  shape: BoxShape.circle,
                ),
                child: Icon(Icons.person_add_rounded, color: cs.primary, size: 20),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      'Add a Family Member',
                      style: TextStyle(
                        fontSize:   17,
                        fontWeight: FontWeight.w700,
                        color:      cs.onSurface,
                      ),
                    ),
                    const SizedBox(height: 2),
                    Text(
                      'Enter their AMINA ID to send a request',
                      style: TextStyle(fontSize: 13, color: cs.onSurfaceVariant),
                    ),
                  ],
                ),
              ),
            ],
          ),

          const SizedBox(height: 20),

          _FormLabel(label: 'AMINA ID'),
          const SizedBox(height: 6),
          _FormField(
            controller: _idCtrl,
            hint:       'Enter their 10-character AMINA ID',
            onChanged:  notifier.setAminaId,
            enabled:    !isLoading && !isSuccess,
          ),

          const SizedBox(height: 16),

          _FormLabel(label: 'Relationship'),
          const SizedBox(height: 8),
          Wrap(
            spacing:    8,
            runSpacing: 8,
            children: _relations.map((r) {
              final selected = state.relation == r;
              return GestureDetector(
                onTap: (!isLoading && !isSuccess)
                    ? () => notifier.setRelation(r)
                    : null,
                child: AnimatedContainer(
                  duration: const Duration(milliseconds: 160),
                  padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
                  decoration: BoxDecoration(
                    color:        selected ? cs.primary : cs.surface,
                    borderRadius: BorderRadius.circular(30),
                    border:       Border.all(
                      color: selected ? cs.primary : amina.cardBorder,
                    ),
                  ),
                  child: Text(
                    r,
                    style: TextStyle(
                      fontSize:   13,
                      fontWeight: selected ? FontWeight.w700 : FontWeight.w500,
                      color:      selected ? Colors.white : cs.onSurfaceVariant,
                    ),
                  ),
                ),
              );
            }).toList(),
          ),

          if (state.errorMsg != null) ...[
            const SizedBox(height: 12),
            Container(
              width:   double.infinity,
              padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
              decoration: BoxDecoration(
                color:        const Color(0xFFFEF2F2),
                borderRadius: BorderRadius.circular(12),
                border:       Border.all(
                  color: const Color(0xFFF87171).withValues(alpha: 0.50)),
              ),
              child: Row(
                children: [
                  const Icon(Icons.error_outline_rounded,
                      color: Color(0xFFEF4444), size: 16),
                  const SizedBox(width: 8),
                  Expanded(
                    child: Text(
                      state.errorMsg!,
                      style: const TextStyle(
                        fontSize: 13, color: Color(0xFFB91C1C), height: 1.4,
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ],

          if (isSuccess) ...[
            const SizedBox(height: 12),
            Container(
              width:   double.infinity,
              padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
              decoration: BoxDecoration(
                color:        cs.primaryContainer,
                borderRadius: BorderRadius.circular(12),
                border:       Border.all(color: cs.primary.withValues(alpha: 0.40)),
              ),
              child: Row(
                children: [
                  Icon(Icons.check_circle_rounded, color: cs.primary, size: 18),
                  const SizedBox(width: 8),
                  Expanded(
                    child: Text(
                      'Request sent! Waiting for approval.',
                      style: TextStyle(
                        fontSize:   13,
                        color:      cs.primary,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ],

          const SizedBox(height: 20),

          SizedBox(
            width:  double.infinity,
            height: 56,
            child: ElevatedButton(
              onPressed: (!state.isComplete || isLoading || isSuccess)
                  ? null
                  : notifier.submit,
              style: ElevatedButton.styleFrom(
                backgroundColor:         cs.primary,
                disabledBackgroundColor: amina.cardBorder,
                foregroundColor:         Colors.white,
                disabledForegroundColor: cs.onSurfaceVariant,
                elevation:               0,
                shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(18)),
              ),
              child: isLoading
                  ? const SizedBox(
                      width:  22,
                      height: 22,
                      child:  CircularProgressIndicator(
                        color: Colors.white, strokeWidth: 2.5,
                      ),
                    )
                  : const Row(
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: [
                        Icon(Icons.send_rounded, size: 18),
                        SizedBox(width: 8),
                        Text(
                          'Send Request',
                          style: TextStyle(
                            fontSize: 16, fontWeight: FontWeight.w700,
                          ),
                        ),
                      ],
                    ),
            ),
          ),

          if (state.status != ConnectStatus.idle) ...[
            const SizedBox(height: 12),
            Center(
              child: GestureDetector(
                onTap: notifier.reset,
                child: Text(
                  'Clear & try again',
                  style: TextStyle(
                    fontSize:        13,
                    color:           cs.onSurfaceVariant.withValues(alpha: 0.70),
                    decoration:      TextDecoration.underline,
                    decorationColor: cs.onSurfaceVariant.withValues(alpha: 0.40),
                  ),
                ),
              ),
            ),
          ],
        ],
      ),
    );
  }
}

class _FormLabel extends StatelessWidget {
  final String label;
  const _FormLabel({required this.label});

  @override
  Widget build(BuildContext context) => Text(
        label,
        style: TextStyle(
          fontSize:   13,
          fontWeight: FontWeight.w600,
          color:      Theme.of(context).colorScheme.onSurfaceVariant,
        ),
      );
}

class _FormField extends StatelessWidget {
  final TextEditingController controller;
  final String                hint;
  final ValueChanged<String>  onChanged;
  final bool                  enabled;

  const _FormField({
    required this.controller,
    required this.hint,
    required this.onChanged,
    this.enabled = true,
  });

  @override
  Widget build(BuildContext context) {
    final cs    = Theme.of(context).colorScheme;
    final amina = Theme.of(context).extension<AminaColors>()!;

    return Container(
      decoration: BoxDecoration(
        color:        enabled ? amina.inputFill : amina.scaffoldBg,
        borderRadius: BorderRadius.circular(14),
        border:       Border.all(color: amina.cardBorder),
      ),
      child: TextField(
        controller:  controller,
        onChanged:   onChanged,
        enabled:     enabled,
        style: TextStyle(fontSize: 15, color: cs.onSurface),
        decoration: InputDecoration(
          hintText:       hint,
          hintStyle:      TextStyle(
            color:    cs.onSurfaceVariant.withValues(alpha: 0.55),
            fontSize: 14,
          ),
          border:         InputBorder.none,
          contentPadding: const EdgeInsets.symmetric(
              horizontal: 16, vertical: 14),
        ),
      ),
    );
  }
}

// ─── Connected members card ───────────────────────────────────────────────────

class _ConnectedMembersCard extends ConsumerWidget {
  final List<ConnectedMember> members;
  const _ConnectedMembersCard({required this.members});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final cs    = Theme.of(context).colorScheme;
    final amina = Theme.of(context).extension<AminaColors>()!;

    return Container(
      width:   double.infinity,
      padding: const EdgeInsets.fromLTRB(22, 20, 22, 20),
      decoration: BoxDecoration(
        color:        cs.surface,
        borderRadius: BorderRadius.circular(24),
        border:       Border.all(color: amina.cardBorder),
        boxShadow: [
          BoxShadow(
            color:      amina.sageGlow,
            blurRadius: 16,
            offset:     const Offset(0, 4),
          ),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Text(
                'Connected Family',
                style: TextStyle(
                  fontSize:   17,
                  fontWeight: FontWeight.w700,
                  color:      cs.onSurface,
                ),
              ),
              const SizedBox(width: 8),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 2),
                decoration: BoxDecoration(
                  color:        cs.primaryContainer,
                  borderRadius: BorderRadius.circular(20),
                ),
                child: Text(
                  '${members.length}',
                  style: TextStyle(
                    fontSize:   12,
                    fontWeight: FontWeight.w700,
                    color:      cs.primary,
                  ),
                ),
              ),
            ],
          ),

          const SizedBox(height: 14),

          for (final m in members) ...[
            _MemberRow(member: m),
            if (m != members.last)
              Divider(height: 1, color: amina.divider),
          ],
        ],
      ),
    );
  }
}

class _MemberRow extends ConsumerWidget {
  final ConnectedMember member;
  const _MemberRow({required this.member});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final cs    = Theme.of(context).colorScheme;
    final amina = Theme.of(context).extension<AminaColors>()!;

    return InkWell(
      onTap: () => Navigator.of(context).push(
        MaterialPageRoute<void>(
          builder: (_) => const CaregiverHealthView(),
        ),
      ),
      borderRadius: BorderRadius.circular(12),
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: 10),
        child: Row(
          children: [
            Stack(
              children: [
                Container(
                  width:  50,
                  height: 50,
                  decoration: BoxDecoration(
                    color: cs.primaryContainer,
                    shape: BoxShape.circle,
                  ),
                  child: Center(
                    child: Text(member.avatar,
                        style: const TextStyle(fontSize: 24)),
                  ),
                ),
                Positioned(
                  bottom: 1, right: 1,
                  child: Container(
                    width:  13,
                    height: 13,
                    decoration: BoxDecoration(
                      color: member.isOnline
                          ? const Color(0xFF22C55E)
                          : amina.cardBorder,
                      shape: BoxShape.circle,
                      border: Border.all(color: cs.surface, width: 2),
                    ),
                  ),
                ),
              ],
            ),
            const SizedBox(width: 12),

            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    member.name,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(
                      fontSize:   16,
                      fontWeight: FontWeight.w700,
                      color:      cs.onSurface,
                    ),
                  ),
                  const SizedBox(height: 2),
                  Text(
                    '${member.relationship}  ·  ${member.lastSeen}',
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(
                      fontSize:   12,
                      color:      member.isOnline
                          ? const Color(0xFF16A34A)
                          : cs.onSurfaceVariant,
                      fontWeight: member.isOnline
                          ? FontWeight.w600
                          : FontWeight.normal,
                    ),
                  ),
                ],
              ),
            ),

            GestureDetector(
              onTap: () => _confirmRemove(context, ref, member),
              child: Padding(
                padding: const EdgeInsets.all(8),
                child: Icon(
                  Icons.link_off_rounded,
                  color: cs.onSurfaceVariant.withValues(alpha: 0.50),
                  size:  20,
                ),
              ),
            ),

            Icon(Icons.chevron_right_rounded,
                color: cs.onSurfaceVariant, size: 20),
          ],
        ),
      ),
    );
  }

  void _confirmRemove(
      BuildContext context, WidgetRef ref, ConnectedMember m) {
    showDialog<void>(
      context: context,
      builder: (ctx) => AlertDialog(
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
        title: Text('Remove ${m.name}?'),
        content: Text(
          '${m.name} will no longer have access to your health data.',
          style: const TextStyle(height: 1.45),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx),
            child: const Text('Cancel'),
          ),
          TextButton(
            onPressed: () async {
              Navigator.pop(ctx);
              final circleId =
                  ref.read(bantabaCircleProvider).value?.circleId ?? '';
              try {
                await ref.read(bantabaRepositoryProvider).removeMember(
                      circleId: circleId,
                      memberId: m.id,
                    );
                ref.invalidate(bantabaCircleProvider);
              } catch (e) {
                if (context.mounted) {
                  ScaffoldMessenger.of(context).showSnackBar(
                    SnackBar(
                      content: Text('Could not remove member: $e'),
                      backgroundColor: const Color(0xFFEF4444),
                      behavior: SnackBarBehavior.floating,
                      shape: RoundedRectangleBorder(
                          borderRadius: BorderRadius.circular(12)),
                    ),
                  );
                }
              }
            },
            child: const Text('Remove',
                style: TextStyle(color: Color(0xFFEF4444))),
          ),
        ],
      ),
    );
  }
}

// ─── Family benefits card (empty state) ──────────────────────────────────────

class _FamilyBenefitsCard extends StatelessWidget {
  const _FamilyBenefitsCard();

  static const _benefits = [
    (Icons.location_on_rounded,       Color(0xFF3B82F6),  'SOS Location Sharing',
     'Your family sees your location when you press SOS.'),
    (Icons.calendar_today_rounded,    Color(0xFFF59E0B),  'Appointment Reminders',
     'Loved ones get alerts about your upcoming appointments.'),
    (Icons.monitor_heart_outlined,    _kSage,             'Health Updates',
     'Share your daily health check-ins automatically.'),
    (Icons.chat_bubble_outline_rounded, Color(0xFFEC4899), 'Care Messaging',
     'Private in-app messaging for your health updates.'),
  ];

  @override
  Widget build(BuildContext context) {
    final cs    = Theme.of(context).colorScheme;
    final amina = Theme.of(context).extension<AminaColors>()!;

    return Container(
      width:   double.infinity,
      padding: const EdgeInsets.fromLTRB(22, 22, 22, 22),
      decoration: BoxDecoration(
        color:        cs.surface,
        borderRadius: BorderRadius.circular(24),
        border:       Border.all(color: amina.cardBorder),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            'Why connect family?',
            style: TextStyle(
              fontSize:   17,
              fontWeight: FontWeight.w700,
              color:      cs.onSurface,
            ),
          ),
          const SizedBox(height: 16),
          for (final (icon, color, title, subtitle) in _benefits) ...[
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Container(
                  width:  38,
                  height: 38,
                  decoration: BoxDecoration(
                    color: color.withValues(alpha: 0.12),
                    shape: BoxShape.circle,
                  ),
                  child: Icon(icon, color: color, size: 18),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        title,
                        style: TextStyle(
                          fontSize:   14,
                          fontWeight: FontWeight.w700,
                          color:      cs.onSurface,
                        ),
                      ),
                      const SizedBox(height: 2),
                      Text(
                        subtitle,
                        style: TextStyle(
                            fontSize: 12.5, color: cs.onSurfaceVariant, height: 1.4),
                      ),
                    ],
                  ),
                ),
              ],
            ),
            if (title != _benefits.last.$3) const SizedBox(height: 14),
          ],
        ],
      ),
    );
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// PROFESSIONAL VIEW
// ═══════════════════════════════════════════════════════════════════════════════

String _initials(String name) {
  final parts = name.trim().split(RegExp(r'\s+'));
  if (parts.length >= 2) {
    return '${parts.first[0]}${parts.last[0]}'.toUpperCase();
  }
  return name.isEmpty ? '?' : name[0].toUpperCase();
}

Color _avatarColor(String name) {
  const palette = [
    Color(0xFF4F46E5), Color(0xFF0891B2), Color(0xFF059669),
    Color(0xFFD97706), Color(0xFFDC2626), Color(0xFF7C3AED),
  ];
  return palette[name.isEmpty ? 0 : name.codeUnitAt(0) % palette.length];
}

// ─── Header: title + search bar ──────────────────────────────────────────────

class _ProHeaderView extends ConsumerWidget {
  const _ProHeaderView();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final cs    = Theme.of(context).colorScheme;
    final amina = Theme.of(context).extension<AminaColors>()!;

    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 20, 16, 0),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            'Find a Caregiver',
            style: TextStyle(
              fontSize:   22,
              fontWeight: FontWeight.w800,
              color:      cs.onSurface,
            ),
          ),
          const SizedBox(height: 4),
          Text(
            'Browse community health workers and submit a formal application',
            style: TextStyle(fontSize: 13, color: cs.onSurfaceVariant),
          ),

          const SizedBox(height: 16),

          Container(
            height:     52,
            decoration: BoxDecoration(
              color:        cs.surface,
              borderRadius: BorderRadius.circular(16),
              border:       Border.all(color: amina.cardBorder),
              boxShadow: [
                BoxShadow(color: amina.sageGlow, blurRadius: 8),
              ],
            ),
            child: TextField(
              onChanged: (v) =>
                  ref.read(proSearchQueryProvider.notifier).state = v,
              style: TextStyle(fontSize: 15, color: cs.onSurface),
              decoration: InputDecoration(
                hintText:       'Search by name or specialty…',
                hintStyle:      TextStyle(color: cs.onSurfaceVariant),
                filled:         true,
                fillColor:      Colors.transparent,
                border:         InputBorder.none,
                contentPadding: const EdgeInsets.symmetric(vertical: 16),
                prefixIcon: Icon(Icons.search_rounded,
                    color: cs.onSurfaceVariant, size: 22),
              ),
            ),
          ),

          const SizedBox(height: 20),
        ],
      ),
    );
  }
}

// ─── Assigned caregivers section ─────────────────────────────────────────────

class _AssignedCaregiversSection extends ConsumerWidget {
  const _AssignedCaregiversSection();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final cs    = Theme.of(context).colorScheme;
    final amina = Theme.of(context).extension<AminaColors>()!;
    final async = ref.watch(assignedCaregiversProvider);

    return async.when(
      loading: () => const SliverToBoxAdapter(child: SizedBox.shrink()),
      error:   (_, __) => const SliverToBoxAdapter(child: SizedBox.shrink()),
      data: (list) {
        if (list.isEmpty) return const SliverToBoxAdapter(child: SizedBox.shrink());
        return SliverToBoxAdapter(
          child: Padding(
            padding: const EdgeInsets.fromLTRB(16, 20, 16, 20),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'MY CAREGIVERS',
                  style: TextStyle(
                    fontSize:      11,
                    fontWeight:    FontWeight.w800,
                    color:         cs.onSurfaceVariant,
                    letterSpacing: 0.8,
                  ),
                ),
                const SizedBox(height: 10),
                ...list.map((c) => _AssignedCaregiverTile(caregiver: c)),
                const SizedBox(height: 8),
                Divider(color: amina.divider),
                const SizedBox(height: 4),
              ],
            ),
          ),
        );
      },
    );
  }
}

class _AssignedCaregiverTile extends StatelessWidget {
  final AssignedCaregiver caregiver;
  const _AssignedCaregiverTile({required this.caregiver});

  @override
  Widget build(BuildContext context) {
    final cs    = Theme.of(context).colorScheme;
    final amina = Theme.of(context).extension<AminaColors>()!;
    final c      = caregiver;
    final color  = _avatarColor(c.name);
    final active = !c.isRevoked;

    return Container(
      margin:  const EdgeInsets.only(bottom: 10),
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color:        cs.surface,
        borderRadius: BorderRadius.circular(16),
        border:       Border.all(color: amina.cardBorder),
      ),
      child: Row(
        children: [
          Container(
            width:  44,
            height: 44,
            decoration: BoxDecoration(
              color: color.withValues(alpha: 0.12),
              shape: BoxShape.circle,
              border: Border.all(color: color.withValues(alpha: 0.30), width: 1.5),
            ),
            child: Center(
              child: Text(
                _initials(c.name),
                style: TextStyle(
                  fontSize:   15,
                  fontWeight: FontWeight.w800,
                  color:      color,
                ),
              ),
            ),
          ),
          const SizedBox(width: 12),

          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  c.name,
                  style: TextStyle(
                    fontSize:   15,
                    fontWeight: FontWeight.w700,
                    color:      cs.onSurface,
                  ),
                ),
                if (c.relationship != null) ...[
                  const SizedBox(height: 2),
                  Text(
                    c.relationship!,
                    style: TextStyle(fontSize: 12, color: cs.onSurfaceVariant),
                  ),
                ],
              ],
            ),
          ),

          Container(
            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
            decoration: BoxDecoration(
              color: active
                  ? const Color(0xFFDCFCE7)
                  : const Color(0xFFFEE2E2),
              borderRadius: BorderRadius.circular(20),
            ),
            child: Text(
              active ? 'Active' : 'Revoked',
              style: TextStyle(
                fontSize:   11,
                fontWeight: FontWeight.w700,
                color: active
                    ? const Color(0xFF16A34A)
                    : const Color(0xFFDC2626),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

// ─── Directory sliver list ────────────────────────────────────────────────────

class _ProSliverList extends ConsumerWidget {
  const _ProSliverList();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final cs    = Theme.of(context).colorScheme;
    final async = ref.watch(filteredDirectoryProvider);

    return async.when(
      loading: () => const SliverToBoxAdapter(
        child: Padding(
          padding: EdgeInsets.symmetric(vertical: 48),
          child: Center(child: CircularProgressIndicator()),
        ),
      ),
      error: (e, _) => SliverToBoxAdapter(
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 32),
          child: Text(
            'Could not load directory: $e',
            style: TextStyle(color: cs.onSurfaceVariant, fontSize: 14),
            textAlign: TextAlign.center,
          ),
        ),
      ),
      data: (list) {
        if (list.isEmpty) {
          return SliverToBoxAdapter(
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 48),
              child: Column(
                children: [
                  Icon(Icons.search_off_rounded,
                      size: 48, color: cs.onSurfaceVariant),
                  const SizedBox(height: 16),
                  Text(
                    'No caregivers found',
                    style: TextStyle(
                      fontSize:   18,
                      fontWeight: FontWeight.w700,
                      color:      cs.onSurface,
                    ),
                  ),
                  const SizedBox(height: 8),
                  Text(
                    'Try a different search term.',
                    style: TextStyle(
                      fontSize: 14,
                      color:    cs.onSurfaceVariant.withValues(alpha: 0.80),
                    ),
                  ),
                ],
              ),
            ),
          );
        }

        return SliverPadding(
          padding: const EdgeInsets.symmetric(horizontal: 16),
          sliver: SliverList(
            delegate: SliverChildBuilderDelegate(
              (ctx, i) => Padding(
                padding: const EdgeInsets.only(bottom: 16),
                child:   _DirectoryCaregiverCard(caregiver: list[i]),
              ),
              childCount: list.length,
            ),
          ),
        );
      },
    );
  }
}

// ─── Directory caregiver card ─────────────────────────────────────────────────

class _DirectoryCaregiverCard extends StatelessWidget {
  final CaregiverDirectoryEntry caregiver;
  const _DirectoryCaregiverCard({required this.caregiver});

  @override
  Widget build(BuildContext context) {
    final cs    = Theme.of(context).colorScheme;
    final amina = Theme.of(context).extension<AminaColors>()!;
    final c     = caregiver;
    final color = _avatarColor(c.name);

    return GestureDetector(
      onTap: () => _showSheet(context, c),
      child: Container(
        decoration: BoxDecoration(
          color:        cs.surface,
          borderRadius: BorderRadius.circular(20),
          border:       Border.all(color: amina.cardBorder),
          boxShadow: [
            BoxShadow(
              color:      amina.sageGlow,
              blurRadius: 12,
              offset:     const Offset(0, 4),
            ),
          ],
        ),
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Container(
                    width:  52,
                    height: 52,
                    decoration: BoxDecoration(
                      color:  color.withValues(alpha: 0.15),
                      shape:  BoxShape.circle,
                      border: Border.all(
                          color: color.withValues(alpha: 0.30), width: 1.5),
                    ),
                    child: Center(
                      child: Text(
                        _initials(c.name),
                        style: TextStyle(
                          fontSize:   17,
                          fontWeight: FontWeight.w800,
                          color:      color,
                        ),
                      ),
                    ),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          c.name,
                          style: TextStyle(
                            fontSize:   16,
                            fontWeight: FontWeight.w800,
                            color:      cs.onSurface,
                          ),
                        ),
                        const SizedBox(height: 4),
                        if (c.specialization.isNotEmpty)
                          Container(
                            padding: const EdgeInsets.symmetric(
                                horizontal: 10, vertical: 3),
                            decoration: BoxDecoration(
                              color:        color.withValues(alpha: 0.10),
                              borderRadius: BorderRadius.circular(20),
                            ),
                            child: Text(
                              c.specialization,
                              style: TextStyle(
                                fontSize:   11,
                                fontWeight: FontWeight.w700,
                                color:      color,
                              ),
                            ),
                          ),
                      ],
                    ),
                  ),
                ],
              ),

              if (c.bio.isNotEmpty) ...[
                const SizedBox(height: 12),
                Text(
                  c.bio,
                  maxLines:  3,
                  overflow:  TextOverflow.ellipsis,
                  style: TextStyle(
                    fontSize: 13,
                    color:    cs.onSurfaceVariant,
                    height:   1.5,
                  ),
                ),
              ],

              if (c.specialtyTags.isNotEmpty) ...[
                const SizedBox(height: 10),
                Wrap(
                  spacing:   6,
                  runSpacing: 4,
                  children: c.specialtyTags
                      .take(4)
                      .map((t) => Container(
                            padding: const EdgeInsets.symmetric(
                                horizontal: 9, vertical: 3),
                            decoration: BoxDecoration(
                              color:        amina.inputFill,
                              borderRadius: BorderRadius.circular(20),
                              border:       Border.all(color: amina.cardBorder),
                            ),
                            child: Text(
                              t,
                              style: TextStyle(
                                fontSize:   11,
                                color:      cs.onSurfaceVariant,
                                fontWeight: FontWeight.w500,
                              ),
                            ),
                          ))
                      .toList(),
                ),
              ],

              const SizedBox(height: 14),
              Divider(height: 1, color: amina.divider),
              const SizedBox(height: 12),

              Row(
                children: [
                  _InfoColumn(label: 'REGION',     value: c.region),
                  _InfoColumn(
                      label: 'EXPERIENCE',
                      value: c.experienceYears > 0
                          ? '${c.experienceYears} yrs'
                          : '—'),
                  _InfoColumn(
                      label: 'LANGUAGES',
                      value: c.languages.isNotEmpty
                          ? c.languages.join(', ')
                          : '—'),
                ],
              ),

              const SizedBox(height: 14),

              SizedBox(
                width:  double.infinity,
                height: 44,
                child: ElevatedButton(
                  onPressed: () => _showApply(context, c),
                  style: ElevatedButton.styleFrom(
                    backgroundColor: color,
                    foregroundColor: Colors.white,
                    elevation:       0,
                    shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(12)),
                  ),
                  child: Text(
                    'Apply to ${c.name.split(' ').first}',
                    style: const TextStyle(
                      fontSize:   14,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  void _showSheet(BuildContext context, CaregiverDirectoryEntry c) {
    showModalBottomSheet<void>(
      context:            context,
      isScrollControlled: true,
      backgroundColor:    Colors.transparent,
      builder:            (_) => _DirectoryProfileSheet(caregiver: c),
    );
  }

  void _showApply(BuildContext context, CaregiverDirectoryEntry c) {
    showModalBottomSheet<void>(
      context:            context,
      isScrollControlled: true,
      backgroundColor:    Colors.transparent,
      builder:            (_) => _ApplySheet(caregiver: c),
    );
  }
}

// ─── Info column ──────────────────────────────────────────────────────────────

class _InfoColumn extends StatelessWidget {
  final String label;
  final String value;
  const _InfoColumn({required this.label, required this.value});

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    return Expanded(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            label,
            style: TextStyle(
              fontSize:      9,
              fontWeight:    FontWeight.w800,
              color:         cs.onSurfaceVariant,
              letterSpacing: 0.6,
            ),
          ),
          const SizedBox(height: 3),
          Text(
            value,
            maxLines:  2,
            overflow:  TextOverflow.ellipsis,
            style: TextStyle(
              fontSize:   12,
              fontWeight: FontWeight.w600,
              color:      cs.onSurface,
            ),
          ),
        ],
      ),
    );
  }
}

// ─── Directory profile sheet ──────────────────────────────────────────────────

class _DirectoryProfileSheet extends StatelessWidget {
  final CaregiverDirectoryEntry caregiver;
  const _DirectoryProfileSheet({required this.caregiver});

  @override
  Widget build(BuildContext context) {
    final cs    = Theme.of(context).colorScheme;
    final amina = Theme.of(context).extension<AminaColors>()!;
    final c     = caregiver;
    final color = _avatarColor(c.name);

    return DraggableScrollableSheet(
      initialChildSize: 0.75,
      minChildSize:     0.50,
      maxChildSize:     0.95,
      builder: (_, scrollController) => Container(
        decoration: BoxDecoration(
          color:        cs.surface,
          borderRadius: const BorderRadius.vertical(top: Radius.circular(28)),
        ),
        child: ListView(
          controller: scrollController,
          padding: const EdgeInsets.fromLTRB(24, 0, 24, 40),
          children: [
            Center(
              child: Container(
                margin:     const EdgeInsets.only(top: 12, bottom: 20),
                width:      36,
                height:     4,
                decoration: BoxDecoration(
                  color:        amina.cardBorder,
                  borderRadius: BorderRadius.circular(2),
                ),
              ),
            ),

            Column(
              children: [
                Container(
                  width:  80,
                  height: 80,
                  decoration: BoxDecoration(
                    color:  color.withValues(alpha: 0.15),
                    shape:  BoxShape.circle,
                    border: Border.all(
                        color: color.withValues(alpha: 0.30), width: 2),
                  ),
                  child: Center(
                    child: Text(
                      _initials(c.name),
                      style: TextStyle(
                        fontSize:   28,
                        fontWeight: FontWeight.w800,
                        color:      color,
                      ),
                    ),
                  ),
                ),
                const SizedBox(height: 12),
                Text(
                  c.name,
                  style: TextStyle(
                    fontSize:   22,
                    fontWeight: FontWeight.w800,
                    color:      cs.onSurface,
                  ),
                ),
                if (c.specialization.isNotEmpty) ...[
                  const SizedBox(height: 6),
                  Container(
                    padding: const EdgeInsets.symmetric(
                        horizontal: 14, vertical: 5),
                    decoration: BoxDecoration(
                      color:        color.withValues(alpha: 0.10),
                      borderRadius: BorderRadius.circular(20),
                    ),
                    child: Text(
                      c.specialization,
                      style: TextStyle(
                        fontSize:   13,
                        fontWeight: FontWeight.w700,
                        color:      color,
                      ),
                    ),
                  ),
                ],
              ],
            ),

            const SizedBox(height: 24),

            Row(
              children: [
                _ProfileStat(
                  value: c.experienceYears > 0 ? '${c.experienceYears}y' : '—',
                  label: 'Experience',
                  color: color,
                ),
                _ProfileStat(
                  value: c.region.isNotEmpty ? c.region : '—',
                  label: 'Region',
                  color: _kProIndigo,
                ),
                _ProfileStat(
                  value: c.languages.isNotEmpty ? '${c.languages.length}' : '—',
                  label: 'Languages',
                  color: _kSage,
                ),
              ],
            ),

            if (c.bio.isNotEmpty) ...[
              const SizedBox(height: 24),
              const _SheetDivider(label: 'About'),
              Text(
                c.bio,
                style: TextStyle(
                  fontSize: 15,
                  color:    cs.onSurfaceVariant,
                  height:   1.6,
                ),
              ),
            ],

            if (c.specialtyTags.isNotEmpty) ...[
              const SizedBox(height: 20),
              const _SheetDivider(label: 'Specialty Tags'),
              Wrap(
                spacing:    8,
                runSpacing: 8,
                children: c.specialtyTags
                    .map((t) => Container(
                          padding: const EdgeInsets.symmetric(
                              horizontal: 12, vertical: 5),
                          decoration: BoxDecoration(
                            color:        amina.inputFill,
                            borderRadius: BorderRadius.circular(20),
                            border:       Border.all(color: amina.cardBorder),
                          ),
                          child: Text(
                            t,
                            style: TextStyle(
                              fontSize:   12,
                              color:      cs.onSurfaceVariant,
                              fontWeight: FontWeight.w500,
                            ),
                          ),
                        ))
                    .toList(),
              ),
            ],

            if (c.languages.isNotEmpty) ...[
              const SizedBox(height: 20),
              const _SheetDivider(label: 'Details'),
              _DetailRow(
                icon:  Icons.translate_rounded,
                color: _kProIndigo,
                label: 'Languages',
                value: c.languages.join(' · '),
              ),
              const SizedBox(height: 12),
              _DetailRow(
                icon:  Icons.place_rounded,
                color: const Color(0xFFF59E0B),
                label: 'Region',
                value: c.region.isEmpty ? '—' : c.region,
              ),
            ],

            const SizedBox(height: 28),

            SizedBox(
              width:  double.infinity,
              height: 54,
              child: ElevatedButton(
                onPressed: () {
                  Navigator.pop(context);
                  showModalBottomSheet<void>(
                    context:            context,
                    isScrollControlled: true,
                    backgroundColor:    Colors.transparent,
                    builder:            (_) => _ApplySheet(caregiver: c),
                  );
                },
                style: ElevatedButton.styleFrom(
                  backgroundColor: color,
                  foregroundColor: Colors.white,
                  elevation:       0,
                  shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(16)),
                ),
                child: Text(
                  'Apply to ${c.name.split(' ').first}',
                  style: const TextStyle(
                    fontSize:   16,
                    fontWeight: FontWeight.w700,
                  ),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _ProfileStat extends StatelessWidget {
  final String value;
  final String label;
  final Color  color;
  const _ProfileStat({
    required this.value,
    required this.label,
    required this.color,
  });

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    return Expanded(
      child: Container(
        margin:  const EdgeInsets.symmetric(horizontal: 4),
        padding: const EdgeInsets.symmetric(vertical: 14),
        decoration: BoxDecoration(
          color:        color.withValues(alpha: 0.08),
          borderRadius: BorderRadius.circular(16),
        ),
        child: Column(
          children: [
            Text(
              value,
              style: TextStyle(
                fontSize:   18,
                fontWeight: FontWeight.w900,
                color:      color,
              ),
            ),
            const SizedBox(height: 2),
            Text(
              label,
              style: TextStyle(
                fontSize: 11, color: cs.onSurfaceVariant, fontWeight: FontWeight.w500),
            ),
          ],
        ),
      ),
    );
  }
}

// ─── Application form sheet ───────────────────────────────────────────────────

class _ApplySheet extends ConsumerStatefulWidget {
  final CaregiverDirectoryEntry caregiver;
  const _ApplySheet({required this.caregiver});

  @override
  ConsumerState<_ApplySheet> createState() => _ApplySheetState();
}

class _ApplySheetState extends ConsumerState<_ApplySheet> {
  static const _contactOptions = [
    'Phone call', 'WhatsApp', 'In-person', 'Video call',
  ];

  final _concernCtrl    = TextEditingController();
  final _conditionsCtrl = TextEditingController();
  final _medsCtrl       = TextEditingController();
  final _emergNameCtrl  = TextEditingController();
  final _emergPhoneCtrl = TextEditingController();
  final _notesCtrl      = TextEditingController();

  String _preferredContact = 'Phone call';

  @override
  void initState() {
    super.initState();
    final user = ref.read(authProvider).user;
    if (user != null && user.conditions.isNotEmpty) {
      _conditionsCtrl.text = user.conditions.join(', ');
    }
  }

  @override
  void dispose() {
    _concernCtrl.dispose();
    _conditionsCtrl.dispose();
    _medsCtrl.dispose();
    _emergNameCtrl.dispose();
    _emergPhoneCtrl.dispose();
    _notesCtrl.dispose();
    super.dispose();
  }

  List<String> _splitComma(String text) =>
      text.split(',').map((s) => s.trim()).where((s) => s.isNotEmpty).toList();

  Future<void> _submit() async {
    final concern   = _concernCtrl.text.trim();
    final emergName = _emergNameCtrl.text.trim();
    final emergPhone= _emergPhoneCtrl.text.trim();

    if (concern.isEmpty || emergName.isEmpty || emergPhone.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Please fill in all required fields.'),
          backgroundColor: Color(0xFFDC2626),
          behavior: SnackBarBehavior.floating,
        ),
      );
      return;
    }

    final user = ref.read(authProvider).user;
    await ref.read(applyCgProvider.notifier).submit(
      caregiverId:           widget.caregiver.id,
      primaryConcern:        concern,
      healthConditions:      _splitComma(_conditionsCtrl.text),
      currentMedications:    _splitComma(_medsCtrl.text),
      preferredContact:      _preferredContact,
      emergencyContactName:  emergName,
      emergencyContactPhone: emergPhone,
      additionalNotes:       _notesCtrl.text.trim(),
      patientFullName:       user?.name ?? '',
      patientAge:            user?.age ?? 0,
      patientGender:         user?.gender ?? '',
      patientRegion:         user?.region ?? '',
    );
  }

  @override
  Widget build(BuildContext context) {
    final cs        = Theme.of(context).colorScheme;
    final amina     = Theme.of(context).extension<AminaColors>()!;
    final applyState = ref.watch(applyCgProvider);
    final c          = widget.caregiver;
    final color      = _avatarColor(c.name);
    final user       = ref.watch(authProvider).user;

    if (applyState.status == ConnectStatus.success) {
      return _ApplySuccessSheet(
        caregiver: c,
        appId:     applyState.appId ?? '',
        color:     color,
      );
    }

    final isLoading = applyState.status == ConnectStatus.loading;

    return DraggableScrollableSheet(
      initialChildSize: 0.92,
      minChildSize:     0.60,
      maxChildSize:     0.98,
      builder: (_, scrollController) => Container(
        decoration: BoxDecoration(
          color:        cs.surface,
          borderRadius: const BorderRadius.vertical(top: Radius.circular(28)),
        ),
        child: ListView(
          controller: scrollController,
          padding: const EdgeInsets.fromLTRB(24, 0, 24, 48),
          children: [
            Center(
              child: Container(
                margin:     const EdgeInsets.only(top: 12, bottom: 16),
                width:      36,
                height:     4,
                decoration: BoxDecoration(
                  color:        amina.cardBorder,
                  borderRadius: BorderRadius.circular(2),
                ),
              ),
            ),

            Row(
              children: [
                Container(
                  width:  46,
                  height: 46,
                  decoration: BoxDecoration(
                    color:  color.withValues(alpha: 0.15),
                    shape:  BoxShape.circle,
                  ),
                  child: Center(
                    child: Text(
                      _initials(c.name),
                      style: TextStyle(
                        fontSize:   15,
                        fontWeight: FontWeight.w800,
                        color:      color,
                      ),
                    ),
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const Text(
                        'CAREGIVER APPLICATION',
                        style: TextStyle(
                          fontSize:      10,
                          fontWeight:    FontWeight.w800,
                          color:         _kProIndigo,
                          letterSpacing: 0.8,
                        ),
                      ),
                      Text(
                        'Apply to ${c.name}',
                        style: TextStyle(
                          fontSize:   18,
                          fontWeight: FontWeight.w800,
                          color:      cs.onSurface,
                        ),
                      ),
                      if (c.specialization.isNotEmpty)
                        Text(
                          c.specialization,
                          style: TextStyle(
                              fontSize: 12, color: cs.onSurfaceVariant),
                        ),
                    ],
                  ),
                ),
              ],
            ),

            const SizedBox(height: 16),

            Container(
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(
                color:        const Color(0xFFEEF2FF),
                borderRadius: BorderRadius.circular(12),
              ),
              child: Row(
                children: [
                  const Icon(Icons.info_outline_rounded,
                      color: _kProIndigo, size: 16),
                  const SizedBox(width: 8),
                  Expanded(
                    child: Text(
                      user != null
                          ? 'Your profile (${user.name}${user.region != null ? ', ${user.region}' : ''}) '
                            'will be included automatically.'
                          : 'Your profile details will be included automatically.',
                      style: const TextStyle(
                        fontSize: 12,
                        color:    _kProIndigo,
                      ),
                    ),
                  ),
                ],
              ),
            ),

            const SizedBox(height: 24),

            _ApplyLabel(text: 'Primary reason for seeking a caregiver', required: true),
            const SizedBox(height: 6),
            _ApplyInput(
              controller:  _concernCtrl,
              hintText:    'Describe your main health concern or why you need caregiver support…',
              maxLines:    4,
              enabled:     !isLoading,
            ),

            const SizedBox(height: 20),

            _ApplyLabel(text: 'Preferred method of contact', required: true),
            const SizedBox(height: 8),
            Wrap(
              spacing:    8,
              runSpacing: 8,
              children: _contactOptions.map((opt) {
                final selected = opt == _preferredContact;
                return GestureDetector(
                  onTap: isLoading
                      ? null
                      : () => setState(() => _preferredContact = opt),
                  child: AnimatedContainer(
                    duration: const Duration(milliseconds: 150),
                    padding: const EdgeInsets.symmetric(
                        horizontal: 14, vertical: 8),
                    decoration: BoxDecoration(
                      color: selected ? _kProIndigo : cs.surface,
                      borderRadius: BorderRadius.circular(20),
                      border: Border.all(
                        color: selected ? _kProIndigo : amina.cardBorder,
                        width: 1.5,
                      ),
                    ),
                    child: Text(
                      opt,
                      style: TextStyle(
                        fontSize:   13,
                        fontWeight: FontWeight.w600,
                        color: selected ? Colors.white : cs.onSurfaceVariant,
                      ),
                    ),
                  ),
                );
              }).toList(),
            ),

            const SizedBox(height: 20),

            _ApplyLabel(text: 'Emergency contact name', required: true),
            const SizedBox(height: 6),
            _ApplyInput(controller: _emergNameCtrl, hintText: 'Full name', enabled: !isLoading),
            const SizedBox(height: 12),
            _ApplyLabel(text: 'Emergency contact phone', required: true),
            const SizedBox(height: 6),
            _ApplyInput(
              controller:   _emergPhoneCtrl,
              hintText:     'Phone number',
              keyboardType: TextInputType.phone,
              enabled:      !isLoading,
            ),

            const SizedBox(height: 20),

            _ApplyLabel(text: 'Current health conditions', required: false),
            const SizedBox(height: 4),
            Text(
              'Comma-separated — pre-filled from your profile',
              style: TextStyle(fontSize: 11, color: cs.onSurfaceVariant),
            ),
            const SizedBox(height: 6),
            _ApplyInput(
              controller: _conditionsCtrl,
              hintText:   'e.g. hypertension, diabetes',
              enabled:    !isLoading,
            ),

            const SizedBox(height: 20),

            _ApplyLabel(text: 'Current medications', required: false),
            const SizedBox(height: 4),
            Text(
              'Comma-separated',
              style: TextStyle(fontSize: 11, color: cs.onSurfaceVariant),
            ),
            const SizedBox(height: 6),
            _ApplyInput(
              controller: _medsCtrl,
              hintText:   'e.g. Amlodipine 5mg, Metformin 500mg',
              enabled:    !isLoading,
            ),

            const SizedBox(height: 20),

            _ApplyLabel(text: 'Additional notes', required: false),
            const SizedBox(height: 6),
            _ApplyInput(
              controller: _notesCtrl,
              hintText:   'Anything else the caregiver should know…',
              maxLines:   3,
              enabled:    !isLoading,
            ),

            if (applyState.status == ConnectStatus.error &&
                applyState.errorMsg != null) ...[
              const SizedBox(height: 16),
              Container(
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(
                  color:        const Color(0xFFFEE2E2),
                  borderRadius: BorderRadius.circular(12),
                ),
                child: Text(
                  applyState.errorMsg!,
                  style: const TextStyle(
                    fontSize: 13,
                    color:    Color(0xFFDC2626),
                  ),
                ),
              ),
            ],

            const SizedBox(height: 28),

            SizedBox(
              width:  double.infinity,
              height: 54,
              child: ElevatedButton(
                onPressed: isLoading ? null : _submit,
                style: ElevatedButton.styleFrom(
                  backgroundColor: color,
                  foregroundColor: Colors.white,
                  disabledBackgroundColor: color.withValues(alpha: 0.50),
                  elevation: 0,
                  shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(16)),
                ),
                child: isLoading
                    ? const SizedBox(
                        width:  22,
                        height: 22,
                        child:  CircularProgressIndicator(
                          strokeWidth: 2.5,
                          color:       Colors.white,
                        ),
                      )
                    : const Text(
                        'Submit Application',
                        style: TextStyle(
                          fontSize:   16,
                          fontWeight: FontWeight.w700,
                        ),
                      ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

// ─── Apply success screen inside sheet ───────────────────────────────────────

class _ApplySuccessSheet extends StatelessWidget {
  final CaregiverDirectoryEntry caregiver;
  final String appId;
  final Color  color;
  const _ApplySuccessSheet({
    required this.caregiver,
    required this.appId,
    required this.color,
  });

  @override
  Widget build(BuildContext context) {
    final cs    = Theme.of(context).colorScheme;
    final amina = Theme.of(context).extension<AminaColors>()!;

    return Container(
      decoration: BoxDecoration(
        color:        cs.surface,
        borderRadius: const BorderRadius.vertical(top: Radius.circular(28)),
      ),
      padding: const EdgeInsets.fromLTRB(32, 48, 32, 56),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Container(
            width:  72,
            height: 72,
            decoration: const BoxDecoration(
              color:  Color(0xFFDCFCE7),
              shape:  BoxShape.circle,
            ),
            child: const Icon(Icons.check_rounded,
                color: Color(0xFF16A34A), size: 38),
          ),
          const SizedBox(height: 20),
          Text(
            'Application Submitted!',
            style: TextStyle(
              fontSize:   22,
              fontWeight: FontWeight.w800,
              color:      cs.onSurface,
            ),
          ),
          const SizedBox(height: 10),
          Text(
            '${caregiver.name} will review your request and respond within 48 hours.',
            textAlign: TextAlign.center,
            style: TextStyle(fontSize: 14, color: cs.onSurfaceVariant, height: 1.5),
          ),
          if (appId.isNotEmpty) ...[
            const SizedBox(height: 16),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
              decoration: BoxDecoration(
                color:        amina.inputFill,
                borderRadius: BorderRadius.circular(12),
                border:       Border.all(color: amina.cardBorder),
              ),
              child: Text(
                'Ref: $appId',
                style: TextStyle(
                  fontSize:      13,
                  fontWeight:    FontWeight.w700,
                  color:         cs.onSurfaceVariant,
                  letterSpacing: 0.5,
                ),
              ),
            ),
          ],
          const SizedBox(height: 28),
          SizedBox(
            width:  double.infinity,
            height: 50,
            child: ElevatedButton(
              onPressed: () => Navigator.pop(context),
              style: ElevatedButton.styleFrom(
                backgroundColor: color,
                foregroundColor: Colors.white,
                elevation:       0,
                shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(14)),
              ),
              child: const Text(
                'Done',
                style: TextStyle(fontSize: 16, fontWeight: FontWeight.w700),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

// ─── Reusable form helpers ────────────────────────────────────────────────────

class _ApplyLabel extends StatelessWidget {
  final String label;
  final bool   required;
  const _ApplyLabel({required String text, required this.required})
      : label = text;

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    return Row(
      children: [
        Text(
          label,
          style: TextStyle(
            fontSize:   13,
            fontWeight: FontWeight.w700,
            color:      cs.onSurface,
          ),
        ),
        if (required) ...[
          const SizedBox(width: 3),
          const Text(
            '*',
            style: TextStyle(
              fontSize:   13,
              color:      Color(0xFFDC2626),
              fontWeight: FontWeight.w700,
            ),
          ),
        ],
      ],
    );
  }
}

class _ApplyInput extends StatelessWidget {
  final TextEditingController controller;
  final String                hintText;
  final int                   maxLines;
  final bool                  enabled;
  final TextInputType         keyboardType;
  const _ApplyInput({
    required this.controller,
    required this.hintText,
    this.maxLines    = 1,
    this.enabled     = true,
    this.keyboardType = TextInputType.text,
  });

  @override
  Widget build(BuildContext context) {
    final cs    = Theme.of(context).colorScheme;
    final amina = Theme.of(context).extension<AminaColors>()!;

    return Container(
      decoration: BoxDecoration(
        color:        enabled ? amina.inputFill : amina.scaffoldBg,
        borderRadius: BorderRadius.circular(14),
        border:       Border.all(color: amina.cardBorder),
      ),
      child: TextField(
        controller:   controller,
        maxLines:     maxLines,
        enabled:      enabled,
        keyboardType: keyboardType,
        style: TextStyle(fontSize: 14, color: cs.onSurface),
        decoration: InputDecoration(
          hintText:       hintText,
          hintStyle: TextStyle(fontSize: 14, color: cs.onSurfaceVariant),
          border:         InputBorder.none,
          contentPadding: EdgeInsets.symmetric(
            horizontal: 14,
            vertical:   maxLines > 1 ? 12 : 14,
          ),
        ),
      ),
    );
  }
}

class _SheetDivider extends StatelessWidget {
  final String label;
  const _SheetDivider({required this.label});

  @override
  Widget build(BuildContext context) {
    final cs    = Theme.of(context).colorScheme;
    final amina = Theme.of(context).extension<AminaColors>()!;

    return Padding(
      padding: const EdgeInsets.only(bottom: 14),
      child: Row(
        children: [
          Text(
            label.toUpperCase(),
            style: TextStyle(
              fontSize:      11,
              fontWeight:    FontWeight.w800,
              color:         cs.onSurfaceVariant,
              letterSpacing: 0.8,
            ),
          ),
          const SizedBox(width: 10),
          Expanded(child: Divider(color: amina.divider)),
        ],
      ),
    );
  }
}

class _DetailRow extends StatelessWidget {
  final IconData icon;
  final Color    color;
  final String   label;
  final String   value;
  const _DetailRow({
    required this.icon,
    required this.color,
    required this.label,
    required this.value,
  });

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    return Row(
      children: [
        Container(
          width:  36,
          height: 36,
          decoration: BoxDecoration(
            color: color.withValues(alpha: 0.10),
            shape: BoxShape.circle,
          ),
          child: Icon(icon, color: color, size: 18),
        ),
        const SizedBox(width: 12),
        Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              label,
              style: TextStyle(
                fontSize:      11,
                fontWeight:    FontWeight.w700,
                color:         cs.onSurfaceVariant,
                letterSpacing: 0.3,
              ),
            ),
            Text(
              value,
              style: TextStyle(
                fontSize:   14,
                fontWeight: FontWeight.w600,
                color:      cs.onSurface,
              ),
            ),
          ],
        ),
      ],
    );
  }
}
