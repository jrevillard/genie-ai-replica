import 'package:flutter/material.dart';
import '../../../../core/theme/app_theme.dart';

class AppointmentCard extends StatelessWidget {
  final String hospital;
  final String time;
  final String specialty;

  const AppointmentCard({
    super.key,
    required this.hospital,
    required this.time,
    required this.specialty,
  });

  @override
  Widget build(BuildContext context) {
    final cs    = Theme.of(context).colorScheme;
    final amina = Theme.of(context).extension<AminaColors>()!;

    return Container(
      margin: const EdgeInsets.only(bottom: 12),
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color:        cs.surface,
        borderRadius: BorderRadius.circular(20),
        border:       Border.all(color: amina.cardBorder),
      ),
      child: Row(
        children: [
          Icon(Icons.calendar_month, size: 40, color: cs.primary),
          const SizedBox(width: 15),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  hospital,
                  style: TextStyle(
                    fontWeight: FontWeight.bold,
                    color:      cs.onSurface,
                  ),
                ),
                Text(
                  specialty,
                  style: TextStyle(color: cs.onSurfaceVariant, fontSize: 12),
                ),
                Text(
                  time,
                  style: TextStyle(
                      color: cs.primary, fontWeight: FontWeight.w500),
                ),
              ],
            ),
          ),
          IconButton.filled(
            onPressed: () {},
            icon: const Icon(Icons.map_sharp),
            style: IconButton.styleFrom(backgroundColor: cs.primary),
          ),
        ],
      ),
    );
  }
}
