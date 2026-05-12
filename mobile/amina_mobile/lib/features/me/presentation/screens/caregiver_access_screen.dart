import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../../core/theme/app_theme.dart';

// ─── Mock caregiver model (patient's view of who has access) ──────────────────

class _LinkedCaregiver {
  final String   id;
  final String   name;
  final String   initials;
  final String   relationship;
  final DateTime connectedSince;
  final DateTime lastViewed;

  const _LinkedCaregiver({
    required this.id,
    required this.name,
    required this.initials,
    required this.relationship,
    required this.connectedSince,
    required this.lastViewed,
  });
}

// ─── Screen ───────────────────────────────────────────────────────────────────

class CaregiverAccessScreen extends ConsumerStatefulWidget {
  const CaregiverAccessScreen({super.key});

  @override
  ConsumerState<CaregiverAccessScreen> createState() =>
      _CaregiverAccessScreenState();
}

class _CaregiverAccessScreenState
    extends ConsumerState<CaregiverAccessScreen> {
  // Mock linking code — in production this comes from the API.
  String _code = '483291';
  bool   _codeCopied = false;
  bool   _regenerating = false;

  late List<_LinkedCaregiver> _caregivers;

  @override
  void initState() {
    super.initState();
    final now = DateTime.now();
    _caregivers = [
      _LinkedCaregiver(
        id:             'cg_1',
        name:           'Elena Martínez',
        initials:       'EM',
        relationship:   'Daughter',
        connectedSince: now.subtract(const Duration(days: 32)),
        lastViewed:     now.subtract(const Duration(hours: 3)),
      ),
    ];
  }

  Future<void> _copyCode() async {
    await Clipboard.setData(ClipboardData(text: _code));
    setState(() => _codeCopied = true);
    await Future<void>.delayed(const Duration(seconds: 2));
    if (mounted) setState(() => _codeCopied = false);
  }

  Future<void> _regenerateCode() async {
    setState(() => _regenerating = true);
    await Future<void>.delayed(const Duration(milliseconds: 1000));
    if (!mounted) return;
    // Generate a new random 6-digit code (mock).
    final code = (100000 + DateTime.now().millisecond * 1234 % 900000)
        .toString()
        .padLeft(6, '0')
        .substring(0, 6);
    setState(() {
      _code        = code;
      _regenerating = false;
    });
  }

  Future<void> _confirmRemove(
      BuildContext context, _LinkedCaregiver cg) async {
    final cs = Theme.of(context).colorScheme;

    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: Theme.of(ctx).colorScheme.surface,
        shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(20)),
        title: Text(
          'Remove ${cg.name}?',
          style: TextStyle(
            color:      cs.onSurface,
            fontWeight: FontWeight.w700,
            fontSize:   18,
          ),
        ),
        content: Text(
          '${cg.name} will immediately lose access to your health data and will need a new linking code to reconnect.',
          style: TextStyle(
            color:  cs.onSurfaceVariant,
            height: 1.5,
            fontSize: 14,
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx, false),
            child: Text('Cancel',
                style: TextStyle(color: cs.onSurfaceVariant)),
          ),
          TextButton(
            onPressed: () => Navigator.pop(ctx, true),
            child: const Text(
              'Remove',
              style: TextStyle(
                color:      Color(0xFFDC2626),
                fontWeight: FontWeight.w700,
              ),
            ),
          ),
        ],
      ),
    );

    if (ok == true && mounted) {
      setState(() => _caregivers.removeWhere((c) => c.id == cg.id));
    }
  }

  String _timeLabel(DateTime dt) {
    final diff = DateTime.now().difference(dt);
    if (diff.inMinutes < 60)  return '${diff.inMinutes}m ago';
    if (diff.inHours   < 24)  return '${diff.inHours}h ago';
    if (diff.inDays    == 1)  return 'Yesterday';
    if (diff.inDays    < 30)  return '${diff.inDays}d ago';
    return '${(diff.inDays / 30).floor()}mo ago';
  }

  String _sinceLabel(DateTime dt) {
    final diff = DateTime.now().difference(dt);
    if (diff.inDays < 1)  return 'Today';
    if (diff.inDays < 30) return '${diff.inDays} days ago';
    return '${(diff.inDays / 30).floor()} month${(diff.inDays / 30).floor() == 1 ? '' : 's'} ago';
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
          'Caregiver Access',
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

          // ── Intro ────────────────────────────────────────────────────────
          _SectionHeader('Your Linking Code', cs),
          const SizedBox(height: 4),
          Text(
            'Share this code with a trusted caregiver so they can view your health data. '
            'They will have read-only access.',
            style: TextStyle(
              fontSize: 13,
              color:    cs.onSurfaceVariant,
              height:   1.5,
            ),
          ),

          const SizedBox(height: 16),

          // ── Code card ────────────────────────────────────────────────────
          Container(
            padding: const EdgeInsets.all(24),
            decoration: BoxDecoration(
              color:        cs.surface,
              borderRadius: BorderRadius.circular(24),
              border:       Border.all(color: amina.cardBorder),
              boxShadow: [
                BoxShadow(
                  color:      cs.primary.withValues(alpha: 0.07),
                  blurRadius: 20,
                  offset:     const Offset(0, 5),
                ),
              ],
            ),
            child: Column(
              children: [
                // Code display
                AnimatedSwitcher(
                  duration: const Duration(milliseconds: 300),
                  child: _regenerating
                      ? SizedBox(
                          key:    const ValueKey('loading'),
                          height: 60,
                          child:  Center(
                            child: CircularProgressIndicator(
                              color: cs.primary, strokeWidth: 2.5),
                          ),
                        )
                      : Row(
                          key:                 ValueKey(_code),
                          mainAxisAlignment:   MainAxisAlignment.center,
                          children: _code.split('').asMap().entries.map((e) {
                            return Container(
                              margin: EdgeInsets.only(
                                  right: e.key < 5 ? 6 : 0),
                              width:  40,
                              height: 50,
                              decoration: BoxDecoration(
                                color:        cs.primaryContainer,
                                borderRadius: BorderRadius.circular(12),
                                border: Border.all(
                                    color: cs.primary
                                        .withValues(alpha: 0.25)),
                              ),
                              child: Center(
                                child: Text(
                                  e.value,
                                  style: TextStyle(
                                    fontSize:      24,
                                    fontWeight:    FontWeight.w900,
                                    color:         cs.primary,
                                    letterSpacing: 0,
                                  ),
                                ),
                              ),
                            );
                          }).toList(),
                        ),
                ),

                const SizedBox(height: 20),

                // Action buttons
                Row(
                  children: [
                    Expanded(
                      child: OutlinedButton.icon(
                        onPressed: _regenerating ? null : _copyCode,
                        icon: AnimatedSwitcher(
                          duration: const Duration(milliseconds: 200),
                          child: Icon(
                            _codeCopied
                                ? Icons.check_rounded
                                : Icons.copy_rounded,
                            key:   ValueKey(_codeCopied),
                            size:  16,
                            color: _codeCopied
                                ? const Color(0xFF059669)
                                : cs.primary,
                          ),
                        ),
                        label: Text(
                          _codeCopied ? 'Copied!' : 'Copy Code',
                          style: TextStyle(
                            fontWeight: FontWeight.w600,
                            color: _codeCopied
                                ? const Color(0xFF059669)
                                : cs.primary,
                          ),
                        ),
                        style: OutlinedButton.styleFrom(
                          padding: const EdgeInsets.symmetric(vertical: 13),
                          side: BorderSide(
                              color: _codeCopied
                                  ? const Color(0xFF059669)
                                      .withValues(alpha: 0.50)
                                  : cs.primary.withValues(alpha: 0.45)),
                          shape: RoundedRectangleBorder(
                              borderRadius: BorderRadius.circular(14)),
                        ),
                      ),
                    ),
                    const SizedBox(width: 12),
                    Expanded(
                      child: OutlinedButton.icon(
                        onPressed: _regenerating ? null : _regenerateCode,
                        icon: Icon(Icons.refresh_rounded,
                            size: 16, color: cs.onSurfaceVariant),
                        label: Text(
                          'New Code',
                          style: TextStyle(
                            fontWeight: FontWeight.w600,
                            color:      cs.onSurfaceVariant,
                          ),
                        ),
                        style: OutlinedButton.styleFrom(
                          padding: const EdgeInsets.symmetric(vertical: 13),
                          side: BorderSide(color: amina.cardBorder),
                          shape: RoundedRectangleBorder(
                              borderRadius: BorderRadius.circular(14)),
                        ),
                      ),
                    ),
                  ],
                ),

                const SizedBox(height: 12),

                // Security note
                Row(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    Icon(Icons.shield_outlined,
                        size: 13, color: cs.onSurfaceVariant),
                    const SizedBox(width: 5),
                    Text(
                      'Code expires after 24 h · read-only access',
                      style: TextStyle(
                        fontSize: 12,
                        color:    cs.onSurfaceVariant,
                      ),
                    ),
                  ],
                ),
              ],
            ),
          ),

          const SizedBox(height: 28),

          // ── How it works ─────────────────────────────────────────────────
          _SectionHeader('How It Works', cs),
          const SizedBox(height: 12),
          Container(
            padding: const EdgeInsets.all(18),
            decoration: BoxDecoration(
              color:        cs.surface,
              borderRadius: BorderRadius.circular(20),
              border:       Border.all(color: amina.cardBorder),
            ),
            child: Column(
              children: const [
                _HowStep(
                  number: '1',
                  text:   'Share your 6-digit code with a trusted person.',
                ),
                _HowDivider(),
                _HowStep(
                  number: '2',
                  text:   'They enter it in the Amina app under "I have a linking code".',
                ),
                _HowDivider(),
                _HowStep(
                  number: '3',
                  text:   'They get read-only access. You can remove them any time.',
                ),
              ],
            ),
          ),

          const SizedBox(height: 28),

          // ── Active caregivers ─────────────────────────────────────────────
          Row(
            children: [
              Expanded(child: _SectionHeader('People With Access', cs)),
              if (_caregivers.isNotEmpty)
                Container(
                  padding: const EdgeInsets.symmetric(
                      horizontal: 10, vertical: 3),
                  decoration: BoxDecoration(
                    color:        cs.primaryContainer,
                    borderRadius: BorderRadius.circular(20),
                  ),
                  child: Text(
                    '${_caregivers.length}',
                    style: TextStyle(
                      fontSize:   12,
                      fontWeight: FontWeight.w700,
                      color:      cs.primary,
                    ),
                  ),
                ),
            ],
          ),

          const SizedBox(height: 12),

          if (_caregivers.isEmpty)
            Container(
              width:   double.infinity,
              padding: const EdgeInsets.symmetric(
                  horizontal: 20, vertical: 28),
              decoration: BoxDecoration(
                color:        cs.surface,
                borderRadius: BorderRadius.circular(20),
                border:       Border.all(color: amina.cardBorder),
              ),
              child: Column(
                children: [
                  Icon(Icons.people_outline_rounded,
                      size: 40, color: cs.onSurfaceVariant.withValues(alpha: 0.40)),
                  const SizedBox(height: 12),
                  Text(
                    'No caregivers connected yet',
                    style: TextStyle(
                      fontSize:   15,
                      fontWeight: FontWeight.w600,
                      color:      cs.onSurface,
                    ),
                  ),
                  const SizedBox(height: 4),
                  Text(
                    'Share your code above to give someone access.',
                    textAlign: TextAlign.center,
                    style: TextStyle(
                      fontSize: 13,
                      color:    cs.onSurfaceVariant,
                    ),
                  ),
                ],
              ),
            )
          else
            Container(
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
              child: Column(
                children: _caregivers
                    .asMap()
                    .entries
                    .map((e) => Column(
                          children: [
                            _CaregiverTile(
                              caregiver: e.value,
                              cs:        cs,
                              amina:     amina,
                              lastViewed: _timeLabel(e.value.lastViewed),
                              since:      _sinceLabel(e.value.connectedSince),
                              onRemove: () =>
                                  _confirmRemove(context, e.value),
                            ),
                            if (e.key < _caregivers.length - 1)
                              Divider(
                                  height: 1,
                                  indent: 72,
                                  color:  amina.cardBorder),
                          ],
                        ))
                    .toList(),
              ),
            ),

          const SizedBox(height: 16),

          // Privacy note
          Container(
            padding: const EdgeInsets.symmetric(
                horizontal: 14, vertical: 12),
            decoration: BoxDecoration(
              color:        cs.primaryContainer.withValues(alpha: 0.50),
              borderRadius: BorderRadius.circular(14),
              border: Border.all(
                  color: cs.primary.withValues(alpha: 0.15)),
            ),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Icon(Icons.info_outline_rounded,
                    color: cs.primary, size: 16),
                const SizedBox(width: 10),
                Expanded(
                  child: Text(
                    'Caregivers can only view your health data — they cannot edit entries, '
                    'send messages, or change your settings.',
                    style: TextStyle(
                      fontSize: 12.5,
                      color:    cs.onSurface,
                      height:   1.45,
                    ),
                  ),
                ),
              ],
            ),
          ),

          const SizedBox(height: 48),
        ],
      ),
    );
  }
}

