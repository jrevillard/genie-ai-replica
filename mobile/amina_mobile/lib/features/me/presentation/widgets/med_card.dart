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

class MedCard extends StatelessWidget {
  final String name;
  final String dose;
  final String time;

  const MedCard({
    super.key,
    required this.name,
    required this.dose,
    required this.time,
  });

  @override
  Widget build(BuildContext context) {
    final cs    = Theme.of(context).colorScheme;
    final amina = Theme.of(context).extension<AminaColors>()!;

    return Container(
      width: 200,
      margin: const EdgeInsets.only(right: 15),
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: cs.surface,
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: amina.cardBorder),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            name,
            style: TextStyle(fontWeight: FontWeight.bold, fontSize: 16, color: cs.onSurface),
          ),
          Text(dose, style: TextStyle(color: cs.onSurfaceVariant)),
          Text("Time: $time", style: TextStyle(color: cs.onSurfaceVariant)),
          const Spacer(),
          ElevatedButton(
            onPressed: () {},
            style: ElevatedButton.styleFrom(
              backgroundColor: const Color(0xFFFDEEF1),
              foregroundColor: Colors.redAccent,
              elevation: 0,
              shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(12)),
            ),
            child: const Row(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                Icon(Icons.check_circle, size: 16),
                SizedBox(width: 5),
                Text("Taken"),
              ],
            ),
          ),
        ],
      ),
    );
  }
}
