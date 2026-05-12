import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:image_picker/image_picker.dart';

import '../../../../core/theme/app_theme.dart';
import '../../../auth/presentation/providers/auth_provider.dart';
import '../../data/models/gamification_model.dart';
import '../providers/avatar_provider.dart';
import '../providers/gamification_provider.dart';

// _kSage stays as brand identity — the sage green is intentional in both modes.
const _kSage = Color(0xFF3D9970);

// ─── Avatar catalogue ─────────────────────────────────────────────────────────

/// A single preset avatar entry: emoji + gradient background + accent colour.
class AvatarDef {
  final String      emoji;
  final List<Color> gradient;
  final String      label;
  final Color       accentColor;

  const AvatarDef({
    required this.emoji,
    required this.gradient,
    required this.label,
    required this.accentColor,
  });
}

/// Eight preset avatar designs shown in the horizontal picker row.
const kAvatarDefs = <AvatarDef>[
  AvatarDef(emoji: '🌸', label: 'Blossom',  accentColor: Color(0xFFFF6B9D), gradient: [Color(0xFFFFB3C6), Color(0xFFFF6B9D)]),
  AvatarDef(emoji: '🌊', label: 'Ocean',    accentColor: Color(0xFF0984E3), gradient: [Color(0xFF74B9FF), Color(0xFF0984E3)]),
  AvatarDef(emoji: '🌿', label: 'Nature',   accentColor: Color(0xFF00B894), gradient: [Color(0xFF55EFC4), Color(0xFF00B894)]),
  AvatarDef(emoji: '☀️', label: 'Sunny',    accentColor: Color(0xFFE17055), gradient: [Color(0xFFFDCB6E), Color(0xFFE17055)]),
  AvatarDef(emoji: '🎨', label: 'Creative', accentColor: Color(0xFF6C5CE7), gradient: [Color(0xFFD79EFF), Color(0xFF6C5CE7)]),
  AvatarDef(emoji: '🦋', label: 'Free',     accentColor: Color(0xFF00CEC9), gradient: [Color(0xFF81ECEC), Color(0xFF00CEC9)]),
  AvatarDef(emoji: '🔥', label: 'Fierce',   accentColor: Color(0xFFD63031), gradient: [Color(0xFFFF8C73), Color(0xFFD63031)]),
  AvatarDef(emoji: '🌙', label: 'Mystic',   accentColor: Color(0xFF6C5CE7), gradient: [Color(0xFF9B8FFF), Color(0xFF4A3F9E)]),
];

// ─── ProfileAvatarCard ────────────────────────────────────────────────────────

/// High-end profile header card for the Me screen.
///
/// ## Avatar states
///   • **Placeholder** — first launch, before any choice is made.
///     Shows a sage-gradient circle with the "Amina Care" health icon.
///   • **Preset** — one of 8 emoji-on-gradient designs, selected from the
///     horizontal scroll row below the avatar.
///   • **Custom photo** — a real image from the device camera or gallery.
///
/// ## Image-picker safety
///   Every failure path is guarded inside [_pickImage]:
///   1. `null` return → user pressed Cancel → silent no-op.
///   2. `!mounted` after the `await` → widget disposed → silent no-op.
///   3. `catch (_)` → OS permission denial / platform exception → SnackBar.
///   Riverpod state is **only** written when a valid file path is returned,
///   so a cancelled picker never corrupts the UI state.
///
/// ## Animations
///   • Elastic glow ring ([AnimationController] + [Curves.elasticOut]) replays
///     on every avatar change — preset tap, photo upload, or photo removal.
///   • [AnimatedSwitcher] with fade + scale transition handles the main avatar
///     area so changes never "glitch" — they always cross-fade.
///   • Each preset bubble press-scales to 0.86× on touch-down and springs back.
class ProfileAvatarCard extends ConsumerStatefulWidget {
  const ProfileAvatarCard({super.key});

  @override
  ConsumerState<ProfileAvatarCard> createState() => _ProfileAvatarCardState();
}