// ─── Caregiver tile ───────────────────────────────────────────────────────────

class _CaregiverTile extends StatelessWidget {
  final _LinkedCaregiver caregiver;
  final ColorScheme      cs;
  final AminaColors      amina;
  final String           lastViewed;
  final String           since;
  final VoidCallback     onRemove;

  const _CaregiverTile({
    required this.caregiver,
    required this.cs,
    required this.amina,
    required this.lastViewed,
    required this.since,
    required this.onRemove,
  });

  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 16),
        child: Row(
          children: [
            // Avatar
            Container(
              width:  50,
              height: 50,
              decoration: const BoxDecoration(
                gradient: LinearGradient(
                  colors: [Color(0xFF6366F1), Color(0xFF4338CA)],
                  begin:  Alignment.topLeft,
                  end:    Alignment.bottomRight,
                ),
                shape: BoxShape.circle,
              ),
              child: Center(
                child: Text(
                  caregiver.initials,
                  style: const TextStyle(
                    color:      Colors.white,
                    fontSize:   17,
                    fontWeight: FontWeight.w800,
                  ),
                ),
              ),
            ),

            const SizedBox(width: 14),

            // Info
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    caregiver.name,
                    style: TextStyle(
                      fontSize:   16,
                      fontWeight: FontWeight.w700,
                      color:      cs.onSurface,
                    ),
                  ),
                  const SizedBox(height: 2),
                  Text(
                    caregiver.relationship,
                    style: TextStyle(
                      fontSize: 13,
                      color:    cs.onSurfaceVariant,
                    ),
                  ),
                  const SizedBox(height: 6),
                  Row(
                    children: [
                      Container(
                        padding: const EdgeInsets.symmetric(
                            horizontal: 7, vertical: 2),
                        decoration: BoxDecoration(
                          color:        cs.primaryContainer,
                          borderRadius: BorderRadius.circular(8),
                        ),
                        child: Text(
                          'Viewed $lastViewed',
                          style: TextStyle(
                            fontSize:   10.5,
                            fontWeight: FontWeight.w600,
                            color:      cs.primary,
                          ),
                        ),
                      ),
                      const SizedBox(width: 6),
                      Flexible(
                        child: Text(
                          '· Connected $since',
                          overflow: TextOverflow.ellipsis,
                          style: TextStyle(
                            fontSize: 11,
                            color:    cs.onSurfaceVariant,
                          ),
                        ),
                      ),
                    ],
                  ),
                ],
              ),
            ),

            // Remove button
            IconButton(
              onPressed: onRemove,
              tooltip:   'Remove access',
              icon: Container(
                width:  34,
                height: 34,
                decoration: BoxDecoration(
                  color:        const Color(0xFFFEF2F2),
                  borderRadius: BorderRadius.circular(10),
                  border: Border.all(
                      color: const Color(0xFFDC2626).withValues(alpha: 0.20)),
                ),
                child: const Icon(Icons.person_remove_rounded,
                    color: Color(0xFFDC2626), size: 17),
              ),
            ),
          ],
        ),
      );
}

// ─── How-it-works step ────────────────────────────────────────────────────────

class _HowStep extends StatelessWidget {
  final String number;
  final String text;
  const _HowStep({required this.number, required this.text});

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Container(
          width:  28,
          height: 28,
          decoration: BoxDecoration(
            color:  cs.primaryContainer,
            shape:  BoxShape.circle,
          ),
          child: Center(
            child: Text(
              number,
              style: TextStyle(
                fontSize:   13,
                fontWeight: FontWeight.w800,
                color:      cs.primary,
              ),
            ),
          ),
        ),
        const SizedBox(width: 12),
        Expanded(
          child: Padding(
            padding: const EdgeInsets.only(top: 4),
            child: Text(
              text,
              style: TextStyle(
                fontSize: 14,
                color:    cs.onSurface,
                height:   1.45,
              ),
            ),
          ),
        ),
      ],
    );
  }
}

class _HowDivider extends StatelessWidget {
  const _HowDivider();

  @override
  Widget build(BuildContext context) {
    final amina = Theme.of(context).extension<AminaColors>()!;
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 12),
      child: Divider(height: 1, color: amina.cardBorder),
    );
  }
}

// ─── Section header ───────────────────────────────────────────────────────────

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
