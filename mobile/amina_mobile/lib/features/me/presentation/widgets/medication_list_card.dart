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

﻿import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../../core/theme/app_theme.dart';
import '../../../today/presentation/providers/prescription_provider.dart';
import '../providers/stock_provider.dart';

// ─── Stock palette ─────────────────────────────────────────────────────────────

const _kStockGreenBg   = Color(0xFFECFDF5);
const _kStockGreenFg   = Color(0xFF065F46);
const _kStockGreenLine = Color(0xFF10B981);

const _kStockAmberBg   = Color(0xFFFFFBEB);
const _kStockAmberFg   = Color(0xFF92400E);
const _kStockAmberLine = Color(0xFFF59E0B);

const _kStockRedBg     = Color(0xFFFEF2F2);
const _kStockRedFg     = Color(0xFF991B1B);
const _kStockRedLine   = Color(0xFFEF4444);

// ─── Card ─────────────────────────────────────────────────────────────────────

/// A full-width tappable card representing a single [PrescriptionEntry].
///
/// Automatically reads [medicationStockProvider] and renders a [_StockBanner]
/// at the bottom that mirrors the live clinical-dashboard data.
class MedicationListCard extends ConsumerWidget {
  final PrescriptionEntry entry;
  final VoidCallback      onTap;

