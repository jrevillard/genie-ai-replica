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
import '../../../../core/theme/app_theme.dart';

/// Amina Care brand block shown at the top of every auth screen.
///
/// Reads all colours from the nearest Theme — works on both the forced-dark
/// auth surfaces and any future light-mode wrapper.

class AuthHeader extends StatelessWidget {
  const AuthHeader({super.key});

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    final amina = Theme.of(context).extension<AminaColors>()!;

    return Column(
      children: [
         // ── Logo glow disc — Oura-style sage ring ─────────────────────────
        Container(
          width: 88,
          height: 88,
          decoration: BoxDecoration(
            shape: BoxShape.circle,
            color: amina.sageLight,
            border: Border.all(
              color: cs.primary.withValues(alpha: 0.30),
              width: 1.5,
            ),
            boxShadow: [
              BoxShadow(
                color: amina.sageGlow,
                blurRadius: 40,
                spreadRadius: 6,
              ),
            ],
          ),
          child: const Center(
            child: Text('🌿', style: TextStyle(fontSize: 40)),
          ),
        ),
        const SizedBox(height: 22),
        Text(
          'Amina Care',
          style: TextStyle(
            fontSize: 28,
            fontWeight: FontWeight.w800,
            color: cs.onSurface,
            letterSpacing: -0.5,
            fontFamily: 'Inter',
          ),
        ),
        const SizedBox(height: 6),
        Text(
          'Your personal health companion',
          style: TextStyle(
            fontSize: 14,
            color: cs.onSurfaceVariant,
            fontFamily: 'Inter',
          ),
        ),
      ],
    );
  }
}