class _ProfileAvatarCardState extends ConsumerState<ProfileAvatarCard>
    with SingleTickerProviderStateMixin {

  // Elastic ring that bounces in whenever the active avatar changes.
  late final AnimationController _ringCtrl;
  late final Animation<double>   _ringAnim;

  @override
  void initState() {
    super.initState();
    _ringCtrl = AnimationController(
      vsync:    this,
      duration: const Duration(milliseconds: 720),
    );
    _ringAnim = CurvedAnimation(parent: _ringCtrl, curve: Curves.elasticOut);
    _ringCtrl.forward(); // play the ring once on first render
  }

  @override
  void dispose() {
    _ringCtrl.dispose();
    super.dispose();
  }

  // ── Image-picker ─────────────────────────────────────────────────────────────

  /// Launches [ImagePicker] for [source], then safely updates Riverpod state.
  ///
  /// All three "nothing to do" cases are handled explicitly so the widget
  /// never tries to call `setState` / `ref.read` on a stale or null value.
  Future<void> _pickImage(ImageSource source) async {
    try {
      final XFile? file = await ImagePicker().pickImage(
        source:       source,
        imageQuality: 85,   // balanced quality vs. memory
        maxWidth:     800,
      );

      if (file == null) return;  // ① User pressed Cancel — do nothing.
      if (!mounted)    return;   // ② Widget unmounted during the async gap.

      ref.read(avatarProvider.notifier).setCustomPhoto(file.path);
      _ringCtrl.forward(from: 0); // celebrate the new photo with the ring
    } catch (_) {
      // ③ OS permission denied, platform error, etc.
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content:  Text('Could not load photo — please check your permissions.'),
          behavior: SnackBarBehavior.floating,
        ),
      );
    }
  }

  /// Shows the source-picker bottom sheet.
  /// Reads [avatarProvider] once to decide whether to show "Remove Photo".
  void _showSourcePicker() {
    final currentState = ref.read(avatarProvider);
    showModalBottomSheet<void>(
      context:            context,
      backgroundColor:    Colors.transparent,
      isScrollControlled: true,
      builder: (sheetCtx) => _UploadSourceSheet(
        showRemove:    currentState.isCustomPhoto,
        selectedIndex: currentState.selectedIndex,
        onGallery: () {
          Navigator.pop(sheetCtx); // dismiss sheet first, then open picker
          _pickImage(ImageSource.gallery);
        },
        onCamera: () {
          Navigator.pop(sheetCtx);
          _pickImage(ImageSource.camera);
        },
        onRemove: () {
          Navigator.pop(sheetCtx);
          ref.read(avatarProvider.notifier).clearAll();
          _ringCtrl.forward(from: 0);
        },
        onPreset: (i) {
          Navigator.pop(sheetCtx);
          _onPresetSelected(i);
        },
      ),
    );
  }

  void _onPresetSelected(int index) {
    HapticFeedback.lightImpact();
    ref.read(avatarProvider.notifier).selectPreset(index);
    _ringCtrl.forward(from: 0);
  }

  // ── Build ────────────────────────────────────────────────────────────────────

  @override
  Widget build(BuildContext context) {
    final avatarState = ref.watch(avatarProvider);
    final stats       = ref.watch(gamificationProvider);
    final userName    = ref.watch(authProvider).user?.name ?? '';

    // Ring colour: the active preset's accent, or sage for placeholder / photo.
    final accentColor = avatarState.hasPreset
        ? kAvatarDefs[avatarState.selectedIndex].accentColor
        : _kSage;

    final cs    = Theme.of(context).colorScheme;
    final amina = Theme.of(context).extension<AminaColors>()!;

    return Container(
      decoration: BoxDecoration(
        color:        cs.surface,
        borderRadius: BorderRadius.circular(28),
        border:       Border.all(color: amina.cardBorder),
        boxShadow: [
          BoxShadow(
            color:      amina.sageGlow,
            blurRadius: 22,
            offset:     const Offset(0, 6),
          ),
        ],
      ),
      clipBehavior: Clip.antiAlias,
      child: Column(
        children: [

          // ── Tier banner ────────────────────────────────────────────────
          _TierBanner(stats: stats),

          const SizedBox(height: 24),

          // ── Main avatar + camera overlay ───────────────────────────────
          _MainAvatarSection(
            avatarState: avatarState,
            ringAnim:    _ringAnim,
            accentColor: accentColor,
            onCameraTap: _showSourcePicker,
          ),

          const SizedBox(height: 13),

          // ── Name + subtitle ────────────────────────────────────────────
          Text(
            userName,
            style: TextStyle(
              fontSize:      20,
              fontWeight:    FontWeight.w800,
              color:         cs.onSurface,
              letterSpacing: -0.3,
            ),
          ),
          const SizedBox(height: 3),
          Text(
            '${stats.villageName} · ${stats.tier.label}',
            style: TextStyle(fontSize: 13, color: cs.onSurfaceVariant),
          ),

          // ── Stats bar ──────────────────────────────────────────────
          Padding(
            padding: const EdgeInsets.fromLTRB(20, 22, 20, 0),
            child:   Divider(height: 1, color: amina.divider),
          ),
          _StatsBar(stats: stats),
          const SizedBox(height: 4),

        ],
      ),
    );
  }
}

