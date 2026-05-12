import 'package:flutter/material.dart';

class CaregiverBenefitsList extends StatelessWidget {
  const CaregiverBenefitsList({super.key});

  static const List<String> _items = [
    "They can see your location if you press SOS",
    "They can help you remember appointments",
    "They can support your health journey",
  ];

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(20),
      ),
      child: Column(
        children: _items
            .map(
              (text) => Padding(
                padding: const EdgeInsets.symmetric(vertical: 8),
                child: Row(
                  children: [
                    const Icon(Icons.check_circle, color: Colors.green, size: 20),
                    const SizedBox(width: 10),
                    Expanded(
                      child: Text(text, style: const TextStyle(fontSize: 14)),
                    ),
                  ],
                ),
              ),
            )
            .toList(),
      ),
    );
  }
}