  const MedicationListCard({
    super.key,
    required this.entry,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final taken = entry.takenToday;
    final stock = ref.watch(medicationStockProvider(entry.medicationName));
    final cs    = Theme.of(context).colorScheme;
    final amina = Theme.of(context).extension<AminaColors>()!;

    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: Material(
        color:        cs.surface,
        borderRadius: BorderRadius.circular(18),
        child: InkWell(
          onTap:         onTap,
          borderRadius:  BorderRadius.circular(18),
          splashColor:   cs.primary.withValues(alpha: 0.06),
          child: Ink(
            decoration: BoxDecoration(
              borderRadius: BorderRadius.circular(18),
              border: Border.all(
                color: taken
                    ? amina.cardBorder
                    : cs.primary.withValues(alpha: 0.25),
              ),
              boxShadow: [
                BoxShadow(
                  color:      amina.sageGlow,
                  blurRadius: 12,
                  offset:     const Offset(0, 3),
                ),
              ],
            ),
            child: ClipRRect(
              borderRadius: BorderRadius.circular(18),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  IntrinsicHeight(
                    child: Row(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        // Left accent bar
                        AnimatedContainer(
                          duration: const Duration(milliseconds: 300),
                          width: 4,
                          color: taken ? amina.divider : cs.primary,
                        ),

                        // Pill icon
                        Padding(
                          padding: const EdgeInsets.symmetric(
                              horizontal: 14, vertical: 16),
                          child: AnimatedContainer(
                            duration: const Duration(milliseconds: 300),
                            width:  46,
                            height: 46,
                            decoration: BoxDecoration(
                              color: taken ? amina.inputFill : cs.primaryContainer,
                              shape: BoxShape.circle,
                            ),
                            child: Icon(
                              Icons.medication_rounded,
                              color: taken ? cs.onSurfaceVariant : cs.primary,
                              size:  22,
                            ),
                          ),
                        ),

                        // Text content
                        Expanded(
                          child: Padding(
                            padding: const EdgeInsets.symmetric(vertical: 16),
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              mainAxisAlignment:  MainAxisAlignment.center,
                              children: [
                                Row(
                                  children: [
                                    Expanded(
                                      child: Text(
                                        entry.medicationName,
                                        style: TextStyle(
                                          fontSize:   16,
                                          fontWeight: FontWeight.w700,
                                          color: taken
                                              ? cs.onSurfaceVariant
                                              : cs.onSurface,
                                          decoration: taken
                                              ? TextDecoration.lineThrough
                                              : TextDecoration.none,
                                          decorationColor: cs.onSurfaceVariant,
                                        ),
                                        maxLines: 1,
                                        overflow: TextOverflow.ellipsis,
                                      ),
                                    ),
                                    if (taken)
                                      _Badge(
                                        label: 'Taken',
                                        icon:  Icons.check_rounded,
                                        color: cs.primary,
                                        bg:    cs.primaryContainer,
                                      ),
                                    if (entry.fromScan && !taken)
                                      _Badge(
                                        label: 'AI',
                                        icon:  Icons.auto_awesome_rounded,
                                        color: const Color(0xFF3B82F6),
                                        bg:    const Color(0xFFEFF6FF),
                                      ),
                                  ],
                                ),
                                const SizedBox(height: 4),
                                Text(
                                  '${entry.dosage}  ·  ${entry.frequency}',
                                  style: TextStyle(
                                    fontSize: 14,
                                    color: taken
                                        ? cs.onSurfaceVariant.withValues(alpha: 0.6)
                                        : cs.onSurfaceVariant,
                                  ),
                                ),
                                const SizedBox(height: 2),
                                Text(
                                  entry.duration,
                                  style: TextStyle(
                                    fontSize: 12,
                                    color:    cs.onSurfaceVariant.withValues(alpha: 0.6),
                                  ),
                                ),
                              ],
                            ),
                          ),
                        ),

                        // Chevron
                        Padding(
                          padding: const EdgeInsets.only(right: 14),
                          child: Center(
                            child: Icon(
                              Icons.chevron_right_rounded,
                              color: cs.onSurfaceVariant,
                              size:  20,
                            ),
                          ),
                        ),
                      ],
                    ),
                  ),

                  _StockBanner(stock: stock),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

// ─── Stock banner ──────────────────────────────────────────────────────────────

/// Full-width strip at the bottom of the medication card showing real-time
/// availability from the clinical desktop dashboard.
///
/// Three visual states matching [StockStatus]:
///   • [StockStatus.inStock]    — emerald green  "Disponible en [Hospital]"
///   • [StockStatus.lowStock]   — amber          "Últimas unidades · [Hospital]"
///   • [StockStatus.outOfStock] — soft red       "Agotado en [Hospital]"
///
/// Designed for accessibility: WCAG AA contrast, 13 px minimum text,
/// distinct icon + color for each state.
class _StockBanner extends StatelessWidget {
  final HospitalStock stock;
  const _StockBanner({required this.stock});

  // ── Per-status palette ─────────────────────────────────────────────────────

  Color get _bg => switch (stock.status) {
        StockStatus.inStock    => _kStockGreenBg,
        StockStatus.lowStock   => _kStockAmberBg,
        StockStatus.outOfStock => _kStockRedBg,
      };

  Color get _fg => switch (stock.status) {
        StockStatus.inStock    => _kStockGreenFg,
        StockStatus.lowStock   => _kStockAmberFg,
        StockStatus.outOfStock => _kStockRedFg,
      };

  Color get _accent => switch (stock.status) {
        StockStatus.inStock    => _kStockGreenLine,
        StockStatus.lowStock   => _kStockAmberLine,
        StockStatus.outOfStock => _kStockRedLine,
      };

  IconData get _icon => switch (stock.status) {
        StockStatus.inStock    => Icons.check_circle_rounded,
        StockStatus.lowStock   => Icons.warning_amber_rounded,
        StockStatus.outOfStock => Icons.cancel_rounded,
      };

  String get _label => switch (stock.status) {
        StockStatus.inStock    =>
            'Disponible en ${stock.hospitalName}',
        StockStatus.lowStock   =>
            'Últimas unidades · ${stock.hospitalName}',
        StockStatus.outOfStock =>
            'Agotado en ${stock.hospitalName}',
      };

  String get _syncLabel {
    final diff = DateTime.now().difference(stock.lastSyncedAt);
    if (diff.inMinutes < 1)  return 'Ahora';
    if (diff.inMinutes < 60) return 'Hace ${diff.inMinutes}m';
    if (diff.inHours   < 24) return 'Hace ${diff.inHours}h';
    return 'Hace ${diff.inDays}d';
  }

  @override
  Widget build(BuildContext context) {
    return Semantics(
      label: _label,
      child: Container(
        width:   double.infinity,
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 9),
        decoration: BoxDecoration(
          color: _bg,
          border: Border(
            top:  BorderSide(color: _accent.withValues(alpha: 0.25), width: 1),
            left: BorderSide(color: _accent, width: 3),
          ),
        ),
        child: Row(
          children: [
            // Status icon with soft glow
            Container(
              width:  26, height: 26,
              decoration: BoxDecoration(
                color:  _accent.withValues(alpha: 0.15),
                shape:  BoxShape.circle,
                boxShadow: [
                  BoxShadow(
                    color:      _accent.withValues(alpha: 0.25),
                    blurRadius: 8,
                    spreadRadius: 1,
                  ),
                ],
              ),
              child: Icon(_icon, color: _accent, size: 15),
            ),

            const SizedBox(width: 10),

            // Main status text — expandable
            Expanded(
              child: Text(
                _label,
                style: TextStyle(
                  fontSize:   13,
                  fontWeight: FontWeight.w600,
                  color:      _fg,
                  height:     1.3,
                  fontFamily: 'Inter',
                ),
                maxLines:  2,
                overflow:  TextOverflow.ellipsis,
              ),
            ),

            const SizedBox(width: 8),

            // Last-sync timestamp — subtle secondary info
            Column(
              crossAxisAlignment: CrossAxisAlignment.end,
              mainAxisSize:       MainAxisSize.min,
              children: [
                Icon(Icons.sync_rounded,
                    size: 11, color: _fg.withValues(alpha: 0.55)),
                const SizedBox(height: 1),
                Text(
                  _syncLabel,
                  style: TextStyle(
                    fontSize:   10,
                    color:      _fg.withValues(alpha: 0.55),
                    fontFamily: 'Inter',
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

// ─── Small badge ──────────────────────────────────────────────────────────────

class _Badge extends StatelessWidget {
  final String   label;
  final IconData icon;
  final Color    color;
  final Color    bg;

  const _Badge({
    required this.label,
    required this.icon,
    required this.color,
    required this.bg,
  });

  @override
  Widget build(BuildContext context) => Container(
        margin:  const EdgeInsets.only(right: 8),
        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
        decoration: BoxDecoration(
          color:        bg,
          borderRadius: BorderRadius.circular(20),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(icon, size: 11, color: color),
            const SizedBox(width: 3),
            Text(
              label,
              style: TextStyle(
                fontSize:   11,
                fontWeight: FontWeight.w600,
                color:      color,
              ),
            ),
          ],
        ),
      );
}