// ─── Tier banner ──────────────────────────────────────────────────────────────

class _TierBanner extends StatelessWidget {
  final UserGameStats stats;
  const _TierBanner({required this.stats});

  static const _grad = LinearGradient(
    begin:  Alignment.centerLeft,
    end:    Alignment.centerRight,
    colors: [Color(0xFF2B7A56), Color(0xFF3D9970)],
  );

  @override
  Widget build(BuildContext context) {
    return Container(
      width:   double.infinity,
      padding: const EdgeInsets.symmetric(vertical: 9),
      decoration: const BoxDecoration(gradient: _grad),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Text(stats.tier.emoji, style: const TextStyle(fontSize: 15)),
          const SizedBox(width: 8),
          Text(
            '${stats.tier.label}  ·  ${stats.villageName}',
            style: const TextStyle(
              fontSize:      13,
              fontWeight:    FontWeight.w700,
              color:         Colors.white,
              letterSpacing: 0.1,
            ),
          ),
          const SizedBox(width: 8),
          const Icon(Icons.verified_rounded, color: Colors.white, size: 15),
        ],
      ),
    );
  }
}

// ─── Main avatar section ──────────────────────────────────────────────────────

/// 120 × 120 bounding box housing three layers (back → front):
///   1. **Elastic glow ring** (110 px) — bounces in via [ringAnim].
///   2. **Avatar content**  (96 px)  — [AnimatedSwitcher] fades between states.
///   3. **Camera edit button**        — 48 × 48 touch target, bottom-right.
class _MainAvatarSection extends StatelessWidget {
  final AvatarState       avatarState;
  final Animation<double> ringAnim;
  final Color             accentColor;
  final VoidCallback      onCameraTap;

  const _MainAvatarSection({
    required this.avatarState,
    required this.ringAnim,
    required this.accentColor,
    required this.onCameraTap,
  });

