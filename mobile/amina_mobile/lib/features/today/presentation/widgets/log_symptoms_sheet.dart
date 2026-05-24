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

void showLogSymptomsSheet(BuildContext context) {
  final cs = Theme.of(context).colorScheme;
  showModalBottomSheet(
    context: context,
    isScrollControlled: true,
    backgroundColor: cs.surface,
    shape: const RoundedRectangleBorder(
      borderRadius: BorderRadius.vertical(top: Radius.circular(32)),
    ),
    builder: (context) {
      final cs = Theme.of(context).colorScheme;
      return Padding(
        padding: EdgeInsets.only(
          bottom: MediaQuery.of(context).viewInsets.bottom + 20,
          top: 20,
          left: 24,
          right: 24,
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            // Drag handle
            Container(
              width: 40,
              height: 5,
              decoration: BoxDecoration(
                color: cs.onSurfaceVariant.withValues(alpha: 0.25),
                borderRadius: BorderRadius.circular(10),
              ),
            ),
            const SizedBox(height: 20),
            Text(
              "Daily Health Log",
              style: TextStyle(
                  fontSize: 22,
                  fontWeight: FontWeight.bold,
                  color: cs.onSurface),
            ),
            const SizedBox(height: 10),

            // AI shortcut tile
            ListTile(
              tileColor: const Color(0xFFF78B8B).withValues(alpha: 0.1),
              shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(15)),
              leading: const Icon(Icons.mic, color: Color(0xFFF78B8B)),
              title: Text(
                "Don't want to type?",
                style: TextStyle(
                    fontWeight: FontWeight.bold, color: cs.onSurface),
              ),
              subtitle: Text(
                "Just tell the AI how you feel",
                style: TextStyle(color: cs.onSurfaceVariant),
              ),
              onTap: () {
                Navigator.pop(context);
                // TODO: trigger mic logic or navigate to chat
              },
            ),

            const SizedBox(height: 25),

            // Symptoms chips
            Align(
              alignment: Alignment.centerLeft,
              child: Text(
                "Symptoms",
                style: TextStyle(
                    fontWeight: FontWeight.bold, color: cs.onSurface),
              ),
            ),
            Wrap(
              spacing: 8,
              children: ["Dizzy", "Headache", "Thirsty", "Blurred Vision", "Tired"]
                  .map(
                    (symptom) => FilterChip(
                      label: Text(symptom),
                      onSelected: (bool value) {},
                    ),
                  )
                  .toList(),
            ),

            const SizedBox(height: 20),

            // Vitals input row
            Row(
              children: [
                Expanded(
                  child: TextField(
                    keyboardType: TextInputType.number,
                    style: TextStyle(color: cs.onSurface),
                    decoration: InputDecoration(
                      labelText: "Glucose (mg/dL)",
                      border: OutlineInputBorder(
                          borderRadius: BorderRadius.circular(15)),
                    ),
                  ),
                ),
                const SizedBox(width: 15),
                Expanded(
                  child: TextField(
                    keyboardType: TextInputType.number,
                    style: TextStyle(color: cs.onSurface),
                    decoration: InputDecoration(
                      labelText: "BP (e.g. 120/80)",
                      border: OutlineInputBorder(
                          borderRadius: BorderRadius.circular(15)),
                    ),
                  ),
                ),
              ],
            ),

            const SizedBox(height: 30),

            // Save button
            SizedBox(
              width: double.infinity,
              height: 55,
              child: ElevatedButton(
                style: ElevatedButton.styleFrom(
                  backgroundColor: cs.primary,
                  shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(15)),
                ),
                onPressed: () => Navigator.pop(context),
                child: const Text(
                  "Save Log",
                  style: TextStyle(color: Colors.white, fontSize: 18),
                ),
              ),
            ),
          ],
        ),
      );
    },
  );
}