  // Selects the right content widget + a stable key for AnimatedSwitcher.
  Widget _content() {
    if (avatarState.isCustomPhoto) {
      return _PhotoAvatar(
        key:  ValueKey('photo:${avatarState.customPhotoPath}'),
        path: avatarState.customPhotoPath!,
      );
    }
    if (avatarState.hasPreset) {
      return _PresetAvatar(
        key: ValueKey('preset:${avatarState.selectedIndex}'),
        def: kAvatarDefs[avatarState.selectedIndex],
      );
    }
    return const _PlaceholderAvatar(key: ValueKey('placeholder'));
  }

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width:  120,
      height: 120,
      child: Stack(
        alignment: Alignment.center,
        children: [

          // ── 1. Elastic glow ring ───────────────────────────────────────
          AnimatedBuilder(
            animation: ringAnim,
            builder: (_, __) {
              // Clamp because elasticOut briefly overshoots 1.0.
              final v = ringAnim.value.clamp(0.0, 1.0);
              return Transform.scale(
                // Starts 20 % larger, bounces down to ×1.0.
                scale: 1.0 + (1 - v) * 0.20,
                child: Container(
                  width:  110,
                  height: 110,
                  decoration: BoxDecoration(
                    shape: BoxShape.circle,
                    border: Border.all(
                      color: accentColor.withValues(alpha: v),
                      width: 2.5,
                    ),
                    boxShadow: [
                      BoxShadow(
                        color:        accentColor.withValues(alpha: 0.28 * v),
                        blurRadius:   22,
                        spreadRadius: 3.0 * v,
                      ),
                    ],
                  ),
                ),
              );
            },
          ),

          // ── 2. Avatar content — smooth fade + scale on every change ────
          AnimatedSwitcher(
            duration:          const Duration(milliseconds: 420),
            transitionBuilder: (child, anim) => FadeTransition(
              opacity: anim,
              child:   ScaleTransition(
                scale: Tween(begin: 0.85, end: 1.0).animate(
                  CurvedAnimation(parent: anim, curve: Curves.easeOutCubic),
                ),
                child: child,
              ),
            ),
            child: _content(),
          ),

          // ── 3. Camera edit button ──────────────────────────────────────
          Positioned(
            bottom: 0,
            right:  0,
            child:  _CameraEditButton(onTap: onCameraTap),
          ),

        ],
      ),
    );
  }
}

// ─── Avatar content variants ──────────────────────────────────────────────────

/// Shown on first launch (no preset, no photo selected).
///
/// Medical-style: sage gradient circle, subtle inner ring,
/// health-and-safety icon, and a small "Amina Care" wordmark.
class _PlaceholderAvatar extends StatelessWidget {
  const _PlaceholderAvatar({super.key});

  static const _grad = LinearGradient(
    begin:  Alignment.topLeft,
    end:    Alignment.bottomRight,
    colors: [Color(0xFF4CAF88), Color(0xFF2B7A56)],
  );

  @override
  Widget build(BuildContext context) {
    return ClipOval(
      child: Container(
        width:  96,
        height: 96,
        decoration: const BoxDecoration(gradient: _grad),
        child: Stack(
          alignment: Alignment.center,
          children: [
            // Decorative inner ring — gives depth to the flat circle.
            Container(
              width:  74,
              height: 74,
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                border: Border.all(
                  color: Colors.white.withValues(alpha: 0.14),
                  width: 1.5,
                ),
              ),
            ),
            // Icon + app wordmark.
            Column(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                const Icon(
                  Icons.health_and_safety_rounded,
                  color: Colors.white,
                  size:  34,
                ),
                const SizedBox(height: 4),
                Text(
                  'Amina Care',
                  style: TextStyle(
                    fontSize:      7.5,
                    fontWeight:    FontWeight.w700,
                    color:         Colors.white.withValues(alpha: 0.82),
                    letterSpacing: 0.6,
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

/// One of the 8 emoji-on-gradient presets.
class _PresetAvatar extends StatelessWidget {
  final AvatarDef def;
  const _PresetAvatar({required this.def, super.key});

  @override
  Widget build(BuildContext context) {
    return ClipOval(
      child: Container(
        width:  96,
        height: 96,
        decoration: BoxDecoration(
          gradient: LinearGradient(
            colors: def.gradient,
            begin:  Alignment.topLeft,
            end:    Alignment.bottomRight,
          ),
        ),
        child: Center(child: Text(def.emoji, style: const TextStyle(fontSize: 44))),
      ),
    );
  }
}

/// Displays a real photo the user picked from the device.
///
/// Falls back to [_PlaceholderAvatar] if the file can no longer be read —
/// e.g. the user deleted it from their gallery after picking it.
class _PhotoAvatar extends StatelessWidget {
  final String path;
  const _PhotoAvatar({required this.path, super.key});

  @override
  Widget build(BuildContext context) {
    return ClipOval(
      child: SizedBox(
        width:  96,
        height: 96,
        child: Image.file(
          File(path),
          fit:          BoxFit.cover,
          // Graceful fallback so a broken path never shows an error widget.
          errorBuilder: (_, __, ___) => const _PlaceholderAvatar(),
        ),
      ),
    );
  }
}

// ─── Camera edit button ───────────────────────────────────────────────────────

/// A sage camera-icon badge positioned at the bottom-right of the avatar.
///
/// The invisible [SizedBox] provides a 48 × 48 touch target (WCAG / elderly-
/// accessible minimum), while the visible circle is 34 px for a clean look.
class _CameraEditButton extends StatelessWidget {
  final VoidCallback onTap;
  const _CameraEditButton({required this.onTap});

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap:    onTap,
      behavior: HitTestBehavior.opaque,
      child: SizedBox(
        width:  48, // accessible touch target
        height: 48,
        child: Center(
          child: Container(
            width:  34,
            height: 34,
            decoration: BoxDecoration(
              color:  _kSage,
              shape:  BoxShape.circle,
              border: Border.all(color: Colors.white, width: 2.5),
              boxShadow: const [
                BoxShadow(
                  color:      Color(0x28000000),
                  blurRadius: 8,
                  offset:     Offset(0, 2),
                ),
              ],
            ),
            child: const Icon(
              Icons.camera_alt_rounded,
              color: Colors.white,
              size:  17,
            ),
          ),
        ),
      ),
    );
  }
}

// ─── "Choose Your Style" divider rule ────────────────────────────────────────

class _PickerRule extends StatelessWidget {
  const _PickerRule();

  @override
  Widget build(BuildContext context) {
    final cs    = Theme.of(context).colorScheme;
    final amina = Theme.of(context).extension<AminaColors>()!;
    return Row(
      children: [
        Expanded(child: Container(height: 1, color: amina.cardBorder)),
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 12),
          child: Text(
            'Choose Your Style',
            style: TextStyle(
              fontSize:      11.5,
              fontWeight:    FontWeight.w700,
              color:         cs.onSurfaceVariant,
              letterSpacing: 0.7,
            ),
          ),
        ),
        Expanded(child: Container(height: 1, color: amina.cardBorder)),
      ],
    );
  }
}

// ─── Preset scroll row ────────────────────────────────────────────────────────

class _AvatarScrollRow extends StatelessWidget {
  final int               selectedIndex;
  final ValueChanged<int> onSelect;

  const _AvatarScrollRow({
    required this.selectedIndex,
    required this.onSelect,
  });

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      height: 86,
      child: ListView.builder(
        scrollDirection: Axis.horizontal,
        physics:         const BouncingScrollPhysics(),
        padding:         const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
        itemCount:       kAvatarDefs.length,
        itemBuilder: (_, i) => _AvatarBubble(
          def:        kAvatarDefs[i],
          isSelected: i == selectedIndex,
          onTap:      () => onSelect(i),
        ),
      ),
    );
  }
}

// ─── Preset avatar bubble ─────────────────────────────────────────────────────

/// 64 × 64 tappable bubble with a press-scale animation and an
/// [AnimatedContainer]-based selection ring.
class _AvatarBubble extends StatefulWidget {
  final AvatarDef    def;
  final bool         isSelected;
  final VoidCallback onTap;

  const _AvatarBubble({
    required this.def,
    required this.isSelected,
    required this.onTap,
  });

  @override
  State<_AvatarBubble> createState() => _AvatarBubbleState();
}

class _AvatarBubbleState extends State<_AvatarBubble>
    with SingleTickerProviderStateMixin {

  late final AnimationController _pressCtrl;
  late final Animation<double>   _pressAnim;

  @override
  void initState() {
    super.initState();
    _pressCtrl = AnimationController(
      vsync:    this,
      duration: const Duration(milliseconds: 110),
    );
    _pressAnim = Tween(begin: 1.0, end: 0.86).animate(
      CurvedAnimation(parent: _pressCtrl, curve: Curves.easeInOut),
    );
  }

  @override
  void dispose() {
    _pressCtrl.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final d          = widget.def;
    final isSelected = widget.isSelected;

    return GestureDetector(
      onTapDown:   (_) => _pressCtrl.forward(),
      onTapUp:     (_) { _pressCtrl.reverse(); widget.onTap(); },
      onTapCancel: ()  => _pressCtrl.reverse(),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 5),
        child: ScaleTransition(
          scale: _pressAnim,
          child: AnimatedContainer(
            duration: const Duration(milliseconds: 260),
            curve:    Curves.easeOutCubic,
            width:    64,
            height:   64,
            decoration: BoxDecoration(
              shape: BoxShape.circle,
              border: Border.all(
                color: isSelected ? d.accentColor : Colors.transparent,
                width: 2.5,
              ),
              boxShadow: isSelected
                  ? [BoxShadow(color: d.accentColor.withValues(alpha: 0.38), blurRadius: 14, spreadRadius: 1)]
                  : const [],
            ),
            child: ClipOval(
              child: Container(
                decoration: BoxDecoration(
                  gradient: LinearGradient(
                    colors: d.gradient,
                    begin:  Alignment.topLeft,
                    end:    Alignment.bottomRight,
                  ),
                ),
                child: Center(child: Text(d.emoji, style: const TextStyle(fontSize: 28))),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

// ─── Stats bar ────────────────────────────────────────────────────────────────

class _StatsBar extends StatelessWidget {
  final UserGameStats stats;
  const _StatsBar({required this.stats});

  static String _fmtXP(int xp) =>
      xp >= 1000 ? '${(xp / 1000).toStringAsFixed(1)}k' : '$xp';

  @override
  Widget build(BuildContext context) {
    final amina = Theme.of(context).extension<AminaColors>()!;
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 16),
      child: Row(
        children: [
          _StatItem(value: '${stats.earnedBadges.length}', label: 'Badges',       color: const Color(0xFFD97706)),
          Container(width: 1, height: 28, color: amina.divider),
          _StatItem(value: _fmtXP(stats.userXP),           label: 'XP Earned',    color: _kSage),
          Container(width: 1, height: 28, color: amina.divider),
          _StatItem(value: '#${stats.userRank}',            label: 'Village Rank', color: const Color(0xFF7C3AED)),
        ],
      ),
    );
  }
}

class _StatItem extends StatelessWidget {
  final String value;
  final String label;
  final Color  color;

  const _StatItem({required this.value, required this.label, required this.color});

  @override
  Widget build(BuildContext context) {
    return Expanded(
      child: Column(
        children: [
          Text(
            value,
            style: TextStyle(
              fontSize:      22,
              fontWeight:    FontWeight.w800,
              color:         color,
              letterSpacing: -0.5,
            ),
          ),
          const SizedBox(height: 2),
          Text(
            label,
            style: TextStyle(fontSize: 11.5, color: Theme.of(context).colorScheme.onSurfaceVariant, fontWeight: FontWeight.w500),
          ),
        ],
      ),
    );
  }
}

// ─── Upload source picker sheet ───────────────────────────────────────────────

/// Bottom sheet consolidating all identity choices in one place:
///   • Upload from Gallery
///   • Take a Photo
///   • Remove Current Photo (conditional)
///   • Choose Your Style — the 8 emoji preset bubbles
///
/// Callbacks are fired AFTER the sheet dismisses itself, so [ImagePicker]
/// opens with a clean navigation stack (no overlapping routes).
class _UploadSourceSheet extends StatelessWidget {
  final bool              showRemove;
  final int               selectedIndex; // mirrors current AvatarState
  final VoidCallback      onGallery;
  final VoidCallback      onCamera;
  final VoidCallback      onRemove;
  final ValueChanged<int> onPreset;

  const _UploadSourceSheet({
    required this.showRemove,
    required this.selectedIndex,
    required this.onGallery,
    required this.onCamera,
    required this.onRemove,
    required this.onPreset,
  });

  @override
  Widget build(BuildContext context) {
    final cs    = Theme.of(context).colorScheme;
    final amina = Theme.of(context).extension<AminaColors>()!;

    return Container(
      margin:  const EdgeInsets.fromLTRB(12, 0, 12, 16),
      padding: const EdgeInsets.fromLTRB(24, 16, 24, 8),
      decoration: BoxDecoration(
        color:        cs.surface,
        borderRadius: const BorderRadius.all(Radius.circular(28)),
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [

          // Drag handle
          Container(
            width:  36,
            height: 4,
            margin: const EdgeInsets.only(bottom: 20),
            decoration: BoxDecoration(
              color:        amina.cardBorder,
              borderRadius: BorderRadius.circular(2),
            ),
          ),

          // Header row
          Row(
            children: [
              Container(
                width:  44,
                height: 44,
                decoration: BoxDecoration(
                    color: cs.primaryContainer, shape: BoxShape.circle),
                child: Icon(
                    Icons.person_rounded, color: cs.primary, size: 22),
              ),
              const SizedBox(width: 14),
              Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    'Edit Profile Picture',
                    style: TextStyle(
                        fontSize:   17,
                        fontWeight: FontWeight.w800,
                        color:      cs.onSurface),
                  ),
                  Text(
                    'Upload a photo or pick a style',
                    style: TextStyle(fontSize: 12.5, color: cs.onSurfaceVariant),
                  ),
                ],
              ),
            ],
          ),

          const SizedBox(height: 20),

          // ── Photo options ──────────────────────────────────────────────
          _SheetOption(
            icon:  Icons.photo_library_rounded,
            label: 'Upload from Gallery',
            onTap: onGallery,
          ),
          const SizedBox(height: 10),
          _SheetOption(
            icon:  Icons.camera_alt_rounded,
            label: 'Take a Photo',
            onTap: onCamera,
          ),

          // "Remove Photo" — only when a custom photo is active
          if (showRemove) ...[
            const SizedBox(height: 10),
            _SheetOption(
              icon:      Icons.delete_outline_rounded,
              label:     'Remove Current Photo',
              onTap:     onRemove,
              iconColor: const Color(0xFFEF4444),
              iconBg:    const Color(0xFFFEF2F2),
              textColor: const Color(0xFFEF4444),
            ),
          ],

          // ── Style presets ──────────────────────────────────────────────
          const SizedBox(height: 18),
          const _PickerRule(),
          const SizedBox(height: 12),

          // Reuse the same bubble row — tapping a bubble pops sheet + selects.
          _AvatarScrollRow(
            selectedIndex: selectedIndex,
            onSelect:      onPreset,
          ),

          const SizedBox(height: 4),

          TextButton(
            onPressed: () => Navigator.pop(context),
            child: Text(
              'Cancel',
              style: TextStyle(
                  color:      Theme.of(context).colorScheme.onSurfaceVariant,
                  fontSize:   15,
                  fontWeight: FontWeight.w500),
            ),
          ),

          const SizedBox(height: 4),
        ],
      ),
    );
  }
}

class _SheetOption extends StatelessWidget {
  final IconData     icon;
  final String       label;
  final VoidCallback onTap;
  final Color?       iconColor;
  final Color?       iconBg;
  final Color?       textColor;

  const _SheetOption({
    required this.icon,
    required this.label,
    required this.onTap,
    this.iconColor,
    this.iconBg,
    this.textColor,
  });

  @override
  Widget build(BuildContext context) {
    final cs    = Theme.of(context).colorScheme;
    final amina = Theme.of(context).extension<AminaColors>()!;
    final resolvedIconColor = iconColor ?? cs.primary;
    final resolvedIconBg    = iconBg    ?? cs.primaryContainer;
    final resolvedTextColor = textColor ?? cs.onSurface;

    return Material(
      color:        amina.inputFill,
      borderRadius: BorderRadius.circular(16),
      child: InkWell(
        onTap:        onTap,
        borderRadius: BorderRadius.circular(16),
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
          child: Row(
            children: [
              Container(
                width:  44,
                height: 44,
                decoration: BoxDecoration(color: resolvedIconBg, shape: BoxShape.circle),
                child: Icon(icon, color: resolvedIconColor, size: 22),
              ),
              const SizedBox(width: 14),
              Expanded(
                child: Text(
                  label,
                  style: TextStyle(fontSize: 15.5, fontWeight: FontWeight.w600, color: resolvedTextColor),
                ),
              ),
              Icon(
                Icons.chevron_right_rounded,
                color: cs.onSurfaceVariant.withValues(alpha: 0.5),
                size:  20,
              ),
            ],
          ),
        ),
      ),
    );
  }
}
